import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import fs from 'fs';
import path from 'path';

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
  const actual = await vi.importActual<typeof import('fs')>('fs');
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
let lastSpawnArgs: string[] = [];
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: vi.fn((bin, args) => {
      lastSpawnArgs = args;
      const proc = new EventEmitter() as any;
      proc.stdin = new PassThrough();
      proc.stdout = new PassThrough();
      proc.stderr = new PassThrough();
      proc.kill = vi.fn();
      return proc;
    }),
    exec: vi.fn((_cmd, _opts, cb) => { if (cb) cb(null); return new EventEmitter(); }),
  };
});

import { runContainerAgent } from './container-runner.js';

describe('V7.0 Repro: Secure Secrets Proxy (V1.9.0 Updated)', () => {
  it('does NOT mount /root and uses HOME=/tmp for isolated runs (V1.9.0 Scorched Earth)', async () => {
    const resultPromise = runContainerAgent(
      { name: 'Test', folder: 'test' } as any,
      { prompt: 'Hello', isIsolated: true, projectPath: 'test-project' } as any,
      () => {}
    );

    // Verify V1.9.0 state: Should use HOME=/tmp and NOT mount /root
    const rootMount = lastSpawnArgs.find(arg => arg.endsWith(':/root'));
    expect(rootMount).toBeUndefined();
    
    const homeArg = lastSpawnArgs.find(arg => arg === 'HOME=/tmp');
    expect(homeArg).toBeDefined();
  });
});
