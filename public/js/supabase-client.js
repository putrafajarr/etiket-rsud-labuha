/**
 * Shared Supabase Cloud & API Resilience Layer for SIM-ETIKET RSUD Labuha
 * Handles direct Supabase REST operations when running on static hosting
 * (Cloudflare Workers / PWA / Capacitor APK) and falls back cleanly when
 * an optional local Node.js server is unreachable.
 */
(function (global) {
  'use strict';

  const SUPABASE_REST_URL = 'https://kwjmzugilxbuqlrgangt.supabase.co/rest/v1';
  const SUPABASE_ANON_KEY = 'sb_publishable_XafHR40fyOY_VKGKLn-paA_QDa_2xb6';

  global.ETIKET_CONFIG = {
    SUPABASE_REST_URL,
    SUPABASE_ANON_KEY
  };

  if (!global._originalFetch) {
    global._originalFetch = global.fetch.bind(global);
  }

  // -------------------- Shared Utility Helpers --------------------

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  function sanitizeBaseUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    let clean = rawUrl.trim().replace(/\/+$/, '');
    if (!clean) return '';
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      const isLocal = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(clean);
      clean = (isLocal ? 'http://' : 'https://') + clean;
    }
    return clean;
  }

  function isLocalHostname(hostname) {
    if (!hostname) return false;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.local') ||
      /^192\.168\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  }

  function isUsableLocalBackend() {
    const customBase = sanitizeBaseUrl(localStorage.getItem('server_api_url') || '');
    const pageIsHttps = global.location && global.location.protocol === 'https:';
    const currentHost = (global.location && global.location.hostname) || '';

    // Ignore stale HTTP LAN URLs or old dead trycloudflare tunnels when served over HTTPS
    if (customBase) {
      if (customBase.includes('trycloudflare.com')) return null;
      if (pageIsHttps && customBase.startsWith('http://')) return null;
      return customBase;
    }

    // Inside Capacitor bundled APK (https://localhost), there is no local Express /api backend
    if (global.Capacitor && isLocalHostname(currentHost)) {
      return null;
    }

    if (isLocalHostname(currentHost)) {
      return '';
    }
    return null;
  }

  const scriptPromises = {};

  function ensureScriptLoaded(src) {
    const basePath = src.split('?')[0];
    if (scriptPromises[basePath]) return scriptPromises[basePath];

    scriptPromises[basePath] = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        delete scriptPromises[basePath];
        reject(new Error('Gagal memuat ' + src));
      };
      document.head.appendChild(script);
    });
    return scriptPromises[basePath];
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Gagal membaca file gambar'));
      reader.readAsDataURL(file);
    });
  }

  function loadImageElement(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Format gambar tidak didukung oleh browser ini'));
      img.src = src;
    });
  }

  async function compressImageFile(file, opts = {}) {
    if (!file || typeof file !== 'object' || file.size === 0) return null;

    const maxDimStart = opts.maxDim || 1024;
    const maxLength = opts.maxLength || 700000;
    const rawDataUrl = await readFileAsDataUrl(file);

    try {
      const img = await loadImageElement(rawDataUrl);
      const steps = [
        { dim: maxDimStart, quality: opts.quality || 0.75 },
        { dim: Math.min(maxDimStart, 800), quality: 0.62 },
        { dim: Math.min(maxDimStart, 640), quality: 0.5 }
      ];

      let bestDataUrl = '';
      for (const step of steps) {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (!w || !h) break;

        if (w > step.dim || h > step.dim) {
          if (w >= h) {
            h = Math.round((h * step.dim) / w);
            w = step.dim;
          } else {
            w = Math.round((w * step.dim) / h);
            h = step.dim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        bestDataUrl = canvas.toDataURL('image/jpeg', step.quality);
        if (bestDataUrl.length <= maxLength) {
          return bestDataUrl;
        }
      }

      if (bestDataUrl) return bestDataUrl;
    } catch (imgErr) {
      // Fallback if small valid image data URL couldn't decode onto canvas in limited WebViews
      if (typeof rawDataUrl === 'string' && rawDataUrl.startsWith('data:image/') && rawDataUrl.length <= maxLength) {
        return rawDataUrl;
      }
      throw new Error('File yang dipilih bukan gambar yang valid atau ukurannya terlalu besar');
    }

    return rawDataUrl;
  }

  async function generateQrDataUrl(text, size = 320) {
    if (!global.QRCode) {
      await ensureScriptLoaded('/js/qrcode.min.js?v=4.0');
    }
    const qrLib = global.QRCode;
    if (!qrLib || typeof qrLib.toDataURL !== 'function') {
      throw new Error('Library QRCode belum siap');
    }
    return qrLib.toDataURL(String(text), {
      width: size,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
  }

  async function getBcryptLib() {
    let lib = global.bcrypt || (global.dcodeIO && global.dcodeIO.bcrypt);
    if (!lib) {
      await ensureScriptLoaded('/js/bcrypt.min.js?v=4.0').catch(() => {});
      lib = global.bcrypt || (global.dcodeIO && global.dcodeIO.bcrypt);
    }
    return lib;
  }

  // -------------------- Supabase REST Transport --------------------

  function parseSupabaseError(text, fallbackMsg) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.code === '23505') {
        return 'Data duplikat: kode, username, atau nomor tersebut sudah digunakan.';
      }
      if (parsed && (parsed.message || parsed.error_description || parsed.details)) {
        return parsed.message || parsed.error_description || parsed.details;
      }
    } catch (e) {
      // ignore non-JSON text
    }
    return text || fallbackMsg || 'Terjadi kesalahan pada koneksi Supabase';
  }

  async function supabaseRequest(path, options = {}) {
    const method = options.method || 'GET';
    const headers = Object.assign(
      {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      options.headers || {}
    );

    const fetchOpts = {
      method,
      headers
    };
    if (options.body !== undefined) {
      fetchOpts.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    const res = await global._originalFetch(`${SUPABASE_REST_URL}${path}`, fetchOpts);
    const text = await res.text();

    if (!res.ok) {
      const msg = parseSupabaseError(text, `HTTP ${res.status}`);
      const err = new Error(msg);
      err.status = res.status;
      err.raw = text;
      throw err;
    }

    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return text;
    }
  }

  async function parseRequestBody(options = {}) {
    const body = options.body;
    const fields = {};
    const files = {};

    if (!body) return { fields, files };

    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      for (const [k, v] of body.entries()) {
        if (typeof File !== 'undefined' && (v instanceof File || v instanceof Blob)) {
          if (v.size > 0) files[k] = v;
        } else {
          fields[k] = v;
        }
      }
      return { fields, files };
    }

    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      for (const [k, v] of body.entries()) {
        fields[k] = v;
      }
      return { fields, files };
    }

    if (typeof body === 'string') {
      try {
        Object.assign(fields, JSON.parse(body));
      } catch (e) {
        // non-JSON string
      }
      return { fields, files };
    }

    if (typeof body === 'object') {
      Object.assign(fields, body);
    }
    return { fields, files };
  }

  function sortTicketsPriority(tickets) {
    const weights = { critical: 1, high: 2, medium: 3, low: 4 };
    return (tickets || []).slice().sort((a, b) => {
      const wa = weights[a.priority] || 4;
      const wb = weights[b.priority] || 4;
      if (wa !== wb) return wa - wb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }

  async function fetchSettingsMap() {
    const rows = await supabaseRequest('/system_settings?select=key,value');
    const map = {};
    (rows || []).forEach(r => {
      map[r.key] = r.value;
    });
    return map;
  }

  async function insertTicketLog(ticketId, userName, action, notes, userId = null) {
    try {
      await supabaseRequest('/ticket_logs', {
        method: 'POST',
        body: {
          ticket_id: Number(ticketId),
          user_id: userId ? Number(userId) : null,
          user_name: userName || 'Sistem',
          action,
          notes: notes || ''
        }
      });
    } catch (e) {
      console.warn('[SupabaseClient] Non-fatal log write failure:', e.message);
    }
  }

  async function insertNotificationLog(entry) {
    try {
      const rows = await supabaseRequest('/notifications_log', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: {
          ticket_id: entry.ticket_id ? Number(entry.ticket_id) : null,
          channel: entry.channel || 'system',
          recipient: entry.recipient || '-',
          title: entry.title || '',
          message: entry.message || '',
          status: entry.status || 'simulated',
          error_message: entry.error_message || null
        }
      });
      return Array.isArray(rows) ? rows[0] : rows;
    } catch (e) {
      console.warn('[SupabaseClient] Non-fatal notification log failure:', e.message);
      return null;
    }
  }

  async function generateUniqueTicketNo() {
    const now = new Date();
    const ym = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, '0');
    const existing = await supabaseRequest(
      `/tickets?ticket_no=like.TKT-${ym}-*&select=id,ticket_no&order=id.desc&limit=20`
    );

    let maxSeq = 0;
    (existing || []).forEach(row => {
      if (row.ticket_no) {
        const parts = String(row.ticket_no).split('-');
        const seqNum = parseInt(parts[2], 10);
        if (!Number.isNaN(seqNum) && seqNum > maxSeq) maxSeq = seqNum;
      }
    });

    return `TKT-${ym}-${String(maxSeq + 1).padStart(4, '0')}`;
  }

  // -------------------- Domain Handlers --------------------

  async function handleAuthLogin(options) {
    const { fields } = await parseRequestBody(options);
    const username = (fields.username || '').trim();
    const password = fields.password || '';

    if (!username || !password) {
      return jsonResponse({ error: 'Username dan password wajib diisi' }, 400);
    }

    const rows = await supabaseRequest(
      `/users?or=(username.ilike.${encodeURIComponent(username)},email.ilike.${encodeURIComponent(username)})&is_active=neq.0`
    );

    if (!rows || rows.length === 0) {
      return jsonResponse({ error: 'Username atau password salah' }, 401);
    }

    const user = rows[0];
    let matched = false;
    const bcryptLib = await getBcryptLib();

    if (bcryptLib && typeof bcryptLib.compareSync === 'function' && user.password_hash) {
      try {
        matched = bcryptLib.compareSync(password, user.password_hash);
      } catch (e) {
        matched = false;
      }
    }

    if (!matched && user.password_hash && !String(user.password_hash).startsWith('$2')) {
      matched = user.password_hash === password;
    }

    if (!matched) {
      return jsonResponse({ error: 'Username atau password salah' }, 401);
    }

    const safeUser = Object.assign({}, user);
    delete safeUser.password_hash;
    const token = 'sb_' + btoa(unescape(encodeURIComponent(JSON.stringify(safeUser))));
    return jsonResponse({ user: safeUser, token }, 200);
  }

  async function handleGetTickets(queryString) {
    const params = new URLSearchParams(queryString);
    const status = params.get('status');
    const priority = params.get('priority');
    const roomId = params.get('roomId');
    const categoryId = params.get('categoryId');
    const techId = params.get('techId');
    const search = (params.get('search') || '').trim().toLowerCase();

    const supaFilters = ['select=*', 'order=created_at.desc'];
    if (status && status !== 'all') supaFilters.push(`status=eq.${encodeURIComponent(status)}`);
    if (priority && priority !== 'all') supaFilters.push(`priority=eq.${encodeURIComponent(priority)}`);
    if (roomId) supaFilters.push(`room_id=eq.${encodeURIComponent(roomId)}`);
    if (categoryId) supaFilters.push(`category_id=eq.${encodeURIComponent(categoryId)}`);
    if (techId) supaFilters.push(`assigned_to=eq.${encodeURIComponent(techId)}`);

    let rows = await supabaseRequest(`/tickets?${supaFilters.join('&')}`);
    if (search) {
      rows = (rows || []).filter(t =>
        String(t.ticket_no || '').toLowerCase().includes(search) ||
        String(t.title || '').toLowerCase().includes(search) ||
        String(t.description || '').toLowerCase().includes(search) ||
        String(t.room_name || '').toLowerCase().includes(search) ||
        String(t.reporter_name || '').toLowerCase().includes(search) ||
        String(t.category_name || '').toLowerCase().includes(search)
      );
    }

    return jsonResponse(sortTicketsPriority(rows), 200);
  }

  async function handleLatestAlert(queryString) {
    const params = new URLSearchParams(queryString);
    const sinceId = parseInt(params.get('sinceId'), 10);

    const rows = await supabaseRequest('/tickets?select=id,status&order=id.desc&limit=500');
    const latestId = rows && rows.length > 0 ? Number(rows[0].id) : 0;
    const openCount = (rows || []).filter(r => r.status === 'open').length;

    let newTickets = [];
    if (!Number.isNaN(sinceId) && sinceId >= 0) {
      newTickets = await supabaseRequest(
        `/tickets?select=id,ticket_no,room_name,category_name,reporter_name,reporter_phone,title,priority,status,assigned_to,created_at&id=gt.${sinceId}&order=id.asc&limit=5`
      );
    }

    return jsonResponse({ latestId, openCount, newTickets: newTickets || [] }, 200);
  }

  async function handleGetTicketDetail(identifier) {
    const cleanId = decodeURIComponent(identifier).trim();
    const isNumeric = /^\d+$/.test(cleanId);
    const filter = isNumeric
      ? `id=eq.${cleanId}`
      : `ticket_no=ilike.${encodeURIComponent(cleanId)}`;

    const rows = await supabaseRequest(`/tickets?select=*&${filter}&limit=1`);
    if (!rows || rows.length === 0) {
      return jsonResponse({ error: 'Tiket tidak ditemukan. Periksa kembali nomor tiket Anda.' }, 404);
    }

    const ticket = rows[0];
    const logs = await supabaseRequest(`/ticket_logs?select=*&ticket_id=eq.${ticket.id}&order=created_at.asc`);
    return jsonResponse({ ticket, logs: logs || [] }, 200);
  }

  async function handleCreateTicket(options) {
    const { fields, files } = await parseRequestBody(options);

    const roomId = fields.room_id ? parseInt(fields.room_id, 10) : null;
    const categoryId = fields.category_id ? parseInt(fields.category_id, 10) : null;
    const reporterName = (fields.reporter_name || '').trim();
    const reporterPhone = (fields.reporter_phone || '').trim();
    const reporterEmail = (fields.reporter_email || '').trim() || null;
    const reporterRole = (fields.reporter_role || 'Staff Ruangan').trim();
    const description = (fields.description || '').trim();
    const channel = (fields.channel || 'web_qr').trim();

    if (!roomId || !reporterName || !reporterPhone || !description) {
      return jsonResponse({ error: 'Ruangan, Nama Pelapor, No. WhatsApp, dan Rincian kendala wajib diisi' }, 400);
    }

    const [roomRows, catRows, settings] = await Promise.all([
      supabaseRequest(`/rooms?select=id,name&id=eq.${roomId}&limit=1`),
      categoryId ? supabaseRequest(`/categories?select=*&id=eq.${categoryId}&limit=1`) : Promise.resolve([]),
      fetchSettingsMap().catch(() => ({}))
    ]);

    const roomName = roomRows && roomRows[0] ? roomRows[0].name : 'Ruangan Umum';
    const cat = catRows && catRows[0] ? catRows[0] : null;
    const categoryName = cat ? cat.name : 'Umum';

    const allowedPriorities = ['critical', 'high', 'medium', 'low'];
    const rawPriority = (fields.priority || '').trim().toLowerCase();
    const priority = allowedPriorities.includes(rawPriority)
      ? rawPriority
      : (cat && allowedPriorities.includes(cat.default_priority) ? cat.default_priority : 'medium');

    const title = (fields.title && fields.title.trim())
      ? fields.title.trim()
      : (description.length > 75 ? description.substring(0, 75) + '...' : description);

    let photoUrl = fields.photo_url || null;
    if (files.photo) {
      photoUrl = await compressImageFile(files.photo, { maxDim: 1024, quality: 0.72, maxLength: 700000 });
    }

    const slaHoursMap = {
      critical: parseFloat(settings.sla_critical_hours) || 1,
      high: parseFloat(settings.sla_high_hours) || 3,
      medium: parseFloat(settings.sla_medium_hours) || 8,
      low: parseFloat(settings.sla_low_hours) || 24
    };
    const resolveHours = slaHoursMap[priority] || (cat && cat.sla_resolve_hours) || 4;
    const responseMinutes = (cat && cat.sla_response_minutes) || 30;
    const now = Date.now();
    const targetResponseTime = new Date(now + responseMinutes * 60 * 1000).toISOString();
    const targetResolveTime = new Date(now + resolveHours * 3600 * 1000).toISOString();

    let created = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let ticketNo = await generateUniqueTicketNo();
      if (attempt > 0) {
        ticketNo += '-' + String(Math.floor(10 + Math.random() * 89));
      }

      try {
        const inserted = await supabaseRequest('/tickets', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: {
            ticket_no: ticketNo,
            room_id: roomId,
            room_name: roomName,
            category_id: categoryId,
            category_name: categoryName,
            reporter_name: reporterName,
            reporter_phone: reporterPhone,
            reporter_email: reporterEmail,
            reporter_role: reporterRole,
            title,
            description,
            photo_url: photoUrl,
            priority,
            channel,
            status: 'open',
            sla_status: 'on_track',
            target_response_time: targetResponseTime,
            target_resolve_time: targetResolveTime
          }
        });
        created = Array.isArray(inserted) ? inserted[0] : inserted;
        break;
      } catch (insErr) {
        if (attempt === 2 || !String(insErr.raw || '').includes('23505')) {
          throw insErr;
        }
      }
    }

    if (created && created.id) {
      await insertTicketLog(
        created.id,
        reporterName,
        'TIKET DIBUAT',
        `Tiket dibuat melalui jalur ${channel} (Prioritas: ${priority.toUpperCase()})`
      );
    }

    return jsonResponse({ success: true, message: 'Tiket berhasil dibuat', ticket: created }, 201);
  }

  async function handleAssignTicket(ticketId, options) {
    const { fields } = await parseRequestBody(options);
    const techId = parseInt(fields.technician_id || fields.assigned_to, 10);
    const assignedByName = (fields.assigned_by_name || 'Tim IT').trim();

    if (!techId || Number.isNaN(techId)) {
      return jsonResponse({ error: 'ID teknisi wajib dipilih' }, 400);
    }

    const [ticketRows, userRows] = await Promise.all([
      supabaseRequest(`/tickets?select=*&id=eq.${ticketId}&limit=1`),
      supabaseRequest(`/users?select=id,name,username,role,phone&id=eq.${techId}&limit=1`)
    ]);

    if (!ticketRows || ticketRows.length === 0) {
      return jsonResponse({ error: 'Tiket tidak ditemukan' }, 404);
    }
    const ticket = ticketRows[0];
    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      return jsonResponse({ error: 'Tiket ini telah selesai dikerjakan dan dikunci permanen.' }, 400);
    }
    if (!userRows || userRows.length === 0) {
      return jsonResponse({ error: 'Data teknisi tidak ditemukan' }, 404);
    }

    const tech = userRows[0];
    const nowIso = new Date().toISOString();
    const patchData = {
      assigned_to: tech.id,
      assigned_to_name: tech.name,
      assigned_at: nowIso,
      status: 'in_progress',
      actual_response_time: ticket.actual_response_time || nowIso,
      updated_at: nowIso
    };

    const updated = await supabaseRequest(`/tickets?id=eq.${ticketId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: patchData
    });
    const updatedTicket = Array.isArray(updated) ? updated[0] : updated;

    await insertTicketLog(
      ticketId,
      assignedByName,
      'DISPOSISI TEKNISI',
      `Tiket ditugaskan kepada ${tech.name} oleh ${assignedByName}`
    );

    return jsonResponse({ success: true, message: 'Teknisi berhasil ditugaskan', ticket: updatedTicket }, 200);
  }

  async function handleUpdateTicketStatus(ticketId, options) {
    const { fields, files } = await parseRequestBody(options);
    const status = (fields.status || '').trim();
    const notes = (fields.notes || fields.resolution_notes || '').trim();
    const pendingReason = (fields.pending_reason || notes || '').trim();
    const userName = (fields.user_name || 'Teknisi IT').trim();

    if (!status) {
      return jsonResponse({ error: 'Status tiket wajib dipilih' }, 400);
    }

    const ticketRows = await supabaseRequest(`/tickets?select=*&id=eq.${ticketId}&limit=1`);
    if (!ticketRows || ticketRows.length === 0) {
      return jsonResponse({ error: 'Tiket tidak ditemukan' }, 404);
    }

    const currentTicket = ticketRows[0];
    if (currentTicket.status === 'resolved' || currentTicket.status === 'closed') {
      return jsonResponse({ error: 'Tiket ini telah selesai dan dikunci secara permanen.' }, 400);
    }

    const nowIso = new Date().toISOString();
    const patchData = {
      status,
      updated_at: nowIso
    };

    if (files.proof_photo) {
      patchData.proof_photo_url = await compressImageFile(files.proof_photo, {
        maxDim: 1024,
        quality: 0.72,
        maxLength: 700000
      });
    } else if (fields.proof_photo_url) {
      patchData.proof_photo_url = fields.proof_photo_url;
    }

    if (status === 'in_progress') {
      patchData.actual_response_time = currentTicket.actual_response_time || nowIso;
      if (notes) patchData.resolution_notes = notes;
    } else if (status === 'pending') {
      patchData.pending_reason = pendingReason || 'Menunggu kelengkapan / tindak lanjut';
    } else if (status === 'resolved' || status === 'closed') {
      patchData.resolved_at = currentTicket.resolved_at || nowIso;
      patchData.actual_resolve_time = currentTicket.actual_resolve_time || nowIso;
      if (status === 'closed') patchData.closed_at = nowIso;
      if (notes) patchData.resolution_notes = notes;

      if (currentTicket.target_resolve_time) {
        const deadline = new Date(currentTicket.target_resolve_time).getTime();
        patchData.sla_status = Date.now() <= deadline ? 'on_track' : 'breached';
      } else {
        patchData.sla_status = 'on_track';
      }
    }

    const updated = await supabaseRequest(`/tickets?id=eq.${ticketId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: patchData
    });
    const updatedTicket = Array.isArray(updated) ? updated[0] : updated;

    await insertTicketLog(
      ticketId,
      userName,
      `STATUS DIUBAH: ${status.toUpperCase()}`,
      notes || pendingReason || `Status tiket diperbarui menjadi ${status}`
    );

    return jsonResponse({ success: true, message: 'Status berhasil diperbarui', ticket: updatedTicket }, 200);
  }

  async function handleRateTicket(ticketId, options) {
    const { fields } = await parseRequestBody(options);
    const rating = parseInt(fields.rating, 10);
    const feedback = (fields.feedback || '').trim() || null;

    if (Number.isNaN(rating) || rating < 1 || rating > 5) {
      return jsonResponse({ error: 'Rating harus antara 1 sampai 5 bintang' }, 400);
    }

    const nowIso = new Date().toISOString();
    const updated = await supabaseRequest(`/tickets?id=eq.${ticketId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: {
        satisfaction_rating: rating,
        satisfaction_feedback: feedback,
        status: 'closed',
        closed_at: nowIso,
        updated_at: nowIso
      }
    });

    await insertTicketLog(
      ticketId,
      'Pelapor',
      'PENILAIAN KEPUASAN',
      `Memberikan rating ${rating} Bintang: "${feedback || 'Tanpa komentar'}"`
    );

    const updatedTicket = Array.isArray(updated) ? updated[0] : updated;
    return jsonResponse({ success: true, message: 'Terima kasih atas penilaian kepuasan Anda', ticket: updatedTicket }, 200);
  }

  async function handleDeleteTicket(ticketId) {
    await supabaseRequest(`/notifications_log?ticket_id=eq.${ticketId}`, { method: 'DELETE' }).catch(() => {});
    await supabaseRequest(`/ticket_logs?ticket_id=eq.${ticketId}`, { method: 'DELETE' }).catch(() => {});
    await supabaseRequest(`/tickets?id=eq.${ticketId}`, { method: 'DELETE' });
    return jsonResponse({ success: true, message: 'Tiket berhasil dihapus permanen' }, 200);
  }

  const DEFAULT_CLOUD_ORIGIN = 'https://etiket-rsud-labuha.etiket-itrsudlabuha.workers.dev';

  async function resolvePublicOrigin(queryString) {
    const params = new URLSearchParams(queryString || '');
    const customHost = (params.get('customHost') || '').trim();
    if (customHost) return sanitizeBaseUrl(customHost);

    try {
      const settings = await fetchSettingsMap();
      const configured = (settings.app_server_url || '').trim();
      if (configured && !configured.includes('trycloudflare.com') && !configured.includes('localhost')) {
        const currentIsHttps = global.location && global.location.protocol === 'https:';
        const configuredSanitized = sanitizeBaseUrl(configured);
        if (!currentIsHttps || configuredSanitized.startsWith('https://')) {
          return configuredSanitized;
        }
      }
    } catch (e) {
      // ignore
    }

    const origin = (global.location && global.location.origin) || '';
    if (!origin || origin === 'null' || (global.Capacitor && origin.includes('localhost'))) {
      return DEFAULT_CLOUD_ORIGIN;
    }
    return origin;
  }

  async function handleGetRooms() {
    const rooms = await supabaseRequest('/rooms?select=*&is_active=neq.0&order=name.asc');
    return jsonResponse(rooms || [], 200);
  }

  async function handleRoomQr(roomId, queryString) {
    const rows = await supabaseRequest(`/rooms?select=*&id=eq.${roomId}&limit=1`);
    if (!rows || rows.length === 0) {
      return jsonResponse({ error: 'Ruangan tidak ditemukan' }, 404);
    }
    const room = rows[0];
    const origin = await resolvePublicOrigin(queryString);
    const reportUrl = `${origin}/lapor.html?room=${encodeURIComponent(room.code)}&id=${room.id}`;
    const qrDataUrl = await generateQrDataUrl(reportUrl, 320);
    return jsonResponse({ room, reportUrl, qrDataUrl }, 200);
  }

  async function handleAllRoomQrs(queryString) {
    const [rooms, origin] = await Promise.all([
      supabaseRequest('/rooms?select=*&is_active=neq.0&order=name.asc'),
      resolvePublicOrigin(queryString)
    ]);

    const result = await Promise.all(
      (rooms || []).map(async room => {
        const reportUrl = `${origin}/lapor.html?room=${encodeURIComponent(room.code)}&id=${room.id}`;
        const qrDataUrl = await generateQrDataUrl(reportUrl, 280);
        return Object.assign({}, room, { reportUrl, qrDataUrl });
      })
    );
    return jsonResponse(result, 200);
  }

  async function handleSaveRoom(roomId, options) {
    const { fields } = await parseRequestBody(options);
    const name = (fields.name || '').trim();
    const code = (fields.code || '').trim().toUpperCase();
    const building = (fields.building || '').trim() || null;
    const floor = (fields.floor || '').trim() || null;
    const pic_name = (fields.pic_name || '').trim() || null;
    const pic_phone = (fields.pic_phone || '').trim() || null;

    if (!name || (!roomId && !code)) {
      return jsonResponse({ error: 'Nama ruangan dan kode wajib diisi' }, 400);
    }

    if (roomId) {
      const patch = { name, building, floor, pic_name, pic_phone };
      if (code) patch.code = code;
      const updated = await supabaseRequest(`/rooms?id=eq.${roomId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: patch
      });
      const room = Array.isArray(updated) ? updated[0] : updated;
      return jsonResponse({ success: true, room }, 200);
    }

    const inserted = await supabaseRequest('/rooms', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: { name, code, building, floor, pic_name, pic_phone, is_active: 1 }
    });
    const room = Array.isArray(inserted) ? inserted[0] : inserted;
    return jsonResponse({ success: true, room }, 201);
  }

  async function handleDeleteRoom(roomId) {
    try {
      await supabaseRequest(`/rooms?id=eq.${roomId}`, { method: 'DELETE' });
    } catch (err) {
      if (String(err.raw || '').includes('23503') || err.status === 409) {
        await supabaseRequest(`/rooms?id=eq.${roomId}`, {
          method: 'PATCH',
          body: { is_active: 0 }
        });
      } else {
        throw err;
      }
    }
    return jsonResponse({ success: true, message: 'Ruangan berhasil dihapus' }, 200);
  }

  async function handleGetCategories() {
    const categories = await supabaseRequest('/categories?select=*&is_active=neq.0&order=id.asc');
    return jsonResponse(categories || [], 200);
  }

  async function handleGetUsers(withTicketCounts) {
    const userCols = 'id,username,name,role,phone,email,room_id,specialization,is_active,created_at';
    const [users, tickets] = await Promise.all([
      supabaseRequest(`/users?select=${userCols}&is_active=neq.0&order=id.asc`),
      withTicketCounts ? supabaseRequest('/tickets?select=id,assigned_to,status') : Promise.resolve(null)
    ]);

    const list = users || [];
    if (withTicketCounts && Array.isArray(tickets)) {
      const counts = {};
      tickets.forEach(t => {
        if (!t.assigned_to) return;
        if (!counts[t.assigned_to]) counts[t.assigned_to] = { active: 0, resolved: 0 };
        if (t.status === 'resolved' || t.status === 'closed') {
          counts[t.assigned_to].resolved++;
        } else {
          counts[t.assigned_to].active++;
        }
      });
      return jsonResponse(
        list.map(u =>
          Object.assign({}, u, {
            active_tickets: (counts[u.id] && counts[u.id].active) || 0,
            resolved_tickets: (counts[u.id] && counts[u.id].resolved) || 0
          })
        ),
        200
      );
    }

    return jsonResponse(list, 200);
  }

  async function handleSaveUser(userId, options) {
    const { fields } = await parseRequestBody(options);
    const name = (fields.name || '').trim();
    const username = (fields.username || '').trim();
    const role = (fields.role || 'teknisi').trim();
    const phone = (fields.phone || '').trim() || null;
    const email = (fields.email || '').trim() || null;
    const specialization = (fields.specialization || '').trim() || null;
    const password = fields.password || '';

    if (!name || (!userId && (!username || !password))) {
      return jsonResponse({ error: 'Nama, username, dan password wajib diisi' }, 400);
    }

    let passwordHash = null;
    if (password) {
      const bcryptLib = await getBcryptLib();
      if (!bcryptLib || typeof bcryptLib.hashSync !== 'function') {
        throw new Error('Library enkripsi password belum tersedia');
      }
      passwordHash = bcryptLib.hashSync(password, 10);
    }

    if (userId) {
      const patch = { name, role, phone, email, specialization };
      if (username) patch.username = username;
      if (passwordHash) patch.password_hash = passwordHash;

      const updated = await supabaseRequest(`/users?id=eq.${userId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: patch
      });
      const user = Array.isArray(updated) ? updated[0] : updated;
      if (user) delete user.password_hash;
      return jsonResponse({ success: true, user }, 200);
    }

    const inserted = await supabaseRequest('/users', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: {
        name,
        username,
        role,
        password_hash: passwordHash,
        phone,
        email,
        specialization,
        is_active: 1
      }
    });
    const user = Array.isArray(inserted) ? inserted[0] : inserted;
    if (user) delete user.password_hash;
    return jsonResponse({ success: true, user }, 201);
  }

  async function handleDeleteUser(userId) {
    try {
      await supabaseRequest(`/users?id=eq.${userId}`, { method: 'DELETE' });
    } catch (err) {
      if (String(err.raw || '').includes('23503') || err.status === 409) {
        await supabaseRequest(`/users?id=eq.${userId}`, {
          method: 'PATCH',
          body: { is_active: 0 }
        });
      } else {
        throw err;
      }
    }
    return jsonResponse({ success: true, message: 'Akun pengguna berhasil dihapus' }, 200);
  }

  async function handleReportsStats() {
    const rows = await supabaseRequest('/tickets?select=id,status,priority,sla_status,target_resolve_time,resolved_at');
    const list = rows || [];
    const total = list.length;
    const open = list.filter(r => r.status === 'open' || r.status === 'assigned').length;
    const inProgress = list.filter(r => r.status === 'in_progress' || r.status === 'pending').length;
    const resolvedRows = list.filter(r => r.status === 'resolved' || r.status === 'closed');
    const resolved = resolvedRows.length;

    let slaCompliance = 100;
    if (resolved > 0) {
      const onTrack = resolvedRows.filter(r => {
        if (r.sla_status === 'breached') return false;
        if (r.sla_status === 'on_track') return true;
        if (r.resolved_at && r.target_resolve_time) {
          return new Date(r.resolved_at).getTime() <= new Date(r.target_resolve_time).getTime();
        }
        return true;
      }).length;
      slaCompliance = Math.round((onTrack / resolved) * 100);
    }

    return jsonResponse({ total, open, inProgress, resolved, slaCompliance }, 200);
  }

  async function handleGetSettings() {
    const map = await fetchSettingsMap();
    return jsonResponse(map, 200);
  }

  async function handleSaveSettings(options) {
    const { fields } = await parseRequestBody(options);
    const nowIso = new Date().toISOString();
    const rows = Object.entries(fields).map(([key, value]) => ({
      key,
      value: value === null || value === undefined ? '' : String(value),
      updated_at: nowIso
    }));

    if (rows.length > 0) {
      await supabaseRequest('/system_settings?on_conflict=key', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: rows
      });
    }
    return jsonResponse({ success: true, message: 'Pengaturan disimpan ke Supabase' }, 200);
  }

  async function handleGetNotificationLogs() {
    const rows = await supabaseRequest('/notifications_log?select=*&order=created_at.desc&limit=100');
    return jsonResponse(rows || [], 200);
  }

  async function handleTestGateway(type, options) {
    const { fields } = await parseRequestBody(options);
    const settings = await fetchSettingsMap().catch(() => ({}));

    if (type === 'telegram') {
      const token = (settings.telegram_bot_token || '').trim();
      const chatId = (fields.chatId || settings.telegram_chat_id || '').trim();
      const text = '🔔 [TEST] SIM-ETIKET RSUD Labuha: Uji koneksi Telegram Bot berhasil!';

      if (token && chatId && !token.includes('SAMPLE_')) {
        try {
          const tgRes = await global._originalFetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text })
          });
          const tgData = await tgRes.json();
          if (tgRes.ok && tgData.ok) {
            await insertNotificationLog({
              channel: 'telegram',
              recipient: chatId,
              title: 'Uji Coba Telegram',
              message: text,
              status: 'sent'
            });
            return jsonResponse({ status: 'sent', message: 'Pesan uji coba berhasil dikirim langsung ke Telegram!' }, 200);
          }
          const errDesc = (tgData && tgData.description) || `HTTP ${tgRes.status}`;
          await insertNotificationLog({
            channel: 'telegram',
            recipient: chatId,
            title: 'Uji Coba Telegram',
            message: text,
            status: 'failed',
            error_message: errDesc
          });
          return jsonResponse({ status: 'failed', message: `Telegram menolak permintaan: ${errDesc}` }, 200);
        } catch (tgErr) {
          await insertNotificationLog({
            channel: 'telegram',
            recipient: chatId,
            title: 'Uji Coba Telegram',
            message: text,
            status: 'failed',
            error_message: tgErr.message
          });
          return jsonResponse({ status: 'failed', message: `Gagal menghubungi API Telegram: ${tgErr.message}` }, 200);
        }
      }

      await insertNotificationLog({
        channel: 'telegram',
        recipient: chatId || '-',
        title: 'Uji Coba Telegram (Simulasi)',
        message: 'Token Telegram masih default/kosong. Uji coba dicatat di log.',
        status: 'simulated'
      });
      return jsonResponse({
        status: 'simulated',
        message: 'Token Bot Telegram masih sampel/kosong, sehingga uji coba dicatat sebagai simulasi di Log Notifikasi.'
      }, 200);
    }

    if (type === 'wa') {
      const phone = (fields.phone || '').trim();
      const msg = 'Halo, ini pesan uji coba WhatsApp Gateway SIM-ETIKET RSUD Labuha.';
      await insertNotificationLog({
        channel: 'whatsapp',
        recipient: phone || '-',
        title: 'Uji Coba WhatsApp Gateway',
        message: msg,
        status: 'simulated'
      });
      return jsonResponse({
        status: 'simulated',
        message: 'Di mode Cloud Static, pengiriman otomatis gateway dicatat ke Log Notifikasi. Untuk kirim langsung gratis dari HP teknisi, gunakan tombol WA di detail tiket.'
      }, 200);
    }

    const email = (fields.email || '').trim();
    const msg = 'Uji coba notifikasi Email SMTP Helpdesk IT RSUD Labuha.';
    await insertNotificationLog({
      channel: 'email',
      recipient: email || '-',
      title: 'Uji Coba Email SMTP',
      message: msg,
      status: 'simulated'
    });
    return jsonResponse({
      status: 'simulated',
      message: 'Protokol SMTP memerlukan relay server lokal; uji coba dicatat sebagai simulasi di Log Notifikasi Supabase.'
    }, 200);
  }

  // -------------------- Router --------------------

  async function handleSupabaseApi(apiPath, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const qIndex = apiPath.indexOf('?');
    const pathname = qIndex >= 0 ? apiPath.slice(0, qIndex) : apiPath;
    const queryString = qIndex >= 0 ? apiPath.slice(qIndex + 1) : '';

    try {
      // Auth
      if (method === 'POST' && pathname === '/api/auth/login') {
        return await handleAuthLogin(options);
      }

      // Tickets
      if (method === 'GET' && pathname === '/api/tickets/latest-alert') {
        return await handleLatestAlert(queryString);
      }
      if (method === 'GET' && pathname === '/api/tickets') {
        return await handleGetTickets(queryString);
      }
      if (method === 'GET' && /^\/api\/tickets\/[^/]+$/.test(pathname)) {
        return await handleGetTicketDetail(pathname.split('/')[3]);
      }
      if (method === 'POST' && pathname === '/api/tickets') {
        return await handleCreateTicket(options);
      }
      if (method === 'PATCH' && /^\/api\/tickets\/\d+\/assign$/.test(pathname)) {
        return await handleAssignTicket(pathname.split('/')[3], options);
      }
      if (method === 'PATCH' && /^\/api\/tickets\/\d+\/status$/.test(pathname)) {
        return await handleUpdateTicketStatus(pathname.split('/')[3], options);
      }
      if (method === 'POST' && /^\/api\/tickets\/\d+\/rate$/.test(pathname)) {
        return await handleRateTicket(pathname.split('/')[3], options);
      }
      if (method === 'DELETE' && /^\/api\/tickets\/\d+$/.test(pathname)) {
        return await handleDeleteTicket(pathname.split('/')[3]);
      }

      // Rooms
      if (method === 'GET' && pathname === '/api/rooms/all/qrcodes') {
        return await handleAllRoomQrs(queryString);
      }
      if (method === 'GET' && /^\/api\/rooms\/\d+\/qr$/.test(pathname)) {
        return await handleRoomQr(pathname.split('/')[3], queryString);
      }
      if (method === 'GET' && pathname === '/api/rooms') {
        return await handleGetRooms();
      }
      if (method === 'POST' && pathname === '/api/rooms') {
        return await handleSaveRoom(null, options);
      }
      if (method === 'PUT' && /^\/api\/rooms\/\d+$/.test(pathname)) {
        return await handleSaveRoom(pathname.split('/')[3], options);
      }
      if (method === 'DELETE' && /^\/api\/rooms\/\d+$/.test(pathname)) {
        return await handleDeleteRoom(pathname.split('/')[3]);
      }

      // Categories
      if (method === 'GET' && pathname === '/api/categories') {
        return await handleGetCategories();
      }

      // Users
      if (method === 'GET' && pathname === '/api/users/technicians') {
        return await handleGetUsers(true);
      }
      if (method === 'GET' && pathname === '/api/users') {
        return await handleGetUsers(false);
      }
      if (method === 'POST' && pathname === '/api/users') {
        return await handleSaveUser(null, options);
      }
      if (method === 'PUT' && /^\/api\/users\/\d+$/.test(pathname)) {
        return await handleSaveUser(pathname.split('/')[3], options);
      }
      if (method === 'DELETE' && /^\/api\/users\/\d+$/.test(pathname)) {
        return await handleDeleteUser(pathname.split('/')[3]);
      }

      // Reports
      if (method === 'GET' && pathname === '/api/reports/stats') {
        return await handleReportsStats();
      }

      // Settings & Notification Logs
      if (method === 'GET' && pathname === '/api/settings/logs') {
        return await handleGetNotificationLogs();
      }
      if (method === 'GET' && pathname === '/api/settings') {
        return await handleGetSettings();
      }
      if (method === 'POST' && pathname === '/api/settings') {
        return await handleSaveSettings(options);
      }
      if (method === 'POST' && pathname === '/api/settings/test-wa') {
        return await handleTestGateway('wa', options);
      }
      if (method === 'POST' && pathname === '/api/settings/test-telegram') {
        return await handleTestGateway('telegram', options);
      }
      if (method === 'POST' && pathname === '/api/settings/test-email') {
        return await handleTestGateway('email', options);
      }

      return jsonResponse({ error: `Endpoint API tidak dikenali: ${method} ${pathname}` }, 404);
    } catch (err) {
      console.error('[SupabaseClient] API error:', method, pathname, err);
      return jsonResponse({ error: err.message || 'Gagal memproses permintaan ke Supabase' }, err.status || 500);
    }
  }

  function extractApiPath(url) {
    if (typeof url !== 'string') return null;
    if (url.startsWith('/api/')) return url;
    try {
      const parsed = new URL(url, global.location ? global.location.origin : 'https://localhost');
      if (global.location && parsed.origin === global.location.origin && parsed.pathname.startsWith('/api/')) {
        return parsed.pathname + parsed.search;
      }
    } catch (e) {
      // ignore invalid URL
    }
    return null;
  }

  async function smartFetch(url, options = {}) {
    const apiPath = extractApiPath(url);
    if (!apiPath) {
      return global._originalFetch(url, options);
    }

    // Try local Node.js backend first ONLY when actively running on a local/custom server
    const localBase = isUsableLocalBackend();
    if (localBase !== null) {
      const targetUrl = localBase ? localBase + apiPath : apiPath;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        const res = await global._originalFetch(targetUrl, Object.assign({}, options, { signal: controller.signal }));
        clearTimeout(timeout);
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && (contentType.includes('application/json') || apiPath.includes('/export-excel') || apiPath.includes('/print-html'))) {
          return res;
        }
      } catch (err) {
        console.debug(`[SmartFetch] Local backend ${targetUrl} unreachable, using Supabase Cloud.`);
      }
    }

    return handleSupabaseApi(apiPath, options);
  }

  // Expose helpers and transparent fetch wrapper
  if (!global.lucide) {
    global.lucide = { createIcons: function () {} };
  }
  global.escapeHtml = escapeHtml;
  global.compressImageFile = compressImageFile;
  global.generateQrDataUrl = generateQrDataUrl;
  global.ensureScriptLoaded = ensureScriptLoaded;
  global.smartFetch = smartFetch;
  global.isLocalBackendHost = () => isUsableLocalBackend() !== null;
  global.handleSupabaseApi = handleSupabaseApi;

  global.fetch = function (input, options) {
    if (typeof input === 'string' && extractApiPath(input)) {
      return smartFetch(input, options);
    }
    return global._originalFetch.apply(global, arguments);
  };
})(typeof window !== 'undefined' ? window : globalThis);
