function getTimeout() {
    return Number(process.env.LLM_TIMEOUT_MS) || 60000;
}
// Test Default
delete process.env.LLM_TIMEOUT_MS;
console.log("Testing default timeout...");
if (getTimeout() !== 60000) {
    console.error("Default timeout failed");
    process.exit(1);
}
// Test Configured
process.env.LLM_TIMEOUT_MS = "120000";
console.log("Testing configured timeout...");
if (getTimeout() !== 120000) {
    console.error("Configured timeout failed");
    process.exit(1);
}
console.log("Timeout logic verified.");
export {};
