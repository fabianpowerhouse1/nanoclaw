import express from 'express';
import { MonitorService } from './services/monitor.js';
const app = express();
const monitorService = new MonitorService();
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});
app.get('/ready', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});
app.get('/api/monitor', async (req, res) => {
    const url = req.query.url;
    if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }
    const result = await monitorService.ping(url);
    res.status(200).json(result);
});
export default app;
//# sourceMappingURL=app.js.map