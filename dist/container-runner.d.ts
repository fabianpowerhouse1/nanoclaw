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
export interface VolumeMount {
    hostPath: string;
    containerPath: string;
    readonly: boolean;
}
export declare function buildVolumeMounts(group: RegisteredGroup, input: ContainerInput, ephemeralHomePath?: string): VolumeMount[];
/**
 * Deterministic Persona Resolution (V1.3)
 * Maps strict aliases to persona prompt files.
 */
export declare function resolvePersonaPath(personaOverride?: string): string;
export declare function runContainerAgent(group: RegisteredGroup, input: ContainerInput, onProcess: (proc: ChildProcess, containerName: string) => void, onOutput?: (output: ContainerOutput) => Promise<void>, extraArgs?: string[]): Promise<ContainerOutput>;
export declare function writeTasksSnapshot(groupFolder: string, isMain: boolean, tasks: any[]): void;
export interface AvailableGroup {
    jid: string;
    name: string;
    lastActivity: string;
    isRegistered: boolean;
}
export declare function writeGroupsSnapshot(groupFolder: string, isMain: boolean, groups: AvailableGroup[], registeredJids: Set<string>): void;
//# sourceMappingURL=container-runner.d.ts.map