const ExcelJS = require('exceljs');
const { query } = require('../config/db');

class ReportGenerator {
  /**
   * Generate complete Excel file (.xlsx) with multiple analytical sheets
   */
  static async generateExcel(filter = {}) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SIM-ETIKET RSUD LABUHA';
    workbook.created = new Date();

    // 1. Fetch tickets with filters
    let sql = `
      SELECT t.*, u.name as tech_name
      FROM tickets t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE 1=1
    `;
    const params = [];

    if (filter.startDate) {
      sql += ' AND t.created_at >= ?';
      params.push(filter.startDate + ' 00:00:00');
    }
    if (filter.endDate) {
      sql += ' AND t.created_at <= ?';
      params.push(filter.endDate + ' 23:59:59');
    }
    if (filter.roomId) {
      sql += ' AND t.room_id = ?';
      params.push(filter.roomId);
    }
    if (filter.status) {
      sql += ' AND t.status = ?';
      params.push(filter.status);
    }
    sql += ' ORDER BY t.created_at DESC';

    const tickets = await query.all(sql, params);

    // SHEET 1: Data Rekapitulasi Tiket
    const sheet1 = workbook.addWorksheet('Rekap Tiket IT', {
      views: [{ showGridLines: true }]
    });

    sheet1.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'No Tiket', key: 'ticket_no', width: 18 },
      { header: 'Tanggal Lapor', key: 'date', width: 20 },
      { header: 'Ruangan / Unit', key: 'room_name', width: 30 },
      { header: 'Kategori Kendala', key: 'category_name', width: 28 },
      { header: 'Prioritas', key: 'priority', width: 14 },
      { header: 'Pelapor', key: 'reporter_name', width: 22 },
      { header: 'Kontak WA', key: 'reporter_phone', width: 16 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Teknisi IT', key: 'assigned_to_name', width: 25 },
      { header: 'Judul Kendala', key: 'title', width: 35 },
      { header: 'Solusi / Catatan Selesai', key: 'resolution_notes', width: 35 },
      { header: 'Rating Kepuasan', key: 'satisfaction_rating', width: 16 },
      { header: 'SLA Status', key: 'sla_status', width: 14 }
    ];

    // Style Header Sheet 1
    sheet1.getRow(1).height = 28;
    sheet1.getRow(1).eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0284C7' } // Blue primary
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'medium' },
        right: { style: 'thin' }
      };
    });

    // Populate rows
    tickets.forEach((t, idx) => {
      const row = sheet1.addRow({
        no: idx + 1,
        ticket_no: t.ticket_no,
        date: new Date(t.created_at).toLocaleString('id-ID'),
        room_name: t.room_name,
        category_name: t.category_name,
        priority: (t.priority || '').toUpperCase(),
        reporter_name: t.reporter_name,
        reporter_phone: t.reporter_phone,
        status: (t.status || '').toUpperCase(),
        assigned_to_name: t.assigned_to_name || 'Belum Ditugaskan',
        title: t.title,
        resolution_notes: t.resolution_notes || '-',
        satisfaction_rating: t.satisfaction_rating ? `${t.satisfaction_rating} / 5 Bintang` : 'Belum Diisi',
        sla_status: (t.sla_status || 'ON TRACK').toUpperCase()
      });

      row.eachCell((cell) => {
        cell.alignment = { vertical: 'middle' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
      });
    });

    // SHEET 2: Kinerja Teknisi
    const sheet2 = workbook.addWorksheet('Kinerja Teknisi', {
      views: [{ showGridLines: true }]
    });

    sheet2.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Nama Teknisi', key: 'name', width: 30 },
      { header: 'Bidang Keahlian', key: 'specialization', width: 28 },
      { header: 'Total Tiket Ditangani', key: 'total_assigned', width: 22 },
      { header: 'Tiket Selesai (Resolved)', key: 'total_resolved', width: 24 },
      { header: 'Tingkat Penyelesaian (%)', key: 'completion_rate', width: 24 },
      { header: 'Rata-rata Rating Kepuasan', key: 'avg_rating', width: 25 }
    ];

    sheet2.getRow(1).height = 28;
    sheet2.getRow(1).eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0D9488' } // Teal
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    const techStats = await query.all(`
      SELECT 
        u.id, u.name, u.specialization,
        COUNT(t.id) as total_assigned,
        SUM(CASE WHEN t.status IN ('resolved', 'closed') THEN 1 ELSE 0 END) as total_resolved,
        AVG(t.satisfaction_rating) as avg_rating
      FROM users u
      LEFT JOIN tickets t ON u.id = t.assigned_to
      WHERE u.role = 'teknisi'
      GROUP BY u.id
      ORDER BY total_resolved DESC
    `);

    techStats.forEach((ts, idx) => {
      const total = ts.total_assigned || 0;
      const resolved = ts.total_resolved || 0;
      const rate = total > 0 ? Math.round((resolved / total) * 100) : 0;
      const avgR = ts.avg_rating ? parseFloat(ts.avg_rating).toFixed(1) + ' / 5.0' : '-';

      sheet2.addRow({
        no: idx + 1,
        name: ts.name,
        specialization: ts.specialization || 'Umum',
        total_assigned: total,
        total_resolved: resolved,
        completion_rate: `${rate}%`,
        avg_rating: avgR
      });
    });

    return workbook;
  }

  /**
   * Generate Official HTML Ready for Print / PDF Export
   */
  static async generatePrintableHtml(filter = {}) {
    const settings = await query.all('SELECT key, value FROM system_settings');
    const config = {};
    settings.forEach(s => config[s.key] = s.value);

    let sql = `
      SELECT t.*, u.name as tech_name
      FROM tickets t
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE 1=1
    `;
    const params = [];

    if (filter.startDate) {
      sql += ' AND t.created_at >= ?';
      params.push(filter.startDate + ' 00:00:00');
    }
    if (filter.endDate) {
      sql += ' AND t.created_at <= ?';
      params.push(filter.endDate + ' 23:59:59');
    }
    if (filter.status) {
      sql += ' AND t.status = ?';
      params.push(filter.status);
    }
    sql += ' ORDER BY t.created_at DESC';

    const tickets = await query.all(sql, params);

    // Summary statistics
    const totalCount = tickets.length;
    const resolvedCount = tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length;
    const inProgressCount = tickets.filter(t => t.status === 'in_progress').length;
    const openCount = tickets.filter(t => t.status === 'open' || t.status === 'assigned').length;

    const rowsHtml = tickets.map((t, idx) => `
      <tr>
        <td style="text-align: center;">${idx + 1}</td>
        <td style="font-weight: bold; white-space: nowrap;">${t.ticket_no}</td>
        <td>${new Date(t.created_at).toLocaleDateString('id-ID')}</td>
        <td><strong>${t.room_name}</strong></td>
        <td>${t.category_name}</td>
        <td>${t.reporter_name}</td>
        <td style="text-align: center;">
          <span class="badge ${t.priority}">${t.priority.toUpperCase()}</span>
        </td>
        <td><strong>${t.title}</strong><br><small style="color:#64748b;">${t.description.substring(0, 80)}...</small></td>
        <td>${t.assigned_to_name || '<em style="color:#94a3b8;">Belum Ditugaskan</em>'}</td>
        <td style="text-align: center;">
          <span class="status-badge ${t.status}">${t.status.toUpperCase()}</span>
        </td>
      </tr>
    `).join('');

    const todayStr = new Date().toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    return `
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="utf-8">
        <title>Laporan Rekapitulasi E-Tiket IT RSUD Labuha</title>
        <style>
          @page { size: A4 landscape; margin: 15mm; }
          body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; color: #111; margin: 0; padding: 10px; }
          .kop-surat { border-bottom: 3px double #000; padding-bottom: 12px; margin-bottom: 20px; text-align: center; position: relative; }
          .kop-surat h2 { margin: 0; font-size: 14pt; letter-spacing: 1px; font-weight: bold; text-transform: uppercase; }
          .kop-surat h1 { margin: 2px 0; font-size: 16pt; letter-spacing: 1.5px; font-weight: bold; text-transform: uppercase; }
          .kop-surat p { margin: 2px 0 0; font-size: 10pt; font-style: italic; }
          .report-title { text-align: center; margin: 18px 0; }
          .report-title h3 { margin: 0; font-size: 13pt; text-decoration: underline; text-transform: uppercase; }
          .report-title p { margin: 4px 0 0; font-size: 10pt; }
          
          .kpi-container { display: flex; gap: 15px; margin-bottom: 18px; font-family: Arial, sans-serif; }
          .kpi-card { flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; text-align: center; background: #f8fafc; }
          .kpi-num { font-size: 18pt; font-weight: bold; color: #0284c7; }
          .kpi-label { font-size: 9pt; color: #475569; text-transform: uppercase; }

          table { width: 100%; border-collapse: collapse; margin-top: 10px; font-family: Arial, sans-serif; font-size: 9pt; }
          th, td { border: 1px solid #333; padding: 6px 8px; vertical-align: top; }
          th { background-color: #f1f5f9; font-weight: bold; text-align: center; }
          
          .badge { padding: 2px 6px; border-radius: 4px; font-size: 7.5pt; font-weight: bold; color: #fff; }
          .badge.critical { background: #dc2626; }
          .badge.high { background: #ea580c; }
          .badge.medium { background: #d97706; }
          .badge.low { background: #2563eb; }

          .status-badge { padding: 2px 6px; border-radius: 4px; font-size: 7.5pt; font-weight: bold; }
          .status-badge.open { background: #fee2e2; color: #991b1b; }
          .status-badge.assigned { background: #fef3c7; color: #92400e; }
          .status-badge.in_progress { background: #dbeafe; color: #1e40af; }
          .status-badge.resolved { background: #dcfce7; color: #166534; }
          .status-badge.closed { background: #f1f5f9; color: #334155; }

          .signature-box { margin-top: 35px; width: 100%; display: flex; justify-content: space-between; font-family: 'Times New Roman', serif; }
          .sig-column { width: 35%; text-align: center; }
          .sig-space { height: 75px; }

          @media print {
            .no-print { display: none !important; }
            body { padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom: 20px; text-align: right; background: #e0f2fe; padding: 12px; border-radius: 8px;">
          <button onclick="window.print()" style="background: #0284c7; color: white; border: none; padding: 10px 20px; font-size: 14px; font-weight: bold; border-radius: 6px; cursor: pointer;">
            🖨 Cetak Laporan (PDF)
          </button>
        </div>

        <div class="kop-surat">
          <h2>PEMERINTAH KABUPATEN HALMAHERA SELATAN</h2>
          <h1>RUMAH SAKIT UMUM DAERAH LABUHA</h1>
          <p>${config.rsud_address || 'Jl. Trans Halmahera, Labuha, Kab. Halmahera Selatan, Maluku Utara'} | Telp: ${config.rsud_phone || '(0927) 21118'}</p>
        </div>

        <div class="report-title">
          <h3>LAPORAN REKAPITULASI PELAYANAN HELPDESK IT & SIMRS</h3>
          <p>Periode: ${filter.startDate || 'Semua Data'} s/d ${filter.endDate || todayStr}</p>
        </div>

        <div class="kpi-container">
          <div class="kpi-card">
            <div class="kpi-num">${totalCount}</div>
            <div class="kpi-label">Total Tiket Masuk</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-num" style="color: #166534;">${resolvedCount}</div>
            <div class="kpi-label">Tiket Berhasil Diselesaikan</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-num" style="color: #2563eb;">${inProgressCount}</div>
            <div class="kpi-label">Sedang Dalam Pengerjaan</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-num" style="color: #dc2626;">${openCount}</div>
            <div class="kpi-label">Tiket Menunggu Tindakan</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 30px;">No</th>
              <th style="width: 90px;">No Tiket</th>
              <th style="width: 75px;">Tanggal</th>
              <th>Ruangan/Unit</th>
              <th>Kategori</th>
              <th>Pelapor</th>
              <th style="width: 70px;">Prioritas</th>
              <th>Uraian Kendala</th>
              <th>Teknisi</th>
              <th style="width: 80px;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="10" style="text-align: center;">Tidak ada data tiket untuk filter ini.</td></tr>'}
          </tbody>
        </table>

        <div class="signature-box">
          <div class="sig-column">
            <p>Mengetahui,<br><strong>Direktur RSUD Labuha</strong></p>
            <div class="sig-space"></div>
            <p style="text-decoration: underline; font-weight: bold; margin-bottom: 2px;">dr. Surahman, Sp.PD</p>
            <p style="margin: 0; font-size: 10pt;">NIP. 19780512 200604 1 008</p>
          </div>

          <div class="sig-column">
            <p>Labuha, ${todayStr}<br><strong>Kepala Instalasi SIMRS & IT</strong></p>
            <div class="sig-space"></div>
            <p style="text-decoration: underline; font-weight: bold; margin-bottom: 2px;">Fahmi Mansur, S.Kom</p>
            <p style="margin: 0; font-size: 10pt;">NIP. 19850914 201001 1 012</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

module.exports = ReportGenerator;

