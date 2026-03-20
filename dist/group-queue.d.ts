import { ChildProcess } from 'child_process';
import { NewMessage } from './types.js';
export declare class GroupQueue {
    private groups;
    private activeCount;
    private waitingGroups;
    private processMessagesFn;
    private shuttingDown;
    private getGroup;
    setProcessMessagesFn(fn: (groupJid: string, messages: NewMessage[]) => Promise<boolean>): void;
    markAsyncActive(groupJid: string, isActive: boolean): void;
    enqueueMessageCheck(groupJid: string, messages?: NewMessage[]): void;
    enqueueTask(groupJid: string, taskId: string, fn: () => Promise<void>): void;
    registerProcess(groupJid: string, proc: ChildProcess, containerName: string, groupFolder?: string): void;
    notifyIdle(groupJid: string): void;
    sendMessage(groupJid: string, text: string): boolean;
    closeStdin(groupJid: string): void;
    private runForGroup;
    private runTask;
    private scheduleRetry;
    drainGroup(groupJid: string): void;
    private drainWaiting;
    shutdown(_gracePeriodMs: number): Promise<void>;
}
//# sourceMappingURL=group-queue.d.ts.map