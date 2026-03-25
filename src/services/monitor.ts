import { performance } from 'perf_hooks';

export class MonitorService {
  /**
   * Pings a URL and returns status and latency in milliseconds with high-resolution performance tracking.
   * Uses native Node.js fetch (v18+).
   */
  async ping(url: string): Promise<{ status: 'UP' | 'DOWN'; latencyMs: number }> {
    const startTime = performance.now();
    try {
      const response = await fetch(url);
      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);

      if (response.ok) {
        return { status: 'UP', latencyMs };
      } else {
        return { status: 'DOWN', latencyMs };
      }
    } catch (error) {
      const endTime = performance.now();
      const latencyMs = Math.round(endTime - startTime);
      // DNS errors, network timeouts, etc.
      return { status: 'DOWN', latencyMs };
    }
  }
}
