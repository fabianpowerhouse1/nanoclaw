import { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

import { DATA_DIR, MAX_CONCURRENT_CONTAINERS } from './config.js';
import { logger } from './logger.js';
import { NewMessage } from './types.js';

interface QueuedTask {
  id: string;
  groupJid: string;
  fn: () => Promise<void>;
}

const MAX_RETRIES = 5;
const BASE_RETRY_MS = 5000;

interface GroupState {
  active: boolean;
  idleWaiting: boolean;
  isAsyncActive: boolean;
  isTaskContainer: boolean;
  pendingMessages: NewMessage[]; // V8.8: Changed from boolean to array
  pendingTasks: QueuedTask[];
  process: ChildProcess | null;
  containerName: string | null;
  groupFolder: string | null;
  retryCount: number;
}

export class GroupQueue {
  private groups = new Map<string, GroupState>();
  private activeCount = 0;
  private waitingGroups: string[] = [];
  // V8.8: Update worker signature
  private processMessagesFn: ((groupJid: string, messages: NewMessage[]) => Promise<boolean>) | null = null;
  private shuttingDown = false;

  private getGroup(groupJid: string): GroupState {
    let state = this.groups.get(groupJid);
    if (!state) {
      state = {
        active: false,
        idleWaiting: false,
        isAsyncActive: false,
        isTaskContainer: false,
        pendingMessages: [],
        pendingTasks: [],
        process: null,
        containerName: null,
        groupFolder: null,
        retryCount: 0,
      };
      this.groups.set(groupJid, state);
    }
    return state;
  }

  setProcessMessagesFn(fn: (groupJid: string, messages: NewMessage[]) => Promise<boolean>): void {
    this.processMessagesFn = fn;
  }

  markAsyncActive(groupJid: string, isActive: boolean): void {
    const state = this.getGroup(groupJid);
    state.isAsyncActive = isActive;
    if (!isActive) {
      if (!state.active) {
        state.process = null;
        state.containerName = null;
        state.groupFolder = null;
      }
    }
  }

  // V8.8: Signature changed to accept messages
  enqueueMessageCheck(groupJid: string, messages?: NewMessage[]): void {
    if (this.shuttingDown) return;
    const state = this.getGroup(groupJid);

    if (messages) {
      state.pendingMessages.push(...messages);
    }
    
    // Don't start a new run if one is already active (sync or async)
    if (state.active || state.isAsyncActive) {
      logger.debug({ groupJid, count: messages?.length }, 'Container active, message(s) queued');
      return;
    }

    if (this.activeCount >= MAX_CONCURRENT_CONTAINERS) {
      if (!this.waitingGroups.includes(groupJid)) {
        this.waitingGroups.push(groupJid);
      }
      logger.debug(
        { groupJid, activeCount: this.activeCount },
        'At concurrency limit, message queued',
      );
      return;
    }

    this.runForGroup(groupJid, 'messages').catch((err) =>
      logger.error({ groupJid, err }, 'Unhandled error in runForGroup'),
    );
  }

  enqueueTask(groupJid: string, taskId: string, fn: () => Promise<void>): void {
    if (this.shuttingDown) return;
    const state = this.getGroup(groupJid);

    if (state.pendingTasks.some((t) => t.id === taskId)) {
      logger.debug({ groupJid, taskId }, 'Task already queued, skipping');
      return;
    }

    if (state.active || state.isAsyncActive) {
      state.pendingTasks.push({ id: taskId, groupJid, fn });
      if (state.idleWaiting) this.closeStdin(groupJid);
      logger.debug({ groupJid, taskId }, 'Container active, task queued');
      return;
    }

    if (this.activeCount >= MAX_CONCURRENT_CONTAINERS) {
      state.pendingTasks.push({ id: taskId, groupJid, fn });
      if (!this.waitingGroups.includes(groupJid)) this.waitingGroups.push(groupJid);
      logger.debug({ groupJid, taskId }, 'At concurrency limit, task queued');
      return;
    }

    this.runTask(groupJid, { id: taskId, groupJid, fn }).catch((err) =>
      logger.error({ groupJid, taskId, err }, 'Unhandled error in runTask'),
    );
  }

  registerProcess(groupJid: string, proc: ChildProcess, containerName: string, groupFolder?: string): void {
    const state = this.getGroup(groupJid);
    state.process = proc;
    state.containerName = containerName;
    if (groupFolder) state.groupFolder = groupFolder;
  }

  notifyIdle(groupJid: string): void {
    const state = this.getGroup(groupJid);
    state.idleWaiting = true;
    if (state.pendingTasks.length > 0) this.closeStdin(groupJid);
  }

  sendMessage(groupJid: string, text: string): boolean {
    const state = this.getGroup(groupJid);
    if (!(state.active || state.isAsyncActive) || !state.groupFolder || state.isTaskContainer) return false;
    state.idleWaiting = false;

    const inputDir = path.join(DATA_DIR, 'ipc', state.groupFolder, 'input');
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`;
      const filepath = path.join(inputDir, filename);
      const tempPath = `${filepath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify({ type: 'message', text }));
      fs.renameSync(tempPath, filepath);
      return true;
    } catch {
      return false;
    }
  }

  closeStdin(groupJid: string): void {
    const state = this.getGroup(groupJid);
    if (!(state.active || state.isAsyncActive) || !state.groupFolder) return;
    const inputDir = path.join(DATA_DIR, 'ipc', state.groupFolder, 'input');
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      fs.writeFileSync(path.join(inputDir, '_close'), '');
    } catch (e) {
      // ignore
    }
  }

  private async runForGroup(
    groupJid: string,
    reason: 'messages' | 'drain',
  ): Promise<void> {
    const state = this.getGroup(groupJid);
    if (state.pendingMessages.length === 0) return;

    const messagesToProcess = [...state.pendingMessages];
    state.pendingMessages = [];
    
    state.active = true;
    state.idleWaiting = false;
    state.isTaskContainer = false;
    this.activeCount++;

    logger.debug(
      { groupJid, reason, activeCount: this.activeCount, count: messagesToProcess.length },
      'Starting container for group messages',
    );

    try {
      if (this.processMessagesFn) {
        const success = await this.processMessagesFn(groupJid, messagesToProcess);
        if (success) state.retryCount = 0;
        else this.scheduleRetry(groupJid, messagesToProcess);
      }
    } catch (err) {
      logger.error({ groupJid, err }, 'Error processing messages for group');
      this.scheduleRetry(groupJid, messagesToProcess);
    } finally {
      state.active = false;
      this.activeCount--;
      if (!state.isAsyncActive) {
        state.process = null;
        state.containerName = null;
        state.groupFolder = null;
      }
    }
  }

  private async runTask(groupJid: string, task: QueuedTask): Promise<void> {
    const state = this.getGroup(groupJid);
    state.active = true;
    state.idleWaiting = false;
    state.isTaskContainer = true;
    this.activeCount++;

    logger.debug({ groupJid, taskId: task.id }, 'Running queued task');

    try {
      await task.fn();
    } catch (err) {
      logger.error({ groupJid, taskId: task.id, err }, 'Error running task');
    } finally {
      state.active = false;
      state.isTaskContainer = false;
      this.activeCount--;
      if (!state.isAsyncActive) {
        state.process = null;
        state.containerName = null;
        state.groupFolder = null;
      }
    }
  }

  private scheduleRetry(groupJid: string, failedMessages: NewMessage[]): void {
    const state = this.getGroup(groupJid);
    state.retryCount++;
    if (state.retryCount > MAX_RETRIES) {
      logger.error({ groupJid }, 'Max retries exceeded, dropping messages');
      state.retryCount = 0;
      return;
    }
    
    // Put failed messages back at the front of the queue
    state.pendingMessages.unshift(...failedMessages);

    const delayMs = BASE_RETRY_MS * Math.pow(2, state.retryCount - 1);
    logger.info({ groupJid, delayMs }, 'Scheduling retry');
    setTimeout(() => {
      if (!this.shuttingDown) this.enqueueMessageCheck(groupJid);
    }, delayMs);
  }

  public drainGroup(groupJid: string): void {
    // This function is now inert for messages, only for tasks.
    if (this.shuttingDown) return;
    const state = this.getGroup(groupJid);
    if (state.pendingTasks.length > 0) {
      const task = state.pendingTasks.shift()!;
      this.runTask(groupJid, task).catch((err) =>
        logger.error({ groupJid, err }, 'Unhandled error in drainGroup task'),
      );
      return;
    }
  }

  private drainWaiting(): void {
    while (this.waitingGroups.length > 0 && this.activeCount < MAX_CONCURRENT_CONTAINERS) {
      const nextJid = this.waitingGroups.shift()!;
      const state = this.getGroup(nextJid);
      if (state.pendingTasks.length > 0) {
        const task = state.pendingTasks.shift()!;
        this.runTask(nextJid, task).catch((err) =>
          logger.error({ groupJid: nextJid, err }, 'Unhandled error in drainWaiting task'),
        );
      } else if (state.pendingMessages.length > 0) {
        this.enqueueMessageCheck(nextJid);
      }
    }
  }

  async shutdown(_gracePeriodMs: number): Promise<void> {
    this.shuttingDown = true;
    logger.info({ activeCount: this.activeCount }, 'GroupQueue shutting down');
  }
}
