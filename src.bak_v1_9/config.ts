import path from 'path';
import fs from 'fs';

import { readEnvFile } from './env.js';

/**
 * NanoClaw Configuration
 *
 * Most values are read from .env first, then process.env.
 * Secrets should ONLY be read via readEnvFile and NEVER exported
 * as plain strings to avoid leaking to child processes.
 */

const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'MESSENGER_PLATFORM',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ONLY',
  'TRIGGER_WORD',
  'TELEGRAM_ALLOWED_USERS',
  'TELEGRAM_DM_POLICY',
  'TELEGRAM_GROUP_POLICY',
  'HOST_PROJECT_PATH',
  'PROVIDER',
  'SKILL_SERVICE_URL',
  'SKILL_SERVICE_PSK_FILE'
]);

/**
 * Helper to read a secret from a file (Docker Secrets) or environment variable.
 */
function readSecret(envKey: string, fileKey?: string): string {
  const filePath = fileKey ? process.env[fileKey] : null;
  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8').trim();
  }
  return process.env[envKey] || envConfig[envKey] || '';
}

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Andy';

// TRIGGER_WORD allows overriding the name used to trigger the bot.
// If not set, it defaults to the ASSISTANT_NAME.
export const TRIGGER_WORD =
  process.env.TRIGGER_WORD || envConfig.TRIGGER_WORD || ASSISTANT_NAME;

export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER || envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
function getProjectRoot(): string {
  try {
    if (fs.existsSync('/app')) {
      fs.accessSync('/app', fs.constants.W_OK);
      return '/app';
    }
  } catch (err) {}
  return path.resolve('.');
}

const PROJECT_ROOT = getProjectRoot();
const HOME_DIR = process.env.HOME || '/root';

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

// Default to gemini-cli
export const PROVIDER = process.env.PROVIDER || envConfig.PROVIDER || 'gemini-cli';
export const GEMINI_SESSION_PATH = path.join(HOME_DIR, '.gemini');

// For Docker-out-of-Docker (DooD): the path to the project root on the host.
// If set, mounts will use this path for host-side resolution.
export const HOST_PROJECT_PATH =
  process.env.HOST_PROJECT_PATH || envConfig.HOST_PROJECT_PATH || '/home/ubuntu/powerhouse/project-nanoclaw';

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(
  process.env.IDLE_TIMEOUT || '1800000',
  10,
); // 30min default — how long to keep container alive after last result
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Support both "@Trigger" and "Trigger" (case-insensitive)
export const TRIGGER_PATTERN = new RegExp(
  `^(?:@)?${escapeRegex(TRIGGER_WORD)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// Platform configuration
export const MESSENGER_PLATFORM =
  process.env.MESSENGER_PLATFORM || envConfig.MESSENGER_PLATFORM || 'whatsapp';

// Telegram configuration
export const TELEGRAM_BOT_TOKEN = readSecret('TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_TOKEN_FILE');

// Telegram policies
export const TELEGRAM_ALLOWED_USERS = (
  process.env.TELEGRAM_ALLOWED_USERS || envConfig.TELEGRAM_ALLOWED_USERS || ''
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const TELEGRAM_DM_POLICY =
  process.env.TELEGRAM_DM_POLICY || envConfig.TELEGRAM_DM_POLICY || 'closed';

export const TELEGRAM_GROUP_POLICY =
  process.env.TELEGRAM_GROUP_POLICY || envConfig.TELEGRAM_GROUP_POLICY || 'closed';

// If MESSENGER_PLATFORM is telegram, we default to TELEGRAM_ONLY=true
// unless explicitly disabled.
const telegramOnlyEnv = process.env.TELEGRAM_ONLY || envConfig.TELEGRAM_ONLY;
export const TELEGRAM_ONLY =
  telegramOnlyEnv !== undefined
    ? telegramOnlyEnv === 'true'
    : MESSENGER_PLATFORM === 'telegram';

// Decoupled Skill Service configuration
export const SKILL_SERVICE_URL = process.env.SKILL_SERVICE_URL || envConfig.SKILL_SERVICE_URL;
export const SKILL_SERVICE_PSK = readSecret('SKILL_SERVICE_PSK', 'SKILL_SERVICE_PSK_FILE');
