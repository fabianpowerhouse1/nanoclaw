import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processGroupMessages, _setRegisteredGroups } from './index.js';
import * as runner from './container-runner.js';
const mockChannel = {
    name: 'telegram',
    connect: async () => { },
    disconnect: async () => { },
    isConnected: () => true,
    ownsJid: (jid) => jid.startsWith('tg:'),
    sendMessage: vi.fn(async () => { }),
    setTyping: vi.fn(async () => { }),
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
        expect(runner.runContainerAgent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            isIsolated: true,
            projectPath: 'nano-claw',
            personaOverride: 'architect'
        }), expect.anything(), expect.anything());
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
        expect(mockChannel.sendMessage).toHaveBeenCalledWith('tg:123', expect.stringContaining('Error: All requests must specify a project context'));
    });
});
//# sourceMappingURL=v1_9_routing.test.js.map