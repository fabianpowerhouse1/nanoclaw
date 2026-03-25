import { describe, test, expect, vi } from 'vitest';
import { MonitorService } from './monitor';

describe('MonitorService - TDD Implementation', () => {
  test('ping(url) should return UP for a successful status 200', async () => {
    // Mock global fetch
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
    });
    
    const service = new MonitorService();
    const result = await service.ping('https://example.com');
    
    expect(result.status).toBe('UP');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('ping(url) should return DOWN for a DNS failure or invalid URL', async () => {
    // Mock global fetch failure
    global.fetch = vi.fn().mockRejectedValue(new Error('DNS Failure'));

    const service = new MonitorService();
    const result = await service.ping('https://this-domain-should-never-exist-123.com');
    
    expect(result.status).toBe('DOWN');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
