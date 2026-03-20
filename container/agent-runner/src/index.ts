import { spawn } from 'child_process';
import * as fs from 'fs';
import { readFile } from 'fs/promises';
import * as path from 'path';

// --- TYPES (Matching nanoclaw/src/types.ts and container-runner.ts) ---

type SDKRole = 'user' | 'assistant' | 'system';

interface SDKMessage {
  role: SDKRole;
  content: string;
}

interface SDKUserMessage {
  type: 'user';
  message: SDKMessage;
  parent_tool_use_id: string | null;
  session_id: string;
}

interface SDKAssistantMessage {
  type: 'assistant';
  message: SDKMessage;
  uuid: string;
}

type SDKResult = SDKUserMessage | SDKAssistantMessage;

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  secrets?: Record<string, string>;
  provider?: string;
  agentName?: 'claude' | 'gemini'; // Legacy field name
  files?: Array<{ path: string; content: string }>;
  systemPromptPath?: string;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result?: string | null;
  error?: string;
  newSessionId?: string;
  lastAssistantUuid?: string;
  closedDuringQuery?: boolean;
}

// Sentinel markers for robust output parsing (must match container-runner)
const OUTPUT_START_MARKER = '###NC_JSON_START###';
const OUTPUT_END_MARKER = '###NC_JSON_END###';

// --- UTILS ---

function log(msg: string) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ${msg}`);
}

function writeOutput(output: ContainerOutput) {
  // Write to stdout with markers so the host can capture it reliably
  process.stdout.write(OUTPUT_START_MARKER + JSON.stringify(output) + OUTPUT_END_MARKER + '\n');
}

/**
 * Read from stdin until EOF
 */
async function readStdin(): Promise<string> {
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
      setTimeout(() => resolve(data), 100);
    }
  });
}

// --- CLAUDE AGENT ---

async function runClaudeQuery(
  prompt: string,
  sessionId: string | undefined,
  containerInput: ContainerInput,
  sdkEnv: Record<string, string | undefined>,
): Promise<{ newSessionId?: string; lastAssistantUuid?: string; closedDuringQuery: boolean }> {
  log(`Running Claude query (session ID: ${sessionId || 'new'})`);

  return new Promise((resolve) => {
    const args = sessionId ? ['--session', sessionId] : [];
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

    let stdout = '';
    let lastAssistantUuid: string | undefined;
    let newSessionId: string | undefined;
    let closedDuringQuery = false;

    claude.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      const sessionMatch = chunk.match(/Session ID: ([a-zA-Z0-9-]+)/);
      if (sessionMatch) newSessionId = sessionMatch[1];
    });

    claude.stderr.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) log(`[claude-stderr] ${line}`);
    });

    claude.stdin.write(prompt + '\n');
    claude.stdin.end();

    claude.on('close', (code) => {
      if (code !== 0 && code !== 130) log(`Claude CLI exited with code ${code}`);
      writeOutput({ status: 'success', result: stdout.trim(), newSessionId: newSessionId || sessionId, lastAssistantUuid });
      resolve({ newSessionId, lastAssistantUuid, closedDuringQuery });
    });
  });
}

// --- GEMINI AGENT ---

async function runGeminiQuery(
  prompt: string,
  sessionId: string | undefined,
  containerInput: ContainerInput,
  sdkEnv: Record<string, string | undefined>,
): Promise<{ newSessionId?: string; lastAssistantUuid?: string; closedDuringQuery: boolean }> {
  log(`Running Gemini query (session ID: ${sessionId || 'new'})`);

  return new Promise((resolve) => {
    const gemini = spawn('gemini', ['-p', prompt, '--approval-mode', 'yolo'], {
      env: {
        ...process.env,
        ...sdkEnv,
        HOME: '/root',
        USER: 'root',
        TERM: 'dumb',
        PATH: process.env.PATH
      }
    });

    let stdout = '';
    let closedDuringQuery = false;

    gemini.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    gemini.stderr.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) log(`[gemini-stderr] ${line}`);
    });

    gemini.on('close', (code) => {
      if (code !== 0) {
        log(`Gemini CLI exited with code ${code}`);
        writeOutput({ status: 'error', error: `Gemini CLI exited with code ${code}` });
        resolve({ closedDuringQuery });
        return;
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
  let input: ContainerInput;
  try { 
    input = JSON.parse(inputStr); 
  } catch (err) {
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
      log(`=== INJECTED SYSTEM PROMPT ===\n${systemPrompt}`);
      input.prompt = `${systemPrompt}\n\n--- SYSTEM INSTRUCTIONS ---\n\n${input.prompt}`;
    } catch (err: any) { 
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
      } catch (err) { 
        log(`Warning: Failed to create file ${file.path}: ${err}`); 
      }
    }
  }

  const sdkEnv: Record<string, string | undefined> = {
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
  } catch (err: any) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(`ERROR: Execution failed: ${errorMsg}`);
    writeOutput({ status: 'error', error: errorMsg });
    process.exit(1);
  }
}

main().catch((err: unknown) => { 
  log(`FATAL ERROR: ${err instanceof Error ? err.message : String(err)}`); 
  process.exit(1); 
});