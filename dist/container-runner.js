import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { CONTAINER_IMAGE, CONTAINER_MAX_OUTPUT_SIZE, CONTAINER_TIMEOUT, DATA_DIR, IDLE_TIMEOUT, TIMEZONE, HOST_PROJECT_PATH, PROVIDER, GEMINI_SESSION_PATH, SKILL_SERVICE_URL, SKILL_SERVICE_PSK, } from './config.js';
import { readEnvFile } from './env.js';
import { resolveGroupFolderPath, resolveGroupIpcPath } from './group-folder.js';
import { logger } from './logger.js';
import { CONTAINER_RUNTIME_BIN, readonlyMountArgs, stopContainer } from './container-runtime.js';
// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '###NC_JSON_START###';
const OUTPUT_END_MARKER = '###NC_JSON_END###';
const SKILLS_DIR = '/home/ubuntu/powerhouse/skills';
/**
 * Translate a local path (inside the bot container) to a host path
 */
function toHostPath(localPath) {
    if (localPath === '/ssh-agent' && process.env.HOST_SSH_AUTH_SOCK) {
        return process.env.HOST_SSH_AUTH_SOCK;
    }
    if (HOST_PROJECT_PATH) {
        const absoluteLocal = path.resolve(localPath);
        if (absoluteLocal.startsWith('/app')) {
            return absoluteLocal.replace('/app', HOST_PROJECT_PATH);
        }
    }
    if (localPath === "/root/.gemini" || localPath === "/home/node/.gemini" || localPath === GEMINI_SESSION_PATH) {
        return "/home/ubuntu/.gemini";
    }
    if (!HOST_PROJECT_PATH)
        return localPath;
    const projectRoot = process.cwd();
    const absoluteLocal = path.resolve(localPath);
    const absoluteProject = path.resolve(projectRoot);
    if (absoluteLocal.startsWith(absoluteProject)) {
        const relative = path.relative(absoluteProject, absoluteLocal);
        return path.join(HOST_PROJECT_PATH, relative);
    }
    return localPath;
}
function ensureWritableDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    if (process.getuid?.() === 0) {
        try {
            fs.chownSync(dirPath, 1000, 1000);
        }
        catch { }
    }
}
function buildVolumeMounts(group, input, ephemeralHomePath) {
    const mounts = [];
    if (input.isIsolated && ephemeralHomePath) {
        mounts.push({
            hostPath: toHostPath(ephemeralHomePath),
            containerPath: '/root',
            readonly: false,
        });
    }
    else if (PROVIDER === 'gemini-cli' && fs.existsSync(GEMINI_SESSION_PATH)) {
        mounts.push({
            hostPath: "/home/ubuntu/.gemini",
            containerPath: '/root/.gemini',
            readonly: false,
        });
    }
    if (input.isIsolated && input.projectPath) {
        const hostWorkspace = `/home/ubuntu/powerhouse/workspaces/${group.folder}/${input.projectPath}`;
        mounts.push({
            hostPath: hostWorkspace,
            containerPath: '/workspace',
            readonly: false,
        });
        mounts.push({
            hostPath: '/home/ubuntu/powerhouse/orchestrator/.agents',
            containerPath: '/app/.agents',
            readonly: true
        });
        // PLATFORM SKILL INTERFACE (V8.0)
        mounts.push({
            hostPath: SKILLS_DIR,
            containerPath: '/app/skills',
            readonly: true
        });
    }
    else {
        const hostWorkspace = `/home/ubuntu/powerhouse/workspaces/${group.folder}`;
        mounts.push({
            hostPath: hostWorkspace,
            containerPath: '/workspace/group',
            readonly: false,
        });
    }
    mounts.push({
        hostPath: '/home/ubuntu/powerhouse/data/active_sessions',
        containerPath: '/workspace/active_sessions',
        readonly: true,
    });
    const groupIpcDir = resolveGroupIpcPath(group.folder);
    mounts.push({
        hostPath: toHostPath(groupIpcDir),
        containerPath: '/workspace/ipc',
        readonly: false,
    });
    if (process.env.SSH_AUTH_SOCK) {
        mounts.push({
            hostPath: toHostPath(process.env.SSH_AUTH_SOCK),
            containerPath: '/ssh-agent',
            readonly: false,
        });
    }
    return mounts;
}
function readSecrets() {
    const secrets = readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']);
    if (SKILL_SERVICE_PSK)
        secrets.SKILL_SERVICE_PSK = SKILL_SERVICE_PSK;
    return secrets;
}
/**
 * Dynamically read and aggregate skill definitions from the host
 */
function readSkills() {
    let aggregated = '\n\n# [AVAILABLE SKILLS]\n';
    try {
        if (!fs.existsSync(SKILLS_DIR))
            return '';
        const skillFolders = fs.readdirSync(SKILLS_DIR);
        for (const folder of skillFolders) {
            const skillPath = path.join(SKILLS_DIR, folder, 'skill.md');
            if (fs.existsSync(skillPath)) {
                aggregated += fs.readFileSync(skillPath, 'utf8') + '\n---\n';
            }
        }
    }
    catch (err) {
        logger.warn('Failed to read platform skills directory');
    }
    return aggregated;
}
function buildContainerArgs(mounts, containerName, input, githubToken) {
    const args = ['run', '-i', '--name', containerName];
    args.push('-e', 'CI=true');
    args.push('-e', 'NONINTERACTIVE=1');
    if (githubToken) {
        args.push('-e', `GH_TOKEN=${githubToken}`);
        args.push('-e', `GITHUB_TOKEN=${githubToken}`);
    }
    if (input?.isIsolated && input?.personaOverride) {
        const persona = input.personaOverride.trim().toLowerCase().replace(/ /g, '-');
        let personaFile = `${persona}.md`;
        if (persona === 'peer-pm')
            personaFile = 'peer_pm.md';
        const personaPath = `/app/.agents/personas/${personaFile}`;
        args.push('-e', `DEFAULT_SYSTEM_PROMPT_PATH=${personaPath}`);
        args.push('-e', 'ISOLATED_WORKSPACE=true');
    }
    else {
        args.push('-e', `DEFAULT_SYSTEM_PROMPT_PATH=/workspace/active_sessions/pilot-alpha_pm_prompt.txt`);
    }
    args.push('-e', `TZ=${TIMEZONE}`);
    if (SKILL_SERVICE_URL) {
        args.push('-e', `SKILL_SERVICE_URL=${SKILL_SERVICE_URL}`);
        args.push('--network', 'infra_core-net');
    }
    if (process.env.SSH_AUTH_SOCK)
        args.push('-e', 'SSH_AUTH_SOCK=/ssh-agent');
    const hostUid = process.getuid?.();
    const hostGid = process.getgid?.();
    if (input?.isIsolated) {
        args.push("--workdir", "/workspace");
        args.push('--cap-drop=ALL');
        args.push('--security-opt', 'no-new-privileges');
        args.push('-e', 'HOME=/root');
    }
    else if (hostUid != null && hostUid !== 0 && hostUid !== 1000) {
        args.push('--user', `${hostUid}:${hostGid}`);
        args.push('-e', 'HOME=/home/node');
    }
    for (const mount of mounts) {
        if (mount.readonly)
            args.push(...readonlyMountArgs(mount.hostPath, mount.containerPath));
        else
            args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
    }
    args.push(CONTAINER_IMAGE);
    return args;
}
/**
 * Redacts tokens from the args array for logging purposes
 */
function sanitizeContainerArgs(args) {
    return args.map(arg => {
        if (arg.startsWith('GH_TOKEN=') || arg.startsWith('GITHUB_TOKEN=')) {
            const parts = arg.split('=');
            return `${parts[0]}=***`;
        }
        return arg;
    });
}
export async function runContainerAgent(group, input, onProcess, onOutput) {
    const startTime = Date.now();
    const groupDir = resolveGroupFolderPath(group.folder);
    ensureWritableDir(groupDir);
    let githubToken;
    try {
        if (fs.existsSync('/run/secrets/github_token')) {
            githubToken = fs.readFileSync('/run/secrets/github_token', 'utf8').trim();
        }
    }
    catch (e) {
        logger.warn('Failed to read github_token secret');
    }
    // Graceful Degradation: Fallback to process.env.GITHUB_TOKEN
    if (!githubToken && process.env.GITHUB_TOKEN) {
        githubToken = process.env.GITHUB_TOKEN;
    }
    let ephemeralHomePath;
    if (input.isIsolated) {
        const tmpDir = path.join(DATA_DIR, 'tmp');
        if (!fs.existsSync(tmpDir))
            fs.mkdirSync(tmpDir, { recursive: true });
        ephemeralHomePath = fs.mkdtempSync(path.join(tmpDir, 'agent-home-'));
        try {
            const geminiDir = path.join(ephemeralHomePath, '.gemini');
            fs.mkdirSync(geminiDir, { recursive: true });
            if (fs.existsSync(GEMINI_SESSION_PATH)) {
                ['settings.json', 'oauth_creds.json', 'projects.json', 'google_accounts.json'].forEach(file => {
                    const src = path.join(GEMINI_SESSION_PATH, file);
                    if (fs.existsSync(src))
                        fs.copyFileSync(src, path.join(geminiDir, file));
                    fs.chmodSync(path.join(geminiDir, file), 0o644);
                });
            }
            const sshDir = path.join(ephemeralHomePath, '.ssh');
            fs.mkdirSync(sshDir, { recursive: true });
            const hostKey = '/root/.ssh/id_github_powerhouse';
            if (fs.existsSync(hostKey)) {
                const destKey = path.join(sshDir, 'id_rsa');
                fs.copyFileSync(hostKey, destKey);
                fs.chmodSync(destKey, 0o600);
            }
            const gitConfig = '[user]\n  name = Powerhouse Agent\n  email = ai@powerhouse.local\n[core]\n  sshCommand = ssh -o StrictHostKeyChecking=no -i /root/.ssh/id_rsa';
            fs.writeFileSync(path.join(ephemeralHomePath, '.gitconfig'), gitConfig);
        }
        catch (err) {
            logger.warn({ err: err.message }, 'Secure Secrets Proxy: Partial seeding failure, continuing without full credentials');
        }
    }
    const mounts = buildVolumeMounts(group, input, ephemeralHomePath);
    const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
    const containerName = `nanoclaw-agent-${safeName}-${Date.now()}`;
    const containerArgs = buildContainerArgs(mounts, containerName, input, githubToken);
    // Telemetry Redaction: Mask tokens if logging args
    logger.info({
        group: group.name,
        containerName,
        isMain: input.isMain,
        args: sanitizeContainerArgs(containerArgs)
    }, 'Spawning container agent');
    const logsDir = path.join(groupDir, 'logs');
    ensureWritableDir(logsDir);
    // DYNAMIC PROMPT INJECTION (V8.0)
    if (input.isIsolated) {
        input.prompt += readSkills();
    }
    return new Promise((resolve) => {
        const container = spawn(CONTAINER_RUNTIME_BIN, containerArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
        onProcess(container, containerName);
        let stdout = '';
        let stderr = '';
        let stdoutTruncated = false;
        let stderrTruncated = false;
        input.secrets = readSecrets();
        input.provider = PROVIDER;
        container.stdin.write(JSON.stringify(input));
        container.stdin.end();
        delete input.secrets;
        let parseBuffer = '';
        let newSessionId;
        let outputChain = Promise.resolve();
        let hadStreamingOutput = false;
        container.stdout.on('data', (data) => {
            const chunk = data.toString();
            if (!stdoutTruncated) {
                const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
                if (chunk.length > remaining) {
                    stdout += chunk.slice(0, remaining);
                    stdoutTruncated = true;
                }
                else
                    stdout += chunk;
            }
            if (onOutput) {
                parseBuffer += chunk;
                let startIdx;
                while ((startIdx = parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
                    const endIdx = parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
                    if (endIdx === -1)
                        break;
                    const jsonStr = parseBuffer.slice(startIdx + OUTPUT_START_MARKER.length, endIdx).trim();
                    try {
                        const parsed = JSON.parse(jsonStr);
                        if (parsed.newSessionId)
                            newSessionId = parsed.newSessionId;
                        hadStreamingOutput = true;
                        resetTimeout();
                        outputChain = outputChain.then(() => onOutput(parsed));
                        parseBuffer = parseBuffer.slice(endIdx + OUTPUT_END_MARKER.length);
                    }
                    catch (err) {
                        const nextStartIdx = parseBuffer.indexOf(OUTPUT_START_MARKER, startIdx + 1);
                        if (nextStartIdx !== -1)
                            parseBuffer = parseBuffer.slice(nextStartIdx);
                        else
                            break;
                    }
                }
            }
        });
        container.stderr.on('data', (data) => {
            const chunk = data.toString();
            if (!stderrTruncated) {
                const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
                if (chunk.length > remaining) {
                    stderr += chunk.slice(0, remaining);
                    stderrTruncated = true;
                }
                else
                    stderr += chunk;
            }
        });
        let timedOut = false;
        const configTimeout = group.containerConfig?.timeout || CONTAINER_TIMEOUT;
        const timeoutMs = Math.max(configTimeout, IDLE_TIMEOUT + 30_000);
        const killOnTimeout = () => {
            timedOut = true;
            exec(stopContainer(containerName), { timeout: 15000 }, (err) => {
                if (err)
                    container.kill('SIGKILL');
            });
        };
        let timeout = setTimeout(killOnTimeout, timeoutMs);
        const resetTimeout = () => {
            clearTimeout(timeout);
            timeout = setTimeout(killOnTimeout, timeoutMs);
        };
        container.on('close', (code) => {
            clearTimeout(timeout);
            const duration = Date.now() - startTime;
            try {
                if (timedOut) {
                    if (hadStreamingOutput) {
                        outputChain.then(() => resolve({ status: 'success', result: null, newSessionId }));
                        return;
                    }
                    resolve({ status: 'error', result: null, error: `Container timed out after ${configTimeout}ms` });
                    return;
                }
                const logFile = path.join(logsDir, `container-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
                const logLines = [`=== Container Run Log ===`, `Duration: ${duration}ms`, `Exit Code: ${code}`, ``, `=== Input ===`, JSON.stringify(input, null, 2), ``, `=== Stderr ===`, stderr, ``, `=== Stdout ===`, stdout];
                fs.writeFileSync(logFile, logLines.join('\n'));
                if (process.getuid?.() === 0)
                    fs.chownSync(logFile, 1000, 1000);
                // CIRCUIT BREAKER: Check for fatal signal in output
                if (code !== 0) {
                    const isFatal = stdout.includes('[SYSTEM_FATAL]') || stderr.includes('[SYSTEM_FATAL]');
                    resolve({
                        status: 'error',
                        result: null,
                        error: isFatal ? 'Upstream API Exhaustion' : `Container exited with code ${code}`,
                        isFatal
                    });
                    return;
                }
                if (onOutput) {
                    if (!hadStreamingOutput && stdout.trim()) {
                        const startIdx = stdout.lastIndexOf(OUTPUT_START_MARKER);
                        const endIdx = stdout.lastIndexOf(OUTPUT_END_MARKER);
                        if (!(startIdx !== -1 && endIdx !== -1 && endIdx > startIdx)) {
                            outputChain = outputChain.then(() => onOutput({
                                status: 'success',
                                result: stdout.trim(),
                                newSessionId,
                            }));
                        }
                    }
                    outputChain.then(() => resolve({ status: 'success', result: null, newSessionId }));
                    return;
                }
                try {
                    const startIdx = stdout.lastIndexOf(OUTPUT_START_MARKER);
                    const endIdx = stdout.lastIndexOf(OUTPUT_END_MARKER);
                    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                        const jsonStr = stdout.slice(startIdx + OUTPUT_START_MARKER.length, endIdx).trim();
                        const output = JSON.parse(jsonStr);
                        resolve(output);
                    }
                    else {
                        resolve({
                            status: 'success',
                            result: stdout.trim() || 'Agent finished with no output.',
                            newSessionId,
                        });
                    }
                }
                catch (err) {
                    resolve({
                        status: 'success',
                        result: stdout.trim() || `Execution error: ${err.message}`,
                        newSessionId,
                    });
                }
            }
            finally {
                if (ephemeralHomePath) {
                    try {
                        fs.rmSync(ephemeralHomePath, { recursive: true, force: true });
                    }
                    catch (e) { }
                }
            }
        });
        container.on('error', (err) => {
            clearTimeout(timeout);
            if (ephemeralHomePath) {
                try {
                    fs.rmSync(ephemeralHomePath, { recursive: true, force: true });
                }
                catch (e) { }
            }
            resolve({ status: 'error', result: null, error: `Container spawn error: ${err.message}` });
        });
    });
}
export function writeTasksSnapshot(groupFolder, isMain, tasks) {
    const groupIpcDir = resolveGroupIpcPath(groupFolder);
    ensureWritableDir(groupIpcDir);
    const filteredTasks = isMain ? tasks : tasks.filter((t) => t.groupFolder === groupFolder);
    const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
    fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
    if (process.getuid?.() === 0)
        fs.chownSync(tasksFile, 1000, 1000);
}
export function writeGroupsSnapshot(groupFolder, isMain, groups, registeredJids) {
    const groupIpcDir = resolveGroupIpcPath(groupFolder);
    ensureWritableDir(groupIpcDir);
    const visibleGroups = isMain ? groups : [];
    const groupsFile = path.join(groupIpcDir, 'available_groups.json');
    fs.writeFileSync(groupsFile, JSON.stringify({ groups: visibleGroups, lastSync: new Date().toISOString() }, null, 2));
    if (process.getuid?.() === 0)
        fs.chownSync(groupsFile, 1000, 1000);
}
//# sourceMappingURL=container-runner.js.map