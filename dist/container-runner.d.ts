import { ChildProcess } from 'child_process';
import { RegisteredGroup } from './types.js';
export interface ContainerInput {
    prompt: string;
    sessionId?: string;
    groupFolder: string;
    chatJid: string;
    isMain: boolean;
    isScheduledTask?: boolean;
    assistantName?: string;
    secrets?: Record<string, string>;
    provider?: string;
    isIsolated?: boolean;
    projectPath?: string;
    personaOverride?: string;
}
export interface ContainerOutput {
    status: 'success' | 'error';
    result: string | null;
    newSessionId?: string;
    error?: string;
    isFatal?: boolean;
}
export declare function runContainerAgent(group: RegisteredGroup, input: ContainerInput, onProcess: (proc: ChildProcess, containerName: string) => void, onOutput?: (output: ContainerOutput) => Promise<void>): Promise<ContainerOutput>;
export declare function writeTasksSnapshot(groupFolder: string, isMain: boolean, tasks: any[]): void;
export interface AvailableGroup {
    jid: string;
    name: string;
    lastActivity: string;
    isRegistered: boolean;
}
export declare function writeGroupsSnapshot(groupFolder: string, isMain: boolean, groups: AvailableGroup[], registeredJids: Set<string>): void;
//# sourceMappingURL=container-runner.d.ts.map