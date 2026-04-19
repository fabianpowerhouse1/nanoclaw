import express from 'express';
import { MonitorService } from './services/monitor.js';
import { GroupQueue } from './group-queue.js';

export function createApp(queue: GroupQueue) {
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

  app.get('/status', (req, res) => {
    const active = queue.getActiveContainers();
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      active_containers: active,
      active_count: active.length
    });
  });

  app.get('/api/monitor', async (req, res) => {
    const url = req.query.url as string;
    if (!url) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }
    const result = await monitorService.ping(url);
    res.status(200).json(result);
  });

  return app;
}
