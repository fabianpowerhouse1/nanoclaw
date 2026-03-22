
import { redactCredentials } from './dist/index.js';

const testCases = [
  { input: 'access_token: "secret-123"', expected: 'access_token: "[REDACTED_BY_POWERHOUSE]"' },
  { input: 'refresh_token=secret-456', expected: 'refresh_token=[REDACTED_BY_POWERHOUSE]' },
  { input: 'client_secret: "top-secret"', expected: 'client_secret: "[REDACTED_BY_POWERHOUSE]"' },
  { input: '_clientSecret: "hidden"', expected: '_clientSecret: "[REDACTED_BY_POWERHOUSE]"' },
  { input: 'id_token:abc-123, other:data', expected: 'id_token:[REDACTED_BY_POWERHOUSE], other:data' }
];

let failed = false;
testCases.forEach(tc => {
  const result = redactCredentials(tc.input);
  if (result !== tc.expected) {
    console.error(`FAILED: Input: ${tc.input} | Expected: ${tc.expected} | Got: ${result}`);
    failed = true;
  } else {
    console.log(`PASSED: ${tc.input} -> ${result}`);
  }
});

if (failed) process.exit(1);
console.log("All Redaction Tests Passed.");
