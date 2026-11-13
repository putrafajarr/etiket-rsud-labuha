const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const NotificationManager = require('../services/notification');
const WhatsAppService = require('../services/whatsapp');
const TelegramService = require('../services/telegram');

// Helper to generate ticket number
async function generateTicketNumber() {
  const now = new Date();
  const yearMonth = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, '0');
  const countRow = await query.get(`
    SELECT COUNT(*) as count FROM tickets 
    WHERE ticket_no LIKE 'TKT-${yearMonth}-%'
  `);
  const seq = (countRow.count + 1).toString().padStart(4, '0');
  return `TKT-${yearMonth}-${seq}`;
}

// POST incoming WhatsApp Webhook (Fonnte / Generic)
router.post('/whatsapp', async (req, res) => {
  try {
    // Fonnte payload format: { sender, message }
    const sender = req.body.sender || req.body.from || req.body.phone;
    const message = req.body.message || req.body.text || '';

    if (!sender || !message) {
      return res.status(200).send('No message payload');
    }

    const trimmed = message.trim();

    // Check if user is checking ticket status: "STATUS TKT-202611-0001"
    if (trimmed.toUpperCase().startsWith('STATUS')) {
      const parts = trimmed.split(/\s+/);
      const ticketNo = parts[1];
      if (!ticketNo) {
        await WhatsAppService.send(sender, 'Format cek status: *STATUS <NOMOR_TIKET>*\nContoh: *STATUS TKT-202611-0001*');
        return res.status(200).json({ status: 'ok' });
      }

      const ticket = await query.get('SELECT * FROM tickets WHERE ticket_no = ?', [ticketNo.toUpperCase()]);
      if (!ticket) {
        await WhatsAppService.send(sender, `Tiket dengan nomor *${ticketNo}* tidak ditemukan di sistem IT RSUD Labuha.`);
      } else {
        const reply = `*INFORMASI TIKET IT RSUD LABUHA*\n` +
          `🎫 *No Tiket*: ${ticket.ticket_no}\n` +
          `🏥 *Ruangan*: ${ticket.room_name}\n` +
          `⚡ *Status*: *${ticket.status.toUpperCase()}*\n` +
          `👨‍🔧 *Teknisi*: ${ticket.assigned_to_name || 'Menunggu penugasan'}\n` +
          `📝 *Keluhan*: ${ticket.title}\n` +
          `Catatan: ${ticket.resolution_notes || '-'}`;
        await WhatsAppService.send(sender, reply);
      }
      return res.status(200).json({ status: 'ok' });
    }

    // Auto Ticket Creation via Format: "LAPOR#NAMA RUANGAN#KENDALA"
    // or generic text message
    let roomName = 'Umum / Melalui WA';
    let issueTitle = trimmed;
    let reporterName = 'Staf WA (' + sender + ')';

    if (trimmed.includes('#')) {
      const parts = trimmed.split('#');
      if (parts.length >= 3) {
        reporterName = parts[0].replace(/LAPOR/i, '').trim() || reporterName;
        roomName = parts[1].trim();
        issueTitle = parts.slice(2).join('#').trim();
      }
    }

    // Match closest room from DB if possible
    const roomMatch = await query.get('SELECT id, name FROM rooms WHERE name LIKE ? OR code LIKE ? LIMIT 1', [`%${roomName}%`, `%${roomName}%`]);
    const finalRoomId = roomMatch ? roomMatch.id : 1;
    const finalRoomName = roomMatch ? roomMatch.name : roomName;

    const ticket_no = await generateTicketNumber();
    const now = new Date();
    const targetResolve = new Date(now.getTime() + 4 * 3600 * 1000).toISOString();

    const insertRes = await query.run(`
      INSERT INTO tickets (
        ticket_no, room_id, room_name, category_id, category_name,
        reporter_name, reporter_phone, reporter_role,
        title, description, priority, channel, status, target_resolve_time
      ) VALUES (?, ?, ?, 1, 'SIMRS & Jaringan', ?, ?, 'Pelapor WA', ?, ?, 'medium', 'wa_bot', 'open', ?)
    `, [ticket_no, finalRoomId, finalRoomName, reporterName, sender, issueTitle, issueTitle, targetResolve]);

    const createdTicket = await query.get('SELECT * FROM tickets WHERE id = ?', [insertRes.lastID]);
    const io = req.app.get('io');
    NotificationManager.notifyTicketCreated(createdTicket, io).catch(e => console.error(e));

    const reply = `*TIKET IT BERHASIL DIBUAT DARI WHATSAPP!*\n` +
      `Halo, laporan kendala Anda telah dicatat:\n` +
      `🎫 *Nomor Tiket*: *${ticket_no}*\n` +
      `🏥 *Ruangan*: ${finalRoomName}\n` +
      `📝 *Kendala*: ${issueTitle}\n\n` +
      `Teknisi IT RSUD Labuha segera merespon tiket Anda. Ketik *STATUS ${ticket_no}* kapan saja untuk mengecek progres.`;

    await WhatsAppService.send(sender, reply);
    res.status(200).json({ status: 'ok', ticket_no });
  } catch (err) {
    console.error('WA webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST incoming Telegram Webhook
router.post('/telegram', async (req, res) => {
  try {
    const update = req.body;
    if (!update || !update.message) return res.status(200).send('OK');

    const chatId = update.message.chat.id;
    const text = update.message.text || '';
    const fromUser = update.message.from.first_name || 'User Telegram';

    if (text.startsWith('/start') || text.startsWith('/help')) {
      const helpMsg = `<b>🏥 SISTEM E-TIKET IT RSUD LABUHA</b>\n\n` +
        `Selamat datang di bot resmi Helpdesk IT RSUD Labuha, Halmahera Selatan.\n\n` +
        `<b>Perintah yang tersedia:</b>\n` +
        `• <code>/lapor [Ruangan] [Rincian Kendala]</code> - Buat tiket baru instan\n` +
        `• <code>/status [No Tiket]</code> - Cek status pengerjaan tiket\n` +
        `• <code>/info</code> - Kontak Helpdesk IT RSUD Labuha\n\n` +
        `<i>Contoh:</i> <code>/lapor IGD Komputer SIMRS mati tiba-tiba</code>`;
      await TelegramService.send(helpMsg, chatId);
      return res.status(200).send('OK');
    }

    if (text.startsWith('/status')) {
      const parts = text.split(' ');
      const ticketNo = parts[1];
      if (!ticketNo) {
        await TelegramService.send('Ketik: <code>/status TKT-XXXXXX-XXXX</code>', chatId);
        return res.status(200).send('OK');
      }

      const ticket = await query.get('SELECT * FROM tickets WHERE ticket_no = ?', [ticketNo.toUpperCase()]);
      if (!ticket) {
        await TelegramService.send(`Tiket <b>${ticketNo}</b> tidak ditemukan.`, chatId);
      } else {
        const reply = `<b>🎫 INFORMASI TIKET IT RSUD LABUHA</b>\n\n` +
          `No Tiket: <code>${ticket.ticket_no}</code>\n` +
          `Ruangan: <b>${ticket.room_name}</b>\n` +
          `Status: <b>${ticket.status.toUpperCase()}</b>\n` +
          `Teknisi: <b>${ticket.assigned_to_name || 'Menunggu penugasan'}</b>\n` +
          `Keluhan: ${ticket.title}\n` +
          `Catatan: ${ticket.resolution_notes || '-'}`;
        await TelegramService.send(reply, chatId);
      }
      return res.status(200).send('OK');
    }

    if (text.startsWith('/lapor')) {
      const content = text.replace('/lapor', '').trim();
      if (!content) {
        await TelegramService.send('Format salah. Contoh: <code>/lapor Farmasi Printer cetak resep macet</code>', chatId);
        return res.status(200).send('OK');
      }

      const ticket_no = await generateTicketNumber();
      const now = new Date();
      const targetResolve = new Date(now.getTime() + 4 * 3600 * 1000).toISOString();

      const insertRes = await query.run(`
        INSERT INTO tickets (
          ticket_no, room_id, room_name, category_id, category_name,
          reporter_name, reporter_phone, reporter_role,
          title, description, priority, channel, status, target_resolve_time
        ) VALUES (?, 1, 'Lapor via Telegram', 1, 'SIMRS & Jaringan', ?, 'Telegram Chat', 'Staf Telegram', ?, ?, 'medium', 'telegram_bot', 'open', ?)
      `, [ticket_no, fromUser, content, content, targetResolve]);

      const createdTicket = await query.get('SELECT * FROM tickets WHERE id = ?', [insertRes.lastID]);
      const io = req.app.get('io');
      NotificationManager.notifyTicketCreated(createdTicket, io).catch(e => console.error(e));

      const reply = `✅ <b>TIKET BERHASIL DIBUAT DARI TELEGRAM!</b>\n\n` +
        `🎫 No Tiket: <code>${ticket_no}</code>\n` +
        `📝 Kendala: <i>${content}</i>\n\n` +
        `Laporan Anda telah diteruskan ke Grup Teknisi IT RSUD Labuha.`;
      await TelegramService.send(reply, chatId);
      return res.status(200).send('OK');
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Telegram webhook error:', err);
    res.status(500).send('Error');
  }
});

module.exports = router;

