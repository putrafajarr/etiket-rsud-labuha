const WhatsAppService = require('./whatsapp');
const TelegramService = require('./telegram');
const EmailService = require('./email');

class NotificationManager {
  /**
   * Handle Notification when a new ticket is submitted
   */
  static async notifyTicketCreated(ticket, io = null) {
    const priorityEmoji = {
      critical: '🚨 [DARURAT/KRITIS]',
      high: '🔴 [PRIORITAS TINGGI]',
      medium: '🟡 [PRIORITAS SEDANG]',
      low: '🟢 [PRIORITAS RENDAH]'
    }[ticket.priority] || '⚪ [TIKET BARU]';

    // 1. WhatsApp to Reporter
    const waReporterMessage = `*RSUD LABUHA - TIKET IT DITERIMA*\n` +
      `Halo *${ticket.reporter_name}*,\n` +
      `Laporan kendala IT Anda telah berhasil dicatat oleh sistem:\n\n` +
      `🎫 *No. Tiket*: ${ticket.ticket_no}\n` +
      `🏥 *Ruangan/Poli*: ${ticket.room_name}\n` +
      `🛠 *Kategori*: ${ticket.category_name}\n` +
      `⚡ *Prioritas*: ${ticket.priority.toUpperCase()}\n` +
      `📝 *Keluhan*: ${ticket.title}\n\n` +
      `Tim Helpdesk IT RSUD Labuha akan segera menugaskan teknisi. Anda dapat memantau progres perbaikan melalui sistem.\n\n` +
      `_Pesan otomatis dari Sistem E-Tiket IT RSUD Labuha_`;

    await WhatsAppService.send(ticket.reporter_phone, waReporterMessage, ticket.id);

    // 2. Telegram to IT Team Group
    const tgGroupMessage = `<b>${priorityEmoji} TIKET BARU MASUK!</b>\n\n` +
      `🎫 <b>No. Tiket</b>: <code>${ticket.ticket_no}</code>\n` +
      `🏥 <b>Ruangan</b>: <b>${ticket.room_name}</b>\n` +
      `👤 <b>Pelapor</b>: ${ticket.reporter_name} (${ticket.reporter_phone})\n` +
      `🏷 <b>Kategori</b>: ${ticket.category_name}\n` +
      `⚠️ <b>Prioritas</b>: <b>${ticket.priority.toUpperCase()}</b>\n` +
      `📋 <b>Keluhan</b>: ${ticket.title}\n` +
      `💬 <b>Rincian</b>: <i>${ticket.description}</i>\n\n` +
      `<i>Segera buka Dashboard E-Tiket IT RSUD Labuha untuk mendisposisikan tiket ini ke teknisi yang bertugas.</i>`;

    await TelegramService.send(tgGroupMessage, null, ticket.id);

    // 3. Email to Reporter (if provided)
    if (ticket.reporter_email) {
      const emailHtml = EmailService.generateTemplate(
        ticket,
        'Laporan Kendala IT Anda Telah Diterima',
        'Terima kasih telah melapor. Tiket kendala IT Anda telah terdaftar dan sedang diproses oleh Tim Helpdesk IT RSUD Labuha.'
      );
      await EmailService.send(
        ticket.reporter_email,
        `[RSUD LABUHA] Tiket Baru Diterima - ${ticket.ticket_no} (${ticket.room_name})`,
        emailHtml,
        ticket.id
      );
    }

    // 4. Realtime Socket.io broadcast to all connected dashboards & technician phones
    if (io) {
      io.emit('ticket_created', {
        ticket,
        alertSound: ticket.priority === 'critical' || ticket.priority === 'high'
      });
    }
  }

  /**
   * Handle Notification when ticket is assigned to a technician
   */
  static async notifyTicketAssigned(ticket, technician, io = null) {
    // 1. WhatsApp to Technician
    if (technician && technician.phone) {
      const waTechMessage = `*PENUGASAN TIKET IT RSUD LABUHA*\n` +
        `Halo rekan *${technician.name}*,\n` +
        `Anda ditugaskan menangani tiket berikut:\n\n` +
        `🎫 *No Tiket*: ${ticket.ticket_no}\n` +
        `🏥 *Lokasi*: *${ticket.room_name}*\n` +
        `👤 *Pelapor*: ${ticket.reporter_name} (${ticket.reporter_phone})\n` +
        `⚠️ *Prioritas*: ${ticket.priority.toUpperCase()}\n` +
        `📝 *Keluhan*: ${ticket.title}\n\n` +
        `Silakan segera menuju ke ruangan terkait dan perbarui status di Aplikasi E-Tiket IT.\n` +
        `_Helpdesk IT RSUD Labuha_`;

      await WhatsAppService.send(technician.phone, waTechMessage, ticket.id);
    }

    // 2. WhatsApp to Reporter
    const waReporterMessage = `*UPDATE TIKET IT RSUD LABUHA*\n` +
      `Halo *${ticket.reporter_name}*,\n` +
      `Tiket Anda (*${ticket.ticket_no}*) telah ditugaskan kepada teknisi kami:\n\n` +
      `👨‍🔧 *Teknisi*: *${technician ? technician.name : 'Petugas IT'}*\n` +
      `📞 *Kontak Teknisi*: ${technician ? technician.phone : '-'}\n` +
      `Status: *Menuju Lokasi / Persiapan Pengerjaan*\n\n` +
      `_Sistem E-Tiket IT RSUD Labuha_`;

    await WhatsAppService.send(ticket.reporter_phone, waReporterMessage, ticket.id);

    // 3. Telegram update to IT Group
    const tgMessage = `👨‍🔧 <b>PENUGASAN TEKNISI</b>\n` +
      `Tiket: <code>${ticket.ticket_no}</code> (${ticket.room_name})\n` +
      `Teknisi: <b>${technician ? technician.name : '-'}</b>\n` +
      `Status: <b>ASSIGNED / DITUGASKAN</b>`;

    await TelegramService.send(tgMessage, null, ticket.id);

    // 4. Socket.io broadcast
    if (io) {
      io.emit('ticket_updated', { ticket, action: 'assigned' });
    }
  }

  /**
   * Handle Notification when ticket is marked as resolved
   */
  static async notifyTicketResolved(ticket, io = null) {
    // 1. WhatsApp to Reporter with rating invitation
    const waMessage = `*PERBAIKAN SELESAI - RSUD LABUHA*\n` +
      `Halo *${ticket.reporter_name}*,\n` +
      `Kendala IT di *${ticket.room_name}* dengan nomor tiket *${ticket.ticket_no}* telah dinyatakan *SELESAI DIPERBAIKI* oleh teknisi (${ticket.assigned_to_name || 'Tim IT'}).\n\n` +
      `Catatan Perbaikan: ${ticket.resolution_notes || 'Perangkat/jaringan telah normal kembali.'}\n\n` +
      `Mohon bantu kami meningkatkan kualitas layanan IT dengan memberikan rating kepuasan (1-5 bintang) di aplikasi atau web.\n` +
      `Terima kasih atas kerja samanya.\n\n` +
      `_Tim IT & SIMRS RSUD Labuha_`;

    await WhatsAppService.send(ticket.reporter_phone, waMessage, ticket.id);

    // 2. Telegram to IT Group
    const tgMessage = `✅ <b>TIKET SELESAI DIPERBAIKI!</b>\n` +
      `🎫 No: <code>${ticket.ticket_no}</code>\n` +
      `🏥 Ruangan: <b>${ticket.room_name}</b>\n` +
      `👨‍🔧 Teknisi: ${ticket.assigned_to_name || '-'}\n` +
      `📝 Hasil: <i>${ticket.resolution_notes || 'Selesai'}</i>`;

    await TelegramService.send(tgMessage, null, ticket.id);

    // 3. Email to Reporter (if provided)
    if (ticket.reporter_email) {
      const emailHtml = EmailService.generateTemplate(
        ticket,
        'Kendala IT Anda Telah Selesai Diperbaiki',
        `Perbaikan kendala di ${ticket.room_name} telah selesai dikerjakan oleh teknisi kami. Silakan cek kembali fungsi perangkat/layanan Anda.`
      );
      await EmailService.send(
        ticket.reporter_email,
        `[RSUD LABUHA] Kendala Selesai Diperbaiki - ${ticket.ticket_no}`,
        emailHtml,
        ticket.id
      );
    }

    // 4. Socket.io broadcast
    if (io) {
      io.emit('ticket_updated', { ticket, action: 'resolved' });
    }
  }
}

module.exports = NotificationManager;

