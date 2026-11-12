const axios = require('axios');
const { query } = require('../config/db');

class WhatsAppService {
  /**
   * Send WhatsApp message via configured gateway (Fonnte, Wablas, Whacenter, or Generic)
   */
  static async send(recipientPhone, messageText, ticketId = null) {
    try {
      const enabledRow = await query.get("SELECT value FROM system_settings WHERE key = 'wa_gateway_enabled'");
      const isEnabled = enabledRow && enabledRow.value === '1';

      if (!isEnabled) {
        console.log(`[WA Gateway DISABLED] Not sending to ${recipientPhone}`);
        return { success: false, status: 'disabled' };
      }

      const tokenRow = await query.get("SELECT value FROM system_settings WHERE key = 'wa_api_token'");
      const urlRow = await query.get("SELECT value FROM system_settings WHERE key = 'wa_api_url'");
      const providerRow = await query.get("SELECT value FROM system_settings WHERE key = 'wa_gateway_provider'");

      const token = tokenRow ? tokenRow.value : '';
      const url = urlRow ? urlRow.value : 'https://api.fonnte.com/send';
      const provider = providerRow ? providerRow.value : 'fonnte';

      // Clean phone number (convert 08xx to 628xx)
      let phone = recipientPhone.replace(/\D/g, '');
      if (phone.startsWith('0')) {
        phone = '62' + phone.substring(1);
      }

      // Check if it's a dummy or placeholder token
      const isPlaceholder = !token || token.includes('SAMPLE') || token.length < 5;

      if (isPlaceholder) {
        console.log(`[WA SIMULATION] To: ${phone}\nMessage:\n${messageText}\n---`);
        await query.run(`
          INSERT INTO notifications_log (ticket_id, channel, recipient, title, message, status)
          VALUES (?, 'whatsapp', ?, 'Notifikasi WhatsApp (Simulasi)', ?, 'simulated')
        `, [ticketId, phone, messageText]);
        return { success: true, status: 'simulated', message: 'Terkirim via simulasi log gateway' };
      }

      // Real sending based on provider
      let response;
      if (provider === 'fonnte') {
        response = await axios.post(url, {
          target: phone,
          message: messageText
        }, {
          headers: { Authorization: token },
          timeout: 10000
        });
      } else if (provider === 'wablas') {
        response = await axios.post(url, {
          phone: phone,
          message: messageText
        }, {
          headers: { Authorization: token },
          timeout: 10000
        });
      } else {
        // Generic JSON payload
        response = await axios.post(url, {
          to: phone,
          message: messageText
        }, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10000
        });
      }

      await query.run(`
        INSERT INTO notifications_log (ticket_id, channel, recipient, title, message, status)
        VALUES (?, 'whatsapp', ?, 'Notifikasi WhatsApp Resmi', ?, 'sent')
      `, [ticketId, phone, messageText]);

      return { success: true, status: 'sent', data: response.data };
    } catch (err) {
      console.error('[WA Error]:', err.message);
      await query.run(`
        INSERT INTO notifications_log (ticket_id, channel, recipient, title, message, status, error_message)
        VALUES (?, 'whatsapp', ?, 'Notifikasi WhatsApp Gagal', ?, 'failed', ?)
      `, [ticketId, recipientPhone, messageText, err.message]);
      return { success: false, status: 'failed', error: err.message };
    }
  }
}

module.exports = WhatsAppService;

