/**
 * Container Runner for NanoClaw
 * Spawns agent execution in containers and handles IPC
 */
import { ChildProcess, exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  CONTAINER_IMAGE,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  TIMEZONE,
  HOST_PROJECT_PATH,
  PROVIDER,
  GEMINI_SESSION_PATH,
  SKILL_SERVICE_URL,
  SKILL_SERVICE_PSK,
} from './config.js';
import { readEnvFile } from './env.js';
import { resolveGroupFolderPath, resolveGroupIpcPath } from './group-folder.js';
import { logger } from './logger.js';
import { CONTAINER_RUNTIME_BIN, readonlyMountArgs, stopContainer } from './container-runtime.js';
import { validateAdditionalMounts } from './mount-security.js';
import { RegisteredGroup } from './types.js';

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

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
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

/**
 * Translate a local path (inside the bot container) to a host path
 * for Docker-out-of-Docker (DooD) support.
 */
function toHostPath(localPath: string): string {
  // Special case: SSH socket translation for DooD
  if (localPath === '/ssh-agent' && process.env.HOST_SSH_AUTH_SOCK) {
    return process.env.HOST_SSH_AUTH_SOCK;
  }

  // Special case: Gemini session path
  if (localPath === "/root/.gemini" || localPath === GEMINI_SESSION_PATH) {
      return "/home/ubuntu/.gemini";
  }

  if (!HOST_PROJECT_PATH) return localPath;
  
  const projectRoot = process.cwd();
  // Ensure we are comparing absolute paths
  const absoluteLocal = path.resolve(localPath);
  const absoluteProject = path.resolve(projectRoot);

  if (absoluteLocal.startsWith(absoluteProject)) {
    const relative = path.relative(absoluteProject, absoluteLocal);
    return path.join(HOST_PROJECT_PATH, relative);
  }
  
  return localPath;
}

/**
 * Ensure a directory exists and is writable by the container's node user (UID 1000).
 * Since the bot runs as root, newly created directories are root-owned.
 */
function ensureWritableDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  
  // If we are root, ensure the directory is owned/writable by UID 1000 (node user)
  if (process.getuid?.() === 0) {
    try {
      // 1000:1000 is the default 'node' user in official images
      fs.chownSync(dirPath, 1000, 1000);
    } catch (err) {
      // Ignore errors (e.g. on filesystems that don't support ownership)
    }
  }
}

function buildVolumeMounts(
  group: RegisteredGroup,
  isMain: boolean,
): VolumeMount[] {
  const mounts: VolumeMount[] = [];
  const projectRoot = process.cwd();
  const groupDir = resolveGroupFolderPath(group.folder);

  if (isMain) {
    // Main gets the project root read-only.
    mounts.push({
      hostPath: toHostPath(projectRoot),
      containerPath: '/workspace/project',
      readonly: true,
    });

    // Main also gets its group folder as the working directory
    ensureWritableDir(groupDir);
    mounts.push({
      hostPath: toHostPath(groupDir),
      containerPath: '/workspace/group',
      readonly: false,
    });
  } else {
    // Other groups only get their own folder
    ensureWritableDir(groupDir);
    mounts.push({
      hostPath: toHostPath(groupDir),
      containerPath: '/workspace/group',
      readonly: false,
    });

    // Global memory directory (read-only for non-main)
    const globalDir = path.join(GROUPS_DIR, 'global');
    if (fs.existsSync(globalDir)) {
      mounts.push({
        hostPath: toHostPath(globalDir),
        containerPath: '/workspace/global',
        readonly: true,
      });
    }
  }

  // Gemini CLI Session Mount
  if (PROVIDER === 'gemini-cli' && fs.existsSync(GEMINI_SESSION_PATH)) {
    mounts.push({
      hostPath: toHostPath(GEMINI_SESSION_PATH),
      containerPath: '/root/.gemini',
      readonly: false,
    });
  }

  // SSH Agent Forwarding
  if (process.env.SSH_AUTH_SOCK) {
    mounts.push({
      hostPath: toHostPath(process.env.SSH_AUTH_SOCK),
      containerPath: '/ssh-agent',
      readonly: false,
    });
  }

  // Decoupled Skill Tool: pw-sync
  // Mounted from orchestrator/infra/skill-service/src/pw-sync.js
  const pwSyncPath = path.resolve(projectRoot, '..', 'orchestrator', 'infra', 'skill-service', 'src', 'pw-sync.js');
  if (fs.existsSync(pwSyncPath)) {
    mounts.push({
      hostPath: toHostPath(pwSyncPath),
      containerPath: '/usr/local/bin/pw-sync',
      readonly: true,
    });
  }

  // Per-group Claude sessions directory
  const groupSessionsDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    '.claude',
  );
  ensureWritableDir(groupSessionsDir);
  
  const settingsFile = path.join(groupSessionsDir, 'settings.json');
  if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(settingsFile, JSON.stringify({
      env: {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
      },
    }, null, 2) + '\n');
    if (process.getuid?.() === 0) fs.chownSync(settingsFile, 1000, 1000);
  }

  // Sync skills
  const skillsSrc = path.join(process.cwd(), 'container', 'skills');
  const skillsDst = path.join(groupSessionsDir, 'skills');
  if (fs.existsSync(skillsSrc)) {
    ensureWritableDir(skillsDst);
    for (const skillDir of fs.readdirSync(skillsSrc)) {
      const srcDir = path.join(skillsSrc, skillDir);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      const dstDir = path.join(skillsDst, skillDir);
      if (!fs.existsSync(dstDir)) {
        fs.cpSync(srcDir, dstDir, { recursive: true });
        if (process.getuid?.() === 0) {
           // Recursively chown copied skills
           const chownRecursive = (p: string) => {
             fs.chownSync(p, 1000, 1000);
             if (fs.statSync(p).isDirectory()) {
               for (const f of fs.readdirSync(p)) chownRecursive(path.join(p, f));
             }
           };
           chownRecursive(dstDir);
        }
      }
    }
  }
  mounts.push({
    hostPath: toHostPath(groupSessionsDir),
    containerPath: '/home/node/.claude',
    readonly: false,
  });

  // Per-group IPC namespace
  const groupIpcDir = resolveGroupIpcPath(group.folder);
  ensureWritableDir(path.join(groupIpcDir, 'messages'));
  ensureWritableDir(path.join(groupIpcDir, 'tasks'));
  ensureWritableDir(path.join(groupIpcDir, 'input'));
  mounts.push({
    hostPath: toHostPath(groupIpcDir),
    containerPath: '/workspace/ipc',
    readonly: false,
  });

  // Sync agent-runner source (ALWAYS sync to ensure latest runner is used)
  const agentRunnerSrc = path.join(projectRoot, 'container', 'agent-runner', 'src');
  const groupAgentRunnerDir = path.join(DATA_DIR, 'sessions', group.folder, 'agent-runner-src');
  if (fs.existsSync(agentRunnerSrc)) {
    ensureWritableDir(groupAgentRunnerDir);
    fs.cpSync(agentRunnerSrc, groupAgentRunnerDir, { recursive: true });
    if (process.getuid?.() === 0) {
      for (const f of fs.readdirSync(groupAgentRunnerDir)) {
        fs.chownSync(path.join(groupAgentRunnerDir, f), 1000, 1000);
      }
      fs.chownSync(groupAgentRunnerDir, 1000, 1000);
    }
  }
  mounts.push({
    hostPath: toHostPath(groupAgentRunnerDir),
    containerPath: '/app/src_mount',
    readonly: false,
  });

  // Additional mounts
  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(
      group.containerConfig.additionalMounts,
      group.name,
      isMain,
    );
    // Translate additional mounts as well if they are within project root
    const translatedMounts = validatedMounts.map(m => ({
      ...m,
      hostPath: toHostPath(m.hostPath)
    }));
    mounts.push(...translatedMounts);
  }

  return mounts;
}

/**
 * Read allowed secrets from .env for passing to the container via stdin.
 * Secrets are never written to disk or mounted as files.
 */
function readSecrets(): Record<string, string> {
  const secrets = readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']);
  
  // Inject Skill Service PSK if available
  if (SKILL_SERVICE_PSK) {
    secrets.SKILL_SERVICE_PSK = SKILL_SERVICE_PSK;
  }
  
  return secrets;
}

function buildContainerArgs(
  mounts: VolumeMount[],
  containerName: string,
  input?: ContainerInput,
): string[] {
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  // Pass host timezone so container's local time matches the user's
  args.push('-e', `TZ=${TIMEZONE}`);

  // Skill Service configuration
  if (SKILL_SERVICE_URL) {
    args.push('-e', `SKILL_SERVICE_URL=${SKILL_SERVICE_URL}`);
    // If we are in a docker-compose environment, we likely want to be on the same network
    // 'core-net' is the default for our orchestrator stack.
    args.push('--network', 'infra_core-net'); 
  }

  // SSH Agent Forwarding
  if (process.env.SSH_AUTH_SOCK) {
    args.push('-e', 'SSH_AUTH_SOCK=/ssh-agent');
  }

  // Run as host user so bind-mounted files are accessible.
  // Skip when running as root (uid 0), as the container's node user (uid 1000),
  // or when getuid is unavailable (native Windows without WSL).
  const hostUid = process.getuid?.();
  const hostGid = process.getgid?.();
  if (hostUid != null && hostUid !== 0 && hostUid !== 1000) {
    args.push('--user', `${hostUid}:${hostGid}`);
    args.push('-e', 'HOME=/home/node');
  }

  for (const mount of mounts) {
    if (mount.readonly) {
      args.push(...readonlyMountArgs(mount.hostPath, mount.containerPath));
    } else {
      args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
    }
  }

  args.push(CONTAINER_IMAGE);

  return args;
}

export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput> {
  const startTime = Date.now();

  const groupDir = resolveGroupFolderPath(group.folder);
  ensureWritableDir(groupDir);

  const mounts = buildVolumeMounts(group, input.isMain);
  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const containerName = `nanoclaw-agent-${safeName}-${Date.now()}`;
  const containerArgs = buildContainerArgs(mounts, containerName, input);

  logger.debug(
    {
      group: group.name,
      containerName,
      mounts: mounts.map(
        (m) =>
          `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
      ),
      containerArgs: containerArgs.join(' '),
    },
    'Container mount configuration',
  );

  logger.info(
    {
      group: group.name,
      containerName,
      mountCount: mounts.length,
      isMain: input.isMain,
    },
    'Spawning container agent',
  );

  const logsDir = path.join(groupDir, 'logs');
  ensureWritableDir(logsDir);

  return new Promise((resolve) => {
    const container = spawn(CONTAINER_RUNTIME_BIN, containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    onProcess(container, containerName);

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    // Pass secrets via stdin (never written to disk or mounted as files)
    input.secrets = readSecrets();
    input.provider = PROVIDER;
    container.stdin.write(JSON.stringify(input));
    container.stdin.end();
    // Remove secrets from input so they don't appear in logs
    delete input.secrets;

    // Streaming output: parse OUTPUT_START/END marker pairs as they arrive
    let parseBuffer = '';
    let newSessionId: string | undefined;
    let outputChain = Promise.resolve();
    let hadStreamingOutput = false;

    container.stdout.on('data', (data) => {
      const chunk = data.toString();

      // Always accumulate for logging
      if (!stdoutTruncated) {
        const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
        if (chunk.length > remaining) {
          stdout += chunk.slice(0, remaining);
          stdoutTruncated = true;
          logger.warn(
            { group: group.name, size: stdout.length },
            'Container stdout truncated due to size limit',
          );
        } else {
          stdout += chunk;
        }
      }

      // Stream-parse for output markers
      if (onOutput) {
        parseBuffer += chunk;
        let startIdx: number;
        while ((startIdx = parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
          const endIdx = parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
          if (endIdx === -1) break; // Incomplete pair, wait for more data

          const jsonStr = parseBuffer
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
          parseBuffer = parseBuffer.slice(endIdx + OUTPUT_END_MARKER.length);

          try {
            const parsed: ContainerOutput = JSON.parse(jsonStr);
            if (parsed.newSessionId) {
              newSessionId = parsed.newSessionId;
            }
            hadStreamingOutput = true;
            // Activity detected — reset the hard timeout
            resetTimeout();
            // Call onOutput for all markers (including null results)
            // so idle timers start even for "silent" query completions.
            outputChain = outputChain.then(() => onOutput(parsed));
          } catch (err) {
            logger.warn(
              { group: group.name, error: err, jsonStr, stdout, stderr },
              'Failed to parse streamed output chunk',
            );
          }
        }
      }
    });

    container.stderr.on('data', (data) => {
      const chunk = data.toString();
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug({ container: group.folder }, line);
      }
      // Don't reset timeout on stderr — SDK writes debug logs continuously.
      // Timeout only resets on actual output (OUTPUT_MARKER in stdout).
      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
        logger.warn(
          { group: group.name, size: stderr.length },
          'Container stderr truncated due to size limit',
        );
      } else {
        stderr += chunk;
      }
    });

    let timedOut = false;
    const configTimeout = group.containerConfig?.timeout || CONTAINER_TIMEOUT;
    // Grace period: hard timeout must be at least IDLE_TIMEOUT + 30s so the
    // graceful _close sentinel has time to trigger before the hard kill fires.
    const timeoutMs = Math.max(configTimeout, IDLE_TIMEOUT + 30_000);

    const killOnTimeout = () => {
      timedOut = true;
      logger.error({ group: group.name, containerName }, 'Container timeout, stopping gracefully');
      exec(stopContainer(containerName), { timeout: 15000 }, (err) => {
        if (err) {
          logger.warn({ group: group.name, containerName, err }, 'Graceful stop failed, force killing');
          container.kill('SIGKILL');
        }
      });
    };

    let timeout = setTimeout(killOnTimeout, timeoutMs);

    // Reset the timeout whenever there's activity (streaming output)
    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(killOnTimeout, timeoutMs);
    };

    container.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      if (timedOut) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const timeoutLog = path.join(logsDir, `container-${ts}.log`);
        fs.writeFileSync(timeoutLog, [
          `=== Container Run Log (TIMEOUT) ===`,
          `Timestamp: ${new Date().toISOString()}`,
          `Group: ${group.name}`,
          `Container: ${containerName}`,
          `Duration: ${duration}ms`,
          `Exit Code: ${code}`,
          `Had Streaming Output: ${hadStreamingOutput}`,
        ].join('\n'));
        if (process.getuid?.() === 0) fs.chownSync(timeoutLog, 1000, 1000);

        // Timeout after output = idle cleanup, not failure.
        // The agent already sent its response; this is just the
        // container being reaped after the idle period expired.
        if (hadStreamingOutput) {
          logger.info(
            { group: group.name, containerName, duration, code },
            'Container timed out after output (idle cleanup)',
          );
          outputChain.then(() => {
            resolve({
              status: 'success',
              result: null,
              newSessionId,
            });
          });
          return;
        }

        logger.error(
          { group: group.name, containerName, duration, code },
          'Container timed out with no output',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Container timed out after ${configTimeout}ms`,
        });
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `container-${timestamp}.log`);

      const logLines = [
        `=== Container Run Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Group: ${group.name}`,
        `IsMain: ${input.isMain}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
        `Stdout Truncated: ${stdoutTruncated}`,
        `Stderr Truncated: ${stderrTruncated}`,
        ``,
        `=== Input ===`,
        JSON.stringify(input, null, 2),
        ``,
        `=== Container Args ===`,
        containerArgs.join(' '),
        ``,
        `=== Mounts ===`,
        mounts
          .map(
            (m) =>
              `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
          )
          .join('\n'),
        ``,
        `=== Stderr${stderrTruncated ? ' (TRUNCATED)' : ''} ===`,
        stderr,
        ``,
        `=== Stdout${stdoutTruncated ? ' (TRUNCATED)' : ''} ===`,
        stdout,
      ];

      fs.writeFileSync(logFile, logLines.join('\n'));
      if (process.getuid?.() === 0) fs.chownSync(logFile, 1000, 1000);

      if (code !== 0) {
        logger.error(
          {
            group: group.name,
            code,
            duration,
            stderr,
            stdout,
            logFile,
          },
          'Container exited with error',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Container exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      // Streaming mode: wait for output chain to settle, return completion marker
      if (onOutput) {
        outputChain.then(() => {
          logger.info(
            { group: group.name, duration, newSessionId },
            'Container completed (streaming mode)',
          );
          resolve({
            status: 'success',
            result: null,
            newSessionId,
          });
        });
        return;
      }

      // Legacy mode: parse the last output marker pair from accumulated stdout
      try {
        // Extract JSON between sentinel markers for robust parsing
        const startIdx = stdout.lastIndexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.lastIndexOf(OUTPUT_END_MARKER);

        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
        } else {
          // Fallback: last non-empty line (backwards compatibility)
          const lines = stdout.trim().split('\n');
          jsonLine = lines[lines.length - 1];
        }

        if (!jsonLine) throw new Error("No output markers found and stdout is empty");

        const output: ContainerOutput = JSON.parse(jsonLine);

        logger.info(
          {
            group: group.name,
            duration,
            status: output.status,
            hasResult: !!output.result,
          },
          'Container completed',
        );

        resolve(output);
      } catch (err: any) {
        logger.error(
          {
            group: group.name,
            stdout,
            stderr,
            error: err,
          },
          'Failed to parse container output',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Failed to parse container output: ${err.message}`,
        });
      }
    });

    container.on('error', (err) => {
      clearTimeout(timeout);
      logger.error({ group: group.name, containerName, error: err }, 'Container spawn error');
      resolve({
        status: 'error',
        result: null,
        error: `Container spawn error: ${err.message}`,
      });
    });
  });
}

export function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: Array<{
    id: string;
    groupFolder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    status: string;
    next_run: string | null;
  }>,
): void {
  // Write filtered tasks to the group's IPC directory
  const groupIpcDir = resolveGroupIpcPath(groupFolder);
  ensureWritableDir(groupIpcDir);

  // Main sees all tasks, others only see their own
  const filteredTasks = isMain
    ? tasks
    : tasks.filter((t) => t.groupFolder === groupFolder);

  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
  if (process.getuid?.() === 0) fs.chownSync(tasksFile, 1000, 1000);
}

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

/**
 * Write available groups snapshot for the container to read.
 * Only main group can see all available groups (for activation).
 * Non-main groups only see their own registration status.
 */
export function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  registeredJids: Set<string>,
): void {
  const groupIpcDir = resolveGroupIpcPath(groupFolder);
  ensureWritableDir(groupIpcDir);

  // Main sees all groups; others see nothing (they can't activate groups)
  const visibleGroups = isMain ? groups : [];

  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  fs.writeFileSync(
    groupsFile,
    JSON.stringify(
      {
        groups: visibleGroups,
        lastSync: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  if (process.getuid?.() === 0) fs.chownSync(groupsFile, 1000, 1000);
}
