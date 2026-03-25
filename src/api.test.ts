import { describe, test, expect, vi } from 'vitest';
import request from 'supertest';
import app from './app';

describe('API Layer - Monitor Routing', () => {
  test('GET /api/monitor should return 200 with status and latency', async () => {
    const res = await request(app).get('/api/monitor?url=https://example.com');
    // Expected to fail with 404 since the route doesn't exist yet.
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('latencyMs');
  });

  test('GET /api/monitor should return 400 if url is missing', async () => {
    const res = await request(app).get('/api/monitor');
    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toBe('Missing url parameter');
  });
});
