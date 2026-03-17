import fs from 'fs';
import path from 'path';
import express, { Request, Response } from 'express';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  POLL_INTERVAL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_ONLY,
  TRIGGER_PATTERN,
  PROVIDER,
  GEMINI_SESSION_PATH,
  TELEGRAM_ALLOWED_USERS,
} from './config.js';
import { WhatsAppChannel } from './channels/whatsapp.js';
import { TelegramChannel } from './channels/telegram.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import { cleanupOrphans, ensureContainerRuntimeRunning } from './container-runtime.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
import { findChannel, formatMessages, formatOutbound } from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;

let whatsapp: WhatsAppChannel;
const channels: Channel[] = [];
const queue = new GroupQueue();

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState(
    'last_agent_timestamp',
    JSON.stringify(lastAgentTimestamp),
  );
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    logger.warn(
      { jid, folder: group.folder, err },
      'Rejecting group registration with invalid folder',
    );
    return;
  }

  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Get available groups list for the agent.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.is_group)
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(groups: Record<string, RegisteredGroup>): void {
  registeredGroups = groups;
}

/**
 * Process all pending messages for a group.
 */
export async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const channel = findChannel(channels, chatJid);
  if (!channel) {
    console.log(`Warning: no channel owns JID ${chatJid}, skipping messages`);
    return true;
  }

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);

  if (missedMessages.length === 0) return true;

  // PATCH C: Backlog TTL (Skip messages older than 30 mins)
  const TTL_MS = 30 * 60 * 1000;
  const now = Date.now();
  const validMessages = missedMessages.filter(m => {
      const msgTime = new Date(m.timestamp).getTime();
      return (now - msgTime) < TTL_MS;
  });

  if (validMessages.length === 0) {
      logger.info({ chatJid }, 'Skipping stale backlog messages due to TTL');
      lastAgentTimestamp[chatJid] = missedMessages[missedMessages.length - 1].timestamp;
      saveState();
      return true;
  }

  // EXPERIMENTAL SHADOW ROUTE: Detect Isolation Request
  let isIsolated = false;
  let projectPath = '';
  let personaOverride = '';
  const firstMsg = validMessages[0].content;
  if (firstMsg.includes('[V6_ISOLATE:')) {
    const match = firstMsg.match(/\[V6_ISOLATE:([^\]]+)\]/);
    if (match) {
        isIsolated = true;
        projectPath = match[1];
        
        // PERSONA INJECTION: Extract [ROLE: PersonaName]
        const roleMatch = firstMsg.match(/\[ROLE:([^\]]+)\]/);
        if (roleMatch) {
            personaOverride = roleMatch[1].trim();
            logger.info({ chatJid, projectPath, personaOverride }, 'Processing isolated task with dynamic persona');
        } else {
            logger.info({ chatJid, projectPath }, 'Processing isolated Walled Garden task');
        }
    }
  }

  // For non-main groups, check if trigger is required
  if (!isMainGroup && group.requiresTrigger !== false && !isIsolated) {
    const hasTrigger = validMessages.some((m) =>
      TRIGGER_PATTERN.test(m.content.trim()),
    );
    if (!hasTrigger) return true;
  }

  // Scrub the isolation metadata and role tags from the prompt before sending to agent
  const sanitizedMessages = validMessages.map(m => ({
      ...m,
      content: m.content
        .replace(/\[V6_ISOLATE:[^\]]+\]/, '')
        .replace(/\[ROLE:[^\]]+\]/, '')
        .trim()
  }));

  let prompt = formatMessages(sanitizedMessages);
  
  // PATCH F: HARD ANCHORING & ANTI-HALLUCINATION
  if (isIsolated) {
      let systemOverride = `SYSTEM_INSTRUCTIONS: CRITICAL ISOLATION MANDATE.\n`;
      systemOverride += `1. You are in a strictly isolated V6 workspace.\n`;
      systemOverride += `2. YOUR PROJECT ROOT IS ALWAYS EXACTLY '/workspace'.\n`;
      systemOverride += `3. YOU MUST IGNORE ALL FILES IN '/app'. That directory contains system runners, NOT your project.\n`;
      systemOverride += `4. DO NOT attempt to search outside '/workspace'. If '/workspace' appears empty, report it immediately.\n`;
      systemOverride += `5. Your identity is governed by the PERSONA file loaded in your system prompt.`;
      
      prompt = `${systemOverride}\n\n${prompt}`;
  }

  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    validMessages[validMessages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, messageCount: validMessages.length, isIsolated },
    'Processing messages',
  );

  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug({ group: group.name }, 'Idle timeout, closing container stdin');
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  await channel.setTyping?.(chatJid, true);
  let hadError = false;
  let outputSentToUser = false;

  const output = await runAgent(group, prompt, chatJid, async (result) => {
    if (result.result) {
      const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
      const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
      if (text) {
        await channel.sendMessage(chatJid, text);
        outputSentToUser = true;
      }
      resetIdleTimer();
    }
    if (result.status === 'success') queue.notifyIdle(chatJid);
    if (result.status === 'error') hadError = true;
  }, isIsolated, projectPath, personaOverride);

  await channel.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (output === 'error' || hadError) {
    if (outputSentToUser) return true;
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    return false;
  }

  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
  isIsolated: boolean = false,
  projectPath?: string,
  personaOverride?: string,
): Promise<'success' | 'error'> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];

  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId && !isIsolated) {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId: isIsolated ? undefined : sessionId, // Isolated runs start fresh
        groupFolder: group.folder,
        chatJid,
        isMain,
        assistantName: ASSISTANT_NAME,
        isIsolated,
        projectPath,
        personaOverride,
      },
      (proc, containerName) => queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.newSessionId && !isIsolated) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return 'error';
    }

    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) return;
  messageLoopRunning = true;

  logger.info(`NanoClaw running (trigger: ${TRIGGER_PATTERN.source})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(jids, lastTimestamp, ASSISTANT_NAME);

      if (messages.length > 0) {
        lastTimestamp = newTimestamp;
        saveState();

        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) existing.push(msg);
          else messagesByGroup.set(msg.chat_jid, [msg]);
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const group = registeredGroups[chatJid];
          if (!group) continue;

          const channel = findChannel(channels, chatJid);
          if (!channel) continue;

          const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
          const isIsolationRequest = groupMessages.some(m => m.content.includes('[V6_ISOLATE:'));
          const needsTrigger = !isMainGroup && group.requiresTrigger !== false && !isIsolationRequest;

          if (needsTrigger) {
            const hasTrigger = groupMessages.some((m) =>
              TRIGGER_PATTERN.test(m.content.trim()),
            );
            if (!hasTrigger) continue;
          }

          const allPending = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          
          // Sanitize messages if isolation is active in any of them
          const sanitizedMessages = messagesToSend.map(m => ({
              ...m,
              content: m.content
                .replace(/\[V6_ISOLATE:[^\]]+\]/, '')
                .replace(/\[ROLE:[^\]]+\]/, '')
                .trim()
          }));
          const formatted = formatMessages(sanitizedMessages);

          if (queue.sendMessage(chatJid, formatted)) {
            lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            channel.setTyping?.(chatJid, true)?.catch(() => {});
          } else {
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

function ensureContainerSystemRunning(): void {
  ensureContainerRuntimeRunning();
  cleanupOrphans();
}

async function startSessionMonitor() {
  const check = async () => {
    if (PROVIDER !== 'gemini-cli') return;
    const credsFile = path.join(GEMINI_SESSION_PATH, 'oauth_creds.json');
    if (!fs.existsSync(credsFile)) return;
    try {
      const creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
      if (creds.expiry_date) {
        const expiry = new Date(creds.expiry_date);
        const diffHours = (expiry.getTime() - Date.now()) / (1000 * 60 * 60);
        if (diffHours < 24) {
          const telegram = channels.find(c => c instanceof TelegramChannel) as TelegramChannel | undefined;
          if (telegram) {
            for (const userId of TELEGRAM_ALLOWED_USERS) {
              await telegram.sendMessage(userId, `⚠️ *Powerhouse Session Alert*: Your Gemini browser session expires in ${Math.round(diffHours)} hours.`);
            }
          }
        }
      }
    } catch {}
  };
  await check();
  setInterval(check, 72 * 60 * 60 * 1000);
}

function startInternalBridge(): void {
  const app = express();
  app.use(express.json());
  app.get('/health/deep', async (req: Request, res: Response) => {
    const mainGroup = Object.values(registeredGroups)[0];
    const testJid = Object.keys(registeredGroups).find(k => registeredGroups[k].folder === MAIN_GROUP_FOLDER) || 'health-check';
    try {
      const result = await runAgent(mainGroup, 'HEALTH_OK', testJid);
      res.json({ status: result === 'success' ? 'ok' : 'error' });
    } catch (err: any) {
      res.status(500).json({ status: 'error', error: err.message });
    }
  });
  app.post('/webhook', async (req: Request, res: Response) => {
    const { chatJid, prompt, callbackUrl } = req.body;
    const group = registeredGroups[chatJid];
    if (!group) return res.status(404).json({ error: 'Group not found' });
    (async () => {
      try {
        const result = await runAgent(group, prompt, chatJid);
        if (callbackUrl) await fetch(callbackUrl, { method: 'POST', body: JSON.stringify({ chatJid, status: result }) });
      } catch {}
    })();
    res.json({ status: 'queued', chatJid });
  });
  app.listen(3000, '0.0.0.0');
}

async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  loadState();
  const shutdown = async () => {
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  const channelOpts = {
    onMessage: (_chatJid: string, msg: NewMessage) => storeMessage(msg),
    onChatMetadata: (chatJid: string, timestamp: string, name?: string, channel?: string, isGroup?: boolean) => storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredGroups: () => registeredGroups,
    registerGroup,
  };
  if (TELEGRAM_BOT_TOKEN) {
    const telegram = new TelegramChannel(TELEGRAM_BOT_TOKEN, channelOpts);
    channels.push(telegram);
    await telegram.connect();
  }
  startInternalBridge();
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) => queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const ch = findChannel(channels, jid);
      const text = formatOutbound(rawText);
      if (ch && text) await ch.sendMessage(jid, text);
    },
  });
  startIpcWatcher({
    sendMessage: (jid, text) => findChannel(channels, jid)!.sendMessage(jid, text),
    registeredGroups: () => registeredGroups,
    registerGroup,
    syncGroupMetadata: () => Promise.resolve(),
    getAvailableGroups,
    writeGroupsSnapshot,
  });
  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();
  startSessionMonitor().catch(() => {});
  startMessageLoop().catch(() => process.exit(1));
}

const isDirectRun = process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;
if (isDirectRun) main().catch(() => process.exit(1));
