
import { resolvePersonaPath } from './container-runner.js';
import fs from 'fs';

const testCases = [
    { input: 'DEV', expected: '/app/.agents/personas/tdd-coder.md' },
    { input: 'developer', expected: '/app/.agents/personas/tdd-coder.md' },
    { input: 'arch', expected: '/app/.agents/personas/architect.md' },
    { input: 'ARCHITECT', expected: '/app/.agents/personas/architect.md' },
    { input: 'QA', expected: '/app/.agents/personas/qa-triage.md' },
    { input: 'qa', expected: '/app/.agents/personas/qa-triage.md' },
    { input: 'space-ninja', expected: '/app/.agents/personas/pm.md' }, // Fallback
    { input: '', expected: '/workspace/active_sessions/pilot-alpha_pm_prompt.txt' } // Default session prompt
];

console.log('[INIT] Starting Persona Router TDD Gate (V1.4)...');

let failed = false;
testCases.forEach(tc => {
    const result = resolvePersonaPath(tc.input);
    
    if (result !== tc.expected) {
        console.error(`❌ FAILED: Input [${tc.input}] -> Expected ${tc.expected}, Got ${result}`);
        failed = true;
    } else {
        console.log(`✅ PASSED: [${tc.input}] -> ${result}`);
    }
});

if (failed) {
    console.error('[FATAL] TDD Gate Failed.');
    process.exit(1);
} else {
    console.log('[SUCCESS] Persona Router TDD Gate Passed.');
}
