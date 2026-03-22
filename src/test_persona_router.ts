
import { resolvePersonaPath } from './container-runner.js';

const testCases = [
    { input: 'DEV', expected: 'tdd-coder.md' },
    { input: 'developer', expected: 'tdd-coder.md' },
    { input: 'arch', expected: 'architect.md' },
    { input: 'ARCHITECT', expected: 'architect.md' },
    { input: 'QA', expected: 'qa-triage.md' },
    { input: 'space-ninja', expected: 'pm.md' }, // Fallback
    { input: '', expected: 'pilot-alpha_pm_prompt.txt' } // Default session prompt
];

console.log('[INIT] Starting Persona Router TDD Gate...');

let failed = false;
testCases.forEach(tc => {
    const result = resolvePersonaPath(tc.input);
    const fileName = result.split('/').pop();
    
    if (fileName !== tc.expected) {
        console.error(`❌ FAILED: Input [${tc.input}] -> Expected ${tc.expected}, Got ${fileName}`);
        failed = true;
    } else {
        console.log(`✅ PASSED: [${tc.input}] -> ${fileName}`);
    }
});

if (failed) {
    console.error('[FATAL] TDD Gate Failed.');
    process.exit(1);
} else {
    console.log('[SUCCESS] Persona Router TDD Gate Passed.');
}
