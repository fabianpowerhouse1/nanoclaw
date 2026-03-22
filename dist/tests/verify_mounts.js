import { buildVolumeMounts } from '../container-runner.js';
const mockGroup = {
    name: 'Test Group',
    folder: 'tg-dm-984504173',
    added_at: new Date().toISOString(),
    trigger: '!test'
};
const mockInput = {
    prompt: 'Hello',
    groupFolder: 'tg-dm-984504173',
    chatJid: 'test-jid',
    isMain: false,
    isIsolated: true,
    projectPath: 'project/power-house-infra',
    personaOverride: 'pm'
};
console.log('[INIT] Starting Isomorphic Mount Validation (V1.5)...');
const mounts = buildVolumeMounts(mockGroup, mockInput);
const expectedMounts = [
    { containerPath: '/workspace', hostPath: '/home/ubuntu/powerhouse/workspaces/tg-dm-984504173/project/power-house-infra' },
    { containerPath: '/app/.agents', hostPath: '/home/ubuntu/powerhouse/orchestrator/.agents' },
    { containerPath: '/app/scripts', hostPath: '/home/ubuntu/powerhouse/orchestrator/scripts' },
    { containerPath: '/usr/local/bin/agent-init.sh', hostPath: '/home/ubuntu/powerhouse/orchestrator/scripts/agent-init.sh' }
];
let failed = false;
expectedMounts.forEach(expected => {
    const found = mounts.find(m => m.containerPath === expected.containerPath);
    if (!found) {
        console.error(`❌ FAILED: Missing mandatory mount for ${expected.containerPath}`);
        failed = true;
    }
    else if (found.hostPath !== expected.hostPath) {
        console.error(`❌ FAILED: Mount ${expected.containerPath} has wrong host path.`);
        console.error(`   Expected: ${expected.hostPath}`);
        console.error(`   Got:      ${found.hostPath}`);
        failed = true;
    }
    else {
        console.log(`✅ PASSED: ${expected.containerPath} -> ${expected.hostPath}`);
    }
});
// STRICT ISOLATION CHECK: Ensure parent 'project' is NOT mounted as /workspace
const workspaceMount = mounts.find(m => m.containerPath === '/workspace');
if (workspaceMount && workspaceMount.hostPath.endsWith('/project')) {
    console.error(`❌ FAILED: Isolation Breach! /workspace points to parent 'project' directory instead of leaf node.`);
    failed = true;
}
if (failed) {
    console.error('[FATAL] Isomorphic Mount Validation Failed.');
    process.exit(1);
}
else {
    console.log('[SUCCESS] Isomorphic Mount Validation Passed.');
}
//# sourceMappingURL=verify_mounts.js.map