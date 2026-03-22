import { runContainerAgent } from './container-runner.js';
import { logger } from './logger.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

async function diagnose() {
  process.env.POWERHOUSE_DEBUG = 'true';
  process.env.HOST_PROJECT_PATH = '/home/ubuntu/powerhouse/project-nanoclaw';
  
  const workspaceBase = '/home/ubuntu/powerhouse/workspaces/github-test';
  const ipcBase = '/home/ubuntu/powerhouse/project-nanoclaw/data/ipc/github-test';
  
  console.log('--- PREPARING WORKSPACE ---');
  // Copy nanoclaw repo to the test workspace to simulate the user's setup
  if (fs.existsSync(workspaceBase)) {
      execSync(`sudo rm -rf ${workspaceBase}`);
  }
  fs.mkdirSync(workspaceBase, { recursive: true });
  execSync(`cp -r /home/ubuntu/powerhouse/workspaces/tg-dm-984504173/project/* ${workspaceBase}/`);
  
  [workspaceBase, ipcBase].forEach(dir => {
      if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
      }
      try {
          execSync(`sudo chmod -R 777 ${dir}`);
          execSync(`sudo chown -R 1001:1001 ${dir}`);
      } catch (e) {
          console.warn(`Warning: Failed to chmod/chown ${dir}`);
      }
  });

  const testGroup = {
    name: 'GitHub Test',
    folder: 'github-test',
    trigger: '@Andy',
    added_at: new Date().toISOString(),
  };

  const testInput = {
    prompt: "Use the github skill to create a dummy commit in the 'nanoclaw' subdirectory on branch 'diag-test-hardened' with message 'chore: hardened skill test'.",
    groupFolder: 'github-test',
    chatJid: 'github-test@g.us',
    isMain: false,
    provider: 'gemini-cli'
  };

  console.log('--- STARTING HARDENED GITHUB DIAGNOSTIC ---');
  
  try {
    const result = await runContainerAgent(
      testGroup,
      testInput,
      (proc, name) => {
        console.log(`Container Spawned: ${name}`);
        if (proc.stderr) {
            proc.stderr.on('data', (data) => {
              process.stdout.write(data.toString());
            });
        }
        if (proc.stdout) {
            proc.stdout.on('data', (data) => {
                process.stdout.write(data.toString());
            });
        }
      }
    );

    console.log('\n--- DIAGNOSTIC RESULT ---');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Diagnostic Run Failed:', err);
  }
}

diagnose();
