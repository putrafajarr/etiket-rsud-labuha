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
        <td style="white-space: nowrap; text-align: center; font-size: 8pt;">${new Date(t.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })}</td>
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
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>Laporan Rekapitulasi E-Tiket IT RSUD Labuha</title>
        <style>
          @page { size: A4 landscape; margin: 12mm; }
          * { box-sizing: border-box; }
          body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; color: #111; margin: 0; padding: 12px; background: #fff; }
          
          /* Top bar with back button & print */
          .print-header-bar {
            position: sticky;
            top: 0;
            z-index: 999;
            background: #0f172a;
            color: #fff;
            padding: 10px 16px;
            margin: -12px -12px 18px -12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.15);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          }
          .btn-back {
            background: rgba(255,255,255,0.15);
            color: #fff;
            text-decoration: none;
            padding: 8px 14px;
            font-size: 12px;
            font-weight: 700;
            border-radius: 8px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            border: 1px solid rgba(255,255,255,0.25);
            cursor: pointer;
            transition: 0.2s;
          }
          .btn-back:hover { background: rgba(255,255,255,0.25); }
          .btn-print {
            background: #0284c7;
            color: #fff;
            border: none;
            padding: 8px 16px;
            font-size: 12px;
            font-weight: 700;
            border-radius: 8px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            transition: 0.2s;
          }
          .btn-print:hover { background: #0369a1; }

          .kop-surat { border-bottom: 3px double #000; padding-bottom: 12px; margin-bottom: 16px; text-align: center; }
          .kop-surat h2 { margin: 0; font-size: 13pt; letter-spacing: 0.5px; font-weight: bold; text-transform: uppercase; }
          .kop-surat h1 { margin: 2px 0; font-size: 15pt; letter-spacing: 1px; font-weight: bold; text-transform: uppercase; }
          .kop-surat p { margin: 2px 0 0; font-size: 9.5pt; font-style: italic; }
          .report-title { text-align: center; margin: 14px 0; }
          .report-title h3 { margin: 0; font-size: 12pt; text-decoration: underline; text-transform: uppercase; }
          .report-title p { margin: 4px 0 0; font-size: 9.5pt; }
          
          .kpi-container { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          .kpi-card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 8px; text-align: center; background: #f8fafc; }
          .kpi-num { font-size: 16pt; font-weight: 900; color: #0284c7; }
          .kpi-label { font-size: 8.5pt; color: #475569; text-transform: uppercase; font-weight: 700; margin-top: 2px; }

          .table-responsive-wrapper {
            width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            margin-top: 10px;
          }
          table { width: 100%; border-collapse: collapse; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 8.5pt; min-width: 850px; }
          th, td { border: 1px solid #cbd5e1; padding: 6px 8px; vertical-align: middle; }
          th { background-color: #f1f5f9; font-weight: bold; text-align: center; color: #334155; }
          
          .badge { padding: 2px 6px; border-radius: 4px; font-size: 7pt; font-weight: bold; color: #fff; display: inline-block; }
          .badge.critical { background: #dc2626; }
          .badge.high { background: #ea580c; }
          .badge.medium { background: #d97706; }
          .badge.low { background: #2563eb; }

          .status-badge { padding: 2px 6px; border-radius: 4px; font-size: 7pt; font-weight: bold; display: inline-block; white-space: nowrap; }
          .status-badge.open { background: #fee2e2; color: #991b1b; }
          .status-badge.assigned { background: #fef3c7; color: #92400e; }
          .status-badge.in_progress { background: #dbeafe; color: #1e40af; }
          .status-badge.resolved { background: #dcfce7; color: #166534; }
          .status-badge.closed { background: #f1f5f9; color: #334155; }

          .signature-box { margin-top: 30px; width: 100%; display: flex; justify-content: space-between; font-family: 'Times New Roman', serif; }
          .sig-column { width: 35%; text-align: center; }
          .sig-space { height: 60px; }

          @media screen and (max-width: 640px) {
            .kpi-container { grid-template-columns: repeat(2, 1fr) !important; gap: 6px !important; }
            .kpi-num { font-size: 14pt !important; }
            .kpi-label { font-size: 7.5pt !important; }
            .kop-surat h2 { font-size: 10pt !important; }
            .kop-surat h1 { font-size: 12pt !important; }
            .kop-surat p { font-size: 8pt !important; }
            .signature-box { flex-direction: column !important; gap: 20px !important; align-items: center !important; }
            .sig-column { width: 100% !important; }
          }

          @media print {
            .no-print { display: none !important; }
            .print-header-bar { display: none !important; }
            body { padding: 0 !important; background: transparent !important; }
            .table-responsive-wrapper { overflow: visible !important; border: none !important; }
            table { min-width: 100% !important; }
            th, td { border: 1px solid #000 !important; }
            @page { size: A4 landscape; margin: 10mm; }
          }
        </style>
      </head>
      <body>
        <div class="print-header-bar no-print">
          <button type="button" onclick="goBackToApp()" class="btn-back">
            <span>⬅ Kembali ke Aplikasi</span>
          </button>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" onclick="window.print()" class="btn-print">
              <span>🖨 Cetak Sekarang (PDF)</span>
            </button>
          </div>
        </div>

        <script>
          function goBackToApp() {
            if (window.parent && window.parent !== window && typeof window.parent.closeReportPrintModal === 'function') {
              window.parent.closeReportPrintModal();
            } else if (window.history.length > 1) {
              window.history.back();
            } else {
              window.location.href = '/';
            }
          }
        </script>

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

        <div class="table-responsive-wrapper">
          <table>
            <thead>
              <tr>
                <th style="width: 35px; text-align: center;">No</th>
                <th style="width: 110px; text-align: center; white-space: nowrap;">No Tiket</th>
                <th style="width: 90px; text-align: center; white-space: nowrap;">Tanggal</th>
                <th style="min-width: 120px;">Ruangan / Unit</th>
                <th style="min-width: 100px;">Kategori</th>
                <th style="min-width: 100px;">Pelapor</th>
                <th style="width: 75px; text-align: center;">Prioritas</th>
                <th style="min-width: 160px;">Uraian Kendala</th>
                <th style="min-width: 110px;">Teknisi</th>
                <th style="width: 85px; text-align: center;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || '<tr><td colspan="10" style="text-align: center; padding: 20px;">Tidak ada data tiket untuk filter ini.</td></tr>'}
            </tbody>
          </table>
        </div>

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

