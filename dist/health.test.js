import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
describe('HealthCheck System - SDD Compliance', () => {
    test('GET /health should return 200 OK', async () => {
        const start = Date.now();
        const res = await request(app).get('/health');
        const latency = Date.now() - start;
        expect(res.statusCode).toEqual(200);
        expect(res.body.status).toBe('ok');
        expect(latency).toBeLessThan(50);
    });
    test('GET /ready should return 200 OK (Deep Check)', async () => {
        const res = await request(app).get('/ready');
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('timestamp');
    });
});
//# sourceMappingURL=health.test.js.map