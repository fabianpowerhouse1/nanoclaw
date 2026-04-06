export declare class MonitorService {
    /**
     * Pings a URL and returns status and latency in milliseconds.
     * Uses native Node.js fetch (v18+).
     */
    ping(url: string): Promise<{
        status: 'UP' | 'DOWN';
        latencyMs: number;
    }>;
}
//# sourceMappingURL=monitor.d.ts.map