// SIM-ETIKET RSUD LABUHA - Core Application Controller
let socket = null;
let allTickets = [];
let allRooms = [];
let allTechnicians = [];
let currentTab = 'tickets';
let viewMode = 'kanban';
let activeUser = {
  id: 1,
  username: 'superadmin',
  name: 'Super Administrator IT',
  role: 'koordinator'
};
let selectedTicketForModal = null;
let categoryChartInstance = null;
let roomChartInstance = null;
let filterTimeout = null;

document.addEventListener('DOMContentLoaded', async () => {
  initMobileNativeBridge();
  initSocket();
  await checkAuthSession();
  await loadRoomsMaster();
  await loadTechnicians();
  await loadTickets();
  await loadStats();
  startAutoSync();
  lucide.createIcons();

  // Unlock AudioContext and request notification permission on first user click
  document.addEventListener('click', () => {
    if (window.soundAlert) window.soundAlert.init();
    if (window.Capacitor?.Plugins?.EtiketNative) {
      window.Capacitor.Plugins.EtiketNative.requestPermission().then(refreshMobileNotifBadge).catch(() => { });
    } else if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(refreshMobileNotifBadge).catch(() => { });
    }
  }, { once: true });
});

async function initMobileNativeBridge() {
  try {
    const cap = window.Capacitor;
    if (!cap) {
      refreshMobileNotifBadge();
      return;
    }

    if (cap.Plugins && cap.Plugins.EtiketNative) {
      await cap.Plugins.EtiketNative.configure({
        serverUrl: window.location.origin,
        monitorEnabled: true
      });
      await cap.Plugins.EtiketNative.requestPermission();
    } else if (cap.Plugins && cap.Plugins.LocalNotifications) {
      await cap.Plugins.LocalNotifications.requestPermissions();
      await cap.Plugins.LocalNotifications.createChannel({
        id: 'etiket_urgent_alerts_v2',
        name: 'Tiket Masuk & Peringatan Darurat IT',
        description: 'Notifikasi banner beranda HP saat ada laporan kendala baru',
        importance: 5,
        visibility: 1,
        vibration: true
      });
    }
  } catch (e) {
    console.warn('Mobile native bridge init warning:', e);
  } finally {
    refreshMobileNotifBadge();
  }
}

async function refreshMobileNotifBadge() {
  const badge = document.getElementById('mobileNotifStatusBadge');
  if (!badge) return;

  try {
    const cap = window.Capacitor;
    if (cap && cap.Plugins && cap.Plugins.EtiketNative) {
      const st = await cap.Plugins.EtiketNative.checkStatus();
      if (st.notificationsEnabled && st.permissionGranted) {
        badge.textContent = '✓ Aktif (Beranda & Latar Belakang)';
        badge.className = 'px-2.5 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full shrink-0';
      } else {
        badge.textContent = '⚠ Izin Notifikasi Dimatikan';
        badge.className = 'px-2.5 py-1 bg-rose-100 text-rose-700 text-[10px] font-bold rounded-full shrink-0';
      }
      return;
    }
  } catch (e) { }

  if (!window.isSecureContext) {
    badge.textContent = 'ℹ Browser HTTP (Gunakan APK)';
    badge.className = 'px-2.5 py-1 bg-amber-100 text-amber-800 text-[10px] font-bold rounded-full shrink-0';
  } else if ('Notification' in window && Notification.permission === 'granted') {
    badge.textContent = '✓ Aktif di Browser';
    badge.className = 'px-2.5 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full shrink-0';
  } else {
    badge.textContent = '⚠ Belum Diizinkan';
    badge.className = 'px-2.5 py-1 bg-slate-200 text-slate-700 text-[10px] font-bold rounded-full shrink-0';
  }
}

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => { deferredPrompt = null; });
  } else {
    Swal.fire({
      title: '📲 Cara Pasang di HP Android',
      html: `
        <div class="text-left text-xs space-y-2.5 p-3 bg-slate-50 rounded-xl border border-slate-200">
          <p><b>Langkah 1:</b> Buka link sistem ini di browser <b>Google Chrome</b> di HP Anda.</p>
          <p><b>Langkah 2:</b> Ketuk ikon titik tiga (<b>⋮</b>) di pojok kanan atas browser Chrome.</p>
          <p><b>Langkah 3:</b> Pilih menu <b>"Instal aplikasi"</b> atau <b>"Tambahkan ke Layar Utama"</b>.</p>
          <p class="text-emerald-700 font-bold">✓ Ikon ETIKET RSUD akan langsung muncul di menu HP Anda dan berjalan seperti aplikasi native!</p>
        </div>
      `,
      confirmButtonText: 'Tutup',
      confirmButtonColor: '#0284c7'
    });
  }
}

// Authentication System for IT Staff & Technicians
async function checkAuthSession() {
  const token = localStorage.getItem('etiket_token');
  const overlay = document.getElementById('loginOverlay');
  if (!token) {
    if (overlay) overlay.classList.remove('hidden');
    return false;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Sesi tidak valid');
    const data = await res.json();
    setAuthenticatedUser(data.user);
    if (overlay) overlay.classList.add('hidden');
    return true;
  } catch (e) {
    localStorage.removeItem('etiket_token');
    if (overlay) overlay.classList.remove('hidden');
    return false;
  }
}

function setAuthenticatedUser(user) {
  activeUser = user;
  const navName = document.getElementById('navUserName');
  const navRole = document.getElementById('navUserRole');
  if (navName) navName.textContent = user.name;
  if (navRole) {
    const roleLabels = {
      superadmin: 'Super Admin',
      kepala_it: 'Koordinator IT',
      helpdesk: 'Helpdesk IT',
      teknisi: 'Teknisi IT'
    };
    navRole.textContent = roleLabels[user.role] || user.role.toUpperCase();
  }
  const techDisplay = document.getElementById('techDisplayName');
  const techRoleEl = document.getElementById('techRoleBadge');
  if (techDisplay) techDisplay.textContent = user.name || user.username;
  if (techRoleEl) {
    const isCoord = user.role === 'koordinator' || user.role === 'kepala_it' || user.role === 'superadmin';
    techRoleEl.textContent = isCoord ? 'Koordinator IT' : 'Teknisi IT';
  }
  loadTechnicianTickets();
}

async function handleLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const errDiv = document.getElementById('loginErrorMsg');
  const btnSubmit = document.getElementById('btnLoginSubmit');

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (errDiv) errDiv.classList.add('hidden');
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = `<span>Memverifikasi...</span>`;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Username atau password salah');

    localStorage.setItem('etiket_token', data.token);
    setAuthenticatedUser(data.user);
    document.getElementById('loginOverlay').classList.add('hidden');

    Swal.fire({
      icon: 'success',
      title: 'Selamat Datang!',
      text: `Halo, ${data.user.name}. Selamat bertugas!`,
      timer: 1800,
      showConfirmButton: false
    });
  } catch (err) {
    if (errDiv) {
      errDiv.textContent = err.message;
      errDiv.classList.remove('hidden');
    }
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = `<i data-lucide="log-in" class="w-4 h-4"></i><span>Masuk ke Dashboard IT</span>`;
    lucide.createIcons();
  }
}

function logoutUser() {
  Swal.fire({
    title: 'Konfirmasi Keluar',
    text: 'Apakah Anda yakin ingin logout dari portal IT RSUD Labuha?',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Ya, Keluar',
    cancelButtonText: 'Batal',
    confirmButtonColor: '#dc2626'
  }).then(result => {
    if (result.isConfirmed) {
      localStorage.removeItem('etiket_token');
      closeMobileMenu();
      const loginOverlay = document.getElementById('loginOverlay');
      if (loginOverlay) loginOverlay.classList.remove('hidden');
      const pwd = document.getElementById('loginPassword');
      if (pwd) pwd.value = '';
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Berhasil Logout',
        showConfirmButton: false,
        timer: 1500
      });
    }
  });
}

// Socket.io Realtime Listener
function initSocket() {
  try {
    if (typeof io === 'function') {
      socket = io();

      socket.on('connect', () => {
        console.log('[Socket] Connected to RSUD Labuha server');
      });

      // Event: New ticket created from anywhere (Web, QR, Android, Bot WA/TG)
      socket.on('ticket_created', (data) => {
        const t = data.ticket;
        if (window.soundAlert) {
          if (t.priority === 'critical' || t.priority === 'high') {
            window.soundAlert.playEmergency();
          } else {
            window.soundAlert.playChime();
          }
        }
        notifyNativeOrBrowser(t);
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: t.priority === 'critical' ? 'error' : 'info',
          title: `${t.priority === 'critical' ? '🚨 KRITIS: ' : '🎫 Tiket Baru: '}${t.room_name}`,
          text: t.title,
          showConfirmButton: false,
          timer: 6000,
          timerProgressBar: true
        });
        loadTickets();
        loadStats();
        if (currentTab === 'technician') loadTechnicianTickets();
      });

      // Event: Ticket status updated or assigned
      socket.on('ticket_updated', (data) => {
        if (data.action === 'resolved') {
          if (window.soundAlert) window.soundAlert.playSuccess();
        }
        loadTickets();
        loadStats();
        if (currentTab === 'technician') loadTechnicianTickets();
      });
    } else {
      console.log('[Socket] io() is not available, relying on auto-sync background polling');
    }
  } catch (err) {
    console.warn('[Socket] Socket init fallback to polling:', err);
  }
}

// =============================================================================
// Supabase Cloud & Resilient Fetch Layer (Online anywhere, zero reinstallations)
// =============================================================================
const SUPABASE_REST_URL = 'https://kwjmzugilxbuqlrgangt.supabase.co/rest/v1';
const SUPABASE_ANON_KEY = 'sb_publishable_XafHR40fyOY_VKGKLn-paA_QDa_2xb6';

async function smartFetch(url, options = {}) {
  let targetUrl = url;
  const customBase = localStorage.getItem('server_api_url');
  if (customBase && url.startsWith('/api/')) {
    targetUrl = customBase.replace(/\/+$/, '') + url;
  }

  // 1. Try primary backend endpoint first
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const fetchOptions = { ...options, signal: controller.signal };
    const res = await window._originalFetch(targetUrl, fetchOptions);
    clearTimeout(timeout);
    if (res.ok) return res;
  } catch (err) {
    console.debug(`[SmartFetch] Backend ${targetUrl} unreachable, falling back to Supabase Cloud...`);
  }

  // 2. Direct Supabase Cloud REST fallback for GET operations
  if (!options.method || options.method === 'GET') {
    const supaHeaders = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    };

    try {
      if (url.startsWith('/api/tickets')) {
        const supaRes = await window._originalFetch(`${SUPABASE_REST_URL}/tickets?select=*&order=created_at.desc`, {
          headers: supaHeaders
        });
        if (supaRes.ok) return supaRes;
      } else if (url.startsWith('/api/rooms')) {
        const supaRes = await window._originalFetch(`${SUPABASE_REST_URL}/rooms?select=*&is_active=neq.0&order=name.asc`, {
          headers: supaHeaders
        });
        if (supaRes.ok) return supaRes;
      } else if (url.startsWith('/api/categories')) {
        const supaRes = await window._originalFetch(`${SUPABASE_REST_URL}/categories?select=*&is_active=neq.0&order=id.asc`, {
          headers: supaHeaders
        });
        if (supaRes.ok) return supaRes;
      } else if (url.startsWith('/api/users/technicians') || url.startsWith('/api/users')) {
        const supaRes = await window._originalFetch(`${SUPABASE_REST_URL}/users?select=id,username,name,role,phone,email&is_active=neq.0`, {
          headers: supaHeaders
        });
        if (supaRes.ok) return supaRes;
      } else if (url.startsWith('/api/reports/stats')) {
        const supaRes = await window._originalFetch(`${SUPABASE_REST_URL}/tickets?select=id,status,priority`, {
          headers: supaHeaders
        });
        if (supaRes.ok) {
          const rows = await supaRes.json();
          const total = rows.length;
          const open = rows.filter(r => r.status === 'open').length;
          const inProgress = rows.filter(r => r.status === 'in_progress').length;
          const resolved = rows.filter(r => r.status === 'resolved' || r.status === 'closed').length;
          return new Response(JSON.stringify({
            total,
            open,
            inProgress,
            resolved,
            slaCompliance: 100
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }
    } catch (supaErr) {
      console.warn('[SmartFetch] Direct Supabase fallback error:', supaErr);
    }
  }

  return window._originalFetch(targetUrl, options);
}

// Transparently intercept window.fetch so all /api/ calls in the app gain resilience
if (!window._originalFetch) {
  window._originalFetch = window.fetch;
  window.fetch = function (url, options) {
    if (typeof url === 'string' && (url.startsWith('/api/') || url.includes('/api/'))) {
      return smartFetch(url, options);
    }
    return window._originalFetch.apply(this, arguments);
  };
}

// =============================================================================
// Comprehensive 2-Second Supabase Real-Time Auto-Sync Engine
// (Tiket, Ruangan, & Petugas IT dengan Notifikasi Beranda Mengambang)
// =============================================================================
let autoSyncTimer = null;
let lastSyncSignature = '';
let knownTicketIds = new Set();
let isInitialSyncRan = false;

let lastRoomsSignature = '';
let knownRoomIds = new Set();
let isInitialRoomsRan = false;

let lastTechsSignature = '';
let knownTechIds = new Set();
let isInitialTechsRan = false;

let isSyncInProgress = false;

async function runRealtimeSyncCycle() {
  if (isSyncInProgress) return;
  isSyncInProgress = true;

  try {
    // -------------------------------------------------------------------------
    // 1. SINKRONISASI TIKET REAL-TIME (Tambah, Edit, Disposisi, Status, Hapus)
    // -------------------------------------------------------------------------
    const res = await smartFetch('/api/tickets');
    if (res && res.ok) {
      const freshTickets = await res.json();
      if (Array.isArray(freshTickets)) {
        const currentSig = freshTickets.map(t => 
          `${t.id}:${t.status}:${t.assigned_to || ''}:${t.assigned_to_name || ''}:${t.priority}:${t.updated_at || ''}:${t.title || ''}`
        ).join('|');

        if (!isInitialSyncRan) {
          lastSyncSignature = currentSig;
          knownTicketIds = new Set(freshTickets.map(t => t.id));
          allTickets = freshTickets;
          isInitialSyncRan = true;
        } else if (currentSig !== lastSyncSignature) {
          const currentIds = new Set(freshTickets.map(t => t.id));

          // A. Tiket Baru Ditambahkan di Supabase
          const newTickets = freshTickets.filter(t => !knownTicketIds.has(t.id));
          if (newTickets.length > 0) {
            newTickets.forEach(newest => {
              if (window.soundAlert) {
                if (newest.priority === 'critical' || newest.priority === 'high') {
                  window.soundAlert.playEmergency();
                } else {
                  window.soundAlert.playChime();
                }
              }
              notifyNativeOrBrowser(newest);
              Swal.fire({
                toast: true,
                position: 'top-end',
                icon: newest.priority === 'critical' ? 'error' : 'info',
                title: `${newest.priority === 'critical' ? '🚨 TIKET KRITIS: ' : '🎫 Tiket Baru: '}${newest.room_name || 'Ruangan RSUD'}`,
                text: `${newest.ticket_no || ''} - ${newest.title}`,
                showConfirmButton: false,
                timer: 5000,
                timerProgressBar: true
              });
            });
          }

          // B. Tiket Dihapus di Supabase
          const deletedTickets = (allTickets || []).filter(oldT => !currentIds.has(oldT.id));
          if (deletedTickets.length > 0) {
            deletedTickets.forEach(dt => {
              Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'warning',
                title: '🗑️ Tiket Dihapus di Supabase',
                text: `Tiket #${dt.ticket_no || dt.id} (${dt.room_name || 'Ruangan'}) telah dihapus dari sistem`,
                showConfirmButton: false,
                timer: 4500,
                timerProgressBar: true
              });
            });
            if (selectedTicketForModal && deletedTickets.some(dt => dt.id === selectedTicketForModal.id)) {
              closeTicketModal();
            }
          }

          // C. Perubahan Status, Disposisi / Klaim Teknisi
          freshTickets.forEach(ft => {
            const oldT = (allTickets || []).find(ot => ot.id === ft.id);
            if (oldT) {
              // Disposisi / Kunci Tiket Berpindah
              if (ft.assigned_to !== oldT.assigned_to) {
                const isMe = activeUser && (ft.assigned_to === activeUser.id || ft.assigned_to_name === activeUser.name);
                if (isMe) {
                  if (window.soundAlert) window.soundAlert.playChime();
                  Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'info',
                    title: `📋 Tiket Dialihkan ke Anda: ${ft.room_name}`,
                    text: `${ft.ticket_no} telah didelegasikan kepada Anda oleh Koordinator`,
                    showConfirmButton: false,
                    timer: 5000,
                    timerProgressBar: true
                  });
                } else {
                  Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'info',
                    title: `🔒 Tiket Diambil: ${ft.room_name}`,
                    text: `${ft.ticket_no} diambil oleh ${ft.assigned_to_name || 'Teknisi lain'}`,
                    showConfirmButton: false,
                    timer: 4500,
                    timerProgressBar: true
                  });
                }
              }

              // Status Berubah
              if (ft.status !== oldT.status) {
                if (ft.status === 'resolved' || ft.status === 'closed') {
                  if (window.soundAlert) window.soundAlert.playSuccess();
                  Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: `✅ Tiket Selesai: ${ft.room_name}`,
                    text: `${ft.ticket_no} telah diselesaikan oleh ${ft.assigned_to_name || 'Tim IT'}`,
                    showConfirmButton: false,
                    timer: 4500,
                    timerProgressBar: true
                  });
                } else if (ft.status === 'in_progress' && oldT.status === 'open') {
                  Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'info',
                    title: `⚙️ Sedang Dikerjakan: ${ft.room_name}`,
                    text: `${ft.ticket_no} mulai dikerjakan (${ft.assigned_to_name || 'Tim IT'})`,
                    showConfirmButton: false,
                    timer: 4000
                  });
                } else {
                  Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'info',
                    title: `🔄 Status Tiket Diperbarui: ${ft.room_name}`,
                    text: `${ft.ticket_no} status: ${ft.status.toUpperCase()}`,
                    showConfirmButton: false,
                    timer: 3500
                  });
                }
              }
            }
          });

          allTickets = freshTickets;
          lastSyncSignature = currentSig;
          knownTicketIds = currentIds;

          renderTickets();
          loadStats();
          if (currentTab === 'technician') loadTechnicianTickets();

          // Refresh modal live jika sedang dibuka
          if (selectedTicketForModal) {
            const up = freshTickets.find(t => t.id === selectedTicketForModal.id);
            if (up && (up.status !== selectedTicketForModal.status || up.assigned_to !== selectedTicketForModal.assigned_to)) {
              selectedTicketForModal = up;
              openTicketModal(up.id);
            }
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // 2. SINKRONISASI RUANGAN / UNIT REAL-TIME (Tambah, Edit, Hapus)
    // -------------------------------------------------------------------------
    const roomsRes = await smartFetch('/api/rooms');
    if (roomsRes && roomsRes.ok) {
      const freshRooms = await roomsRes.json();
      if (Array.isArray(freshRooms)) {
        const freshRoomsSig = freshRooms.map(r => `${r.id}:${r.name}:${r.code}:${r.is_active || 1}:${r.building || ''}`).join('|');
        if (!isInitialRoomsRan) {
          lastRoomsSignature = freshRoomsSig;
          knownRoomIds = new Set(freshRooms.map(r => r.id));
          allRooms = freshRooms;
          isInitialRoomsRan = true;
        } else if (freshRoomsSig !== lastRoomsSignature) {
          const currentRoomIds = new Set(freshRooms.map(r => r.id));
          const addedRooms = freshRooms.filter(r => !knownRoomIds.has(r.id));
          const deletedRooms = (allRooms || []).filter(r => !currentRoomIds.has(r.id));
          const modRooms = freshRooms.filter(r => {
            const oldR = (allRooms || []).find(o => o.id === r.id);
            return oldR && (oldR.name !== r.name || oldR.code !== r.code || oldR.building !== r.building);
          });

          if (addedRooms.length > 0) {
            addedRooms.forEach(ar => {
              Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: '🏥 Unit Baru di Supabase',
                text: `${ar.name} (${ar.code}) berhasil disinkronkan ke aplikasi`,
                showConfirmButton: false,
                timer: 4000
              });
            });
          }
          if (modRooms.length > 0) {
            modRooms.forEach(mr => {
              Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'info',
                title: '🏥 Unit Diperbarui di Supabase',
                text: `${mr.name} (${mr.code}) telah diperbarui`,
                showConfirmButton: false,
                timer: 4000
              });
            });
          }
          if (deletedRooms.length > 0) {
            deletedRooms.forEach(dr => {
              Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'warning',
                title: '🗑️ Unit Dihapus di Supabase',
                text: `Ruangan ${dr.name} telah dihapus dari sistem`,
                showConfirmButton: false,
                timer: 4000
              });
            });
          }

          allRooms = freshRooms;
          lastRoomsSignature = freshRoomsSig;
          knownRoomIds = currentRoomIds;

          // Re-populate filter dropdown
          const filterSelect = document.getElementById('filterRoom');
          if (filterSelect) {
            const curVal = filterSelect.value;
            filterSelect.innerHTML = '<option value="">Semua Ruangan RSUD</option>';
            allRooms.forEach(r => {
              filterSelect.innerHTML += `<option value="${r.id}" ${r.id == curVal ? 'selected' : ''}>${r.name}</option>`;
            });
          }
          if (currentTab === 'rooms') loadRoomsMaster();
        }
      }
    }

    // -------------------------------------------------------------------------
    // 3. SINKRONISASI PETUGAS IT REAL-TIME (Tambah, Edit, Ganti Role)
    // -------------------------------------------------------------------------
    const techRes = await smartFetch('/api/users/technicians');
    if (techRes && techRes.ok) {
      const freshTechs = await techRes.json();
      if (Array.isArray(freshTechs)) {
        const freshTechsSig = freshTechs.map(u => `${u.id}:${u.name}:${u.role}:${u.username}`).join('|');
        if (!isInitialTechsRan) {
          lastTechsSignature = freshTechsSig;
          knownTechIds = new Set(freshTechs.map(u => u.id));
          allTechnicians = freshTechs;
          isInitialTechsRan = true;
        } else if (freshTechsSig !== lastTechsSignature) {
          Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'info',
            title: '👤 Data Petugas IT Diperbarui',
            text: 'Perubahan akun petugas IT di Supabase telah disinkronkan',
            showConfirmButton: false,
            timer: 3500
          });

          allTechnicians = freshTechs;
          lastTechsSignature = freshTechsSig;
          knownTechIds = new Set(freshTechs.map(u => u.id));

          // Re-populate modal technician select
          const select = document.getElementById('modalAssignTech');
          if (select) {
            const curVal = select.value;
            select.innerHTML = '<option value="">-- Pilih Petugas / Teknisi IT --</option>';
            allTechnicians.forEach(t => {
              const roleLabel = (t.role === 'koordinator' || t.role === 'kepala_it' || t.role === 'superadmin') ? 'Koordinator IT' : 'Teknisi IT';
              const isSelf = activeUser && (activeUser.id === t.id || activeUser.username === t.username) ? ' [Akun Anda]' : '';
              select.innerHTML += `<option value="${t.id}" ${t.id == curVal ? 'selected' : ''}>${t.name} (${roleLabel})${isSelf} - ${t.active_tickets || 0} aktif</option>`;
            });
          }
          if (currentTab === 'users') loadUsers();
        }
      }
    }
  } catch (err) {
    console.debug('[Real-Time Sync Error]:', err);
  } finally {
    isSyncInProgress = false;
  }
}

function startAutoSync() {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  // Interval 2 detik untuk sinkronisasi live
  autoSyncTimer = setInterval(runRealtimeSyncCycle, 2000);
}

// 1-Click Instant Manual Sync Button on Header
async function triggerManualSync() {
  const icon = document.getElementById('iconManualSync');
  if (icon) icon.classList.add('animate-spin');

  await runRealtimeSyncCycle();
  await loadStats();

  setTimeout(() => {
    if (icon) icon.classList.remove('animate-spin');
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: '🔄 Sinkronisasi Supabase Sukses',
      text: 'Data tiket, unit ruangan, dan staf IT telah disinkronkan langsung dari Supabase Cloud',
      showConfirmButton: false,
      timer: 3000
    });
  }, 350);
}

// Toggle audio alert sound
function toggleSound() {
  const isMuted = window.soundAlert.toggleMute();
  const icon = document.getElementById('soundIcon');
  const label = document.getElementById('soundLabel');

  if (isMuted) {
    icon.className = 'w-4 h-4 text-slate-400';
    icon.setAttribute('data-lucide', 'volume-x');
    label.textContent = 'Alarm Hening';
  } else {
    icon.className = 'w-4 h-4 text-emerald-600';
    icon.setAttribute('data-lucide', 'volume-2');
    label.textContent = 'Alarm Aktif';
    window.soundAlert.playChime();
  }
  lucide.createIcons();
}

// Mobile Navigation Drawer Toggle
function toggleMobileMenu() {
  const drawer = document.getElementById('mobileDrawer');
  const backdrop = document.getElementById('mobileDrawerBackdrop');
  if (!drawer || !backdrop) return;

  const isOpen = drawer.classList.contains('open');
  if (isOpen) {
    closeMobileMenu();
  } else {
    const user = activeUser || {};
    const userNameEl = document.getElementById('drawerUserName');
    const userRoleEl = document.getElementById('drawerUserRole');
    if (userNameEl) userNameEl.textContent = user.name || user.username || 'Petugas IT';
    if (userRoleEl) userRoleEl.textContent = (user.role || 'PETUGAS IT').toUpperCase();

    backdrop.classList.add('open');
    drawer.classList.add('open');
    lucide.createIcons();
  }
}

function closeMobileMenu() {
  const drawer = document.getElementById('mobileDrawer');
  const backdrop = document.getElementById('mobileDrawerBackdrop');
  if (drawer) drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
}

// Global App Back Button Handler (Physical Back Key & UI Button)
window.handleAppBack = function () {
  // 1. If mobile drawer is open, close it
  const drawer = document.getElementById('mobileDrawer');
  if (drawer && drawer.classList.contains('open')) {
    closeMobileMenu();
    return true;
  }

  // 2. If any modal is open, close it
  const modals = ['ticketModal', 'addRoomModal', 'userModal'];
  for (const mId of modals) {
    const m = document.getElementById(mId);
    if (m && !m.classList.contains('hidden')) {
      m.classList.add('hidden');
      return true;
    }
  }

  // 3. If currently on a sub-view (not tickets), return to tickets dashboard
  if (currentTab !== 'tickets') {
    switchTab('tickets');
    return true;
  }

  return false;
};

// Switch view tabs
function switchTab(tab) {
  currentTab = tab;
  closeMobileMenu();

  // Control Back button in top header
  const btnBack = document.getElementById('btnHeaderBack');
  if (btnBack) {
    if (tab === 'tickets') {
      btnBack.classList.add('hidden');
    } else {
      btnBack.classList.remove('hidden');
    }
  }

  const tabs = ['tickets', 'technician', 'reports', 'rooms', 'users', 'gateway', 'logs'];
  tabs.forEach(t => {
    const el = document.getElementById(`view-${t}`);
    const navDesktop = document.getElementById(`nav-${t}`);
    const navMob = document.getElementById(`mob-${t}`);

    if (t === tab) {
      if (el) el.classList.remove('hidden');
      if (navDesktop) {
        navDesktop.className = 'w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl font-bold text-xs text-sky-700 bg-sky-50 transition text-left';
      }
      if (navMob) {
        navMob.classList.add('active');
      }
    } else {
      if (el) el.classList.add('hidden');
      if (navDesktop) {
        navDesktop.className = 'w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl font-semibold text-xs text-slate-600 hover:bg-slate-100 transition text-left';
      }
      if (navMob) {
        navMob.classList.remove('active');
      }
    }
  });

  const mobMenu = document.getElementById('mob-menu');
  if (mobMenu) mobMenu.classList.remove('active');

  if (tab === 'tickets') {
    loadTickets();
    loadStats();
  } else if (tab === 'rooms') {
    loadRoomsMaster();
  } else if (tab === 'reports') {
    loadReportsData();
  } else if (tab === 'gateway') {
    loadGatewaySettings();
  } else if (tab === 'logs') {
    loadNotificationLogs();
  } else if (tab === 'technician') {
    loadTechnicianTickets();
  } else if (tab === 'users') {
    loadUsers();
  }

  lucide.createIcons();
}

// Set View Mode (Kanban vs Table)
function setViewMode(mode) {
  viewMode = mode;
  const kanban = document.getElementById('kanbanContainer');
  const table = document.getElementById('tableViewContainer');
  const btnK = document.getElementById('btnViewKanban');
  const btnT = document.getElementById('btnViewTable');

  if (mode === 'kanban') {
    kanban.classList.remove('hidden');
    table.classList.add('hidden');
    btnK.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-600 text-white transition flex items-center space-x-1';
    btnT.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition flex items-center space-x-1';
  } else {
    kanban.classList.add('hidden');
    table.classList.remove('hidden');
    btnT.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-600 text-white transition flex items-center space-x-1';
    btnK.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition flex items-center space-x-1';
  }
}

// Debounce search filter
function debounceFilter() {
  clearTimeout(filterTimeout);
  filterTimeout = setTimeout(() => {
    loadTickets();
  }, 300);
}

// Load Tickets
async function loadTickets() {
  const search = document.getElementById('filterSearch').value.trim();
  const priority = document.getElementById('filterPriority').value;
  const roomId = document.getElementById('filterRoom').value;

  let url = `/api/tickets?priority=${priority}`;
  if (roomId) url += `&roomId=${roomId}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;

  try {
    const res = await fetch(url);
    allTickets = await res.json();
    renderTickets();
  } catch (err) {
    console.error('Failed to load tickets:', err);
  }
}

// Render Kanban & Table
function renderTickets() {
  const openList = document.getElementById('colOpenList');
  const assignedList = document.getElementById('colAssignedList');
  const progressList = document.getElementById('colProgressList');
  const resolvedList = document.getElementById('colResolvedList');
  const tableBody = document.getElementById('ticketsTableBody');

  openList.innerHTML = '';
  assignedList.innerHTML = '';
  progressList.innerHTML = '';
  resolvedList.innerHTML = '';
  tableBody.innerHTML = '';

  let countOpen = 0, countAssigned = 0, countProgress = 0, countResolved = 0;

  allTickets.forEach(t => {
    // Priority styling
    const priorityClasses = {
      critical: 'ticket-critical bg-rose-50/40 border-rose-200',
      high: 'ticket-high bg-orange-50/40 border-orange-200',
      medium: 'ticket-medium bg-amber-50/40 border-amber-200',
      low: 'ticket-low bg-sky-50/40 border-sky-200'
    }[t.priority] || 'bg-white border-slate-200';

    const priorityBadge = {
      critical: '<span class="bg-rose-600 text-white px-2 py-0.5 rounded text-[10px] font-black uppercase">🚨 Kritis</span>',
      high: '<span class="bg-orange-500 text-white px-2 py-0.5 rounded text-[10px] font-bold uppercase">Tinggi</span>',
      medium: '<span class="bg-amber-500 text-white px-2 py-0.5 rounded text-[10px] font-bold uppercase">Sedang</span>',
      low: '<span class="bg-sky-500 text-white px-2 py-0.5 rounded text-[10px] font-bold uppercase">Rendah</span>'
    }[t.priority];

    // Card element for Kanban
    const card = document.createElement('div');
    card.className = `p-3.5 rounded-xl border bg-white shadow-sm hover:shadow-md transition cursor-pointer space-y-2.5 ${priorityClasses}`;
    card.onclick = () => openTicketModal(t.id);
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="font-mono font-bold text-xs text-sky-700">${t.ticket_no}</span>
        ${priorityBadge}
      </div>
      <div>
        <h4 class="font-bold text-slate-800 text-xs line-clamp-2 leading-snug">${t.title}</h4>
        <p class="text-[11px] text-slate-500 font-semibold mt-1 flex items-center">
          <i data-lucide="map-pin" class="w-3 h-3 mr-1 text-slate-400"></i> ${t.room_name}
        </p>
      </div>
      <div class="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
        <span class="truncate max-w-[100px]">👤 ${t.reporter_name}</span>
        <div>${t.assigned_to ? (activeUser && (t.assigned_to === activeUser.id || t.assigned_to_name === activeUser.name) ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">👤 Anda</span>' : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">🔒 ' + (t.assigned_to_name ? t.assigned_to_name.split(' ')[0] : 'Teknisi') + '</span>') : '<span class="text-rose-500 font-bold text-[10px]">⏳ Belum ada</span>'}</div>
      </div>
    `;

    // Append to Kanban column
    if (t.status === 'open') {
      openList.appendChild(card);
      countOpen++;
    } else if (t.status === 'assigned') {
      assignedList.appendChild(card);
      countAssigned++;
    } else if (t.status === 'in_progress' || t.status === 'pending') {
      progressList.appendChild(card);
      countProgress++;
    } else if (t.status === 'resolved' || t.status === 'closed') {
      resolvedList.appendChild(card);
      countResolved++;
    }

    // Append to Table
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 cursor-pointer transition';
    tr.onclick = () => openTicketModal(t.id);
    tr.innerHTML = `
      <td class="p-3.5 font-mono font-bold text-sky-700">${t.ticket_no}</td>
      <td class="p-3.5 text-slate-500 whitespace-nowrap">${new Date(t.created_at).toLocaleDateString('id-ID')}</td>
      <td class="p-3.5 font-bold text-slate-800">${t.room_name}</td>
      <td class="p-3.5 text-slate-600">${t.category_name}</td>
      <td class="p-3.5">${priorityBadge}</td>
      <td class="p-3.5 text-slate-700">${t.reporter_name}</td>
      <td class="p-3.5 font-medium text-slate-800 max-w-xs truncate">${t.title}</td>
      <td class="p-3.5 font-semibold">${t.assigned_to ? (activeUser && (t.assigned_to === activeUser.id || t.assigned_to_name === activeUser.name) ? '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">👤 ' + t.assigned_to_name + ' (Anda)</span>' : '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">🔒 ' + t.assigned_to_name + '</span>') : '<span class="text-rose-500 font-bold text-xs bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200">⏳ Belum Ditugaskan</span>'}</td>
      <td class="p-3.5 uppercase font-bold text-[10px] text-slate-600">${t.status.replace('_', ' ')}</td>
      <td class="p-3.5 text-center">
        <button onclick="event.stopPropagation(); openTicketModal(${t.id})" class="px-2.5 py-1 bg-sky-50 text-sky-700 hover:bg-sky-100 rounded-lg font-bold">Aksi</button>
      </td>
    `;
    tableBody.appendChild(tr);
  });

  document.getElementById('colCountOpen').textContent = countOpen;
  document.getElementById('colCountAssigned').textContent = countAssigned;
  document.getElementById('colCountProgress').textContent = countProgress;
  document.getElementById('colCountResolved').textContent = countResolved;
  document.getElementById('badgeOpenCount').textContent = countOpen;

  lucide.createIcons();
}

// Load Rooms Master & Filter Options
async function loadRoomsMaster() {
  try {
    const res = await fetch('/api/rooms');
    allRooms = await res.json();

    // Filter dropdown
    const filterSelect = document.getElementById('filterRoom');
    filterSelect.innerHTML = '<option value="">Semua Ruangan RSUD</option>';
    allRooms.forEach(r => {
      filterSelect.innerHTML += `<option value="${r.id}">${r.name}</option>`;
    });

    // Rooms Grid Tab
    const roomsGrid = document.getElementById('roomsGrid');
    roomsGrid.innerHTML = '';

    if (!allRooms || allRooms.length === 0) {
      roomsGrid.innerHTML = `
        <div class="col-span-full py-12 px-4 text-center bg-white rounded-2xl border-2 border-dashed border-slate-200">
          <div class="w-14 h-14 bg-sky-50 text-sky-600 rounded-2xl flex items-center justify-center mx-auto mb-3 text-2xl font-bold shadow-sm">
            🏢
          </div>
          <h3 class="font-bold text-slate-800 text-sm">Belum Ada Data Ruangan / Unit</h3>
          <p class="text-xs text-slate-400 mt-1 max-w-sm mx-auto">Semua data unit lama telah dibersihkan. Anda sekarang dapat menambahkan unit/ruangan RSUD Labuha baru dari nol.</p>
          <button onclick="openAddRoomModal()" class="mt-4 px-4 py-2.5 bg-gradient-to-r from-sky-600 to-teal-600 text-white font-bold rounded-xl text-xs transition inline-flex items-center space-x-1.5 shadow-md shadow-sky-600/20 active:scale-95">
            <i data-lucide="plus-circle" class="w-4 h-4"></i>
            <span>Tambah Unit Pertama</span>
          </button>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    allRooms.forEach(r => {
      const card = document.createElement('div');
      card.className = 'bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-3';
      card.innerHTML = `
        <div>
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-mono font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded">${r.code}</span>
            <span class="text-[10px] text-slate-400 font-semibold">${r.floor || 'Lantai 1'}</span>
          </div>
          <h4 class="font-bold text-slate-800 text-xs mt-2">${r.name}</h4>
          <p class="text-[11px] text-slate-400">${r.building || 'Gedung RSUD'}</p>
        </div>
        <div class="pt-3 border-t border-slate-100 flex items-center justify-between">
          <div class="flex items-center space-x-1.5">
            <a href="/lapor.html?room=${encodeURIComponent(r.code)}&id=${r.id}" target="_blank" class="text-xs text-sky-600 font-bold hover:underline flex items-center">
              <i data-lucide="external-link" class="w-3.5 h-3.5 mr-1"></i> Form
            </a>
            <button onclick="previewRoomQR(${r.id})" class="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded text-[10px] font-bold text-slate-700">
              QR
            </button>
          </div>
          <div class="flex items-center space-x-1">
            <button onclick="openEditRoomModal(${r.id})" class="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition" title="Edit Unit">
              <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="deleteRoom(${r.id}, '${r.name.replace(/'/g, "\\'")}')" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="Hapus Unit">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>
      `;
      roomsGrid.appendChild(card);
    });
    lucide.createIcons();
  } catch (err) {
    console.error('Failed to load rooms:', err);
  }
}

// Auto-generate standardized room/unit code based on room name & sequence
function generateAutoRoomCode(name) {
  if (!name || !name.trim()) return '';
  const clean = name.trim().toUpperCase();

  let prefix = 'UNIT';
  if (clean.includes('POLI') || clean.includes('KLINIK')) {
    prefix = 'POLI';
  } else if (clean.includes('IGD') || clean.includes('UGD') || clean.includes('DARURAT')) {
    prefix = 'UGD';
  } else if (clean.includes('INAP') || clean.includes('BANGSAL') || clean.includes('RUANG RAWAT')) {
    prefix = 'INAP';
  } else if (clean.includes('ICU') || clean.includes('ICCU') || clean.includes('NICU') || clean.includes('PICU')) {
    prefix = 'ICU';
  } else if (clean.includes('LAB') || clean.includes('PATOLOGI')) {
    prefix = 'LAB';
  } else if (clean.includes('FARMASI') || clean.includes('APOTEK') || clean.includes('OBAT')) {
    prefix = 'FAR';
  } else if (clean.includes('RAD') || clean.includes('RONTGEN')) {
    prefix = 'RAD';
  } else if (clean.includes('BEDAH') || clean.includes('OPERASI') || clean.includes(' OK ') || clean.endsWith(' OK') || clean.startsWith('OK ')) {
    prefix = 'OK';
  } else if (clean.includes('GIZI') || clean.includes('DAPUR')) {
    prefix = 'GIZI';
  } else if (clean.includes('REKAM MEDIS') || clean.includes(' RM ') || clean.startsWith('RM ')) {
    prefix = 'RM';
  } else if (clean.includes('ADMIN') || clean.includes(' TU ') || clean.includes('MANAJEMEN') || clean.includes('DIREKSI')) {
    prefix = 'ADM';
  } else if (clean.includes('IT') || clean.includes('SIMRS') || clean.includes('SERVER')) {
    prefix = 'IT';
  } else {
    const words = clean.split(/\s+/).filter(w => w.length > 0);
    if (words.length >= 2) {
      prefix = (words[0].substring(0, 2) + words[1].substring(0, 2)).toUpperCase();
    } else {
      prefix = clean.replace(/[^A-Z0-9]/g, '').substring(0, 4) || 'UNIT';
    }
  }

  let maxNum = 0;
  (allRooms || []).forEach(r => {
    if (r.code && r.code.toUpperCase().startsWith(prefix + '-')) {
      const parts = r.code.toUpperCase().split('-');
      const num = parseInt(parts[1], 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  });

  const nextNum = String(maxNum + 1).padStart(2, '0');
  return prefix + '-' + nextNum;
}

function onRoomNameInput(val) {
  const editId = document.getElementById('editRoomId')?.value;
  if (!editId) {
    const codeEl = document.getElementById('newRoomCode');
    if (codeEl) {
      codeEl.value = generateAutoRoomCode(val);
      codeEl.readOnly = true;
    }
  }
}

// Modal Tambah / Edit Ruangan / Unit
function openAddRoomModal() {
  document.getElementById('editRoomId').value = '';
  document.getElementById('roomModalTitle').textContent = 'Tambah Ruangan / Unit RSUD';
  document.getElementById('addRoomForm').reset();
  const codeEl = document.getElementById('newRoomCode');
  if (codeEl) {
    codeEl.value = '';
    codeEl.readOnly = true;
  }
  document.getElementById('addRoomModal').classList.remove('hidden');
  document.getElementById('newRoomName').focus();
  lucide.createIcons();
}

function openEditRoomModal(roomId) {
  const room = allRooms.find(r => r.id === roomId);
  if (!room) return;

  document.getElementById('editRoomId').value = room.id;
  document.getElementById('roomModalTitle').textContent = 'Edit Ruangan / Unit RSUD';
  document.getElementById('newRoomName').value = room.name;
  const codeEl = document.getElementById('newRoomCode');
  if (codeEl) {
    codeEl.value = room.code;
    codeEl.readOnly = true;
  }
  document.getElementById('newRoomBuilding').value = room.building || 'Gedung Rawat Jalan';
  document.getElementById('newRoomFloor').value = room.floor || '';
  document.getElementById('newRoomPic').value = room.pic_name || '';
  document.getElementById('newRoomPhone').value = room.pic_phone || '';

  document.getElementById('addRoomModal').classList.remove('hidden');
  document.getElementById('newRoomName').focus();
  lucide.createIcons();
}

function closeAddRoomModal() {
  document.getElementById('addRoomModal').classList.add('hidden');
  document.getElementById('editRoomId').value = '';
  document.getElementById('addRoomForm').reset();
}

async function submitAddRoom(e) {
  e.preventDefault();
  const editId = document.getElementById('editRoomId').value;
  const name = document.getElementById('newRoomName').value.trim();
  const code = document.getElementById('newRoomCode').value.trim().toUpperCase();
  const building = document.getElementById('newRoomBuilding').value;
  const floor = document.getElementById('newRoomFloor').value.trim();
  const pic_name = document.getElementById('newRoomPic').value.trim();
  const pic_phone = document.getElementById('newRoomPhone').value.trim();

  if (!name || !code) {
    Swal.fire('Peringatan', 'Nama dan Kode Ruangan wajib diisi', 'warning');
    return;
  }

  try {
    let res;
    if (editId) {
      res = await fetch(`/api/rooms/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code, building, floor, pic_name, pic_phone })
      });
    } else {
      res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code, building, floor, pic_name, pic_phone })
      });
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal menyimpan ruangan');

    Swal.fire({
      icon: 'success',
      title: editId ? 'Ruangan Berhasil Diperbarui!' : 'Ruangan Berhasil Ditambahkan!',
      text: `${name} telah terdaftar dan QR Code otomatis siap digunakan.`,
      timer: 2000,
      showConfirmButton: false
    });

    closeAddRoomModal();
    await loadRoomsMaster();
  } catch (err) {
    Swal.fire('Error', err.message, 'error');
  }
}

async function deleteRoom(roomId, roomName) {
  const result = await Swal.fire({
    title: 'Hapus Ruangan / Unit?',
    text: `Apakah Anda yakin ingin menghapus "${roomName}"? Data unit akan terhapus langsung dari database Supabase.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Ya, Hapus Permanen',
    cancelButtonText: 'Batal'
  });

  if (result.isConfirmed) {
    try {
      const res = await fetch(`/api/rooms/${roomId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Gagal menghapus ruangan');
      }

      Swal.fire('Terhapus', 'Ruangan berhasil dihapus dari database', 'success');
      await loadRoomsMaster();
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    }
  }
}

// ================= USER MANAGEMENT =================
let allUsersData = [];

async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    allUsersData = await res.json();

    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';

    allUsersData.forEach(u => {
      const roleBadge = {
        koordinator: '<span class="bg-indigo-100 text-indigo-700 font-bold px-2.5 py-1 rounded-lg text-[10px] uppercase whitespace-nowrap inline-block">Koordinator IT</span>',
        kepala_it: '<span class="bg-indigo-100 text-indigo-700 font-bold px-2.5 py-1 rounded-lg text-[10px] uppercase whitespace-nowrap inline-block">Koordinator IT</span>',
        superadmin: '<span class="bg-indigo-100 text-indigo-700 font-bold px-2.5 py-1 rounded-lg text-[10px] uppercase whitespace-nowrap inline-block">Koordinator IT</span>',
        teknisi: '<span class="bg-emerald-100 text-emerald-700 font-bold px-2.5 py-1 rounded-lg text-[10px] uppercase whitespace-nowrap inline-block">Teknisi IT</span>'
      }[u.role] || `<span class="bg-slate-100 text-slate-700 font-bold px-2.5 py-1 rounded-lg text-[10px] uppercase whitespace-nowrap inline-block">${u.role}</span>`;

      const statusBadge = u.is_active === 1
        ? '<span class="text-emerald-600 font-bold whitespace-nowrap">● Aktif</span>'
        : '<span class="text-rose-500 font-bold whitespace-nowrap">● Nonaktif</span>';

      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition whitespace-nowrap';
      tr.innerHTML = `
        <td class="p-3.5 font-bold text-slate-800">${u.name}</td>
        <td class="p-3.5 font-mono text-slate-600 font-bold">${u.username}</td>
        <td class="p-3.5">${roleBadge}</td>
        <td class="p-3.5 font-mono text-slate-700">${u.phone ? `<a href="https://wa.me/${u.phone.replace(/\\D/g, '')}" target="_blank" class="text-emerald-600 font-bold hover:underline flex items-center"><i data-lucide="message-circle" class="w-3 h-3 mr-1"></i>${u.phone}</a>` : '-'}</td>
        <td class="p-3.5 text-slate-600">${u.specialization || '-'}</td>
        <td class="p-3.5 text-xs">${statusBadge}</td>
        <td class="p-3.5 text-center">
          <div class="flex items-center justify-center space-x-1.5">
            <button onclick="openEditUserModal(${u.id})" class="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition" title="Edit Akun">
              <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="deleteUser(${u.id}, '${u.name.replace(/'/g, "\\'")}')" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="Nonaktifkan Akun">
              <i data-lucide="user-x" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    lucide.createIcons();
  } catch (err) {
    console.error('Failed to load users:', err);
  }
}

function openAddUserModal() {
  document.getElementById('editUserId').value = '';
  document.getElementById('userModalTitle').textContent = 'Tambah Akun Pengguna IT';
  document.getElementById('userUsername').disabled = false;
  document.getElementById('userPassword').required = true;
  document.getElementById('pwdReqSpan').classList.remove('hidden');
  document.getElementById('pwdHint').classList.add('hidden');
  document.getElementById('userForm').reset();
  document.getElementById('userModal').classList.remove('hidden');
  document.getElementById('userFullName').focus();
  lucide.createIcons();
}

function openEditUserModal(userId) {
  const user = allUsersData.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('editUserId').value = user.id;
  document.getElementById('userModalTitle').textContent = 'Edit Akun: ' + user.name;
  document.getElementById('userFullName').value = user.name;
  document.getElementById('userUsername').value = user.username;
  document.getElementById('userUsername').disabled = false;
  document.getElementById('userRole').value = (user.role === 'koordinator' || user.role === 'kepala_it' || user.role === 'superadmin') ? 'koordinator' : 'teknisi';
  document.getElementById('userPassword').value = '';
  document.getElementById('userPassword').required = false;
  document.getElementById('pwdReqSpan').classList.add('hidden');
  document.getElementById('pwdHint').classList.remove('hidden');
  document.getElementById('userPhone').value = user.phone || '';
  document.getElementById('userEmail').value = user.email || '';
  document.getElementById('userSpecialization').value = user.specialization || '';

  document.getElementById('userModal').classList.remove('hidden');
  document.getElementById('userFullName').focus();
  lucide.createIcons();
}

function closeUserModal() {
  document.getElementById('userModal').classList.add('hidden');
  document.getElementById('editUserId').value = '';
  document.getElementById('userForm').reset();
}

async function submitUserForm(e) {
  e.preventDefault();
  const editId = document.getElementById('editUserId').value;
  const name = document.getElementById('userFullName').value.trim();
  const username = document.getElementById('userUsername').value.trim();
  const role = document.getElementById('userRole').value;
  const password = document.getElementById('userPassword').value;
  const phone = document.getElementById('userPhone').value.trim();
  const email = document.getElementById('userEmail').value.trim();
  const specialization = document.getElementById('userSpecialization').value.trim();

  if (!name || (!editId && (!username || !password))) {
    Swal.fire('Peringatan', 'Data wajib belum lengkap', 'warning');
    return;
  }

  try {
    let res;
    if (editId) {
      res = await fetch(`/api/users/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username, role, phone, email, specialization, password })
      });
    } else {
      res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username, role, password, phone, email, specialization })
      });
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal menyimpan akun');

    Swal.fire({
      icon: 'success',
      title: editId ? 'Akun Diperbarui!' : 'Akun Berhasil Dibuat!',
      text: `${name} telah tersimpan di sistem.`,
      timer: 2000,
      showConfirmButton: false
    });

    closeUserModal();
    await loadUsers();
    await loadTechnicians();
  } catch (err) {
    Swal.fire('Error', err.message, 'error');
  }
}

async function deleteUser(userId, userName) {
  const result = await Swal.fire({
    title: 'Hapus Akun Pengguna?',
    text: `Apakah Anda yakin ingin menghapus akun "${userName}"? Data akun akan terhapus langsung dari database Supabase.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Ya, Hapus Permanen',
    cancelButtonText: 'Batal'
  });

  if (result.isConfirmed) {
    try {
      const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Gagal menghapus pengguna');
      }

      Swal.fire('Terhapus', 'Akun pengguna berhasil dihapus dari database', 'success');
      await loadUsers();
      await loadTechnicians();
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    }
  }
}

// Preview single room QR Code
async function previewRoomQR(roomId) {
  try {
    const res = await fetch(`/api/rooms/${roomId}/qr`);
    const data = await res.json();
    Swal.fire({
      title: data.room.name,
      html: `
        <img src="${data.qrDataUrl}" class="w-48 h-48 mx-auto rounded-xl border p-2 my-2">
        <p class="text-xs text-slate-500 font-mono font-bold">${data.room.code}</p>
        <p class="text-xs text-slate-600 mt-2">Scan QR Code ini untuk langsung membuka formulir pelaporan ruangan ini.</p>
      `,
      confirmButtonText: 'Tutup',
      confirmButtonColor: '#0284c7'
    });
  } catch (err) {
    console.error(err);
  }
}

// Load Technicians
async function loadTechnicians() {
  try {
    const res = await fetch('/api/users/technicians');
    allTechnicians = await res.json();

    const select = document.getElementById('modalAssignTech');
    if (select) {
      select.innerHTML = '<option value="">-- Pilih Petugas / Teknisi IT --</option>';
      allTechnicians.forEach(t => {
        const roleLabel = (t.role === 'koordinator' || t.role === 'kepala_it' || t.role === 'superadmin') ? 'Koordinator IT' : 'Teknisi IT';
        const isSelf = activeUser && (activeUser.id === t.id || activeUser.username === t.username) ? ' [Akun Anda]' : '';
        select.innerHTML += `<option value="${t.id}">${t.name} (${roleLabel})${isSelf} - ${t.active_tickets || 0} aktif</option>`;
      });
    }

    // Populate Leaderboard in Reports
    const tbody = document.getElementById('techLeaderboardBody');
    if (tbody) {
      tbody.innerHTML = '';
      allTechnicians.forEach(t => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="p-3 font-bold text-slate-800">${t.name} <span class="text-[10px] text-slate-400">(@${t.username})</span></td>
          <td class="p-3 text-slate-500">${t.specialization || ((t.role === 'koordinator' || t.role === 'kepala_it' || t.role === 'superadmin') ? 'Koordinator SIMRS' : 'Teknisi IT')}</td>
          <td class="p-3 font-bold text-amber-600">${t.active_tickets || 0} Tiket</td>
          <td class="p-3 font-bold text-emerald-600">${t.resolved_tickets || 0} Tiket Selesai</td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (err) {
    console.error('Failed to load technicians:', err);
  }
}

// Quick 1-Click Ticket Claim (Otomatis Ambil Tiket oleh Akun yang Login)
async function claimTicketSelf() {
  if (!selectedTicketForModal) return;
  if (!activeUser || !activeUser.id) {
    Swal.fire('Info', 'Sesi login tidak terdeteksi. Silakan login terlebih dahulu.', 'info');
    return;
  }

  const isDone = selectedTicketForModal.status === 'resolved' || selectedTicketForModal.status === 'closed';
  if (isDone) {
    Swal.fire('Tiket Terkunci', 'Tiket ini telah selesai dikerjakan dan dikunci secara permanen.', 'info');
    return;
  }

  // Anti-overlap check: if someone else has already claimed it
  if (selectedTicketForModal.assigned_to && selectedTicketForModal.assigned_to != activeUser.id) {
    const confirmOverlap = await Swal.fire({
      title: 'Peringatan Tumpang Tindih',
      html: `Tiket ini saat ini sedang ditangani oleh <b>${selectedTicketForModal.assigned_to_name || 'Teknisi Lain'}</b>.<br><br>Apakah Anda yakin ingin mengambil alih tiket ini?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Ya, Ambil Alih',
      cancelButtonText: 'Batal',
      confirmButtonColor: '#d97706'
    });
    if (!confirmOverlap.isConfirmed) return;
  }

  const savedTicketNo = selectedTicketForModal.ticket_no;
  const savedRoom = selectedTicketForModal.room_name;
  const ticketId = selectedTicketForModal.id;

  try {
    const res = await fetch(`/api/tickets/${ticketId}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ technician_id: activeUser.id, assigned_by_name: activeUser.name })
    });
    const resData = await res.json();
    if (!res.ok) throw new Error(resData.error || 'Gagal mengambil tiket');

    closeModal();

    // Bunyikan chime sukses
    if (window.soundAlert) window.soundAlert.playSuccess();

    // Notifikasi melayang langsung di pojok atas Beranda (Web & APK)
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: `🔒 Tiket Berhasil Anda Kunci!`,
      text: `${savedTicketNo} (${savedRoom}) terkunci atas nama Anda: ${activeUser.name}`,
      showConfirmButton: false,
      timer: 4500,
      timerProgressBar: true
    });

    // Notifikasi sistem HP (Android Status Bar & Lock Screen)
    if (typeof notifyNativeGeneric === 'function') {
      notifyNativeGeneric(
        `🔒 Tiket Diambil: ${savedRoom}`,
        `${savedTicketNo} telah Anda ambil & terkunci atas nama ${activeUser.name}`
      );
    }

    await loadTickets();
    await loadStats();
    if (currentTab === 'technician') loadTechnicianTickets();
  } catch (err) {
    Swal.fire('Error', err.message, 'error');
  }
}

// Quick Assign to Logged-in User
function assignToSelf() {
  const select = document.getElementById('modalAssignTech');
  if (!select || !activeUser || !activeUser.id) return;
  select.value = String(activeUser.id);
  if (!select.value) {
    const opt = document.createElement('option');
    opt.value = String(activeUser.id);
    opt.textContent = `${activeUser.name} [Akun Anda]`;
    opt.selected = true;
    select.appendChild(opt);
  }
  Swal.fire({
    icon: 'info',
    title: 'Akun Dipilih',
    text: `Tiket akan ditugaskan kepada Anda: ${activeUser.name}`,
    timer: 1200,
    showConfirmButton: false
  });
}

// Load KPI Stats
async function loadStats() {
  try {
    const res = await fetch('/api/reports/stats');
    const stats = await res.json();

    document.getElementById('kpiTotal').textContent = stats.total;
    document.getElementById('kpiOpen').textContent = stats.open;
    document.getElementById('kpiInProgress').textContent = stats.inProgress;
    document.getElementById('kpiResolved').textContent = stats.resolved;
    document.getElementById('kpiSla').textContent = `${stats.slaCompliance}%`;
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

// Open Ticket Detail Modal
async function openTicketModal(ticketId) {
  try {
    const res = await fetch(`/api/tickets/${ticketId}`);
    const data = await res.json();
    selectedTicketForModal = data.ticket;

    // Strict Lock Permission Checks
    const isDone = selectedTicketForModal.status === 'resolved' || selectedTicketForModal.status === 'closed';
    const isCoordinator = activeUser && (activeUser.role === 'koordinator' || activeUser.role === 'kepala_it' || activeUser.role === 'superadmin');
    const isAssignedToMe = activeUser && selectedTicketForModal.assigned_to && (selectedTicketForModal.assigned_to === activeUser.id || selectedTicketForModal.assigned_to_name === activeUser.name);
    const isUnassigned = !selectedTicketForModal.assigned_to;

    const actionContainer = document.getElementById('modalActionContainer');
    const readOnlyBanner = document.getElementById('modalReadOnlyBanner');
    const resolvedBanner = document.getElementById('modalResolvedBanner');
    const claimBox = document.getElementById('modalClaimBox');
    const delegateLabel = document.getElementById('modalDelegateLabel');
    const lockBanner = document.getElementById('modalLockBanner');
    const lockText = document.getElementById('modalLockText');

    if (isDone) {
      // Tiket telah selesai dikerjakan: KUNCI PERMANEN UNTUK SEMUA ORANG
      if (lockBanner) lockBanner.classList.add('hidden');
      if (readOnlyBanner) readOnlyBanner.classList.add('hidden');
      if (claimBox) claimBox.classList.add('hidden');
      if (actionContainer) actionContainer.classList.add('hidden');
      if (resolvedBanner) resolvedBanner.classList.remove('hidden');
    } else {
      if (resolvedBanner) resolvedBanner.classList.add('hidden');
      if (isUnassigned) {
        // Tiket belum diambil siapapun
        if (lockBanner) lockBanner.classList.add('hidden');
        if (readOnlyBanner) readOnlyBanner.classList.add('hidden');
        if (actionContainer) actionContainer.classList.remove('hidden');
        if (claimBox) claimBox.classList.remove('hidden');
        if (delegateLabel) delegateLabel.textContent = 'Atau Disposisikan ke Petugas Lain:';
      } else if (isAssignedToMe) {
        // Tiket sedang ditangani oleh user yang sedang login
        if (lockBanner) {
          lockBanner.classList.remove('hidden');
          lockBanner.className = 'p-3.5 bg-emerald-50 border-2 border-emerald-300 rounded-2xl flex items-center space-x-3 text-emerald-950 shadow-sm';
          const iconBox = lockBanner.querySelector('div');
          if (iconBox) {
            iconBox.className = 'w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-sm';
            iconBox.textContent = '👤';
          }
          lockText.innerHTML = `Tiket ini sedang <b>Anda</b> tangani. Silakan perbarui status atau disposisikan jika perlu bantuan.`;
        }
        if (readOnlyBanner) readOnlyBanner.classList.add('hidden');
        if (actionContainer) actionContainer.classList.remove('hidden');
        if (claimBox) claimBox.classList.add('hidden');
        if (delegateLabel) delegateLabel.textContent = 'Oper / Disposisikan Tiket Ini ke Rekan IT Lain:';
      } else if (isCoordinator) {
        // Tiket sedang ditangani orang lain, tapi yang buka adalah KOORDINATOR IT
        if (lockBanner) {
          lockBanner.classList.remove('hidden');
          lockBanner.className = 'p-3.5 bg-sky-50 border-2 border-sky-300 rounded-2xl flex items-center space-x-3 text-sky-950 shadow-sm';
          const iconBox = lockBanner.querySelector('div');
          if (iconBox) {
            iconBox.className = 'w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-sm';
            iconBox.textContent = '👔';
          }
          lockText.innerHTML = `Tiket sedang dikerjakan oleh <b>${selectedTicketForModal.assigned_to_name}</b>. Sebagai Koordinator IT, Anda memiliki wewenang disposisi / alih tugas.`;
        }
        if (readOnlyBanner) readOnlyBanner.classList.add('hidden');
        if (actionContainer) actionContainer.classList.remove('hidden');
        if (claimBox) claimBox.classList.add('hidden');
        if (delegateLabel) delegateLabel.textContent = `Disposisikan Ulang / Alihkan dari ${selectedTicketForModal.assigned_to_name} ke:`;
      } else {
        // STRICT LOCK: Tiket sedang ditangani IT lain, dan user saat ini BUKAN Koordinator!
        if (lockBanner) lockBanner.classList.add('hidden');
        if (readOnlyBanner) {
          readOnlyBanner.classList.remove('hidden');
          const readOnlyName = document.getElementById('modalReadOnlyTechName');
          if (readOnlyName) readOnlyName.textContent = selectedTicketForModal.assigned_to_name || 'Petugas Lain';
        }
        if (actionContainer) actionContainer.classList.add('hidden');
      }
    }

    document.getElementById('modalTicketNo').textContent = selectedTicketForModal.ticket_no;
    document.getElementById('modalRoom').textContent = selectedTicketForModal.room_name;
    document.getElementById('modalCategory').textContent = selectedTicketForModal.category_name;
    document.getElementById('modalReporter').textContent = selectedTicketForModal.reporter_name;
    document.getElementById('modalPhone').textContent = selectedTicketForModal.reporter_phone;
    document.getElementById('modalTitle').textContent = selectedTicketForModal.title;
    document.getElementById('modalDesc').textContent = selectedTicketForModal.description;

    document.getElementById('modalAssignTech').value = selectedTicketForModal.assigned_to || '';
    document.getElementById('modalNewStatus').value = selectedTicketForModal.status || 'in_progress';
    document.getElementById('modalResolutionNotes').value = selectedTicketForModal.resolution_notes || '';

    // Render Modal Logs
    const logsList = document.getElementById('modalLogsList');
    logsList.innerHTML = '';
    (data.logs || []).forEach(l => {
      const item = document.createElement('div');
      item.className = 'bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex justify-between items-start';
      item.innerHTML = `
        <div>
          <span class="font-bold text-slate-800">${l.action}</span>
          <p class="text-slate-600 mt-0.5">${l.notes || '-'}</p>
        </div>
        <span class="text-[10px] text-slate-400">${new Date(l.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
      `;
      logsList.appendChild(item);
    });

    document.getElementById('ticketModal').classList.remove('hidden');
    lucide.createIcons();
  } catch (err) {
    console.error(err);
  }
}

function closeModal() {
  document.getElementById('ticketModal').classList.add('hidden');
  selectedTicketForModal = null;
}

// Assign Technician
async function assignTechnician() {
  if (!selectedTicketForModal) return;

  const isDone = selectedTicketForModal.status === 'resolved' || selectedTicketForModal.status === 'closed';
  if (isDone) {
    Swal.fire('Tiket Terkunci', 'Tiket ini telah selesai dikerjakan dan dikunci secara permanen.', 'info');
    return;
  }

  const techId = document.getElementById('modalAssignTech').value;
  if (!techId) {
    Swal.fire('Peringatan', 'Silakan pilih teknisi terlebih dahulu', 'warning');
    return;
  }

  const selectedOpt = document.getElementById('modalAssignTech').selectedOptions[0];
  const targetTechName = selectedOpt ? selectedOpt.textContent.split('(')[0].trim() : 'Teknisi IT';

  const isCoordinator = activeUser && (activeUser.role === 'koordinator' || activeUser.role === 'kepala_it' || activeUser.role === 'superadmin');
  const isAssignedToMe = activeUser && selectedTicketForModal.assigned_to && (selectedTicketForModal.assigned_to === activeUser.id || selectedTicketForModal.assigned_to_name === activeUser.name);

  // Strict Lock: Non-coordinator cannot steal ticket from other technicians
  if (selectedTicketForModal.assigned_to && !isAssignedToMe && !isCoordinator) {
    Swal.fire('Akses Ditolak', `Tiket ini sedang dikerjakan oleh ${selectedTicketForModal.assigned_to_name || 'Teknisi Lain'}. Hanya petugas yang bersangkutan atau Koordinator IT yang berhak mendisposisikan tiket ini.`, 'error');
    return;
  }

  if (selectedTicketForModal.assigned_to && selectedTicketForModal.assigned_to != techId) {
    const confirmOverlap = await Swal.fire({
      title: 'Konfirmasi Disposisi / Alih Tugas',
      html: `Apakah Anda yakin ingin mengalihkan tiket ini dari <b>${selectedTicketForModal.assigned_to_name || 'Petugas Sebelumnya'}</b> ke teknisi baru?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Ya, Alihkan Tiket',
      cancelButtonText: 'Batal',
      confirmButtonColor: '#0284c7'
    });
    if (!confirmOverlap.isConfirmed) return;
  }

  const savedTicketNo = selectedTicketForModal.ticket_no;
  const savedRoom = selectedTicketForModal.room_name;
  const ticketId = selectedTicketForModal.id;

  try {
    const res = await fetch(`/api/tickets/${ticketId}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ technician_id: techId, assigned_by_name: activeUser.name })
    });
    const resData = await res.json();
    if (!res.ok) throw new Error(resData.error || 'Gagal menugaskan teknisi');

    closeModal();

    if (window.soundAlert) window.soundAlert.playSuccess();

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: `👨‍🔧 Teknisi Ditugaskan!`,
      text: `${savedTicketNo} dialihkan ke ${targetTechName}`,
      showConfirmButton: false,
      timer: 4500,
      timerProgressBar: true
    });

    if (typeof notifyNativeGeneric === 'function') {
      notifyNativeGeneric(
        `👨‍🔧 Disposisi Tiket: ${savedRoom}`,
        `${savedTicketNo} dialihkan ke ${targetTechName}`
      );
    }

    await loadTickets();
    await loadTechnicians();
    await loadStats();
    if (currentTab === 'technician') loadTechnicianTickets();
  } catch (err) {
    Swal.fire('Error', err.message, 'error');
  }
}

// Update Ticket Status
async function updateTicketStatus() {
  if (!selectedTicketForModal) return;

  const isDone = selectedTicketForModal.status === 'resolved' || selectedTicketForModal.status === 'closed';
  if (isDone) {
    Swal.fire('Tiket Terkunci', 'Tiket ini telah selesai dikerjakan dan dikunci secara permanen. Tidak dapat diotak-atik lagi.', 'info');
    return;
  }

  const isCoordinator = activeUser && (activeUser.role === 'koordinator' || activeUser.role === 'kepala_it' || activeUser.role === 'superadmin');
  const isAssignedToMe = activeUser && selectedTicketForModal.assigned_to && (selectedTicketForModal.assigned_to === activeUser.id || selectedTicketForModal.assigned_to_name === activeUser.name);

  // Strict Lock: Non-coordinator cannot update status of tickets handled by other techs
  if (selectedTicketForModal.assigned_to && !isAssignedToMe && !isCoordinator) {
    Swal.fire('Akses Ditolak', 'Tiket ini terkunci dan sedang ditangani oleh teknisi lain. Hanya teknisi tersebut atau Koordinator IT yang dapat memperbarui status tiket.', 'error');
    return;
  }

  const status = document.getElementById('modalNewStatus').value;
  const notes = document.getElementById('modalResolutionNotes').value;
  const proofPhotoInput = document.getElementById('modalProofPhoto');

  const savedTicketNo = selectedTicketForModal.ticket_no;
  const savedRoom = selectedTicketForModal.room_name;
  const ticketId = selectedTicketForModal.id;

  const formData = new FormData();
  formData.append('status', status);
  formData.append('notes', notes);
  formData.append('user_name', activeUser.name);
  if (proofPhotoInput.files && proofPhotoInput.files[0]) {
    formData.append('proof_photo', proofPhotoInput.files[0]);
  }

  try {
    const res = await fetch(`/api/tickets/${ticketId}/status`, {
      method: 'PATCH',
      body: formData
    });
    const resData = await res.json();
    if (!res.ok) throw new Error(resData.error || 'Gagal memperbarui status tiket');

    closeModal();

    if (window.soundAlert) window.soundAlert.playSuccess();

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: status === 'resolved' || status === 'closed' ? 'success' : 'info',
      title: status === 'resolved' || status === 'closed' ? `✅ Tiket Selesai & Dikunci!` : `🔄 Status Tiket Diperbarui`,
      text: `${savedTicketNo} (${savedRoom}) kini ${status.toUpperCase()}`,
      showConfirmButton: false,
      timer: 4500,
      timerProgressBar: true
    });

    if (typeof notifyNativeGeneric === 'function') {
      notifyNativeGeneric(
        status === 'resolved' || status === 'closed' ? `✅ Tiket Selesai: ${savedRoom}` : `🔄 Status Tiket: ${savedRoom}`,
        `${savedTicketNo} status: ${status.toUpperCase()}`
      );
    }

    await loadTickets();
    await loadStats();
    if (currentTab === 'technician') loadTechnicianTickets();
  } catch (err) {
    Swal.fire('Error', err.message, 'error');
  }
}

// Technician Ward Mode
function loadTechnicianTickets() {
  const container = document.getElementById('techTicketList');
  container.innerHTML = '';

  const techNameEl = document.getElementById('techDisplayName');
  const techRoleEl = document.getElementById('techRoleBadge');
  if (techNameEl) {
    techNameEl.textContent = activeUser.name || activeUser.username;
  }
  if (techRoleEl) {
    const isCoord = activeUser.role === 'koordinator' || activeUser.role === 'kepala_it' || activeUser.role === 'superadmin';
    techRoleEl.textContent = isCoord ? 'Koordinator IT' : 'Teknisi IT';
  }

  const myTickets = allTickets.filter(t => t.assigned_to === activeUser.id && t.status !== 'closed');
  document.getElementById('techActiveCount').textContent = myTickets.length;
  document.getElementById('badgeMyTickets').textContent = myTickets.length;

  if (myTickets.length === 0) {
    container.innerHTML = `
      <div class="bg-white p-8 rounded-2xl text-center border border-slate-200">
        <div class="text-4xl mb-2">🎉</div>
        <h4 class="font-bold text-slate-800 text-sm">Tidak Ada Tugas Aktif Saat Ini</h4>
        <p class="text-xs text-slate-400 mt-1">Semua tiket yang ditugaskan kepada Anda telah terselesaikan dengan baik.</p>
      </div>
    `;
    return;
  }

  myTickets.forEach(t => {
    const card = document.createElement('div');
    card.className = 'bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3';
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="font-mono font-bold text-xs text-sky-700">${t.ticket_no}</span>
        <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${t.priority === 'critical' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700'}">
          ${t.priority}
        </span>
      </div>
      <div>
        <h3 class="font-bold text-slate-800 text-sm">${t.title}</h3>
        <p class="text-xs text-slate-500 mt-1">${t.description}</p>
      </div>
      <div class="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
        <p><strong>🏥 Lokasi:</strong> ${t.room_name}</p>
        <p><strong>👤 Pelapor:</strong> ${t.reporter_name} (${t.reporter_phone})</p>
      </div>
      <div class="pt-2 flex flex-wrap gap-2">
        <button onclick="openTicketModal(${t.id})" class="flex-1 min-w-[130px] py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition">
          Perbarui Tindakan / Selesai
        </button>
        <button onclick="sendDirectWaFromCard('${t.ticket_no}', '${t.room_name}', '${t.reporter_name}', '${t.reporter_phone}', '${t.title}', 'done')" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-sm" title="Kirim WA Selesai">
          <i data-lucide="message-circle" class="w-4 h-4"></i>
          <span>WA Selesai</span>
        </button>
      </div>
    `;
    container.appendChild(card);
  });

  lucide.createIcons();
}

// Kirim Pesan WhatsApp Langsung dari HP Teknisi (100% Gratis Tanpa Bot)
function sendWhatsAppDirect(type) {
  if (!selectedTicketForModal) return;
  const t = selectedTicketForModal;

  const isDone = t.status === 'resolved' || t.status === 'closed';
  if (isDone) {
    Swal.fire('Tiket Terkunci', 'Tiket ini telah selesai dikerjakan dan dikunci secara permanen.', 'info');
    return;
  }

  const isCoordinator = activeUser && (activeUser.role === 'koordinator' || activeUser.role === 'kepala_it' || activeUser.role === 'superadmin');
  const isAssignedToMe = activeUser && t.assigned_to && (t.assigned_to === activeUser.id || t.assigned_to_name === activeUser.name);

  // Strict Lock: Non-assigned tech cannot send WhatsApp
  if (t.assigned_to && !isAssignedToMe && !isCoordinator) {
    Swal.fire('Akses Ditolak', `Tiket ini sedang dikerjakan oleh ${t.assigned_to_name || 'Teknisi lain'}. Tombol WhatsApp dikunci untuk Anda.`, 'warning');
    return;
  }

  sendDirectWaFromCard(t.ticket_no, t.room_name, t.reporter_name, t.reporter_phone, t.title, type);
}

function sendDirectWaFromCard(ticketNo, roomName, reporterName, reporterPhone, title, type) {
  if (!reporterPhone) {
    Swal.fire('Info', 'Nomor WhatsApp pelapor tidak tertera', 'info');
    return;
  }

  let cleanPhone = reporterPhone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '62' + cleanPhone.substring(1);
  }

  const techName = activeUser ? activeUser.name : 'Tim IT RSUD Labuha';
  let message = '';

  if (type === 'otw') {
    message = `Halo ${reporterName},\n\nSaya *${techName}* dari Tim IT RSUD Labuha saat ini *SEDANG MENUJU KE ${roomName}* untuk menangani kendala:\n"${title}" (${ticketNo}).\n\nMohon ditunggu, terima kasih.`;
  } else {
    message = `Halo ${reporterName},\n\nKendala IT di *${roomName}* dengan nomor tiket *${ticketNo}*:\n"${title}"\n\nTelah dinyatakan *SELESAI DIPERBAIKI* oleh saya (*${techName}* - Tim IT RSUD Labuha).\n\nSilakan dicek kembali fungsinya. Terima kasih atas kerja samanya.`;
  }

  const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  window.open(waUrl, '_blank');
}

// Set quick period for reports
function setReportPeriod(period) {
  const startEl = document.getElementById('reportStartDate');
  const endEl = document.getElementById('reportEndDate');
  const labelEl = document.getElementById('activePeriodLabel');
  if (!startEl || !endEl) return;

  const now = new Date();
  const formatYmd = d => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const labels = {
    today: 'Hari Ini',
    '7days': '7 Hari Terakhir',
    month: 'Bulan Ini',
    all: 'Semua Data'
  };

  if (period === 'today') {
    startEl.value = formatYmd(now);
    endEl.value = formatYmd(now);
  } else if (period === '7days') {
    const past7 = new Date();
    past7.setDate(now.getDate() - 6);
    startEl.value = formatYmd(past7);
    endEl.value = formatYmd(now);
  } else if (period === 'month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    startEl.value = formatYmd(firstDay);
    endEl.value = formatYmd(now);
  } else if (period === 'all') {
    startEl.value = '';
    endEl.value = '';
  }

  if (labelEl) labelEl.textContent = labels[period] || 'Kustom';
  loadReportsData();
}

function onReportDateChange() {
  const labelEl = document.getElementById('activePeriodLabel');
  if (labelEl) labelEl.textContent = 'Rentang Kustom';
  loadReportsData();
}

// Load Reports Charts
async function loadReportsData() {
  try {
    const start = document.getElementById('reportStartDate')?.value || '';
    const end = document.getElementById('reportEndDate')?.value || '';
    let url = '/api/reports/stats';
    const params = [];
    if (start) params.push(`startDate=${encodeURIComponent(start)}`);
    if (end) params.push(`endDate=${encodeURIComponent(end)}`);
    if (params.length > 0) url += `?${params.join('&')}`;

    const res = await smartFetch(url);
    if (!res || !res.ok) return;
    const stats = await res.json();
    if (!stats) return;

    if (typeof Chart === 'undefined') return;

    // Category Chart
    const canvasCat = document.getElementById('categoryChart');
    if (canvasCat) {
      const ctxCat = canvasCat.getContext('2d');
      if (categoryChartInstance) categoryChartInstance.destroy();

      const catLabels = (stats.categoryStats || []).map(c => c.category_name);
      const catCounts = (stats.categoryStats || []).map(c => c.count);

      categoryChartInstance = new Chart(ctxCat, {
        type: 'doughnut',
        data: {
          labels: catLabels,
          datasets: [{
            data: catCounts,
            backgroundColor: ['#0284c7', '#0d9488', '#f59e0b', '#dc2626', '#8b5cf6', '#64748b']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } } }
        }
      });
    }

    // Room Chart
    const canvasRoom = document.getElementById('roomChart');
    if (canvasRoom) {
      const ctxRoom = canvasRoom.getContext('2d');
      if (roomChartInstance) roomChartInstance.destroy();

      const roomLabels = (stats.roomStats || []).slice(0, 5).map(r => r.room_name.split('(')[0]);
      const roomCounts = (stats.roomStats || []).slice(0, 5).map(r => r.count);

      roomChartInstance = new Chart(ctxRoom, {
        type: 'bar',
        data: {
          labels: roomLabels,
          datasets: [{
            label: 'Jumlah Kendala',
            data: roomCounts,
            backgroundColor: '#0284c7',
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
          plugins: { legend: { display: false } }
        }
      });
    }

  } catch (err) {
    console.error('Failed to load reports charts:', err);
  }
}

// Export Excel with date filter & resolved full URL
function exportExcel() {
  const start = document.getElementById('reportStartDate')?.value || '';
  const end = document.getElementById('reportEndDate')?.value || '';
  let url = '/api/reports/export-excel';
  const params = [];
  if (start) params.push(`startDate=${encodeURIComponent(start)}`);
  if (end) params.push(`endDate=${encodeURIComponent(end)}`);
  if (params.length > 0) url += `?${params.join('&')}`;

  const customBase = localStorage.getItem('server_api_url');
  let fullUrl = url;
  if (customBase && url.startsWith('/api/')) {
    fullUrl = customBase.replace(/\/+$/, '') + url;
  }
  window.location.href = fullUrl;
}

// Print Official HTML / PDF with date filter (In-App Responsive Modal & Direct fallback)
async function printOfficialReport() {
  const start = document.getElementById('reportStartDate')?.value || '';
  const end = document.getElementById('reportEndDate')?.value || '';
  let url = '/api/reports/print-html';
  const params = [];
  if (start) params.push(`startDate=${encodeURIComponent(start)}`);
  if (end) params.push(`endDate=${encodeURIComponent(end)}`);
  if (params.length > 0) url += `?${params.join('&')}`;

  const modal = document.getElementById('reportPrintModal');
  const frame = document.getElementById('reportPrintFrame');
  const loading = document.getElementById('reportPrintLoading');

  if (modal && frame) {
    modal.classList.remove('hidden');
    if (loading) loading.classList.remove('hidden');

    try {
      const res = await smartFetch(url);
      if (!res || !res.ok) throw new Error('Gagal memuat dokumen cetak dari server');
      const html = await res.text();
      frame.srcdoc = html;
      frame.onload = () => {
        if (loading) loading.classList.add('hidden');
      };
    } catch (err) {
      if (loading) loading.classList.add('hidden');
      Swal.fire('Gagal Memuat Laporan', err.message, 'error');
    }
  } else {
    const customBase = localStorage.getItem('server_api_url');
    let fullUrl = url;
    if (customBase && url.startsWith('/api/')) {
      fullUrl = customBase.replace(/\/+$/, '') + url;
    }
    window.location.href = fullUrl;
  }
}

function closeReportPrintModal() {
  const modal = document.getElementById('reportPrintModal');
  const frame = document.getElementById('reportPrintFrame');
  if (modal) modal.classList.add('hidden');
  if (frame) frame.srcdoc = '';
}

function printReportIframe() {
  const frame = document.getElementById('reportPrintFrame');
  if (frame && frame.contentWindow) {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }
}

// Load Gateway & Server Settings
async function loadGatewaySettings() {
  try {
    const res = await fetch('/api/settings');
    const cfg = await res.json();

    const serverUrlInput = document.getElementById('cfg_app_server_url');
    if (serverUrlInput) {
      serverUrlInput.value = cfg.app_server_url || window.location.origin;
    }

    document.getElementById('cfg_wa_enabled').checked = cfg.wa_gateway_enabled === '1';
    document.getElementById('cfg_wa_provider').value = cfg.wa_gateway_provider || 'fonnte';
    document.getElementById('cfg_wa_url').value = cfg.wa_api_url || 'https://api.fonnte.com/send';
    document.getElementById('cfg_wa_token').value = cfg.wa_api_token || '';

    document.getElementById('cfg_tg_enabled').checked = cfg.telegram_enabled === '1';
    document.getElementById('cfg_tg_token').value = cfg.telegram_bot_token || '';
    document.getElementById('cfg_tg_chat_id').value = cfg.telegram_chat_id || '';

    document.getElementById('cfg_email_enabled').checked = cfg.email_enabled === '1';
    document.getElementById('cfg_smtp_host').value = cfg.smtp_host || 'smtp.gmail.com';
    document.getElementById('cfg_smtp_port').value = cfg.smtp_port || '587';
    document.getElementById('cfg_smtp_from').value = cfg.smtp_from_name || 'Helpdesk IT RSUD Labuha';
    document.getElementById('cfg_smtp_user').value = cfg.smtp_user || '';
    document.getElementById('cfg_smtp_pass').value = cfg.smtp_pass || '';
  } catch (err) {
    console.error(err);
  }
}

function setQuickServerIp() {
  const input = document.getElementById('cfg_app_server_url');
  if (input) {
    input.value = window.location.origin;
  }
}

// Save Gateway Settings
async function saveGatewaySettings() {
  const serverUrlInput = document.getElementById('cfg_app_server_url');
  const payload = {
    app_server_url: serverUrlInput ? serverUrlInput.value.trim() : '',
    wa_gateway_enabled: document.getElementById('cfg_wa_enabled').checked ? '1' : '0',
    wa_gateway_provider: document.getElementById('cfg_wa_provider').value,
    wa_api_url: document.getElementById('cfg_wa_url').value,
    wa_api_token: document.getElementById('cfg_wa_token').value,

    telegram_enabled: document.getElementById('cfg_tg_enabled').checked ? '1' : '0',
    telegram_bot_token: document.getElementById('cfg_tg_token').value,
    telegram_chat_id: document.getElementById('cfg_tg_chat_id').value,

    email_enabled: document.getElementById('cfg_email_enabled').checked ? '1' : '0',
    smtp_host: document.getElementById('cfg_smtp_host').value,
    smtp_port: document.getElementById('cfg_smtp_port').value,
    smtp_from_name: document.getElementById('cfg_smtp_from').value,
    smtp_user: document.getElementById('cfg_smtp_user').value,
    smtp_pass: document.getElementById('cfg_smtp_pass').value
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Gagal menyimpan pengaturan');

    if (payload.app_server_url && window.Capacitor?.Plugins?.EtiketNative) {
      let targetUrl = payload.app_server_url;
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = `http://${targetUrl}`;
      }
      window.Capacitor.Plugins.EtiketNative.configure({ serverUrl: targetUrl }).catch(() => { });
    }

    Swal.fire({
      icon: 'success',
      title: 'Pengaturan Berhasil Disimpan!',
      text: 'Alamat server aplikasi (APK), konfigurasi gateway, dan barcode QR telah diperbarui.',
      timer: 2000,
      showConfirmButton: false
    });
  } catch (err) {
    Swal.fire('Error', err.message, 'error');
  }
}

// Native APK & Browser Notification Dispatcher
async function notifyNativeOrBrowser(t) {
  const notifTitle = `${t.priority === 'critical' ? '🚨 KRITIS: ' : '🎫 Tiket Baru: '}${t.room_name}`;
  const notifBody = `${t.title} • Pelapor: ${t.reporter_name} (${t.reporter_phone || '-'})`;

  try {
    const cap = window.Capacitor;
    if (cap && cap.Plugins && cap.Plugins.EtiketNative) {
      await cap.Plugins.EtiketNative.notifyTicketNow({
        id: Number(t.id) || Date.now() % 100000,
        ticketNo: t.ticket_no || '',
        roomName: t.room_name || 'Ruangan RSUD',
        title: t.title || 'Laporan Kendala IT',
        reporterName: t.reporter_name || 'Staf RSUD',
        priority: t.priority || 'medium'
      });
      return;
    }

    if (cap && cap.Plugins && cap.Plugins.LocalNotifications) {
      await cap.Plugins.LocalNotifications.schedule({
        notifications: [{
          id: (Number(t.id) || 1) + 10000,
          title: notifTitle,
          body: notifBody,
          channelId: 'etiket_urgent_alerts_v2'
        }]
      });
      return;
    }
  } catch (e) {
    console.warn('Capacitor notify fallback:', e);
  }

  // Fallback for HTTPS / localhost desktop browser
  if ('Notification' in window && Notification.permission === 'granted') {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(notifTitle, {
          body: notifBody,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          vibrate: [200, 100, 200],
          tag: 'ticket-' + t.id,
          data: { url: '/index.html' }
        });
      }).catch(() => {
        try { new Notification(notifTitle, { body: notifBody, icon: '/icons/icon-192.png' }); } catch (e) { }
      });
    } else {
      try { new Notification(notifTitle, { body: notifBody, icon: '/icons/icon-192.png' }); } catch (e) { }
    }
  }
}

async function testMobileHomeNotification() {
  const cap = window.Capacitor;
  if (cap && cap.Plugins && cap.Plugins.EtiketNative) {
    try {
      const perm = await cap.Plugins.EtiketNative.requestPermission();
      await refreshMobileNotifBadge();
      if (!perm.granted) {
        Swal.fire({
          icon: 'warning',
          title: 'Izin Notifikasi HP Belum Aktif',
          text: 'Aktifkan izin notifikasi untuk ETIKET RSUD LABUHA agar notifikasi bisa muncul di beranda HP.',
          showCancelButton: true,
          confirmButtonText: 'Buka Pengaturan HP',
          cancelButtonText: 'Tutup'
        }).then(r => {
          if (r.isConfirmed) cap.Plugins.EtiketNative.openNotificationSettings();
        });
        return;
      }

      await cap.Plugins.EtiketNative.testNotification({ delayMs: 3000 });
      Swal.fire({
        icon: 'success',
        title: 'Tes Notifikasi Berjalan!',
        html: 'Silakan tekan tombol <b>Beranda / Home</b> di HP Anda sekarang!<br><br>Dalam <b>3 detik</b>, notifikasi akan muncul langsung di layar beranda HP Anda.',
        timer: 3500,
        showConfirmButton: false
      });
    } catch (e) {
      Swal.fire('Error', 'Gagal memicu tes notifikasi: ' + e.message, 'error');
    }
    return;
  }

  // Fallback for Web Browser
  if (!window.isSecureContext) {
    Swal.fire({
      icon: 'info',
      title: 'Gunakan Aplikasi APK untuk Notif Beranda HP',
      html: `
        <div class="text-left text-xs space-y-2">
          <p>Browser Chrome di HP secara otomatis memblokir notifikasi website jika server masih memakai alamat IP HTTP biasa (belum ada domain HTTPS).</p>
          <p class="font-bold text-sky-700">Solusinya sangat mudah: Gunakan aplikasi APK <b>ETIKET-RSUD-LABUHA.apk</b> versi terbaru karena APK memiliki mesin notifikasi native Android sendiri!</p>
        </div>
      `,
      confirmButtonText: 'Mengerti'
    });
    return;
  }

  if ('Notification' in window) {
    const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    refreshMobileNotifBadge();
    if (p === 'granted') {
      setTimeout(() => {
        new Notification('🔔 TES BERHASIL: SIM-ETIKET RSUD LABUHA', {
          body: 'Notifikasi layar komputer/HP sudah aktif!',
          icon: '/icons/icon-192.png'
        });
      }, 2000);
      Swal.fire('Tes Dikirim', 'Perkecil (minimize) browser sekarang, notifikasi tes muncul dalam 2 detik.', 'success');
    } else {
      Swal.fire('Izin Ditolak', 'Silakan izinkan notifikasi pada ikon gembok/pengaturan browser Anda.', 'warning');
    }
  }
}

function openMobileNotificationSettings() {
  if (window.Capacitor?.Plugins?.EtiketNative) {
    window.Capacitor.Plugins.EtiketNative.openNotificationSettings();
  } else {
    Swal.fire('Info', 'Tombol ini berfungsi langsung saat dibuka dari aplikasi Android APK.', 'info');
  }
}

function openApkServerDialog() {
  if (window.Capacitor?.Plugins?.EtiketNative) {
    window.Capacitor.Plugins.EtiketNative.promptServerUrl();
  } else {
    switchTab('gateway');
    const el = document.getElementById('cfg_app_server_url');
    if (el) el.focus();
  }
}

// Test Send WhatsApp
async function testWhatsApp() {
  const phone = document.getElementById('testWaPhone').value.trim();
  if (!phone) {
    Swal.fire('Peringatan', 'Masukkan nomor WhatsApp uji coba', 'warning');
    return;
  }

  Swal.fire({ title: 'Mengirim Tes WhatsApp...', didOpen: () => Swal.showLoading() });

  try {
    const res = await fetch('/api/settings/test-wa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    Swal.fire('Hasil Uji Coba WhatsApp', `Status: <b>${data.status.toUpperCase()}</b><br>${data.message || 'Pesan berhasil diproses'}`, 'info');
  } catch (err) {
    Swal.fire('Error', err.message, 'error');
  }
}

// Test Send Telegram
async function testTelegram() {
  const chatId = document.getElementById('cfg_tg_chat_id').value.trim();
  Swal.fire({ title: 'Mengirim Tes Telegram...', didOpen: () => Swal.showLoading() });

  try {
    const res = await fetch('/api/settings/test-telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId })
    });
    const data = await res.json();
    Swal.fire('Hasil Uji Coba Telegram', `Status: <b>${data.status.toUpperCase()}</b><br>${data.message || 'Pesan terkirim ke Telegram'}`, 'info');
  } catch (err) {
    Swal.fire('Error', err.message, 'error');
  }
}

// Test Send Email
async function testEmail() {
  const email = document.getElementById('testEmailTarget').value.trim();
  if (!email) {
    Swal.fire('Peringatan', 'Masukkan alamat email tujuan pengujian', 'warning');
    return;
  }

  Swal.fire({ title: 'Mengirim Tes Email...', didOpen: () => Swal.showLoading() });

  try {
    const res = await fetch('/api/settings/test-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    Swal.fire('Hasil Uji Coba Email', `Status: <b>${data.status.toUpperCase()}</b><br>${data.message || 'Email berhasil dikirim'}`, 'info');
  } catch (err) {
    Swal.fire('Error', err.message, 'error');
  }
}

// Load Notification Logs
async function loadNotificationLogs() {
  try {
    const res = await fetch('/api/settings/logs');
    const logs = await res.json();

    const tbody = document.getElementById('logsTableBody');
    tbody.innerHTML = '';

    logs.forEach(l => {
      const tr = document.createElement('tr');
      const badgeStatus = {
        sent: '<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">SENT</span>',
        simulated: '<span class="bg-sky-100 text-sky-700 px-2 py-0.5 rounded text-[10px] font-bold">SIMULATED (LOGGED)</span>',
        failed: '<span class="bg-rose-100 text-rose-700 px-2 py-0.5 rounded text-[10px] font-bold">FAILED</span>'
      }[l.status] || l.status;

      tr.innerHTML = `
        <td class="p-3 text-slate-500">${new Date(l.created_at).toLocaleTimeString('id-ID')}</td>
        <td class="p-3 font-bold uppercase text-slate-700">${l.channel}</td>
        <td class="p-3 font-semibold text-slate-800">${l.recipient}</td>
        <td class="p-3 text-slate-600">${l.title || '-'}</td>
        <td class="p-3 max-w-xs truncate text-slate-500">${l.message.substring(0, 60)}...</td>
        <td class="p-3">${badgeStatus}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load logs:', err);
  }
}

