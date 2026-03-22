import { spawn } from 'child_process';
import * as fs from 'fs';
import { readFile } from 'fs/promises';
import * as path from 'path';
// Sentinel markers for robust output parsing (must match container-runner)
const OUTPUT_START_MARKER = '###NC_JSON_START###';
const OUTPUT_END_MARKER = '###NC_JSON_END###';
// --- UTILS ---
export function redactCredentials(text) {
    // V1.0 Telemetry Sanitizer: Redact sensitive tokens and secrets
    return text.replace(/(access_token|refresh_token|id_token|client_secret|_clientSecret)(["']?\s*[:=]\s*["']?)([^"'\s,]+)(["']?)/gi, (match, key, separator, value, endQuote) => {
        return `${key}${separator}[REDACTED_BY_POWERHOUSE]${endQuote}`;
    });
}
function log(msg) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ${redactCredentials(msg)}`);
}
function writeOutput(output) {
    // Write to stdout with markers so the host can capture it reliably
    const sanitizedOutput = JSON.parse(redactCredentials(JSON.stringify(output)));
    process.stdout.write(OUTPUT_START_MARKER + JSON.stringify(sanitizedOutput) + OUTPUT_END_MARKER + '\n');
}
/**
 * Read from stdin until EOF
 */
async function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
            data += chunk;
        });
        process.stdin.on('end', () => {
            resolve(data);
        });
        // Safety timeout for interactive shells
        if (process.stdin.isTTY) {
            setTimeout(() => resolve(data), 1000); // 1s for interactive
        }
    });
}
// --- CLAUDE AGENT ---
async function runClaudeQuery(prompt, sessionId, containerInput, sdkEnv) {
    log(`Running Claude query (session ID: ${sessionId || 'new'})`);
    return new Promise((resolve) => {
        const args = sessionId ? ['--session', sessionId] : [];
        const isDebug = process.env.POWERHOUSE_DEBUG === 'true';
        if (isDebug) {
            log(`[DEBUG] Claude Debug Mode enabled.`);
            args.push('--verbose');
        }
        const claude = spawn('claude', args, {
            env: {
                ...process.env,
                ...sdkEnv,
                HOME: '/root',
                USER: 'root',
                TERM: 'xterm-256color',
                PATH: process.env.PATH
            }
        });
        // V0.6 GUILLOTINE: Configurable SDK Limit (V0.8)
        const sdkTimeout = setTimeout(() => {
            const timeoutVal = Number(process.env.LLM_TIMEOUT_MS) || 600000;
            log(`[SYSTEM_FATAL] SDK Timeout: ${timeoutVal}ms limit reached`);
            process.stdout.write(`\n[SYSTEM_FATAL] SDK Timeout: ${timeoutVal}ms limit reached\n`);
            claude.kill('SIGKILL');
            process.exit(1);
        }, Number(process.env.LLM_TIMEOUT_MS) || 600000);
        let stdout = '';
        let lastAssistantUuid;
        let newSessionId;
        let closedDuringQuery = false;
        claude.stdout.on('data', (data) => {
            const chunk = redactCredentials(data.toString());
            stdout += chunk;
            const sessionMatch = chunk.match(/Session ID: ([a-zA-Z0-9-]+)/);
            if (sessionMatch)
                newSessionId = sessionMatch[1];
            if (isDebug) {
                log(`[claude-stdout] ${chunk.trim()}`);
            }
        });
        claude.stderr.on('data', (data) => {
            const line = redactCredentials(data.toString().trim());
            if (line) {
                log(`[claude-stderr] ${line}`);
                // V0.9 SMART BREAKER: Demote transient API errors to warnings
                if (/exhausted your capacity|429|quota limit/i.test(line)) {
                    log(`[WARN] Transient API Limit hit. Deferring to native CLI retry logic...`);
                }
            }
        });
        claude.stdin.write(prompt + '\n');
        claude.stdin.end();
        claude.on('close', (code) => {
            clearTimeout(sdkTimeout);
            if (code !== 0 && code !== 130) {
                log(`[SYSTEM_FATAL] Upstream API Error: CLI Terminated unexpectedly (Code: ${code})`);
                process.stdout.write(`\n[SYSTEM_FATAL] Upstream API Error: CLI Terminated unexpectedly (Code: ${code})\n`);
                process.exit(1);
            }
            writeOutput({ status: 'success', result: stdout.trim(), newSessionId: newSessionId || sessionId, lastAssistantUuid });
            resolve({ newSessionId, lastAssistantUuid, closedDuringQuery });
        });
    });
}
// --- GEMINI AGENT ---
async function runGeminiQuery(prompt, sessionId, containerInput, sdkEnv) {
    log(`Running Gemini query (session ID: ${sessionId || 'new'})`);
    const isDebug = process.env.POWERHOUSE_DEBUG === 'true';
    return new Promise((resolve) => {
        // V0.9.2 TELEMETRY SHATTER: Enable --debug and respect LLM_MODEL env
        const geminiArgs = [
            ...(isDebug ? ['--debug', '--output-format', 'stream-json'] : ['--debug']),
            ...(process.env.LLM_MODEL ? ['--model', process.env.LLM_MODEL] : []),
            '-p', prompt,
            '--approval-mode', 'yolo'
        ];
        if (isDebug) {
            log(`[DEBUG] Gemini Telemetry Mode enabled (POWERHOUSE_DEBUG=true).`);
        }
        const gemini = spawn('gemini', geminiArgs, {
            env: {
                ...process.env,
                ...sdkEnv,
                GEMINI_TELEMETRY_ENABLED: isDebug ? 'true' : process.env.GEMINI_TELEMETRY_ENABLED,
                HOME: '/root',
                USER: 'root',
                TERM: 'dumb',
                PATH: process.env.PATH
            }
        });
        // V0.6 GUILLOTINE: Configurable SDK Limit (V0.8)
        const sdkTimeout = setTimeout(() => {
            const timeoutVal = Number(process.env.LLM_TIMEOUT_MS) || 600000;
            log(`[SYSTEM_FATAL] SDK Timeout: ${timeoutVal}ms limit reached`);
            process.stdout.write(`\n[SYSTEM_FATAL] SDK Timeout: ${timeoutVal}ms limit reached\n`);
            gemini.kill('SIGKILL');
            process.exit(1);
        }, Number(process.env.LLM_TIMEOUT_MS) || 600000);
        let stdout = '';
        let closedDuringQuery = false;
        gemini.stdout.on('data', (data) => {
            const chunk = redactCredentials(data.toString());
            stdout += chunk;
            // V0.9.2: Real-time stdout telemetry for debugging silent hangs
            if (isDebug || chunk.includes('###NC_JSON')) {
                log(`[gemini-stdout] ${chunk.trim()}`);
            }
        });
        gemini.stderr.on('data', (data) => {
            const line = redactCredentials(data.toString().trim());
            if (line) {
                log(`[gemini-stderr] ${line}`);
                // V0.9 SMART BREAKER: Demote transient API errors to warnings
                if (/exhausted your capacity|429|quota limit/i.test(line)) {
                    log(`[WARN] Transient API Limit hit. Deferring to native CLI retry logic...`);
                }
            }
        });
        gemini.on('close', (code) => {
            clearTimeout(sdkTimeout);
            if (code !== 0) {
                log(`[SYSTEM_FATAL] Upstream API Error: CLI Terminated unexpectedly (Code: ${code})`);
                writeOutput({ status: 'error', error: `Gemini CLI terminated unexpectedly (Code: ${code})` });
                process.exit(1);
            }
            const pseudoSessionId = sessionId || `gemini-${containerInput.chatJid}`;
            writeOutput({ status: 'success', result: stdout.trim(), newSessionId: pseudoSessionId });
            resolve({ closedDuringQuery });
        });
    });
}
// --- MAIN ---
async function main() {
    log('Agent Runner starting...');
    let inputStr = process.env.AGENT_INPUT;
    if (!inputStr) {
        log('AGENT_INPUT not found, reading from stdin...');
        inputStr = await readStdin();
    }
    if (!inputStr || inputStr.trim() === '') {
        log('ERROR: No input provided (neither AGENT_INPUT nor stdin).');
        writeOutput({ status: 'error', error: 'No input provided' });
        process.exit(1);
    }
    let input;
    try {
        input = JSON.parse(inputStr);
    }
    catch (err) {
        log('Input is not valid JSON, treating as raw prompt.');
        input = { prompt: inputStr, chatJid: 'manual-test', groupFolder: 'main', isMain: true, provider: process.env.PROVIDER || 'gemini-cli' };
    }
    const provider = input.provider || input.agentName || 'gemini-cli';
    log(`Provider: ${provider}, Chat: ${input.chatJid}`);
    const systemPromptPath = input.systemPromptPath || process.env.DEFAULT_SYSTEM_PROMPT_PATH;
    if (systemPromptPath) {
        try {
            log(`Injecting system prompt from: ${systemPromptPath}`);
            const systemPrompt = await readFile(systemPromptPath, 'utf8');
            if (process.env.POWERHOUSE_DEBUG === 'true') {
                log(`=== INJECTED SYSTEM PROMPT ===\n${systemPrompt}`);
            }
            input.prompt = `${systemPrompt}\n\n--- SYSTEM INSTRUCTIONS ---\n\n${input.prompt}`;
        }
        catch (err) {
            log(`Warning: Failed to read system prompt at ${systemPromptPath}: ${err.message}`);
        }
    }
    if (input.files && input.files.length > 0) {
        for (const file of input.files) {
            try {
                const fullPath = path.resolve('/', file.path);
                fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                fs.writeFileSync(fullPath, file.content);
                log(`Created file: ${fullPath}`);
            }
            catch (err) {
                log(`Warning: Failed to create file ${file.path}: ${err}`);
            }
        }
    }
    const sdkEnv = {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        ...input.secrets
    };
    try {
        if (provider === 'claude' || provider === 'claude-code') {
            await runClaudeQuery(input.prompt, input.sessionId, input, sdkEnv);
        }
        else if (provider === 'gemini' || provider === 'gemini-cli') {
            await runGeminiQuery(input.prompt, input.sessionId, input, sdkEnv);
        }
        else {
            throw new Error(`Unsupported agent/provider: ${provider}`);
        }
        log('Query completed successfully.');
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log(`ERROR: Execution failed: ${errorMsg}`);
        writeOutput({ status: 'error', error: errorMsg });
        process.exit(1);
    }
}
main().catch((err) => {
    log(`FATAL ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
