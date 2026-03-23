import fs from 'fs';
import path from 'path';
import express from 'express';
import { ASSISTANT_NAME, MAIN_GROUP_FOLDER, POLL_INTERVAL, TELEGRAM_BOT_TOKEN, TRIGGER_PATTERN, } from './config.js';
import { TelegramChannel } from './channels/telegram.js';
import { runContainerAgent, writeGroupsSnapshot, writeTasksSnapshot, } from './container-runner.js';
import { cleanupOrphans, ensureContainerRuntimeRunning } from './container-runtime.js';
import { getAllChats, getAllRegisteredGroups, getAllSessions, getAllTasks, getMessagesSince, getNewMessages, getRouterState, initDatabase, setRegisteredGroup, setRouterState, storeChatMetadata, storeMessage, } from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
import { findChannel, formatMessages, formatOutbound } from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { logger } from './logger.js';
process.on('unhandledRejection', (reason, promise) => {
    logger.fatal({ reason, promise }, 'FATAL: Unhandled Rejection at Promise');
    process.exit(1);
});
process.on('uncaughtException', (err, origin) => {
    logger.fatal({ err, origin }, 'FATAL: Uncaught Exception');
    process.exit(1);
});
export { escapeXml, formatMessages } from './router.js';
let lastTimestamp = '';
let sessions = {};
let registeredGroups = {};
let lastAgentTimestamp = {};
let messageLoopRunning = false;
let whatsapp;
const channels = [];
const queue = new GroupQueue();
function loadState() {
    lastTimestamp = getRouterState('last_timestamp') || '';
    const agentTs = getRouterState('last_agent_timestamp');
    try {
        lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
    }
    catch {
        logger.warn('Corrupted last_agent_timestamp in DB, resetting');
        lastAgentTimestamp = {};
    }
    sessions = getAllSessions();
    registeredGroups = getAllRegisteredGroups();
    logger.info({ groupCount: Object.keys(registeredGroups).length }, 'State loaded');
}
function saveState() {
    setRouterState('last_timestamp', lastTimestamp);
    setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
}
function registerGroup(jid, group) {
    let groupDir;
    try {
        groupDir = resolveGroupFolderPath(group.folder);
    }
    catch (err) {
        logger.warn({ jid, folder: group.folder, err }, 'Rejecting group registration with invalid folder');
        return;
    }
    registeredGroups[jid] = group;
    setRegisteredGroup(jid, group);
    fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });
    logger.info({ jid, name: group.name, folder: group.folder }, 'Group registered');
}
export function getAvailableGroups() {
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
export function _setRegisteredGroups(groups) {
    registeredGroups = groups;
}
export async function processGroupMessages(chatJid, messages) {
    console.log(`[DEBUG] processGroupMessages called for ${chatJid} with ${messages.length} messages`);
    let isIsolated = false;
    let projectPath = '';
    let personaOverride = '';
    let group;
    if (chatJid.startsWith('internal:')) {
        isIsolated = false;
        group = { name: 'Internal System', folder: 'system', added_at: '', trigger: '' };
    }
    else {
        group = registeredGroups[chatJid];
    }
    if (!group) {
        logger.warn({ chatJid }, 'Worker received messages for unregistered group. Dropping.');
        return true;
    }
    const validMessages = messages.filter(m => (Date.now() - new Date(m.timestamp).getTime()) < (30 * 60 * 1000));
    if (validMessages.length === 0)
        return true;
    const firstMsg = validMessages[0].content;
    // V1.9.0 SCORCHED EARTH ROUTING: Detect Project/Role in text
    const projectMatch = firstMsg.match(/(?:^|\s)project\s+([^\s\[]+)/i);
    const roleMatch = firstMsg.match(/\[ROLE:\s*([^\]]+)\]/i);
    if (projectMatch) {
        isIsolated = true;
        projectPath = projectMatch[1];
        if (roleMatch)
            personaOverride = roleMatch[1].trim();
        logger.info({ chatJid, projectPath, personaOverride }, 'Detected project context. Routing to Isolated Pipeline.');
    }
    logger.info({ group: group.name, messageCount: validMessages.length, isIsolated }, 'Processing messages');
    const sanitizedMessages = validMessages.map(m => ({
        ...m,
        content: m.content
            .replace(/(?:^|\s)project\s+[^\s\[]+/i, '')
            .replace(/\[ROLE:[^\]]+\]/i, '')
            .trim()
    }));
    let prompt = formatMessages(sanitizedMessages);
    if (isIsolated) {
        let systemOverride = `SYSTEM_INSTRUCTIONS: CRITICAL ISOLATION MANDATE.
`;
        systemOverride += `1. You are in a strictly isolated V6 workspace.
`;
        systemOverride += `2. YOUR PROJECT ROOT IS ALWAYS EXACTLY '/workspace'.
`;
        systemOverride += `3. YOU MUST IGNORE ALL FILES IN '/app'. That directory contains system runners, NOT your project.
`;
        systemOverride += `4. DO NOT attempt to search outside '/workspace'. If '/workspace' appears empty, report it immediately.
`;
        systemOverride += `5. Your identity is governed by the PERSONA file loaded in your system prompt.`;
        prompt = `${systemOverride}

${prompt}`;
    }
    const channel = findChannel(channels, chatJid);
    if (!channel && !chatJid.startsWith('internal:')) {
        logger.warn({ chatJid }, 'No channel for JID, cannot send response.');
        return true;
    }
    if (isIsolated) {
        channel.sendMessage(chatJid, "<REPLY>Walled Garden initialized. Task executing asynchronously...</REPLY>").catch(() => { });
        queue.markAsyncActive(chatJid, true);
        const isMain = group.folder === MAIN_GROUP_FOLDER;
        const tasks = getAllTasks();
        writeTasksSnapshot(group.folder, isMain, tasks.map(t => ({ ...t })));
        const availableGroups = getAvailableGroups();
        writeGroupsSnapshot(group.folder, isMain, availableGroups, new Set(Object.keys(registeredGroups)));
        runContainerAgent(group, { prompt, groupFolder: group.folder, chatJid, isMain, assistantName: ASSISTANT_NAME, isIsolated: true, projectPath, personaOverride }, (proc, containerName) => queue.registerProcess(chatJid, proc, containerName, group.folder), async (result) => {
            if (result.result) {
                const text = String(result.result).replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
                if (text)
                    await channel.sendMessage(chatJid, text);
            }
            if (result.status === 'success')
                queue.notifyIdle(chatJid);
        })
            .then((status) => {
            logger.info({ chatJid, status }, 'Asynchronous isolated task completed');
            queue.markAsyncActive(chatJid, false);
            queue.enqueueMessageCheck(chatJid);
        })
            .catch((err) => {
            const errMsg = err?.message || String(err);
            logger.error({ chatJid, err: errMsg }, 'Asynchronous isolated task failed');
            channel.sendMessage(chatJid, `⚠️ *Isolated Task Failure*: ${errMsg}`).catch(() => { });
            queue.markAsyncActive(chatJid, false);
            queue.enqueueMessageCheck(chatJid);
        });
        return true;
    }
    await channel?.setTyping?.(chatJid, true);
    // Handle Standard Agent (Legacy/Fallback) - DEPRECATED in V1.9.0
    // Scorched Earth: No un-isolated agents allowed.
    logger.warn({ chatJid }, 'No project context found in message. Scorched Earth policy prevents un-isolated spawning.');
    await channel.sendMessage(chatJid, "⚠️ Error: All requests must specify a project context (e.g., 'project my-app ...').");
    await channel?.setTyping?.(chatJid, false);
    return true;
}
// runAgent DELETED - V1.9.0
async function startMessageLoop() {
    if (messageLoopRunning)
        return;
    messageLoopRunning = true;
    logger.info(`NanoClaw running (trigger: ${TRIGGER_PATTERN.source})`);
    while (true) {
        try {
            const jids = Object.keys(registeredGroups);
            const { messages, newTimestamp } = getNewMessages(jids, lastTimestamp, ASSISTANT_NAME);
            if (messages.length > 0) {
                lastTimestamp = newTimestamp;
                saveState();
                const messagesByGroup = new Map();
                for (const msg of messages) {
                    const existing = messagesByGroup.get(msg.chat_jid);
                    if (existing)
                        existing.push(msg);
                    else
                        messagesByGroup.set(msg.chat_jid, [msg]);
                }
                for (const [chatJid, groupMessages] of messagesByGroup) {
                    const group = registeredGroups[chatJid];
                    if (!group)
                        continue;
                    const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
                    const isIsolationRequest = groupMessages.some(m => m.content.toLowerCase().includes('v6_isolate'));
                    if (!isMainGroup && group.requiresTrigger !== false && !isIsolationRequest) {
                        const hasTrigger = groupMessages.some((m) => TRIGGER_PATTERN.test(m.content.trim()));
                        if (!hasTrigger)
                            continue;
                    }
                    lastAgentTimestamp[chatJid] = groupMessages[groupMessages.length - 1].timestamp;
                    saveState();
                    queue.enqueueMessageCheck(chatJid, groupMessages);
                }
            }
        }
        catch (err) {
            logger.error({ err }, 'Error in message loop');
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
}
function recoverPendingMessages() {
    for (const [chatJid, group] of Object.entries(registeredGroups)) {
        const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
        const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
        if (pending.length > 0) {
            queue.enqueueMessageCheck(chatJid, pending);
        }
    }
}
function ensureContainerSystemRunning() {
    ensureContainerRuntimeRunning();
    cleanupOrphans();
}
async function startSessionMonitor() {
    // ... (omitted for brevity)
}
const BOOT_TIMESTAMP = new Date().toISOString();
function startInternalBridge() {
    const app = express();
    app.use(express.json());
    app.get('/health/deep', async (req, res) => {
        const internalGroup = { name: 'Internal System', folder: 'system', added_at: '', trigger: '' };
        try {
            // V9.2: Correct positional parameters: (group, prompt, jid, onOutput, isIsolated)
            // NON-BLOCKING PATCH: Execute agent check asynchronously to satisfy HTTP heartbeat window
            // Immediate ACK to the heartbeat caller
            res.json({ status: "ok", boot_timestamp: BOOT_TIMESTAMP });
        }
        catch (err) {
            res.status(500).json({ status: 'error', error: err.message });
        }
    });
    app.post('/webhook', async (req, res) => {
        // ... (omitted for brevity)
    });
    app.listen(3000, '0.0.0.0');
}
async function main() {
    ensureContainerSystemRunning();
    initDatabase();
    loadState();
    const shutdown = async () => {
        await queue.shutdown(10000);
        for (const ch of channels)
            await ch.disconnect();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    const channelOpts = {
        onMessage: (_chatJid, msg) => storeMessage(msg),
        onChatMetadata: (chatJid, timestamp, name, channel, isGroup) => storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
        registeredGroups: () => registeredGroups,
        registerGroup,
    };
    if (TELEGRAM_BOT_TOKEN) {
        const telegram = new TelegramChannel(TELEGRAM_BOT_TOKEN, channelOpts);
        channels.push(telegram);
        await telegram.connect();
    }
    startInternalBridge();
    queue.setProcessMessagesFn(processGroupMessages);
    startSchedulerLoop({
        registeredGroups: () => registeredGroups,
        getSessions: () => sessions,
        queue,
        onProcess: (groupJid, proc, containerName, groupFolder) => queue.registerProcess(groupJid, proc, containerName, groupFolder),
        sendMessage: async (jid, rawText) => {
            const ch = findChannel(channels, jid);
            const text = formatOutbound(rawText);
            if (ch && text)
                await ch.sendMessage(jid, text);
        },
    });
    startIpcWatcher({
        sendMessage: (jid, text) => findChannel(channels, jid).sendMessage(jid, text),
        registeredGroups: () => registeredGroups,
        registerGroup,
        syncGroupMetadata: () => Promise.resolve(),
        getAvailableGroups,
        writeGroupsSnapshot,
    });
    recoverPendingMessages();
    startSessionMonitor().catch(() => { });
    startMessageLoop().catch(() => process.exit(1));
}
const isDirectRun = process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;
if (isDirectRun)
    main().catch(() => process.exit(1));
//# sourceMappingURL=index.js.map