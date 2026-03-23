import { Bot } from 'grammy';

import {
  ASSISTANT_NAME,
  TELEGRAM_ALLOWED_USERS,
  TELEGRAM_DM_POLICY,
  TELEGRAM_GROUP_POLICY,
  TRIGGER_PATTERN,
} from '../config.js';
import { logger } from '../logger.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
  NewMessage,
} from '../types.js';
import { storeMessageDirect, storeChatMetadata } from "../db.js";

export interface TelegramChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup?: (jid: string, group: RegisteredGroup) => void;
}

export class TelegramChannel implements Channel {
  name = 'telegram';

  private bot: Bot | null = null;
  private opts: TelegramChannelOpts;
  private botToken: string;

  constructor(botToken: string, opts: TelegramChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.bot = new Bot(this.botToken);
    logger.info("Telegram bot initialized, starting polling...");

    // Command to get chat ID (useful for registration)
    this.bot.command('chatid', (ctx) => {
      const chatId = ctx.chat.id;
      const chatType = ctx.chat.type;
      const chatName =
        chatType === 'private'
          ? ctx.from?.first_name || 'Private'
          : (ctx.chat as any).title || 'Unknown';

      ctx.reply(
        `Chat ID: \`tg:${chatId}\`\nName: ${chatName}\nType: ${chatType}`,
        { parse_mode: 'Markdown' },
      );
    });

    // Command to check bot status
    this.bot.command('ping', (ctx) => {
      ctx.reply(`${ASSISTANT_NAME} is online.`);
    });

    this.bot.on('message:text', async (ctx) => {
      logger.info({ chat: ctx.chat.id, from: ctx.from?.id, text: ctx.message.text }, 'RAW INBOUND TELEGRAM MESSAGE');
      
      // Skip commands
      if (ctx.message.text.startsWith('/')) return;

      const senderId = ctx.from?.id.toString() || '';
      
      // Filter by allowed users if configured
      if (TELEGRAM_ALLOWED_USERS.length > 0 && !TELEGRAM_ALLOWED_USERS.includes(senderId)) {
        logger.debug({ senderId }, 'Message from unauthorized Telegram user');
        return;
      }

      const chatJid = `tg:${ctx.chat.id}`;
      let content = ctx.message.text;
      
      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id.toString() ||
        'Unknown';
      const sender = ctx.from?.id.toString() || '';
      const msgId = ctx.message.message_id.toString();

      // Determine chat name
      const chatName =
        ctx.chat.type === 'private'
          ? senderName
          : (ctx.chat as any).title || chatJid;

      // Translate Telegram @bot_username mentions into TRIGGER_PATTERN format.
      const botUsername = ctx.me?.username?.toLowerCase();
      if (botUsername) {
        const entities = ctx.message.entities || [];
        const isBotMentioned = entities.some((entity) => {
          if (entity.type === 'mention') {
            const mentionText = content
              .substring(entity.offset, entity.offset + entity.length)
              .toLowerCase();
            return mentionText === `@${botUsername}`;
          }
          return false;
        });
        if (isBotMentioned && !TRIGGER_PATTERN.test(content)) {
          content = `@${ASSISTANT_NAME} ${content}`;
        }
      }

      // Store chat metadata for discovery
      this.opts.onChatMetadata(
        chatJid,
        timestamp,
        chatName,
        'telegram',
        ctx.chat.type !== 'private'
      );

      // Check if chat is registered
      let group = this.opts.registeredGroups()[chatJid];
      
      // Auto-register if policy allows
      if (!group && this.opts.registerGroup) {
        const isPrivate = ctx.chat.type === 'private';
        const policy = isPrivate ? TELEGRAM_DM_POLICY : TELEGRAM_GROUP_POLICY;
        
        if (policy === 'open') {
          logger.info({ chatJid, chatName }, 'Auto-registering Telegram chat');
          group = {
            name: chatName,
            folder: isPrivate ? `tg-dm-${senderId}` : `tg-group-${ctx.chat.id}`,
            trigger: ASSISTANT_NAME,
            added_at: new Date().toISOString(),
            requiresTrigger: !isPrivate, // DMs usually don't require trigger if open
          };
          this.opts.registerGroup(chatJid, group);
        }
      }

      // Only deliver full message for registered groups
      if (!group) {
        logger.debug(
          { chatJid, chatName },
          'Message from unregistered Telegram chat',
        );
        return;
      }

      // Deliver message — startMessageLoop() will pick it up
      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
      });

      logger.info(
        { chatJid, chatName, sender: senderName },
        'Telegram message stored',
      );
    });

    // Handle non-text messages with placeholders
    const storeNonText = (ctx: any, placeholder: string) => {
      const senderId = ctx.from?.id.toString() || '';
      if (TELEGRAM_ALLOWED_USERS.length > 0 && !TELEGRAM_ALLOWED_USERS.includes(senderId)) {
        return;
      }

      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) return;

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id?.toString() ||
        'Unknown';
      const caption = ctx.message.caption ? ` ${ctx.message.caption}` : '';

      this.opts.onChatMetadata(chatJid, timestamp);
      this.opts.onMessage(chatJid, {
        id: ctx.message.message_id.toString(),
        chat_jid: chatJid,
        sender: senderId,
        sender_name: senderName,
        content: `[${placeholder}]${caption}`,
        timestamp,
        is_from_me: false,
      });
    };

    this.bot.on('message:photo', (ctx) => storeNonText(ctx, 'Photo'));
    this.bot.on('message:video', (ctx) => storeNonText(ctx, 'Video'));
    this.bot.on('message:voice', (ctx) => storeNonText(ctx, 'Voice Message'));
    this.bot.on('message:audio', (ctx) => storeNonText(ctx, 'Audio'));
    this.bot.on('message:document', (ctx) => {
      const fileName = ctx.message.document.file_name || 'File';
      storeNonText(ctx, `Document: ${fileName}`);
    });
    this.bot.on('message:sticker', (ctx) => storeNonText(ctx, `Sticker: ${ctx.message.sticker.emoji || ''}`));
    this.bot.on('message:location', (ctx) => storeNonText(ctx, 'Location'));
    this.bot.on('message:contact', (ctx) => storeNonText(ctx, 'Contact'));

    // Handle errors gracefully
    this.bot.catch((err) => {
        logger.error({ err: err.message }, 'Telegram bot error');
    });

    return new Promise((resolve) => {
        this.bot!.start({
          onStart: (info) => {
            logger.info({ username: info.username, id: info.id }, "Telegram bot connected");
            console.log("Telegram bot connected: @" + info.username);
            resolve();
          }
        });
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.bot) {
      logger.warn('Telegram bot not initialized');
      return;
    }
    try {
      const numericId = jid.replace(/^tg:/, '');
      const MAX_LENGTH = 4096;
      if (text.length <= MAX_LENGTH) {
        await this.bot.api.sendMessage(numericId, text);
      } else {
        for (let i = 0; i < text.length; i += MAX_LENGTH) {
          await this.bot.api.sendMessage(numericId, text.slice(i, i + MAX_LENGTH));
        }
      }
      logger.info({ jid, length: text.length }, 'Telegram message sent');
      const now = new Date().toISOString();
      storeChatMetadata(jid, now, undefined, 'telegram', jid.includes(':'));
      storeMessageDirect({
        id: 'out-' + Date.now(),
        chat_jid: jid,
        sender: 'me',
        sender_name: ASSISTANT_NAME,
        content: text,
        timestamp: now,
        is_from_me: true,
        is_bot_message: true
      });
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Telegram message');
    }
  }

  isConnected(): boolean {
    return this.bot !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('tg:');
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
      this.bot = null;
      logger.info('Telegram bot stopped');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.bot || !isTyping) return;
    try {
      const numericId = jid.replace(/^tg:/, '');
      await this.bot.api.sendChatAction(numericId, 'typing');
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Telegram typing indicator');
    }
  }
}
