
import { runContainerAgent, ContainerInput } from '../container-runner.js';
import { RegisteredGroup } from '../types.js';

const mockGroup: RegisteredGroup = {
    name: 'ITM Synthetic Group',
    folder: 'system',
    added_at: new Date().toISOString(),
    trigger: '!test'
};

const mockInput: ContainerInput = {
    prompt: 'ITM Synthetic Prompt',
    groupFolder: 'system',
    chatJid: 'itm-synthetic-jid',
    isMain: false,
    isIsolated: true,
    projectPath: 'project/active-project',
    personaOverride: 'pm'
};

// V1.6: The Synthetic Dispatcher (Source Parity)
// This test exercises the ACTUAL production spawning logic.
// If container-runner.ts fails to mount a dependency, this test will FATALLY fail.
async function runTest() {
    console.log('[INIT] Starting Synthetic Dispatcher (V1.6)...');

    // Offline Assertion Override: No network calls, just version + secret check
    const extraArgs = [
        '--direct',
        'gemini --version && cat /tmp/.gemini/oauth_creds.json | grep access_token'
    ];

    try {
        const output = await runContainerAgent(
            mockGroup, 
            mockInput, 
            (proc, name) => {
                console.log(`[DISPATCH] Agent spawned: ${name}`);
                proc.stdout?.on('data', (d) => console.log(`[STDOUT] ${d.toString()}`));
                proc.stderr?.on('data', (d) => console.error(`[STDERR] ${d.toString()}`));
            },
            async (chunk) => {
                // Stream logs to console for ITM visibility
                if (chunk.result) console.log(chunk.result);
            },
            extraArgs
        );

        if (output.status === 'success') {
            console.log('[SUCCESS] Synthetic Dispatcher Passed.');
            process.exit(0);
        } else {
            console.error('[FATAL] Synthetic Dispatcher FAILED.');
            console.error('Error:', output.error);
            process.exit(1);
        }
    } catch (err: any) {
        console.error('[SYSTEM_FATAL] Synthetic Dispatcher crashed.');
        console.error(err.message);
        process.exit(1);
    }
}

runTest();
