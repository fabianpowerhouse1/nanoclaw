import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
// Sentinel markers must match container-runner.ts
const OUTPUT_START_MARKER = '###NC_JSON_START###';
const OUTPUT_END_MARKER = '###NC_JSON_END###';
// Mock config
vi.mock('./config.js', () => ({
    CONTAINER_IMAGE: 'nanoclaw-agent:latest',
    CONTAINER_MAX_OUTPUT_SIZE: 1048576,
    CONTAINER_TIMEOUT: 1800000,
    DATA_DIR: './.test-tmp/',
    GROUPS_DIR: '/tmp/nanoclaw-test-groups',
    IDLE_TIMEOUT: 1800000,
    TIMEZONE: 'UTC',
    HOST_PROJECT_PATH: '/app',
    PROVIDER: 'gemini-cli',
    GEMINI_SESSION_PATH: '/tmp/gemini',
    SKILL_SERVICE_URL: '',
    SKILL_SERVICE_PSK: '',
}));
// Mock logger
vi.mock('./logger.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));
// Mock fs
vi.mock('fs', async () => {
    const actual = await vi.importActual('fs');
    return {
        ...actual,
        default: {
            ...actual,
            existsSync: vi.fn(() => true),
            mkdirSync: vi.fn(),
            writeFileSync: vi.fn(),
            readFileSync: vi.fn(() => '{}'),
            readdirSync: vi.fn(() => []),
            statSync: vi.fn(() => ({ isDirectory: () => true })),
            copyFileSync: vi.fn(),
            chmodSync: vi.fn(),
            rmSync: vi.fn(),
        },
    };
});
// Mock container-runtime
vi.mock('./container-runtime.js', () => ({
    CONTAINER_RUNTIME_BIN: 'docker',
    readonlyMountArgs: vi.fn(() => []),
    stopContainer: vi.fn(() => 'docker stop'),
}));
// Mock mount-security
vi.mock('./mount-security.js', () => ({
    validateAdditionalMounts: vi.fn(() => []),
}));
// Create a controllable fake ChildProcess
function createFakeProcess() {
    const proc = new EventEmitter();
    proc.stdin = new PassThrough();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.kill = vi.fn();
    proc.pid = 12345;
    return proc;
}
let fakeProc;
// Mock child_process.spawn
vi.mock('child_process', async () => {
    const actual = await vi.importActual('child_process');
    return {
        ...actual,
        spawn: vi.fn(() => fakeProc),
        exec: vi.fn((_cmd, _opts, cb) => {
            if (typeof _opts === 'function')
                _opts(null);
            else if (cb)
                cb(null);
            return new EventEmitter();
        }),
    };
});
import { runContainerAgent } from './container-runner.js';
import fs from 'fs';
describe.skip('V6.10 Repro: Missing JSON Markers (FIXED)', () => {
    beforeEach(() => {
        fakeProc = createFakeProcess();
        fs.mkdirSync('/tmp/nanoclaw-test-data/tmp', { recursive: true });
        fs.mkdirSync('/tmp/nanoclaw-test-data/tmp/', { recursive: true });
        fs.mkdirSync('/tmp/nanoclaw-test-data/tmp/', { recursive: true });
    });
    it('successfully triggers onOutput when raw text is emitted (GREEN STATE)', async () => {
        const onOutput = vi.fn(async () => { });
        const resultPromise = runContainerAgent({ name: 'Test', folder: 'test' }, { prompt: 'Hello', isIsolated: true, projectPath: 'test-project' }, () => { }, onOutput);
        // Emit raw text WITHOUT markers
        fakeProc.stdout.push('Hello from the other side\n');
        // Settle streams
        await new Promise(r => setTimeout(r, 50));
        // Exit successfully
        fakeProc.emit('close', 0);
        const result = await resultPromise;
        // IN GREEN STATE:
        // 1. onOutput IS called even though markers were missing
        // 2. it contains the raw stdout as 'result'
        expect(onOutput).toHaveBeenCalledWith(expect.objectContaining({
            status: 'success',
            result: 'Hello from the other side'
        }));
        expect(result.status).toBe('success');
    });
    it('triggers onOutput when JSON markers ARE present', async () => {
        const onOutput = vi.fn(async () => { });
        const resultPromise = runContainerAgent({ name: 'Test', folder: 'test' }, { prompt: 'Hello', isIsolated: true, projectPath: 'test-project' }, () => { }, onOutput);
        // Emit valid JSON markers
        fakeProc.stdout.push(`${OUTPUT_START_MARKER}\n{"status":"success","result":"Valid JSON"}\n${OUTPUT_END_MARKER}\n`);
        await new Promise(r => setTimeout(r, 50));
        fakeProc.emit('close', 0);
        const result = await resultPromise;
        expect(onOutput).toHaveBeenCalledWith(expect.objectContaining({ result: 'Valid JSON' }));
        expect(result.status).toBe('success');
    });
});
//# sourceMappingURL=repro-v6-10.test.js.map