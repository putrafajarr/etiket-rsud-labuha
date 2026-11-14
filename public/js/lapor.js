let roomsData = [];
let categoriesData = [];
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
      title: '📲 Pasang Aplikasi di HP Android',
      html: `
        <div class="text-left text-xs space-y-2.5 p-3 bg-slate-50 rounded-xl border border-slate-200">
          <p><b>1.</b> Buka tautan ini di browser <b>Google Chrome</b> di HP Anda.</p>
          <p><b>2.</b> Ketuk tanda titik tiga (<b>⋮</b>) di pojok kanan atas browser.</p>
          <p><b>3.</b> Pilih menu <b>"Instal aplikasi"</b> atau <b>"Tambahkan ke Layar Utama"</b>.</p>
          <p class="text-emerald-700 font-bold">✓ Ikon aplikasi akan langsung muncul di menu HP Anda!</p>
        </div>
      `,
      confirmButtonText: 'Mengerti',
      confirmButtonColor: '#0284c7'
    });
  }
}

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadRooms(), loadCategories()]);
  checkUrlParams();
  loadSavedIdentity();
  setupForm();
  if (window.lucide) window.lucide.createIcons();
});

// Load remembered reporter identity from localStorage
function loadSavedIdentity() {
  const savedName = localStorage.getItem('reporter_name');
  const savedPhone = localStorage.getItem('reporter_phone');
  const savedEmail = localStorage.getItem('reporter_email');
  if (savedName) document.getElementById('reporter_name').value = savedName;
  if (savedPhone) document.getElementById('reporter_phone').value = savedPhone;
  if (savedEmail) document.getElementById('reporter_email').value = savedEmail;
}

// Load categories dynamically from backend / Supabase
async function loadCategories() {
  try {
    let res;
    try {
      res = await fetch('/api/categories');
    } catch (netErr) {
      // Backend offline, direct Supabase REST
      res = await fetch('https://kwjmzugilxbuqlrgangt.supabase.co/rest/v1/categories?select=*&is_active=neq.0&order=id.asc', {
        headers: {
          'apikey': 'sb_publishable_XafHR40fyOY_VKGKLn-paA_QDa_2xb6',
          'Authorization': 'Bearer sb_publishable_XafHR40fyOY_VKGKLn-paA_QDa_2xb6'
        }
      });
    }

    if (!res || !res.ok) {
      res = await fetch('https://kwjmzugilxbuqlrgangt.supabase.co/rest/v1/categories?select=*&is_active=neq.0&order=id.asc', {
        headers: {
          'apikey': 'sb_publishable_XafHR40fyOY_VKGKLn-paA_QDa_2xb6',
          'Authorization': 'Bearer sb_publishable_XafHR40fyOY_VKGKLn-paA_QDa_2xb6'
        }
      });
    }

    categoriesData = await res.json();
    const select = document.getElementById('category_id');
    if (!select) return;

    select.innerHTML = '<option value="">-- Pilih Jenis Masalah / Kategori --</option>';
    categoriesData.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load categories:', err);
  }
}

// Load rooms from backend with resilient Supabase Cloud fallback
async function loadRooms() {
  try {
    let res;
    try {
      res = await fetch('/api/rooms');
    } catch (netErr) {
      // Backend offline, fallback to direct Supabase REST
      res = await fetch('https://kwjmzugilxbuqlrgangt.supabase.co/rest/v1/rooms?select=*&is_active=neq.0&order=name.asc', {
        headers: {
          'apikey': 'sb_publishable_XafHR40fyOY_VKGKLn-paA_QDa_2xb6',
          'Authorization': 'Bearer sb_publishable_XafHR40fyOY_VKGKLn-paA_QDa_2xb6'
        }
      });
    }

    if (!res || !res.ok) {
      res = await fetch('https://kwjmzugilxbuqlrgangt.supabase.co/rest/v1/rooms?select=*&is_active=neq.0&order=name.asc', {
        headers: {
          'apikey': 'sb_publishable_XafHR40fyOY_VKGKLn-paA_QDa_2xb6',
          'Authorization': 'Bearer sb_publishable_XafHR40fyOY_VKGKLn-paA_QDa_2xb6'
        }
      });
    }

    roomsData = await res.json();
    const select = document.getElementById('room_id');
    if (!select) return;
    
    // Group rooms by building
    const grouped = {};
    roomsData.forEach(r => {
      const b = r.building || 'Lainnya';
      if (!grouped[b]) grouped[b] = [];
      grouped[b].push(r);
    });

    select.innerHTML = '<option value="">-- Pilih Ruangan Anda --</option>';
    for (const [building, rooms] of Object.entries(grouped)) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = `📍 ${building}`;
      rooms.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = `${r.name} (${r.code})`;
        opt.dataset.code = r.code;
        optgroup.appendChild(opt);
      });
      select.appendChild(optgroup);
    }
  } catch (err) {
    console.error('Failed to load rooms:', err);
  }
}

// Check if user came from a QR code scan with query params: ?room=IGD-01 or ?id=1
function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get('room');
  const roomId = params.get('id');

  if (roomId || roomCode) {
    let matched = null;
    if (roomId) {
      matched = roomsData.find(r => r.id == roomId);
    } else if (roomCode) {
      matched = roomsData.find(r => r.code.toUpperCase() === roomCode.toUpperCase());
    }

    if (matched) {
      const select = document.getElementById('room_id');
      select.value = matched.id;
      
      const badge = document.getElementById('qrDetectedBadge');
      const roomNameEl = document.getElementById('qrRoomName');
      roomNameEl.textContent = `${matched.name} [${matched.code}]`;
      badge.classList.remove('hidden');

      // KUNCI RUANGAN: Sembunyikan pilihan dropdown agar staf tidak bisa ganti-ganti unit
      const selectContainer = document.getElementById('roomSelectContainer');
      if (selectContainer) selectContainer.classList.add('hidden');
    }
  }
}

function resetRoomSelection() {
  document.getElementById('qrDetectedBadge').classList.add('hidden');
  document.getElementById('room_id').value = '';
}

// Preview image selected by user
function previewImage(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('imagePreview').src = e.target.result;
      document.getElementById('uploadPlaceholder').classList.add('hidden');
      document.getElementById('imagePreviewContainer').classList.remove('hidden');
    };
    reader.readAsDataURL(input.files[0]);
  }
}

// Setup form submit handler
function setupForm() {
  const form = document.getElementById('reportForm');
  const btn = document.getElementById('btnSubmit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Basic validation
    const phone = document.getElementById('reporter_phone').value.trim();
    if (phone.length < 9) {
      Swal.fire({
        icon: 'warning',
        title: 'Nomor WhatsApp Tidak Valid',
        text: 'Mohon masukkan nomor WhatsApp yang aktif untuk menerima update tiket.',
        confirmButtonColor: '#0284c7'
      });
      return;
    }

    const formData = new FormData(form);

    btn.disabled = true;
    btn.innerHTML = `<span class="inline-block animate-spin mr-2">🔄</span> Mengirim Laporan...`;

    try {
      let data = null;
      try {
        const res = await fetch('/api/tickets', {
          method: 'POST',
          body: formData
        });
        if (res.ok) {
          data = await res.json();
        }
      } catch (netErr) {
        // Backend offline / static Cloudflare hosting
      }

      // Direct Supabase Fallback jika backend Node.js tidak tersedia
      if (!data || !data.ticket) {
        const roomId = parseInt(document.getElementById('room_id').value);
        const catId = parseInt(document.getElementById('category_id').value);
        const matchedRoom = roomsData.find(r => r.id === roomId);
        const matchedCat = categoriesData.find(c => c.id === catId);
        const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        const generatedTicketNo = `TKT-${todayStr}-${randomNum}`;

        const payload = {
          ticket_no: generatedTicketNo,
          room_id: roomId,
          room_name: matchedRoom ? matchedRoom.name : `Ruangan ${roomId}`,
          category_id: catId,
          category_name: matchedCat ? matchedCat.name : 'Umum',
          reporter_name: document.getElementById('reporter_name').value.trim(),
          reporter_phone: phone,
          reporter_email: document.getElementById('reporter_email').value.trim() || null,
          title: document.getElementById('title').value.trim(),
          description: document.getElementById('description').value.trim(),
          priority: matchedCat && matchedCat.default_priority ? matchedCat.default_priority : 'medium',
          status: 'open',
          channel: 'web_qr'
        };

        const supaRes = await fetch('https://kwjmzugilxbuqlrgangt.supabase.co/rest/v1/tickets', {
          method: 'POST',
          headers: {
            'apikey': 'sb_publishable_XafHR40fyOY_VKGKLn-paA_QDa_2xb6',
            'Authorization': 'Bearer sb_publishable_XafHR40fyOY_VKGKLn-paA_QDa_2xb6',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(payload)
        });

        if (!supaRes.ok) {
          const errText = await supaRes.text();
          throw new Error('Gagal menyimpan laporan ke server: ' + errText);
        }

        const inserted = await supaRes.json();
        data = { ticket: (Array.isArray(inserted) && inserted.length > 0) ? inserted[0] : payload };
      }

      const ticket = data.ticket;

      // Save identity for effortless future reporting
      localStorage.setItem('reporter_name', document.getElementById('reporter_name').value);
      localStorage.setItem('reporter_phone', phone);
      const emailVal = document.getElementById('reporter_email').value;
      if (emailVal) localStorage.setItem('reporter_email', emailVal);

      // Success modal
      Swal.fire({
        icon: 'success',
        title: 'Laporan Berhasil Terkirim!',
        html: `
          <div class="text-left bg-slate-50 p-4 rounded-xl border border-slate-200 mt-2 space-y-2 text-sm">
            <div class="flex justify-between items-center pb-2 border-b">
              <span class="text-xs text-slate-500 font-semibold uppercase">Nomor Tiket:</span>
              <span class="font-bold text-sky-700 text-base font-mono">${ticket.ticket_no}</span>
            </div>
            <div>
              <span class="text-xs text-slate-500">Ruangan:</span>
              <p class="font-semibold text-slate-800">${ticket.room_name}</p>
            </div>
            <div>
              <span class="text-xs text-slate-500">Keluhan:</span>
              <p class="text-slate-700">${ticket.title}</p>
            </div>
          </div>
          <p class="text-xs text-slate-500 mt-4 leading-relaxed">
            Notifikasi konfirmasi telah dikirimkan ke WhatsApp Anda. Tim Helpdesk IT RSUD Labuha segera memproses penanganan.
          </p>
        `,
        confirmButtonText: 'Lacak Progres Tiket',
        showCancelButton: true,
        cancelButtonText: 'Buat Laporan Baru',
        confirmButtonColor: '#0284c7',
        cancelButtonColor: '#64748b'
      }).then((result) => {
        if (result.isConfirmed) {
          window.location.href = `/track.html?ticket=${encodeURIComponent(ticket.ticket_no)}`;
        } else {
          form.reset();
          document.getElementById('uploadPlaceholder').classList.remove('hidden');
          document.getElementById('imagePreviewContainer').classList.add('hidden');
          checkUrlParams();
        }
      });

    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Terjadi Kesalahan',
        text: err.message,
        confirmButtonColor: '#0284c7'
      });
    } finally {
      btn.disabled = false;
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
        <span>KIRIM LAPORAN SEKARANG</span>
      `;
    }
  });
}

// Bersihkan badge Netlify secara otomatis jika terinjeksi
(() => {
  const purgeNetlify = () => {
    document.querySelectorAll('[id*="netlify"], [class*="netlify"], iframe[src*="netlify"], netlify-drawer').forEach(el => el.remove());
  };
  purgeNetlify();
  setInterval(purgeNetlify, 1500);
})();

