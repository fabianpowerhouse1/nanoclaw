import { describe, test, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../src/app';

describe('HealthCheck System - API Endpoints', () => {
  test('GET /health should return 200 OK', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('timestamp');
  });

  test('GET /ready should return 200 OK', async () => {
    const res = await request(app).get('/ready');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('timestamp');
  });

  test('GET /api/monitor?url=https://google.com should return status UP', async () => {
    const res = await request(app).get('/api/monitor?url=https://google.com');
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('latencyMs');
    expect(['UP', 'DOWN']).toContain(res.body.status);
  });

  test('GET /api/monitor without url should return 400', async () => {
    const res = await request(app).get('/api/monitor');
    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toBe('Missing url parameter');
  });
});
