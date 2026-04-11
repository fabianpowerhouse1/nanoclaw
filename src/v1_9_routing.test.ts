import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processGroupMessages, _setRegisteredGroups } from './index.js';
import * as router from './router.js';
import * as runner from './container-runner.js';

const mockChannel = {
  name: 'telegram',
  connect: async () => {},
  disconnect: async () => {},
  isConnected: () => true,
  ownsJid: (jid: string) => jid.startsWith('tg:'),
  sendMessage: vi.fn(async () => {}),
  setTyping: vi.fn(async () => {}),
};

vi.mock('./router.js', () => ({
  findChannel: vi.fn(() => mockChannel),
  formatMessages: vi.fn(() => 'formatted prompt'),
}));

// Mock container-runner
vi.mock('./container-runner.js', () => ({
  runContainerAgent: vi.fn(async () => 'success'),
  writeTasksSnapshot: vi.fn(),
  writeGroupsSnapshot: vi.fn(),
  resolvePersonaPath: vi.fn(() => '/fake/path'),
}));

// Mock index-level dependencies
vi.mock('./db.js', () => ({
  getAllSessions: () => ({}),
  getAllRegisteredGroups: () => ({}),
  getRouterState: () => '',
  getAllTasks: () => [],
  getAllChats: () => [],
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('V1.9.0 Routing Finality (Scorched Earth)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should route a message with "project <name> [ROLE: <persona>]" context as isolated by default', async () => {
    const messages = [
      {
        id: '1',
        chat_jid: 'tg:123',
        sender: '456',
        sender_name: 'User',
        content: 'project nano-claw [ROLE: architect] Please design the new routing logic.',
        timestamp: new Date(Date.now() - 1000).toISOString(),
        is_from_me: false,
      }
    ];

    _setRegisteredGroups({
      'tg:123': { name: 'Test Group', folder: 'test-folder', added_at: '2026-01-01', trigger: '' }
    });

    await processGroupMessages('tg:123', messages);

    expect(runner.runContainerAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        isIsolated: true,
        projectPath: 'nano-claw',
        personaOverride: 'architect'
      }),
      expect.anything(),
      expect.anything()
    );
  });

  it('should reject a message WITHOUT project context (Scorched Earth)', async () => {
    const messages = [
      {
        id: '2',
        chat_jid: 'tg:123',
        sender: '456',
        sender_name: 'User',
        content: 'Hello, world!',
        timestamp: new Date(Date.now() - 1000).toISOString(),
        is_from_me: false,
      }
    ];

    _setRegisteredGroups({
      'tg:123': { name: 'Test Group', folder: 'test-folder', added_at: '2026-01-01', trigger: '' }
    });

    const result = await processGroupMessages('tg:123', messages);
    
    expect(result).toBe(true);
    expect(runner.runContainerAgent).not.toHaveBeenCalled();
    
    expect(mockChannel.sendMessage).toHaveBeenCalledWith(
        'tg:123', 
        expect.stringContaining('Error: All requests must specify a project context')
    );
  });
});
import { describe, it, expect } from 'vitest';
import { resolvePersonaPath } from './container-runner.js';

describe('V7 Persona Mapping', () => {
  it('should resolve the default persona to super-pm.md', () => {
    const path = resolvePersonaPath();
    expect(path).toBe('/app/.agents/dist/super-pm.md');
  });

  it('should resolve "pm" and "product" aliases to super-pm.md', () => {
    expect(resolvePersonaPath('pm')).toBe('/app/.agents/dist/super-pm.md');
    expect(resolvePersonaPath('product')).toBe('/app/.agents/dist/super-pm.md');
    expect(resolvePersonaPath('discovery')).toBe('/app/.agents/dist/super-pm.md');
  });

  it('should resolve "architect" and "design" aliases to super-architect.md', () => {
    expect(resolvePersonaPath('architect')).toBe('/app/.agents/dist/super-architect.md');
    expect(resolvePersonaPath('design')).toBe('/app/.agents/dist/super-architect.md');
  });

  it('should resolve "coder" and "dev" aliases to super-coder.md', () => {
    expect(resolvePersonaPath('coder')).toBe('/app/.agents/dist/super-coder.md');
    expect(resolvePersonaPath('dev')).toBe('/app/.agents/dist/super-coder.md');
    expect(resolvePersonaPath('implementation')).toBe('/app/.agents/dist/super-coder.md');
  });

  it('should resolve "qa" and "verify" aliases to super-qa.md', () => {
    expect(resolvePersonaPath('qa')).toBe('/app/.agents/dist/super-qa.md');
    expect(resolvePersonaPath('verify')).toBe('/app/.agents/dist/super-qa.md');
  });

  it('should resolve "bar-raiser" and "antagonist" aliases to super-bar-raiser.md', () => {
    expect(resolvePersonaPath('bar-raiser')).toBe('/app/.agents/dist/super-bar-raiser.md');
    expect(resolvePersonaPath('antagonist')).toBe('/app/.agents/dist/super-bar-raiser.md');
    expect(resolvePersonaPath('audit')).toBe('/app/.agents/dist/super-bar-raiser.md');
  });

  it('should fallback to super-pm.md for unknown personas', () => {
    expect(resolvePersonaPath('unknown')).toBe('/app/.agents/dist/super-pm.md');
  });
});
