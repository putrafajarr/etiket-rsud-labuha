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
let appSettings = {};

document.addEventListener('DOMContentLoaded', async () => {
  initMobileNativeBridge();
  await checkAuthSession();
  await Promise.all([
    loadRoomsMaster(),
    loadTechnicians(),
    loadTickets(),
    loadStats(),
    loadAppSettings()
  ]);
  initSocket();
  startAutoSync();
  lucide.createIcons();

  // Keep internal page links inside Capacitor APK WebView so they never open external broken localhost tabs
  if (window.Capacitor) {
    document.addEventListener('click', (ev) => {
      const anchor = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (href.startsWith('/') && !href.endsWith('.apk') && anchor.target === '_blank') {
        ev.preventDefault();
        window.location.href = href;
      }
    });
  }

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

  // 1. Direct decode if token is Supabase standalone token
  if (token.startsWith('sb_')) {
    try {
      const user = JSON.parse(decodeURIComponent(escape(atob(token.slice(3)))));
      setAuthenticatedUser(user);
      if (overlay) overlay.classList.add('hidden');
      return true;
    } catch (e) {
      localStorage.removeItem('etiket_token');
      if (overlay) overlay.classList.remove('hidden');
      return false;
    }
  }

  // 2. Otherwise verify with backend
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
    const cached = localStorage.getItem('etiket_cached_user');
    if (cached) {
      try {
        const u = JSON.parse(cached);
        setAuthenticatedUser(u);
        if (overlay) overlay.classList.add('hidden');
        return true;
      } catch (err) {}
    }
    localStorage.removeItem('etiket_token');
    if (overlay) overlay.classList.remove('hidden');
    return false;
  }
}

function setAuthenticatedUser(user) {
  activeUser = user;
  if (user) {
    try {
      localStorage.setItem('etiket_cached_user', JSON.stringify(user));
    } catch (e) {}
  }
  const navName = document.getElementById('navUserName');
  const navRole = document.getElementById('navUserRole');
  if (navName) navName.textContent = user.name;
  if (navRole) {
    const roleLabels = {
      koordinator: 'Koordinator IT',
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
    if (!res.ok || !data || !data.user) {
      throw new Error((data && data.error) || 'Username atau password salah');
    }

    const authUser = data.user;
    const authToken = data.token;

    localStorage.setItem('etiket_token', authToken);
    setAuthenticatedUser(authUser);
    document.getElementById('loginOverlay').classList.add('hidden');

    await Promise.all([loadTechnicians(), loadRoomsMaster(), loadTickets(), loadStats()]);

    Swal.fire({
      icon: 'success',
      title: 'Selamat Datang!',
      text: `Halo, ${authUser.name}. Selamat bertugas!`,
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

// Socket.io Realtime Listener (loaded only on local Node.js host)
async function initSocket() {
  try {
    if (typeof io !== 'function' && window.isLocalBackendHost && window.isLocalBackendHost() && typeof window.ensureScriptLoaded === 'function') {
      await window.ensureScriptLoaded('/socket.io/socket.io.js').catch(() => {});
    }
    if (typeof io === 'function') {
      socket = io();

      socket.on('connect', () => {
        console.log('[Socket] Connected to RSUD Labuha server');
      });

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

      socket.on('ticket_updated', (data) => {
        const ut = data && data.ticket;
        if (data.action === 'resolved') {
          if (window.soundAlert) window.soundAlert.playSuccess();
          if (ut) {
            notifyNativeGeneric(
              `✅ Tiket Selesai: ${ut.room_name || 'Ruangan RSUD'}`,
              `${ut.ticket_no || ''} telah diselesaikan oleh ${ut.assigned_to_name || 'Tim IT'}`,
              {
                ticketId: ut.id,
                ticketNo: ut.ticket_no,
                roomName: ut.room_name,
                status: ut.status || 'resolved',
                assignedTo: ut.assigned_to || 0,
                eventType: 'resolved'
              }
            );
          }
        } else if (data.action === 'assigned' && ut) {
          if (window.soundAlert) window.soundAlert.playChime();
          notifyNativeGeneric(
            `👨‍🔧 Disposisi Tiket: ${ut.room_name || 'Ruangan RSUD'}`,
            `${ut.ticket_no || ''} ditugaskan ke ${ut.assigned_to_name || 'Teknisi IT'}`,
            {
              ticketId: ut.id,
              ticketNo: ut.ticket_no,
              roomName: ut.room_name,
              status: ut.status || 'in_progress',
              assignedTo: ut.assigned_to || 0,
              eventType: 'assigned'
            }
          );
        }
        loadTickets();
        loadStats();
        if (currentTab === 'technician') loadTechnicianTickets();
      });
    }
  } catch (err) {
    console.debug('[Socket] Using Supabase Cloud auto-sync polling');
  }
}

// =============================================================================
// Supabase Cloud & Resilient Fetch Layer provided by /js/supabase-client.js
// =============================================================================

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
                if (window.soundAlert) window.soundAlert.playChime();
                if (isMe) {
                  notifyNativeGeneric(
                    `📋 Disposisi untuk Anda: ${ft.room_name || 'Ruangan RSUD'}`,
                    `${ft.ticket_no || ''} ditugaskan kepada Anda (${ft.title || ''})`,
                    {
                      ticketId: ft.id,
                      ticketNo: ft.ticket_no,
                      roomName: ft.room_name,
                      status: ft.status || 'in_progress',
                      assignedTo: ft.assigned_to || 0,
                      eventType: 'assigned'
                    }
                  );
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
                  if (ft.assigned_to) {
                    notifyNativeGeneric(
                      `👨‍🔧 Disposisi Tiket: ${ft.room_name || 'Ruangan RSUD'}`,
                      `${ft.ticket_no || ''} ditugaskan ke ${ft.assigned_to_name || 'Teknisi IT'}`,
                      {
                        ticketId: ft.id,
                        ticketNo: ft.ticket_no,
                        roomName: ft.room_name,
                        status: ft.status || 'in_progress',
                        assignedTo: ft.assigned_to || 0,
                        eventType: 'assigned'
                      }
                    );
                  }
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
                  notifyNativeGeneric(
                    `✅ Tiket Selesai: ${ft.room_name || 'Ruangan RSUD'}`,
                    `${ft.ticket_no || ''} telah diselesaikan oleh ${ft.assigned_to_name || 'Tim IT'}`,
                    {
                      ticketId: ft.id,
                      ticketNo: ft.ticket_no,
                      roomName: ft.room_name,
                      status: ft.status,
                      assignedTo: ft.assigned_to || 0,
                      eventType: 'resolved'
                    }
                  );
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
              filterSelect.innerHTML += `<option value="${r.id}" ${r.id == curVal ? 'selected' : ''}>${esc(r.name)}</option>`;
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
              select.innerHTML += `<option value="${t.id}" ${t.id == curVal ? 'selected' : ''}>${esc(t.name)} (${roleLabel})${isSelf} - ${t.active_tickets || 0} aktif</option>`;
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
  // Interval cerdas: 5 detik dan HANYA berjalan jika aplikasi / layar sedang aktif dilihat!
  autoSyncTimer = setInterval(() => {
    if (document.hidden) return; // Menghemat kuota saat HP terkunci atau tab diminimalkan
    runRealtimeSyncCycle();
  }, 5000);
}

// Saat user kembali membuka tab / menghidupkan layar HP, lakukan sinkronisasi instan seketika!
if (!window._visibilityListenerAttached) {
  window._visibilityListenerAttached = true;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      runRealtimeSyncCycle();
    }
  });
}

// 1-Click Instant Manual Sync Button on Header
async function triggerManualSync() {
  const icon = document.getElementById('iconManualSync');
  if (icon) icon.classList.add('animate-spin');

  await runRealtimeSyncCycle();
  await Promise.all([loadStats(), loadAppSettings()]);

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
    updateSignersPreview();
    loadAppSettings();
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
    lucide.createIcons();
  }
}

// Sub-toggle for Mobile Table View: Cards vs Full Table
let tableSubViewMode = 'cards';
function setTableSubView(mode) {
  tableSubViewMode = mode;
  const cardContainer = document.getElementById('ticketsMobileCardContainer');
  const tableWrapper = document.getElementById('ticketsFullTableWrapper');
  const swipeHint = document.getElementById('mobileTableSwipeHint');
  const btnC = document.getElementById('btnSubMobileCards');
  const btnT = document.getElementById('btnSubMobileTable');

  if (mode === 'cards') {
    if (cardContainer) {
      cardContainer.classList.remove('hidden');
      cardContainer.classList.add('block');
    }
    if (tableWrapper) {
      tableWrapper.classList.add('hidden');
      tableWrapper.classList.remove('block');
      tableWrapper.classList.add('sm:block');
    }
    if (swipeHint) swipeHint.classList.add('hidden');
    if (btnC) {
      btnC.className = 'px-2.5 py-1 text-[11px] font-bold rounded-lg bg-sky-600 text-white transition';
    }
    if (btnT) {
      btnT.className = 'px-2.5 py-1 text-[11px] font-semibold text-slate-600 rounded-lg hover:bg-slate-100 transition';
    }
  } else {
    if (cardContainer) {
      cardContainer.classList.add('hidden');
      cardContainer.classList.remove('block');
    }
    if (tableWrapper) {
      tableWrapper.classList.remove('hidden');
      tableWrapper.classList.remove('sm:block');
      tableWrapper.classList.add('block');
    }
    if (swipeHint) swipeHint.classList.remove('hidden');
    if (btnT) {
      btnT.className = 'px-2.5 py-1 text-[11px] font-bold rounded-lg bg-sky-600 text-white transition';
    }
    if (btnC) {
      btnC.className = 'px-2.5 py-1 text-[11px] font-semibold text-slate-600 rounded-lg hover:bg-slate-100 transition';
    }
  }
  lucide.createIcons();
}

// Safe HTML escaping delegate (uses helper from supabase-client.js)
function esc(value) {
  return typeof window.escapeHtml === 'function' ? window.escapeHtml(value) : String(value ?? '');
}

// Debounce search filter
function debounceFilter() {
  clearTimeout(filterTimeout);
  filterTimeout = setTimeout(() => {
    renderTickets();
  }, 200);
}

// Load Tickets (keeps allTickets unfiltered; toolbar filters apply cleanly in renderTickets)
async function loadTickets() {
  try {
    const res = await fetch('/api/tickets');
    const rows = await res.json();
    if (Array.isArray(rows)) {
      allTickets = rows;
    }
    renderTickets();
  } catch (err) {
    console.error('Failed to load tickets:', err);
  }
}

function getFilteredTickets(list) {
  const search = (document.getElementById('filterSearch')?.value || '').trim().toLowerCase();
  const priority = document.getElementById('filterPriority')?.value || 'all';
  const roomId = document.getElementById('filterRoom')?.value || '';

  return (list || []).filter(t => {
    if (priority && priority !== 'all' && t.priority !== priority) return false;
    if (roomId && String(t.room_id) !== String(roomId)) return false;
    if (search) {
      const hay = [t.ticket_no, t.title, t.description, t.room_name, t.category_name, t.reporter_name, t.assigned_to_name]
        .map(v => String(v || '').toLowerCase())
        .join(' ');
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

// Render Kanban, Desktop Table & Mobile Cards
function renderTickets() {
  const openList = document.getElementById('colOpenList');
  const assignedList = document.getElementById('colAssignedList');
  const progressList = document.getElementById('colProgressList');
  const resolvedList = document.getElementById('colResolvedList');
  const tableBody = document.getElementById('ticketsTableBody');
  const mobileCardContainer = document.getElementById('ticketsMobileCardContainer');

  if (openList) openList.innerHTML = '';
  if (assignedList) assignedList.innerHTML = '';
  if (progressList) progressList.innerHTML = '';
  if (resolvedList) resolvedList.innerHTML = '';
  if (tableBody) tableBody.innerHTML = '';
  if (mobileCardContainer) mobileCardContainer.innerHTML = '';

  const visibleTickets = getFilteredTickets(allTickets);
  let countOpen = 0, countAssigned = 0, countProgress = 0, countResolved = 0;

  if (visibleTickets.length === 0) {
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="10" class="p-8 text-center text-slate-400">
            <div class="text-3xl mb-2">📭</div>
            <p class="font-bold text-sm text-slate-700">Tidak Ada Data Tiket</p>
            <p class="text-xs text-slate-400 mt-1">Belum ada tiket yang sesuai dengan filter atau pencarian Anda.</p>
          </td>
        </tr>
      `;
    }
    if (mobileCardContainer) {
      mobileCardContainer.innerHTML = `
        <div class="p-8 text-center text-slate-400 bg-white">
          <div class="text-3xl mb-2">📭</div>
          <p class="font-bold text-sm text-slate-700">Tidak Ada Data Tiket</p>
          <p class="text-xs text-slate-400 mt-1">Belum ada tiket yang sesuai dengan filter atau pencarian Anda.</p>
        </div>
      `;
    }
  }

  visibleTickets.forEach(t => {
    const safeTicketNo = esc(t.ticket_no);
    const safeTitle = esc(t.title);
    const safeRoom = esc(t.room_name);
    const safeCategory = esc(t.category_name);
    const safeReporter = esc(t.reporter_name);
    const safeTechName = esc(t.assigned_to_name);
    const hasPhoto = Boolean(t.photo_url);
    const hasProof = Boolean(t.proof_photo_url);

    const priorityClasses = {
      critical: 'ticket-critical bg-rose-50/40 border-rose-200',
      high: 'ticket-high bg-orange-50/40 border-orange-200',
      medium: 'ticket-medium bg-amber-50/40 border-amber-200',
      low: 'ticket-low bg-sky-50/40 border-sky-200'
    }[t.priority] || 'bg-white border-slate-200';

    const mobileBorderAccent = {
      critical: 'border-l-4 border-l-rose-600',
      high: 'border-l-4 border-l-orange-500',
      medium: 'border-l-4 border-l-amber-500',
      low: 'border-l-4 border-l-sky-500'
    }[t.priority] || 'border-l-4 border-l-slate-300';

    const priorityBadge = {
      critical: '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-black bg-rose-600 text-white whitespace-nowrap shadow-sm">🚨 Kritis</span>',
      high: '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-bold bg-orange-500 text-white whitespace-nowrap shadow-sm">🔴 Tinggi</span>',
      medium: '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-bold bg-amber-500 text-white whitespace-nowrap shadow-sm">🟡 Sedang</span>',
      low: '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-bold bg-sky-500 text-white whitespace-nowrap shadow-sm">🟢 Rendah</span>'
    }[t.priority] || `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700 whitespace-nowrap">${esc(t.priority)}</span>`;

    const statusBadge = {
      open: '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 whitespace-nowrap"><span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>Tiket Baru</span>',
      assigned: '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 whitespace-nowrap"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>Ditugaskan</span>',
      in_progress: '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 whitespace-nowrap"><span class="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse"></span>Dikerjakan</span>',
      pending: '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 whitespace-nowrap"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>Pending</span>',
      resolved: '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 whitespace-nowrap">✓ Selesai</span>',
      closed: '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 whitespace-nowrap">✓ Ditutup</span>'
    }[t.status] || `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 whitespace-nowrap">${esc(t.status)}</span>`;

    const createdDate = new Date(t.created_at);
    const dateFormatted = !isNaN(createdDate)
      ? createdDate.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '-';
    const timeFormatted = !isNaN(createdDate)
      ? createdDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      : '-';

    let techBadge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap">⏳ Belum Ditugaskan</span>';
    if (t.assigned_to) {
      const isMe = activeUser && (t.assigned_to === activeUser.id || t.assigned_to_name === activeUser.name);
      if (isMe) {
        techBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 whitespace-nowrap">👤 ${safeTechName} (Anda)</span>`;
      } else {
        techBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-900 border border-amber-300 whitespace-nowrap">🔒 ${safeTechName || 'Teknisi'}</span>`;
      }
    }

    const attachmentChips =
      (hasPhoto ? '<span class="inline-flex items-center px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 text-[9px] font-bold">📷 Foto</span>' : '') +
      (hasProof ? '<span class="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px] font-bold">✅ Bukti</span>' : '');

    // Card element for Kanban
    const card = document.createElement('div');
    card.className = `p-3.5 rounded-xl border bg-white shadow-sm hover:shadow-md transition cursor-pointer space-y-2.5 ${priorityClasses}`;
    card.onclick = () => openTicketModal(t.id);
    card.innerHTML = `
      <div class="flex items-center justify-between gap-1.5">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="font-mono font-bold text-xs text-sky-700 truncate">${safeTicketNo}</span>
          ${attachmentChips}
        </div>
        ${priorityBadge}
      </div>
      <div>
        <h4 class="font-bold text-slate-800 text-xs line-clamp-2 leading-snug">${safeTitle}</h4>
        <p class="text-[11px] text-slate-500 font-semibold mt-1 flex items-center">
          <i data-lucide="map-pin" class="w-3 h-3 mr-1 text-slate-400 shrink-0"></i>
          <span class="truncate">${safeRoom}</span>
        </p>
      </div>
      <div class="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
        <span class="truncate max-w-[110px]">👤 ${safeReporter}</span>
        <div>${t.assigned_to ? (activeUser && (t.assigned_to === activeUser.id || t.assigned_to_name === activeUser.name) ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">👤 Anda</span>' : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">🔒 ' + esc(t.assigned_to_name ? t.assigned_to_name.split(' ')[0] : 'Teknisi') + '</span>') : '<span class="text-rose-500 font-bold text-[10px]">⏳ Belum ada</span>'}</div>
      </div>
    `;

    if (t.status === 'open') {
      if (openList) openList.appendChild(card);
      countOpen++;
    } else if (t.status === 'assigned') {
      if (assignedList) assignedList.appendChild(card);
      countAssigned++;
    } else if (t.status === 'in_progress' || t.status === 'pending') {
      if (progressList) progressList.appendChild(card);
      countProgress++;
    } else if (t.status === 'resolved' || t.status === 'closed') {
      if (resolvedList) resolvedList.appendChild(card);
      countResolved++;
    }

    // Append to Full Desktop/Tablet Table (aligned, zebra, compact)
    if (tableBody) {
      const tr = document.createElement('tr');
      tr.className = 'even:bg-slate-50/40 hover:bg-sky-50/60 cursor-pointer transition whitespace-nowrap border-b border-slate-100';
      tr.onclick = () => openTicketModal(t.id);
      tr.innerHTML = `
        <td class="px-3.5 py-3 font-mono font-bold text-sky-700 whitespace-nowrap text-xs align-middle">
          <div class="flex items-center gap-1.5">
            <span>${safeTicketNo}</span>
            ${attachmentChips}
          </div>
        </td>
        <td class="px-3.5 py-3 text-slate-500 whitespace-nowrap text-xs align-middle">
          <div class="font-bold text-slate-700 leading-tight">${dateFormatted}</div>
          <div class="text-[10px] text-slate-400 font-mono mt-0.5">${timeFormatted} WIT</div>
        </td>
        <td class="px-3.5 py-3 font-bold text-slate-800 whitespace-nowrap text-xs align-middle max-w-[180px] truncate" title="${safeRoom}">
          <span>🏥 ${safeRoom}</span>
        </td>
        <td class="px-3.5 py-3 whitespace-nowrap text-xs align-middle">
          <span class="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-[10px] font-bold">${safeCategory}</span>
        </td>
        <td class="px-3.5 py-3 whitespace-nowrap text-xs align-middle">${priorityBadge}</td>
        <td class="px-3.5 py-3 text-slate-700 whitespace-nowrap text-xs font-semibold align-middle max-w-[130px] truncate" title="${safeReporter}">${safeReporter}</td>
        <td class="px-3.5 py-3 text-slate-800 text-xs max-w-[220px] truncate font-medium align-middle" title="${safeTitle}">${safeTitle}</td>
        <td class="px-3.5 py-3 whitespace-nowrap text-xs align-middle">${techBadge}</td>
        <td class="px-3.5 py-3 whitespace-nowrap text-xs align-middle">${statusBadge}</td>
        <td class="px-3.5 py-3 text-center whitespace-nowrap text-xs align-middle">
          <button onclick="event.stopPropagation(); openTicketModal(${t.id})" class="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition shadow-sm inline-flex items-center space-x-1 active:scale-95">
            <i data-lucide="eye" class="w-3.5 h-3.5"></i>
            <span>Buka</span>
          </button>
        </td>
      `;
      tableBody.appendChild(tr);
    }

    // Append to Mobile Card List (APK & Mobile Web)
    if (mobileCardContainer) {
      const mCard = document.createElement('div');
      mCard.className = `p-3.5 sm:p-4 bg-white hover:bg-sky-50/40 transition cursor-pointer space-y-2.5 active:bg-slate-50 border-b border-slate-100 ${mobileBorderAccent}`;
      mCard.onclick = () => openTicketModal(t.id);
      mCard.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center flex-wrap gap-1.5 min-w-0">
            <span class="font-mono font-bold text-sky-700 text-xs">${safeTicketNo}</span>
            <span class="text-[10px] text-slate-400 font-medium">${dateFormatted} • ${timeFormatted} WIT</span>
            ${attachmentChips}
          </div>
          <div class="shrink-0">
            ${statusBadge}
          </div>
        </div>

        <div class="flex items-center justify-between gap-2">
          <div class="font-bold text-slate-800 text-sm flex items-center space-x-1.5 min-w-0">
            <span class="text-base shrink-0">🏥</span>
            <span class="truncate">${safeRoom}</span>
          </div>
          <div class="shrink-0">
            ${priorityBadge}
          </div>
        </div>

        <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-xs text-slate-700 font-medium leading-relaxed">
          <span class="text-slate-400 text-[10px] block font-bold uppercase tracking-wider mb-0.5">Uraian Kendala:</span>
          <p class="line-clamp-2">${safeTitle}</p>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-100 text-xs">
          <div class="flex items-center space-x-1.5 text-slate-500 text-[11px] min-w-0">
            <span class="font-semibold text-slate-700 truncate max-w-[115px]">👤 ${safeReporter}</span>
            <span class="text-slate-300">•</span>
            <span class="text-slate-500 truncate max-w-[95px]">${safeCategory}</span>
          </div>
          <div class="flex items-center space-x-1.5 shrink-0">
            ${techBadge}
            <button onclick="event.stopPropagation(); openTicketModal(${t.id})" class="px-3 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold transition shadow-sm">
              Buka
            </button>
          </div>
        </div>
      `;
      mobileCardContainer.appendChild(mCard);
    }
  });

  const countOpenEl = document.getElementById('colCountOpen');
  const countAssignedEl = document.getElementById('colCountAssigned');
  const countProgressEl = document.getElementById('colCountProgress');
  const countResolvedEl = document.getElementById('colCountResolved');
  const badgeOpenCountEl = document.getElementById('badgeOpenCount');

  if (countOpenEl) countOpenEl.textContent = countOpen;
  if (countAssignedEl) countAssignedEl.textContent = countAssigned;
  if (countProgressEl) countProgressEl.textContent = countProgress;
  if (countResolvedEl) countResolvedEl.textContent = countResolved;
  if (badgeOpenCountEl) badgeOpenCountEl.textContent = countOpen;

  lucide.createIcons();
}

// Load Rooms Master & Filter Options
async function loadRoomsMaster() {
  try {
    const res = await fetch('/api/rooms');
    allRooms = await res.json();

    // Filter dropdown (preserve current filter selection)
    const filterSelect = document.getElementById('filterRoom');
    const prevSelected = filterSelect ? filterSelect.value : '';
    if (filterSelect) {
      filterSelect.innerHTML = '<option value="">Semua Ruangan RSUD</option>';
      allRooms.forEach(r => {
        const opt = document.createElement('option');
        opt.value = String(r.id);
        opt.textContent = r.name;
        filterSelect.appendChild(opt);
      });
      if (prevSelected) filterSelect.value = prevSelected;
    }

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
            <span class="text-[10px] font-mono font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded">${esc(r.code)}</span>
            <span class="text-[10px] text-slate-400 font-semibold">${esc(r.floor || 'Lantai 1')}</span>
          </div>
          <h4 class="font-bold text-slate-800 text-xs mt-2">${esc(r.name)}</h4>
          <p class="text-[11px] text-slate-400">${esc(r.building || 'Gedung RSUD')}</p>
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
            <button onclick="deleteRoomById(${r.id})" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="Hapus Unit">
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

function deleteRoomById(roomId) {
  const room = (allRooms || []).find(r => r.id === roomId);
  return deleteRoom(roomId, room ? room.name : 'Ruangan Ini');
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

    if (!allUsersData || allUsersData.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="p-8 text-center text-slate-400 text-xs">
            Belum ada akun pengguna aktif di database Supabase.
          </td>
        </tr>
      `;
      return;
    }

    allUsersData.forEach(u => {
      const roleBadge = {
        koordinator: '<span class="bg-indigo-100 text-indigo-700 font-bold px-2.5 py-1 rounded-lg text-[10px] whitespace-nowrap inline-block">Koordinator IT</span>',
        kepala_it: '<span class="bg-indigo-100 text-indigo-700 font-bold px-2.5 py-1 rounded-lg text-[10px] whitespace-nowrap inline-block">Koordinator IT</span>',
        superadmin: '<span class="bg-indigo-100 text-indigo-700 font-bold px-2.5 py-1 rounded-lg text-[10px] whitespace-nowrap inline-block">Koordinator IT</span>',
        teknisi: '<span class="bg-emerald-100 text-emerald-700 font-bold px-2.5 py-1 rounded-lg text-[10px] whitespace-nowrap inline-block">Teknisi IT</span>'
      }[u.role] || `<span class="bg-slate-100 text-slate-700 font-bold px-2.5 py-1 rounded-lg text-[10px] whitespace-nowrap inline-block">${esc(u.role)}</span>`;

      const isActive = u.is_active === undefined || u.is_active === null || u.is_active === 1 || u.is_active === true;
      const statusBadge = isActive
        ? '<span class="text-emerald-600 font-bold whitespace-nowrap">● Aktif</span>'
        : '<span class="text-rose-500 font-bold whitespace-nowrap">● Nonaktif</span>';

      const cleanDigits = u.phone ? String(u.phone).replace(/\D/g, '') : '';
      const tr = document.createElement('tr');
      tr.className = 'even:bg-slate-50/40 hover:bg-sky-50/50 transition whitespace-nowrap';
      tr.innerHTML = `
        <td class="px-3.5 py-3 font-bold text-slate-800 align-middle">${esc(u.name)}</td>
        <td class="px-3.5 py-3 font-mono text-slate-600 font-bold align-middle">${esc(u.username)}</td>
        <td class="px-3.5 py-3 align-middle">${roleBadge}</td>
        <td class="px-3.5 py-3 font-mono text-slate-700 align-middle">${u.phone ? `<a href="https://wa.me/${cleanDigits}" target="_blank" class="text-emerald-600 font-bold hover:underline inline-flex items-center"><i data-lucide="message-circle" class="w-3 h-3 mr-1"></i>${esc(u.phone)}</a>` : '-'}</td>
        <td class="px-3.5 py-3 text-slate-600 align-middle">${esc(u.specialization || '-')}</td>
        <td class="px-3.5 py-3 text-xs align-middle">${statusBadge}</td>
        <td class="px-3.5 py-3 text-center align-middle">
          <div class="flex items-center justify-center space-x-1.5">
            <button onclick="openEditUserModal(${u.id})" class="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition" title="Edit Akun">
              <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="deleteUserById(${u.id})" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="Hapus Akun">
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

function deleteUserById(userId) {
  const user = (allUsersData || []).find(u => u.id === userId);
  return deleteUser(userId, user ? user.name : 'Pengguna Ini');
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
        select.innerHTML += `<option value="${t.id}">${esc(t.name)} (${roleLabel})${isSelf} - ${t.active_tickets || 0} aktif</option>`;
      });
    }

    // Populate Leaderboard in Reports
    const tbody = document.getElementById('techLeaderboardBody');
    if (tbody) {
      tbody.innerHTML = '';
      if (!allTechnicians || allTechnicians.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="4" class="p-6 text-center text-slate-400 text-xs">Belum ada data teknisi IT aktif.</td>
          </tr>
        `;
      } else {
        allTechnicians.forEach(t => {
          const tr = document.createElement('tr');
          tr.className = 'even:bg-slate-50/40 whitespace-nowrap hover:bg-sky-50/50 transition';
          tr.innerHTML = `
            <td class="px-3.5 py-3 font-bold text-slate-800 whitespace-nowrap align-middle">${esc(t.name)} <span class="text-[10px] text-slate-400 font-mono">(@${esc(t.username)})</span></td>
            <td class="px-3.5 py-3 text-slate-500 whitespace-nowrap align-middle">${esc(t.specialization || ((t.role === 'koordinator' || t.role === 'kepala_it' || t.role === 'superadmin') ? 'Koordinator SIMRS' : 'Teknisi IT'))}</td>
            <td class="px-3.5 py-3 font-bold text-amber-600 whitespace-nowrap align-middle">${Number(t.active_tickets) || 0} Tiket</td>
            <td class="px-3.5 py-3 font-bold text-emerald-600 whitespace-nowrap align-middle">${Number(t.resolved_tickets) || 0} Tiket Selesai</td>
          `;
          tbody.appendChild(tr);
        });
      }
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
  const savedAssignedTo = Number(selectedTicketForModal.assigned_to || 0);
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

    // Notifikasi sistem HP (Beranda & Layar Kunci)
    notifyNativeGeneric(
      `🔒 Tiket Diambil: ${savedRoom}`,
      `${savedTicketNo} telah Anda ambil & terkunci atas nama ${activeUser.name}`,
      {
        ticketId,
        ticketNo: savedTicketNo,
        roomName: savedRoom,
        status: 'in_progress',
        assignedTo: Number(activeUser.id) || 0,
        assignedToName: activeUser.name,
        eventType: 'assigned'
      }
    );

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
    if (!res.ok || !data || !data.ticket) {
      throw new Error((data && data.error) || 'Data tiket tidak ditemukan');
    }
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
          lockText.innerHTML = `Tiket sedang dikerjakan oleh <b>${esc(selectedTicketForModal.assigned_to_name)}</b>. Sebagai Koordinator IT, Anda memiliki wewenang disposisi / alih tugas.`;
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

    // Populate Photos (Foto Kendala & Foto Bukti Penyelesaian)
    const photosSection = document.getElementById('modalPhotosSection');
    const issuePhotoWrap = document.getElementById('modalIssuePhotoWrap');
    const issuePhotoImg = document.getElementById('modalIssuePhoto');
    const issuePhotoLink = document.getElementById('modalIssuePhotoLink');
    const proofPhotoWrap = document.getElementById('modalProofPhotoWrap');
    const proofPhotoImg = document.getElementById('modalProofPhotoPreview');
    const proofPhotoLink = document.getElementById('modalProofPhotoLink');

    let anyPhoto = false;
    if (selectedTicketForModal.photo_url && issuePhotoWrap && issuePhotoImg) {
      issuePhotoImg.src = selectedTicketForModal.photo_url;
      if (issuePhotoLink) {
        issuePhotoLink.onclick = (e) => {
          e.preventDefault();
          openImageLightbox(selectedTicketForModal.photo_url, 'Foto Kendala - ' + selectedTicketForModal.ticket_no);
        };
      }
      issuePhotoWrap.classList.remove('hidden');
      anyPhoto = true;
    } else if (issuePhotoWrap) {
      issuePhotoWrap.classList.add('hidden');
    }

    if (selectedTicketForModal.proof_photo_url && proofPhotoWrap && proofPhotoImg) {
      proofPhotoImg.src = selectedTicketForModal.proof_photo_url;
      if (proofPhotoLink) {
        proofPhotoLink.onclick = (e) => {
          e.preventDefault();
          openImageLightbox(selectedTicketForModal.proof_photo_url, 'Foto Bukti Penyelesaian - ' + selectedTicketForModal.ticket_no);
        };
      }
      proofPhotoWrap.classList.remove('hidden');
      anyPhoto = true;
    } else if (proofPhotoWrap) {
      proofPhotoWrap.classList.add('hidden');
    }

    if (photosSection) {
      if (anyPhoto) photosSection.classList.remove('hidden');
      else photosSection.classList.add('hidden');
    }

    document.getElementById('modalAssignTech').value = selectedTicketForModal.assigned_to || '';
    document.getElementById('modalNewStatus').value = selectedTicketForModal.status || 'in_progress';
    document.getElementById('modalResolutionNotes').value = selectedTicketForModal.resolution_notes || '';
    const proofFileInput = document.getElementById('modalProofPhoto');
    if (proofFileInput) proofFileInput.value = '';

    // Render Modal Logs
    const logsList = document.getElementById('modalLogsList');
    logsList.innerHTML = '';
    const logs = data.logs || [];
    if (logs.length === 0) {
      logsList.innerHTML = '<div class="text-slate-400 text-xs italic p-2 bg-slate-50 rounded-xl border border-slate-100">Belum ada riwayat aktivitas tercatat.</div>';
    } else {
      logs.forEach(l => {
        const item = document.createElement('div');
        item.className = 'bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex justify-between items-start gap-2';
        item.innerHTML = `
          <div class="min-w-0">
            <span class="font-bold text-slate-800">${esc(l.action)}</span>
            <p class="text-slate-600 mt-0.5 break-words">${esc(l.notes || '-')}</p>
            <span class="text-[10px] text-slate-400 block mt-0.5">Oleh: ${esc(l.user_name)}</span>
          </div>
          <span class="text-[10px] text-slate-400 shrink-0">${new Date(l.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
        `;
        logsList.appendChild(item);
      });
    }

    document.getElementById('ticketModal').classList.remove('hidden');
    lucide.createIcons();
  } catch (err) {
    console.error(err);
    Swal.fire('Gagal Memuat Tiket', err.message || 'Detail tiket tidak dapat dibuka.', 'error');
  }
}

function openImageLightbox(src, caption) {
  if (!src) return;
  Swal.fire({
    title: caption || 'Lampiran Foto',
    imageUrl: src,
    imageAlt: caption || 'Lampiran Foto',
    width: 640,
    confirmButtonText: 'Tutup',
    confirmButtonColor: '#0284c7'
  });
}

function closeModal() {
  document.getElementById('ticketModal').classList.add('hidden');
  const proofFileInput = document.getElementById('modalProofPhoto');
  if (proofFileInput) proofFileInput.value = '';
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
  const savedAssignedTo = Number(selectedTicketForModal.assigned_to || 0);
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

    notifyNativeGeneric(
      `👨‍🔧 Disposisi Tiket: ${savedRoom}`,
      `${savedTicketNo} didisposisikan ke ${targetTechName}`,
      {
        ticketId,
        ticketNo: savedTicketNo,
        roomName: savedRoom,
        status: 'in_progress',
        assignedTo: Number(techId) || 0,
        assignedToName: targetTechName,
        eventType: 'assigned'
      }
    );

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
  const savedAssignedTo = Number(selectedTicketForModal.assigned_to || 0);
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

    const isResolvedStatus = status === 'resolved' || status === 'closed';
    notifyNativeGeneric(
      isResolvedStatus ? `✅ Tiket Selesai: ${savedRoom}` : `🔄 Status Tiket: ${savedRoom}`,
      isResolvedStatus
        ? `${savedTicketNo} telah selesai dikerjakan oleh ${activeUser.name || 'Tim IT'}${notes ? ' • ' + notes : ''}`
        : `${savedTicketNo} status: ${status.toUpperCase()}`,
      {
        ticketId,
        ticketNo: savedTicketNo,
        roomName: savedRoom,
        status,
        assignedTo: savedAssignedTo,
        eventType: isResolvedStatus ? 'resolved' : 'status'
      }
    );

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
        <span class="font-mono font-bold text-xs text-sky-700">${esc(t.ticket_no)}</span>
        <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${t.priority === 'critical' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700'}">
          ${esc(t.priority)}
        </span>
      </div>
      <div>
        <h3 class="font-bold text-slate-800 text-sm">${esc(t.title)}</h3>
        <p class="text-xs text-slate-500 mt-1">${esc(t.description)}</p>
      </div>
      <div class="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
        <p><strong>🏥 Lokasi:</strong> ${esc(t.room_name)}</p>
        <p><strong>👤 Pelapor:</strong> ${esc(t.reporter_name)} (${esc(t.reporter_phone)})</p>
      </div>
      <div class="pt-2 flex flex-wrap gap-2">
        <button onclick="openTicketModal(${t.id})" class="flex-1 min-w-[130px] py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition">
          Perbarui Tindakan / Selesai
        </button>
        <button onclick="sendDirectWaByTicketId(${t.id}, 'done')" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-sm" title="Kirim WA Selesai">
          <i data-lucide="message-circle" class="w-4 h-4"></i>
          <span>WA Selesai</span>
        </button>
      </div>
    `;
    container.appendChild(card);
  });

  lucide.createIcons();
}

function sendDirectWaByTicketId(ticketId, type) {
  const t = (allTickets || []).find(item => item.id === ticketId) || selectedTicketForModal;
  if (!t) return;
  sendDirectWaFromCard(t.ticket_no, t.room_name, t.reporter_name, t.reporter_phone, t.title, type);
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

// Load Reports Charts (Real-Time from Memory with Smooth Update)
function loadReportsData() {
  updateSignersPreview();
  try {
    const start = document.getElementById('reportStartDate')?.value || '';
    const end = document.getElementById('reportEndDate')?.value || '';

    // Filter tickets based on date range
    let tickets = (allTickets || []).slice();
    if (start) {
      const sTime = new Date(start + 'T00:00:00').getTime();
      tickets = tickets.filter(t => new Date(t.created_at).getTime() >= sTime);
    }
    if (end) {
      const eTime = new Date(end + 'T23:59:59').getTime();
      tickets = tickets.filter(t => new Date(t.created_at).getTime() <= eTime);
    }

    // Category Counts
    const catMap = {};
    const roomMap = {};
    tickets.forEach(t => {
      const cat = t.category_name || 'SIMRS & IT';
      catMap[cat] = (catMap[cat] || 0) + 1;
      const room = (t.room_name || 'Ruangan').split('(')[0].trim();
      roomMap[room] = (roomMap[room] || 0) + 1;
    });

    const catLabels = Object.keys(catMap);
    const catCounts = Object.values(catMap);

    const sortedRooms = Object.entries(roomMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const roomLabels = sortedRooms.map(r => r[0]);
    const roomCounts = sortedRooms.map(r => r[1]);

    if (typeof Chart === 'undefined') return;

    // Category Doughnut Chart
    const canvasCat = document.getElementById('categoryChart');
    if (canvasCat) {
      const ctxCat = canvasCat.getContext('2d');
      if (categoryChartInstance) {
        categoryChartInstance.data.labels = catLabels.length > 0 ? catLabels : ['Belum Ada Data'];
        categoryChartInstance.data.datasets[0].data = catCounts.length > 0 ? catCounts : [0];
        categoryChartInstance.update('none');
      } else {
        categoryChartInstance = new Chart(ctxCat, {
          type: 'doughnut',
          data: {
            labels: catLabels.length > 0 ? catLabels : ['Belum Ada Data'],
            datasets: [{
              data: catCounts.length > 0 ? catCounts : [1],
              backgroundColor: ['#0284c7', '#0d9488', '#f59e0b', '#dc2626', '#8b5cf6', '#64748b']
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'bottom',
                labels: { boxWidth: 12, font: { size: 10 } }
              }
            }
          }
        });
      }
    }

    // Top Rooms Bar Chart
    const canvasRoom = document.getElementById('roomChart');
    if (canvasRoom) {
      const ctxRoom = canvasRoom.getContext('2d');
      if (roomChartInstance) {
        roomChartInstance.data.labels = roomLabels.length > 0 ? roomLabels : ['Belum Ada Data'];
        roomChartInstance.data.datasets[0].data = roomCounts.length > 0 ? roomCounts : [0];
        roomChartInstance.update('none');
      } else {
        roomChartInstance = new Chart(ctxRoom, {
          type: 'bar',
          data: {
            labels: roomLabels.length > 0 ? roomLabels : ['Belum Ada Data'],
            datasets: [{
              label: 'Jumlah Kendala',
              data: roomCounts.length > 0 ? roomCounts : [0],
              backgroundColor: '#0284c7',
              borderRadius: 6
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: { beginAtZero: true, ticks: { precision: 0 } }
            },
            plugins: { legend: { display: false } }
          }
        });
      }
    }
  } catch (err) {
    console.error('Failed to load reports charts:', err);
  }
}

// Generate Official Printable Report HTML Client-Side (Instant in 0ms, 100% reliable in APK)
function generateClientPrintHtml(startDate, endDate) {
  let tickets = (allTickets || []).slice();
  if (startDate) {
    const sTime = new Date(startDate + 'T00:00:00').getTime();
    tickets = tickets.filter(t => new Date(t.created_at).getTime() >= sTime);
  }
  if (endDate) {
    const eTime = new Date(endDate + 'T23:59:59').getTime();
    tickets = tickets.filter(t => new Date(t.created_at).getTime() <= eTime);
  }

  const totalCount = tickets.length;
  const resolvedCount = tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length;
  const inProgressCount = tickets.filter(t => t.status === 'in_progress').length;
  const openCount = tickets.filter(t => t.status === 'open' || t.status === 'assigned').length;

  const signers = getReportSigners();
  const todayStr = new Date().toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const rowsHtml = tickets.map((t, idx) => `
    <tr>
      <td style="text-align: center;">${idx + 1}</td>
      <td style="font-weight: bold; white-space: nowrap;">${esc(t.ticket_no)}</td>
      <td style="white-space: nowrap; text-align: center; font-size: 8pt;">${new Date(t.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })}</td>
      <td><strong>${esc(t.room_name)}</strong></td>
      <td>${esc(t.category_name)}</td>
      <td>${esc(t.reporter_name)}</td>
      <td style="text-align: center;">
        <span class="badge ${esc(t.priority || 'medium')}">${esc((t.priority || 'medium').toUpperCase())}</span>
      </td>
      <td><strong>${esc(t.title)}</strong><br><small style="color:#64748b;">${esc((t.description || '').substring(0, 80))}...</small></td>
      <td>${t.assigned_to_name ? esc(t.assigned_to_name) : '<em style="color:#94a3b8;">Belum Ditugaskan</em>'}</td>
      <td style="text-align: center;">
        <span class="status-badge ${esc(t.status)}">${esc(String(t.status || '').toUpperCase())}</span>
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Laporan Rekapitulasi E-Tiket IT RSUD Labuha</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; color: #111; margin: 0; padding: 12px; background: #fff; }
    
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
    <p>Jl. Trans Halmahera, Labuha, Kab. Halmahera Selatan, Maluku Utara | Telp: (0927) 21118</p>
  </div>

  <div class="report-title">
    <h3>LAPORAN REKAPITULASI PELAYANAN HELPDESK IT &amp; SIMRS</h3>
    <p>Periode: ${startDate || 'Semua Data'} s/d ${endDate || todayStr}</p>
  </div>

  <div class="kpi-container">
    <div class="kpi-card">
      <div class="kpi-num">${totalCount}</div>
      <div class="kpi-label">Total Tiket Masuk</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-num" style="color: #166534;">${resolvedCount}</div>
      <div class="kpi-label">Tiket Selesai</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-num" style="color: #2563eb;">${inProgressCount}</div>
      <div class="kpi-label">Sedang Dikerjakan</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-num" style="color: #dc2626;">${openCount}</div>
      <div class="kpi-label">Menunggu Tindakan</div>
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
      <p style="text-decoration: underline; font-weight: bold; margin-bottom: 2px;">${esc(signers.directorName)}</p>
      <p style="margin: 0; font-size: 10pt;">${esc(signers.directorNip)}</p>
    </div>

    <div class="sig-column">
      <p>Labuha, ${todayStr}<br><strong>Kepala Instalasi SIMRS &amp; IT</strong></p>
      <div class="sig-space"></div>
      <p style="text-decoration: underline; font-weight: bold; margin-bottom: 2px;">${esc(signers.headName)}</p>
      <p style="margin: 0; font-size: 10pt;">${esc(signers.headNip)}</p>
    </div>
  </div>
</body>
</html>`;
}

// Export Excel (.xlsx) directly client-side using ExcelJS (works 100% on Cloud & Offline)
async function exportExcel() {
  const start = document.getElementById('reportStartDate')?.value || '';
  const end = document.getElementById('reportEndDate')?.value || '';

  let tickets = (allTickets || []).slice();
  if (start) {
    const sTime = new Date(start + 'T00:00:00').getTime();
    tickets = tickets.filter(t => new Date(t.created_at).getTime() >= sTime);
  }
  if (end) {
    const eTime = new Date(end + 'T23:59:59').getTime();
    tickets = tickets.filter(t => new Date(t.created_at).getTime() <= eTime);
  }

  Swal.fire({ title: 'Menyiapkan File Excel...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

  try {
    await loadAppSettings();
    if (!window.ExcelJS && typeof window.ensureScriptLoaded === 'function') {
      await window.ensureScriptLoaded('/js/exceljs.min.js?v=4.2');
    }
    if (!window.ExcelJS) {
      throw new Error('Komponen pembuat Excel gagal dimuat');
    }

    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = 'SIM-ETIKET IT RSUD Labuha';
    const sheet = workbook.addWorksheet('Rekap E-Tiket IT');

    sheet.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Nomor Tiket', key: 'ticket_no', width: 20 },
      { header: 'Waktu Lapor', key: 'created_at', width: 20 },
      { header: 'Ruangan / Unit', key: 'room_name', width: 28 },
      { header: 'Kategori', key: 'category_name', width: 24 },
      { header: 'Prioritas', key: 'priority', width: 12 },
      { header: 'Pelapor', key: 'reporter_name', width: 22 },
      { header: 'No. WhatsApp', key: 'reporter_phone', width: 16 },
      { header: 'Keluhan', key: 'description', width: 40 },
      { header: 'Teknisi Bertugas', key: 'assigned_to_name', width: 22 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Catatan Penyelesaian', key: 'resolution_notes', width: 32 }
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 24;

    tickets.forEach((t, idx) => {
      sheet.addRow({
        no: idx + 1,
        ticket_no: t.ticket_no || '-',
        created_at: t.created_at ? new Date(t.created_at).toLocaleString('id-ID') : '-',
        room_name: t.room_name || '-',
        category_name: t.category_name || '-',
        priority: String(t.priority || 'medium').toUpperCase(),
        reporter_name: t.reporter_name || '-',
        reporter_phone: t.reporter_phone || '-',
        description: t.description || t.title || '-',
        assigned_to_name: t.assigned_to_name || 'Belum Ditugaskan',
        status: String(t.status || 'open').toUpperCase(),
        resolution_notes: t.resolution_notes || t.pending_reason || '-'
      });
    });

    const signers = getReportSigners();
    const todayStr = new Date().toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    sheet.addRow([]);
    const sigHeaderRow = sheet.addRow([]);
    sigHeaderRow.getCell(3).value = 'Mengetahui, Direktur RSUD Labuha';
    sigHeaderRow.getCell(10).value = `Labuha, ${todayStr} • Kepala Instalasi SIMRS & IT`;
    sigHeaderRow.getCell(3).font = { bold: true };
    sigHeaderRow.getCell(10).font = { bold: true };
    sheet.addRow([]);
    sheet.addRow([]);
    const sigNamesRow = sheet.addRow([]);
    sigNamesRow.getCell(3).value = signers.directorName;
    sigNamesRow.getCell(10).value = signers.headName;
    sigNamesRow.getCell(3).font = { bold: true, underline: true };
    sigNamesRow.getCell(10).font = { bold: true, underline: true };
    const sigNipsRow = sheet.addRow([]);
    sigNipsRow.getCell(3).value = signers.directorNip;
    sigNipsRow.getCell(10).value = signers.headNip;

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `Rekap-ETiket-RSUD-Labuha-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    if (window.Capacitor?.Plugins?.EtiketNative?.exportBase64File) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      }
      await window.Capacitor.Plugins.EtiketNative.exportBase64File({
        filename,
        mimeType,
        base64: btoa(binary)
      });
    } else {
      const blob = new Blob([buffer], { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    }

    Swal.fire({
      icon: 'success',
      title: 'File Excel Berhasil Dibuat!',
      text: `${tickets.length} tiket diekspor ke ${filename}.`,
      timer: 2200,
      showConfirmButton: false
    });
  } catch (err) {
    console.error('Export Excel error:', err);
    Swal.fire('Gagal Ekspor Excel', err.message || 'Terjadi kesalahan saat membuat file Excel.', 'error');
  }
}

// Print Official HTML / PDF (Refreshes latest signers then renders cleanly)
async function printOfficialReport() {
  const start = document.getElementById('reportStartDate')?.value || '';
  const end = document.getElementById('reportEndDate')?.value || '';

  const modal = document.getElementById('reportPrintModal');
  const frame = document.getElementById('reportPrintFrame');
  const loading = document.getElementById('reportPrintLoading');

  if (modal && frame) {
    modal.classList.remove('hidden');
    await loadAppSettings();
    const html = generateClientPrintHtml(start, end);
    frame.srcdoc = html;
    if (loading) loading.classList.add('hidden');
  } else {
    let url = '/api/reports/print-html';
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
}

function closeReportPrintModal() {
  const modal = document.getElementById('reportPrintModal');
  const frame = document.getElementById('reportPrintFrame');
  if (modal) modal.classList.add('hidden');
  if (frame) frame.srcdoc = '';
}

function printReportIframe() {
  const frame = document.getElementById('reportPrintFrame');
  if (window.Capacitor?.Plugins?.EtiketNative?.printHtml && frame && frame.srcdoc) {
    window.Capacitor.Plugins.EtiketNative.printHtml({
      title: 'Laporan Rekapitulasi E-Tiket IT RSUD Labuha',
      html: frame.srcdoc
    }).catch(err => {
      Swal.fire('Info Cetak', err.message || 'Gagal membuka dialog cetak Android', 'info');
    });
    return;
  }
  if (frame && frame.contentWindow) {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }
}

function getDefaultPublicOrigin() {
  const origin = window.location.origin || '';
  if (window.Capacitor && origin.includes('localhost')) {
    return 'https://etiket-rsud-labuha.etiket-itrsudlabuha.workers.dev';
  }
  return origin;
}

function getReportSigners() {
  const s = appSettings || {};
  const directorName = (s.director_name || '').trim() || 'dr. Surahman, Sp.PD';
  const directorNip = s.director_nip !== undefined ? String(s.director_nip).trim() : 'NIP. 19780512 200604 1 008';
  const headName = (s.head_simrs_name || '').trim() || 'Fahmi Mansur, S.Kom';
  const headNip = s.head_simrs_nip !== undefined ? String(s.head_simrs_nip).trim() : 'NIP. 19850914 201001 1 012';
  return { directorName, directorNip, headName, headNip };
}

function updateSignersPreview() {
  const signers = getReportSigners();
  const dirEl = document.getElementById('reportDirectorPreview');
  const dirNipEl = document.getElementById('reportDirectorNipPreview');
  const headEl = document.getElementById('reportHeadPreview');
  const headNipEl = document.getElementById('reportHeadNipPreview');
  if (dirEl) dirEl.textContent = signers.directorName;
  if (dirNipEl) dirNipEl.textContent = signers.directorNip || '-';
  if (headEl) headEl.textContent = signers.headName;
  if (headNipEl) headNipEl.textContent = signers.headNip || '-';

  const cfgDir = document.getElementById('cfg_director_name');
  const cfgDirNip = document.getElementById('cfg_director_nip');
  const cfgHead = document.getElementById('cfg_head_simrs_name');
  const cfgHeadNip = document.getElementById('cfg_head_simrs_nip');
  if (cfgDir) cfgDir.value = signers.directorName;
  if (cfgDirNip) cfgDirNip.value = signers.directorNip;
  if (cfgHead) cfgHead.value = signers.headName;
  if (cfgHeadNip) cfgHeadNip.value = signers.headNip;
}

async function loadAppSettings() {
  try {
    const res = await fetch('/api/settings');
    if (res && res.ok) {
      const cfg = await res.json();
      if (cfg && typeof cfg === 'object') {
        appSettings = cfg;
        updateSignersPreview();
      }
    }
  } catch (err) {
    console.debug('Load app settings warning:', err);
  }
  return appSettings;
}

async function saveSignersPayload(payload) {
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Gagal menyimpan data penandatangan');
  appSettings = Object.assign({}, appSettings || {}, payload);
  updateSignersPreview();
}

async function openEditSignersModal() {
  await loadAppSettings();
  const signers = getReportSigners();
  const result = await Swal.fire({
    title: 'Edit Pejabat Penandatangan Laporan',
    html: `
      <div class="text-left text-xs space-y-3 pt-1">
        <div class="p-3 bg-sky-50/70 rounded-xl border border-sky-200 space-y-2">
          <p class="font-bold text-sky-900">Direktur RSUD Labuha</p>
          <div>
            <label class="block font-semibold text-slate-700 mb-1">Nama Direktur &amp; Gelar</label>
            <input id="swalDirectorName" type="text" value="${esc(signers.directorName)}" class="w-full p-2.5 border border-slate-300 rounded-xl text-xs font-semibold text-slate-800">
          </div>
          <div>
            <label class="block font-semibold text-slate-700 mb-1">NIP Direktur</label>
            <input id="swalDirectorNip" type="text" value="${esc(signers.directorNip)}" class="w-full p-2.5 border border-slate-300 rounded-xl text-xs font-mono text-slate-700">
          </div>
        </div>
        <div class="p-3 bg-teal-50/70 rounded-xl border border-teal-200 space-y-2">
          <p class="font-bold text-teal-900">Kepala Instalasi SIMRS &amp; IT</p>
          <div>
            <label class="block font-semibold text-slate-700 mb-1">Nama Kepala Instalasi SIMRS &amp; IT</label>
            <input id="swalHeadName" type="text" value="${esc(signers.headName)}" class="w-full p-2.5 border border-slate-300 rounded-xl text-xs font-semibold text-slate-800">
          </div>
          <div>
            <label class="block font-semibold text-slate-700 mb-1">NIP Kepala Instalasi SIMRS &amp; IT</label>
            <input id="swalHeadNip" type="text" value="${esc(signers.headNip)}" class="w-full p-2.5 border border-slate-300 rounded-xl text-xs font-mono text-slate-700">
          </div>
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'Simpan Perubahan',
    cancelButtonText: 'Batal',
    confirmButtonColor: '#0284c7',
    preConfirm: () => {
      const director_name = (document.getElementById('swalDirectorName')?.value || '').trim();
      const director_nip = (document.getElementById('swalDirectorNip')?.value || '').trim();
      const head_simrs_name = (document.getElementById('swalHeadName')?.value || '').trim();
      const head_simrs_nip = (document.getElementById('swalHeadNip')?.value || '').trim();
      if (!director_name || !head_simrs_name) {
        Swal.showValidationMessage('Nama Direktur dan Kepala Instalasi SIMRS & IT wajib diisi');
        return false;
      }
      return { director_name, director_nip, head_simrs_name, head_simrs_nip };
    }
  });

  if (result.isConfirmed && result.value) {
    try {
      await saveSignersPayload(result.value);
      Swal.fire({
        icon: 'success',
        title: 'Penandatangan Diperbarui!',
        text: 'Nama Direktur & Kepala Instalasi SIMRS & IT tersimpan ke Supabase dan langsung sinkron ke Web & APK.',
        timer: 2200,
        showConfirmButton: false
      });
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    }
  }
}

async function saveSignersFromGateway() {
  const director_name = (document.getElementById('cfg_director_name')?.value || '').trim();
  const director_nip = (document.getElementById('cfg_director_nip')?.value || '').trim();
  const head_simrs_name = (document.getElementById('cfg_head_simrs_name')?.value || '').trim();
  const head_simrs_nip = (document.getElementById('cfg_head_simrs_nip')?.value || '').trim();

  if (!director_name || !head_simrs_name) {
    Swal.fire('Peringatan', 'Nama Direktur dan Kepala Instalasi SIMRS & IT tidak boleh kosong', 'warning');
    return;
  }

  try {
    await saveSignersPayload({ director_name, director_nip, head_simrs_name, head_simrs_nip });
    Swal.fire({
      icon: 'success',
      title: 'Nama Penandatangan Disimpan!',
      text: 'Perubahan langsung berlaku pada laporan cetak PDF & Excel di Web maupun APK.',
      timer: 2000,
      showConfirmButton: false
    });
  } catch (err) {
    Swal.fire('Error', err.message, 'error');
  }
}

// Load Gateway & Server Settings
async function loadGatewaySettings() {
  try {
    const res = await fetch('/api/settings');
    const cfg = await res.json();
    if (cfg && typeof cfg === 'object') {
      appSettings = cfg;
    }

    const serverUrlInput = document.getElementById('cfg_app_server_url');
    if (serverUrlInput) {
      const savedOrigin = (cfg.app_server_url || '').trim();
      serverUrlInput.value = (savedOrigin && !savedOrigin.includes('localhost') && !savedOrigin.includes('trycloudflare'))
        ? savedOrigin
        : getDefaultPublicOrigin();
    }

    updateSignersPreview();

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
    input.value = getDefaultPublicOrigin();
  }
}

// Save Gateway Settings
async function saveGatewaySettings() {
  const serverUrlInput = document.getElementById('cfg_app_server_url');
  const signers = getReportSigners();
  const payload = {
    app_server_url: serverUrlInput ? serverUrlInput.value.trim() : '',
    director_name: (document.getElementById('cfg_director_name')?.value || '').trim() || signers.directorName,
    director_nip: document.getElementById('cfg_director_nip') ? document.getElementById('cfg_director_nip').value.trim() : signers.directorNip,
    head_simrs_name: (document.getElementById('cfg_head_simrs_name')?.value || '').trim() || signers.headName,
    head_simrs_nip: document.getElementById('cfg_head_simrs_nip') ? document.getElementById('cfg_head_simrs_nip').value.trim() : signers.headNip,
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
    appSettings = Object.assign({}, appSettings || {}, payload);
    updateSignersPreview();

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

/**
 * Dispatcher notifikasi umum (Disposisi / Selesai / Perubahan Status) ke Android APK & Browser.
 */
async function notifyNativeGeneric(title, body, meta = {}) {
  const notifTitle = String(title || 'Update Tiket SIMRS & IT');
  const notifBody = String(body || 'Ada pembaruan status tiket.');
  const ticketId = Number(meta.ticketId || meta.id || (Date.now() % 100000));
  const assignedTo = Number(meta.assignedTo || 0);
  const status = String(meta.status || '');
  const eventType = String(
    meta.eventType ||
    (status === 'resolved' || status === 'closed' ? 'resolved' : (assignedTo > 0 ? 'assigned' : 'status'))
  );
  const offsetId = ticketId + (eventType === 'resolved' ? 20000 : eventType === 'assigned' ? 30000 : 40000);

  try {
    const cap = window.Capacitor;
    if (cap && cap.Plugins && cap.Plugins.EtiketNative) {
      if (typeof cap.Plugins.EtiketNative.notifyEventNow === 'function') {
        await cap.Plugins.EtiketNative.notifyEventNow({
          ticketId,
          id: ticketId,
          eventType,
          status,
          assignedTo,
          title: notifTitle,
          body: notifBody,
          highPriority: true
        });
        return;
      }
      if (typeof cap.Plugins.EtiketNative.notifyTicketNow === 'function') {
        await cap.Plugins.EtiketNative.notifyTicketNow({
          id: offsetId,
          ticketNo: meta.ticketNo || '',
          roomName: notifTitle,
          title: notifBody,
          reporterName: meta.assignedToName || 'Tim IT RSUD',
          priority: 'high'
        });
        return;
      }
    }

    if (cap && cap.Plugins && cap.Plugins.LocalNotifications) {
      await cap.Plugins.LocalNotifications.schedule({
        notifications: [{
          id: offsetId,
          title: notifTitle,
          body: notifBody,
          channelId: 'etiket_urgent_alerts_v2'
        }]
      });
      return;
    }
  } catch (e) {
    console.warn('Capacitor notifyEvent fallback:', e);
  }

  if (typeof Notification !== 'undefined') {
    const triggerBrowserNotif = () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(notifTitle, {
            body: notifBody,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            vibrate: [200, 100, 200],
            tag: `ticket-${eventType}-${ticketId}`,
            data: { url: '/index.html' }
          });
        }).catch(() => {
          try { new Notification(notifTitle, { body: notifBody, icon: '/icons/icon-192.png' }); } catch (e) { }
        });
      } else {
        try { new Notification(notifTitle, { body: notifBody, icon: '/icons/icon-192.png' }); } catch (e) { }
      }
    };

    if (Notification.permission === 'granted') {
      triggerBrowserNotif();
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') triggerBrowserNotif();
      }).catch(() => { });
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

    if (!logs || logs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="p-8 text-center text-slate-400 text-xs font-sans">
            Belum ada catatan log notifikasi tersimpan di Supabase.
          </td>
        </tr>
      `;
      return;
    }

    logs.forEach(l => {
      const tr = document.createElement('tr');
      tr.className = 'even:bg-slate-50/40 whitespace-nowrap hover:bg-sky-50/50 transition border-b border-slate-100';
      const badgeStatus = {
        sent: '<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">SENT</span>',
        simulated: '<span class="bg-sky-100 text-sky-700 px-2 py-0.5 rounded text-[10px] font-bold">LOGGED (CLOUD)</span>',
        failed: '<span class="bg-rose-100 text-rose-700 px-2 py-0.5 rounded text-[10px] font-bold">FAILED</span>'
      }[l.status] || `<span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[10px] font-bold">${esc(l.status)}</span>`;

      const timeStr = l.created_at
        ? new Date(l.created_at).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '-';
      const msgSnippet = l.message ? String(l.message).substring(0, 60) + (l.message.length > 60 ? '...' : '') : '-';

      tr.innerHTML = `
        <td class="px-3.5 py-3 text-slate-500 whitespace-nowrap align-middle">${esc(timeStr)}</td>
        <td class="px-3.5 py-3 font-bold uppercase text-slate-700 whitespace-nowrap align-middle">${esc(l.channel)}</td>
        <td class="px-3.5 py-3 font-semibold text-slate-800 whitespace-nowrap align-middle">${esc(l.recipient)}</td>
        <td class="px-3.5 py-3 text-slate-600 whitespace-nowrap align-middle">${esc(l.title || '-')}</td>
        <td class="px-3.5 py-3 max-w-xs truncate text-slate-500 align-middle" title="${esc(l.message || '')}">${esc(msgSnippet)}</td>
        <td class="px-3.5 py-3 whitespace-nowrap align-middle">${badgeStatus}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load logs:', err);
  }
}

// Bersihkan badge & drawer Netlify secara otomatis di web & APK
(() => {
  const purgeNetlify = () => {
    document.querySelectorAll('[id*="netlify"], [class*="netlify"], iframe[src*="netlify"], netlify-drawer').forEach(el => el.remove());
  };
  purgeNetlify();
  setInterval(purgeNetlify, 1500);
})();


