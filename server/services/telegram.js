const axios = require('axios');
const { query } = require('../config/db');

class TelegramService {
  /**
   * Send Telegram notification to the IT Group or specific chat
   */
  static async send(messageText, customChatId = null, ticketId = null) {
    try {
      const enabledRow = await query.get("SELECT value FROM system_settings WHERE key = 'telegram_enabled'");
      const isEnabled = enabledRow && enabledRow.value === '1';

      if (!isEnabled) {
        console.log('[Telegram DISABLED] Message not sent.');
        return { success: false, status: 'disabled' };
      }

      const tokenRow = await query.get("SELECT value FROM system_settings WHERE key = 'telegram_bot_token'");
      const chatRow = await query.get("SELECT value FROM system_settings WHERE key = 'telegram_chat_id'");

      const token = tokenRow ? tokenRow.value : '';
      const chatId = customChatId || (chatRow ? chatRow.value : '');

      const isPlaceholder = !token || token.includes('SAMPLE') || !chatId || chatId.includes('SAMPLE');

      if (isPlaceholder) {
        console.log(`[TELEGRAM SIMULATION] To: ${chatId}\nMessage:\n${messageText}\n---`);
        await query.run(`
          INSERT INTO notifications_log (ticket_id, channel, recipient, title, message, status)
          VALUES (?, 'telegram', ?, 'Notifikasi Telegram (Simulasi)', ?, 'simulated')
        `, [ticketId, chatId || 'Grup IT RSUD Labuha', messageText]);
        return { success: true, status: 'simulated', message: 'Terkirim via simulasi log Telegram' };
      }

      // Real Telegram Bot API call
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const response = await axios.post(url, {
        chat_id: chatId,
        text: messageText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }, { timeout: 10000 });

      await query.run(`
        INSERT INTO notifications_log (ticket_id, channel, recipient, title, message, status)
        VALUES (?, 'telegram', ?, 'Notifikasi Telegram Resmi', ?, 'sent')
      `, [ticketId, chatId, messageText]);

      return { success: true, status: 'sent', data: response.data };
    } catch (err) {
      console.error('[Telegram Error]:', err.response ? err.response.data : err.message);
      await query.run(`
        INSERT INTO notifications_log (ticket_id, channel, recipient, title, message, status, error_message)
        VALUES (?, 'telegram', ?, 'Notifikasi Telegram Gagal', ?, 'failed', ?)
      `, [ticketId, customChatId || 'Grup IT', messageText, err.message]);
      return { success: false, status: 'failed', error: err.message };
    }
  }
}

module.exports = TelegramService;

