export class MonitorService {
    /**
     * Pings a URL and returns status and latency in milliseconds.
     * Uses native Node.js fetch (v18+).
     */
    async ping(url) {
        const start = Date.now();
        try {
            const response = await fetch(url);
            const latencyMs = Date.now() - start;
            if (response.status === 200) {
                return { status: 'UP', latencyMs };
            }
            else {
                return { status: 'DOWN', latencyMs };
            }
        }
        catch (error) {
            const latencyMs = Date.now() - start;
            // DNS errors, network timeouts, etc.
            return { status: 'DOWN', latencyMs };
        }
    }
}
//# sourceMappingURL=monitor.js.map