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

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadRooms(), loadCategories()]);
  checkUrlParams();
  loadSavedIdentity();
  setupForm();
  if (window.lucide) window.lucide.createIcons();
});

function loadSavedIdentity() {
  const savedName = localStorage.getItem('reporter_name');
  const savedPhone = localStorage.getItem('reporter_phone');
  const savedEmail = localStorage.getItem('reporter_email');
  if (savedName) document.getElementById('reporter_name').value = savedName;
  if (savedPhone) document.getElementById('reporter_phone').value = savedPhone;
  if (savedEmail) document.getElementById('reporter_email').value = savedEmail;
}

async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    if (!res.ok) throw new Error('Gagal memuat kategori');
    categoriesData = await res.json();

    const select = document.getElementById('category_id');
    if (!select) return;

    select.innerHTML = '<option value="">-- Pilih Jenis Masalah / Kategori --</option>';
    (categoriesData || []).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load categories:', err);
  }
}

async function loadRooms() {
  try {
    const res = await fetch('/api/rooms');
    if (!res.ok) throw new Error('Gagal memuat ruangan');
    roomsData = await res.json();

    const select = document.getElementById('room_id');
    if (!select) return;

    const grouped = {};
    (roomsData || []).forEach(r => {
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

function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get('room');
  const roomId = params.get('id');

  if (roomId || roomCode) {
    let matched = null;
    if (roomId) {
      matched = roomsData.find(r => r.id == roomId);
    } else if (roomCode) {
      matched = roomsData.find(r => r.code && r.code.toUpperCase() === roomCode.toUpperCase());
    }

    if (matched) {
      const select = document.getElementById('room_id');
      select.value = matched.id;

      const badge = document.getElementById('qrDetectedBadge');
      const roomNameEl = document.getElementById('qrRoomName');
      roomNameEl.textContent = `${matched.name} [${matched.code}]`;
      badge.classList.remove('hidden');

      const selectContainer = document.getElementById('roomSelectContainer');
      if (selectContainer) selectContainer.classList.add('hidden');
    }
  }
}

function resetRoomSelection() {
  const badge = document.getElementById('qrDetectedBadge');
  const select = document.getElementById('room_id');
  const selectContainer = document.getElementById('roomSelectContainer');
  if (badge) badge.classList.add('hidden');
  if (select) select.value = '';
  if (selectContainer) selectContainer.classList.remove('hidden');
}

function clearPhotoSelection() {
  const input = document.getElementById('photoInput');
  const previewImg = document.getElementById('imagePreview');
  const placeholder = document.getElementById('uploadPlaceholder');
  const container = document.getElementById('imagePreviewContainer');
  if (input) input.value = '';
  if (previewImg) previewImg.src = '';
  if (placeholder) placeholder.classList.remove('hidden');
  if (container) container.classList.add('hidden');
}

async function previewImage(input) {
  if (!input || !input.files || !input.files[0]) return;
  const file = input.files[0];

  try {
    let previewUrl = null;
    if (typeof window.compressImageFile === 'function') {
      previewUrl = await window.compressImageFile(file, { maxDim: 1024, quality: 0.72 });
    } else {
      previewUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = e => resolve(e.target.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
    }

    if (!previewUrl) throw new Error('Gagal membaca foto');
    document.getElementById('imagePreview').src = previewUrl;
    document.getElementById('uploadPlaceholder').classList.add('hidden');
    document.getElementById('imagePreviewContainer').classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    clearPhotoSelection();
    Swal.fire({
      icon: 'warning',
      title: 'Format Foto Tidak Didukung',
      text: err.message || 'Silakan pilih file foto/gambar lain (JPG/PNG).',
      confirmButtonColor: '#0284c7'
    });
  }
}

function setupForm() {
  const form = document.getElementById('reportForm');
  const btn = document.getElementById('btnSubmit');
  if (!form || !btn) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const roomVal = document.getElementById('room_id').value;
    const catVal = document.getElementById('category_id').value;
    const descVal = (document.getElementById('description').value || '').trim();
    const nameVal = (document.getElementById('reporter_name').value || '').trim();
    const phone = (document.getElementById('reporter_phone').value || '').trim();
    const emailVal = (document.getElementById('reporter_email').value || '').trim();

    if (!roomVal) {
      Swal.fire({ icon: 'warning', title: 'Ruangan Belum Dipilih', text: 'Silakan pilih ruangan tempat kendala terjadi.', confirmButtonColor: '#0284c7' });
      return;
    }
    if (!catVal) {
      Swal.fire({ icon: 'warning', title: 'Kategori Belum Dipilih', text: 'Silakan pilih jenis kendala IT.', confirmButtonColor: '#0284c7' });
      return;
    }
    if (!descVal) {
      Swal.fire({ icon: 'warning', title: 'Rincian Kendala Kosong', text: 'Tuliskan keluhan/kerusakan secara singkat dan jelas.', confirmButtonColor: '#0284c7' });
      return;
    }
    if (phone.length < 9) {
      Swal.fire({
        icon: 'warning',
        title: 'Nomor WhatsApp Tidak Valid',
        text: 'Mohon masukkan nomor WhatsApp yang aktif untuk menerima update tiket.',
        confirmButtonColor: '#0284c7'
      });
      return;
    }

    const selectedPriority = (form.querySelector('input[name="priority"]:checked')?.value || 'medium').trim();
    const derivedTitle = descVal.length > 75 ? descVal.substring(0, 75) + '...' : descVal;

    const formData = new FormData(form);
    formData.set('room_id', roomVal);
    formData.set('category_id', catVal);
    formData.set('priority', selectedPriority);
    formData.set('title', derivedTitle);
    formData.set('description', descVal);
    formData.set('reporter_name', nameVal);
    formData.set('reporter_phone', phone);
    if (emailVal) formData.set('reporter_email', emailVal);

    btn.disabled = true;
    btn.innerHTML = `<span class="inline-block animate-spin mr-2">🔄</span> Mengirim Laporan...`;

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok || !data || !data.ticket) {
        throw new Error((data && data.error) || 'Gagal menyimpan laporan ke server');
      }

      const ticket = data.ticket;
      const esc = typeof window.escapeHtml === 'function' ? window.escapeHtml : (v => String(v || ''));

      localStorage.setItem('reporter_name', nameVal);
      localStorage.setItem('reporter_phone', phone);
      if (emailVal) localStorage.setItem('reporter_email', emailVal);

      Swal.fire({
        icon: 'success',
        title: 'Laporan Berhasil Terkirim!',
        html: `
          <div class="text-left bg-slate-50 p-4 rounded-xl border border-slate-200 mt-2 space-y-2 text-sm">
            <div class="flex justify-between items-center pb-2 border-b">
              <span class="text-xs text-slate-500 font-semibold uppercase">Nomor Tiket:</span>
              <span class="font-bold text-sky-700 text-base font-mono">${esc(ticket.ticket_no)}</span>
            </div>
            <div>
              <span class="text-xs text-slate-500">Ruangan:</span>
              <p class="font-semibold text-slate-800">${esc(ticket.room_name)}</p>
            </div>
            <div>
              <span class="text-xs text-slate-500">Keluhan:</span>
              <p class="text-slate-700">${esc(ticket.title)}</p>
            </div>
          </div>
          <p class="text-xs text-slate-500 mt-4 leading-relaxed">
            Laporan Anda sudah tercatat di sistem helpdesk &amp; Supabase. Simpan atau catat nomor tiket untuk melacak progres penanganan.
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
          clearPhotoSelection();
          resetRoomSelection();
          checkUrlParams();
          loadSavedIdentity();
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
