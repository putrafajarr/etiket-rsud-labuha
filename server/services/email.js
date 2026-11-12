const nodemailer = require('nodemailer');
const { query } = require('../config/db');

class EmailService {
  static async send(toEmail, subject, htmlContent, ticketId = null) {
    try {
      if (!toEmail || !toEmail.includes('@')) {
        return { success: false, status: 'invalid_recipient' };
      }

      const enabledRow = await query.get("SELECT value FROM system_settings WHERE key = 'email_enabled'");
      const isEnabled = enabledRow && enabledRow.value === '1';

      if (!isEnabled) {
        console.log(`[Email DISABLED] Not sending to ${toEmail}`);
        return { success: false, status: 'disabled' };
      }

      const hostRow = await query.get("SELECT value FROM system_settings WHERE key = 'smtp_host'");
      const portRow = await query.get("SELECT value FROM system_settings WHERE key = 'smtp_port'");
      const userRow = await query.get("SELECT value FROM system_settings WHERE key = 'smtp_user'");
      const passRow = await query.get("SELECT value FROM system_settings WHERE key = 'smtp_pass'");
      const fromRow = await query.get("SELECT value FROM system_settings WHERE key = 'smtp_from_name'");

      const host = hostRow ? hostRow.value : 'smtp.gmail.com';
      const port = portRow ? parseInt(portRow.value, 10) : 587;
      const user = userRow ? userRow.value : '';
      const pass = passRow ? passRow.value : '';
      const fromName = fromRow ? fromRow.value : 'Helpdesk IT RSUD Labuha';

      const isPlaceholder = !user || !pass || pass.includes('app_password') || user.includes('sample');

      if (isPlaceholder) {
        console.log(`[EMAIL SIMULATION] To: ${toEmail}\nSubject: ${subject}\n---`);
        await query.run(`
          INSERT INTO notifications_log (ticket_id, channel, recipient, title, message, status)
          VALUES (?, 'email', ?, ?, ?, 'simulated')
        `, [ticketId, toEmail, subject, `Subject: ${subject} (Terkirim via simulasi log Email)`]);
        return { success: true, status: 'simulated', message: 'Terkirim via simulasi log Email' };
      }

      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
      });

      const info = await transporter.sendMail({
        from: `"${fromName}" <${user}>`,
        to: toEmail,
        subject,
        html: htmlContent
      });

      await query.run(`
        INSERT INTO notifications_log (ticket_id, channel, recipient, title, message, status)
        VALUES (?, 'email', ?, ?, ?, 'sent')
      `, [ticketId, toEmail, subject, `MessageId: ${info.messageId}`]);

      return { success: true, status: 'sent', data: info };
    } catch (err) {
      console.error('[Email Error]:', err.message);
      await query.run(`
        INSERT INTO notifications_log (ticket_id, channel, recipient, title, message, status, error_message)
        VALUES (?, 'email', ?, ?, ?, 'failed', ?)
      `, [ticketId, toEmail, subject, 'Gagal kirim email', err.message]);
      return { success: false, status: 'failed', error: err.message };
    }
  }

  /**
   * Generate official RSUD Labuha HTML Email Template
   */
  static generateTemplate(ticket, actionTitle, actionDescription) {
    const priorityColors = {
      critical: '#DC2626',
      high: '#EA580C',
      medium: '#D97706',
      low: '#2563EB'
    };
    const badgeColor = priorityColors[ticket.priority] || '#4B5563';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6; margin: 0; padding: 20px; color: #1f2937; }
          .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
          .header { background: linear-gradient(135deg, #0284c7, #0369a1); color: #ffffff; padding: 25px; text-align: center; }
          .header h1 { margin: 0; font-size: 20px; letter-spacing: 0.5px; }
          .header p { margin: 5px 0 0; opacity: 0.9; font-size: 13px; }
          .content { padding: 25px; }
          .badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: bold; color: #ffffff; background: ${badgeColor}; text-transform: uppercase; }
          .ticket-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 20px 0; }
          .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #e2e8f0; font-size: 14px; }
          .label { font-weight: 600; color: #64748b; }
          .val { font-weight: bold; color: #0f172a; text-align: right; }
          .footer { background: #f8fafc; text-align: center; padding: 18px; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>RSUD LABUHA</h1>
            <p>Sistem Informasi E-Tiket IT & SIMRS</p>
          </div>
          <div class="content">
            <h2 style="font-size: 18px; color: #0f172a; margin-top: 0;">${actionTitle}</h2>
            <p style="font-size: 14px; color: #475569; line-height: 1.5;">${actionDescription}</p>

            <div class="ticket-card">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
                <span style="font-size: 16px; font-weight: bold; color: #0284c7;">${ticket.ticket_no}</span>
                <span class="badge">${ticket.priority}</span>
              </div>
              <div class="row"><span class="label">Ruangan/Poli</span><span class="val">${ticket.room_name}</span></div>
              <div class="row"><span class="label">Kategori</span><span class="val">${ticket.category_name}</span></div>
              <div class="row"><span class="label">Pelapor</span><span class="val">${ticket.reporter_name}</span></div>
              <div class="row"><span class="label">Status</span><span class="val" style="text-transform: capitalize;">${ticket.status.replace('_', ' ')}</span></div>
              ${ticket.assigned_to_name ? `<div class="row"><span class="label">Teknisi Bertugas</span><span class="val">${ticket.assigned_to_name}</span></div>` : ''}
              <div style="margin-top: 14px;">
                <div class="label" style="margin-bottom: 4px;">Keluhan:</div>
                <div style="font-size: 14px; font-weight: 600; color: #1e293b;">${ticket.title}</div>
                <div style="font-size: 13px; color: #475569; margin-top: 4px;">${ticket.description}</div>
              </div>
            </div>

            <p style="font-size: 13px; color: #64748b;">
              Notifikasi ini dikirimkan otomatis oleh Server E-Tiket IT RSUD Labuha.
            </p>
          </div>
          <div class="footer">
            &copy; 2026 Tim SIMRS & IT RSUD Labuha, Halmahera Selatan.<br>
            Jl. Trans Halmahera, Labuha. Call Center IT: 0812-3456-7899
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

module.exports = EmailService;

