import fs from 'fs';
function testTokenLogic(mockSecretFile, mockEnvValue) {
    let githubToken;
    // 1. Secret Extraction (Mandated Try/Catch)
    try {
        if (mockSecretFile && fs.existsSync(mockSecretFile)) {
            githubToken = fs.readFileSync(mockSecretFile, 'utf8').trim();
        }
    }
    catch (e) {
        console.log('Failed to read github_token secret (expected if path missing)');
    }
    // 2. Graceful Degradation (Mandated Fallback)
    if (!githubToken && mockEnvValue) {
        githubToken = mockEnvValue;
    }
    console.log(`Extracted Token: ${githubToken || 'NOT_FOUND'}`);
    // 3. Telemetry Redaction
    const args = ['run', '-e', `GH_TOKEN=${githubToken}`, '-e', `GITHUB_TOKEN=${githubToken}`, 'nanoclaw-agent:latest'];
    const sanitizedArgs = args.map(arg => {
        if (arg.startsWith('GH_TOKEN=') || arg.startsWith('GITHUB_TOKEN=')) {
            const parts = arg.split('=');
            return `${parts[0]}=***`;
        }
        return arg;
    });
    console.log('Sanitized Args:', sanitizedArgs);
}
console.log('--- TEST 1: Secret File Exists ---');
const secretPath = '/tmp/mock_github_token';
fs.writeFileSync(secretPath, 'secret-token-123');
testTokenLogic(secretPath, 'env-token-456');
fs.unlinkSync(secretPath);
console.log('\n--- TEST 2: Secret File Missing, Env Exists ---');
testTokenLogic('/tmp/missing_secret', 'env-token-456');
console.log('\n--- TEST 3: Both Missing ---');
testTokenLogic('/tmp/missing_secret', null);
//# sourceMappingURL=reproduce-gh-token.js.map