import express from 'express';
import { MonitorService } from './services/monitor';

const app = express();
const monitorService = new MonitorService();

/**
 * Liveness Probe: Returns 200 OK if service is up.
 */
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

/**
 * Readiness Probe: Returns 200 OK if service is ready.
 */
app.get('/ready', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString() 
  });
});

/**
 * External Health Monitor API
 */
app.get('/api/monitor', async (req, res) => {
  const url = req.query.url as string;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  
  try {
    const result = await monitorService.ping(url);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Internal monitor failure' });
  }
});

export default app;
