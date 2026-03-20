import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
// Mock config
vi.mock('./config.js', () => ({
    CONTAINER_IMAGE: 'nanoclaw-agent:latest',
    CONTAINER_MAX_OUTPUT_SIZE: 1048576,
    CONTAINER_TIMEOUT: 1800000,
    DATA_DIR: '/tmp/nanoclaw-test-data',
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
            mkdtempSync: vi.fn(() => '/tmp/agent-home-XXXX'),
            writeFileSync: vi.fn(),
            readFileSync: vi.fn(() => '{}'),
            readdirSync: vi.fn(() => ['oauth_creds.json']),
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
// Mock child_process.spawn
let lastSpawnArgs = [];
vi.mock('child_process', async () => {
    const actual = await vi.importActual('child_process');
    return {
        ...actual,
        spawn: vi.fn((bin, args) => {
            lastSpawnArgs = args;
            const proc = new EventEmitter();
            proc.stdin = new PassThrough();
            proc.stdout = new PassThrough();
            proc.stderr = new PassThrough();
            proc.kill = vi.fn();
            return proc;
        }),
        exec: vi.fn((_cmd, _opts, cb) => { if (cb)
            cb(null); return new EventEmitter(); }),
    };
});
import { runContainerAgent } from './container-runner.js';
describe('V7.0 Repro: Secure Secrets Proxy (GREEN STATE)', () => {
    it('mounts a proxy /root volume for isolated runs', async () => {
        const resultPromise = runContainerAgent({ name: 'Test', folder: 'test' }, { prompt: 'Hello', isIsolated: true }, () => { });
        // Verify V7 state: Should have a standalone /root proxy mount
        const rootMount = lastSpawnArgs.find(arg => arg.endsWith(':/root'));
        expect(rootMount).toBeDefined();
        expect(rootMount).toContain('agent-home-');
    });
});
//# sourceMappingURL=repro-v7-auth.test.js.map