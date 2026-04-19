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
import { createApp } from './app.js';
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

process.on('unhandledRejection', (reason: any, promise) => {
  logger.fatal({ reason, promise }, 'FATAL: Unhandled Rejection at Promise');
  process.exit(1);
});

process.on('uncaughtException', (err, origin) => {
  logger.fatal({ err, origin }, 'FATAL: Uncaught Exception');
  process.exit(1);
});

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

  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

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

export function _setRegisteredGroups(groups: Record<string, RegisteredGroup>): void {
  registeredGroups = groups;
}

export async function processGroupMessages(chatJid: string, messages: NewMessage[]): Promise<boolean> {
  let isIsolated = false;
  let projectPath = '';
  let personaOverride = '';
  let projectPhase = '';
  let group: RegisteredGroup | undefined;

  if (chatJid.startsWith('internal:')) {
    isIsolated = false;
    group = { name: 'Internal System', folder: 'system', added_at: '', trigger: '' };
  } else {
    group = registeredGroups[chatJid];
  }

  if (!group) {
    logger.warn({ chatJid }, 'Worker received messages for unregistered group. Dropping.');
    return true;
  }

  const validMessages = messages.filter(m => (Date.now() - new Date(m.timestamp).getTime()) < (30 * 60 * 1000));
  if (validMessages.length === 0) return true;
  
  const firstMsg = validMessages[0].content;
  
  const projectMatch = firstMsg.match(/(?:^|\s)project\s+([^\s\[]+)/i);
  const roleMatch = firstMsg.match(/\[ROLE:\s*([^\]]+)\]/i);
  const phaseMatch = firstMsg.match(/\[PHASE:\s*([^\]]+)\]/i);
  
  if (projectMatch) {
    isIsolated = true;
    projectPath = projectMatch[1];
    if (roleMatch) personaOverride = roleMatch[1].trim();
    if (phaseMatch) projectPhase = phaseMatch[1].trim();
  }
  
  const sanitizedMessages = validMessages.map(m => ({
      ...m,
      content: m.content.trim()
  }));

  let prompt = formatMessages(sanitizedMessages);
  const channel = findChannel(channels, chatJid);
  if (!channel && !chatJid.startsWith('internal:')) return true;

  if (isIsolated) {
      runContainerAgent(
        group,
        { prompt, groupFolder: group.folder, chatJid, isMain: group.folder === MAIN_GROUP_FOLDER, assistantName: ASSISTANT_NAME, isIsolated: true, projectPath, personaOverride, projectPhase },
        (proc, containerName) => queue.registerProcess(chatJid, proc, containerName, group.folder),
        async (result) => {
          if (result.result) {
            const text = String(result.result).replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
            if (text) await channel!.sendMessage(chatJid, text);
          }
          if (result.status === 'success') queue.notifyIdle(chatJid);
        }
      );
      return true;
  }

  return true;
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) return;
  messageLoopRunning = true;
  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(jids, lastTimestamp, ASSISTANT_NAME);
      if (messages.length > 0) {
        lastTimestamp = newTimestamp;
        saveState();
        for (const msg of messages) {
          queue.enqueueMessageCheck(msg.chat_jid, [msg]);
        }
      }
    } catch (err) { logger.error({ err }, 'Error in message loop'); }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

function startInternalBridge(): void {
  const app = createApp(queue);
  app.listen(3000, '0.0.0.0', () => {
    logger.info('Internal HealthCheck Bridge running on port 3000');
  });
}

async function main(): Promise<void> {
  ensureContainerRuntimeRunning();
  initDatabase();
  loadState();
  const shutdown = async () => {
    await queue.shutdown(10000);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  
  startInternalBridge();
  queue.setProcessMessagesFn(processGroupMessages);
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) => queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const ch = findChannel(channels, jid);
      if (ch) await ch.sendMessage(jid, rawText);
    },
  });
  startMessageLoop().catch(() => process.exit(1));
}

const isDirectRun = process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;
if (isDirectRun) main().catch(() => process.exit(1));
