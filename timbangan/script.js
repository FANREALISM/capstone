/**
 * DigiScale POS — script.js
 * Features:
 *  - Product CRUD (add / edit / delete) persisted to localStorage
 *  - Dropdown auto-fills Harga per Kg from product catalogue
 *  - Real-time Berat Bersih & Total Harga calculation
 *  - Tambah ke Struk / Reset Timbangan / Kosongkan Struk
 *  - Per-item delete from receipt
 *  - Cetak Struk via window.print()
 *  - Live clock in topbar
 */

'use strict';

// ════════════════════════════════════════════════════════════
//  PRODUCT CATALOGUE  (localStorage-backed)
// ════════════════════════════════════════════════════════════

const STORAGE_KEY = 'digiscale_products';

/** Default product list (used only when localStorage is empty) */
const DEFAULT_PRODUCTS = [
  { id: 1,  name: 'Apel Fuji',          price: 32000  },
  { id: 2,  name: 'Apel Malang',         price: 18000  },
  { id: 3,  name: 'Jeruk Pontianak',     price: 22000  },
  { id: 4,  name: 'Jeruk Mandarin',      price: 28000  },
  { id: 5,  name: 'Anggur Hijau',        price: 55000  },
  { id: 6,  name: 'Mangga Harum Manis',  price: 20000  },
  { id: 7,  name: 'Daging Sapi',         price: 130000 },
  { id: 8,  name: 'Daging Ayam',         price: 38000  },
  { id: 9,  name: 'Ikan Salmon',         price: 120000 },
  { id: 10, name: 'Udang Segar',         price: 75000  },
];

let products = [];   // working array
let prodNextId = 1;  // auto-increment id

function loadProducts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      products = JSON.parse(raw);
      prodNextId = products.reduce(function (mx, p) { return Math.max(mx, p.id); }, 0) + 1;
    } else {
      products = DEFAULT_PRODUCTS.map(function (p) { return Object.assign({}, p); });
      prodNextId = products.length + 1;
      saveProducts();
    }
  } catch (e) {
    products = DEFAULT_PRODUCTS.map(function (p) { return Object.assign({}, p); });
    prodNextId = products.length + 1;
  }
}

function saveProducts() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(products)); } catch (e) {}
}

// ════════════════════════════════════════════════════════════
//  DOM REFS
// ════════════════════════════════════════════════════════════

// Scale panel
const itemSelect   = document.getElementById('itemSelect');
const grossInput   = document.getElementById('grossWeight');
const tareInput    = document.getElementById('tareWeight');
const priceInput   = document.getElementById('pricePerKg');
const netWeightBox = document.getElementById('netWeightBox');
const totalPriceEl = document.getElementById('totalPrice');
const lcdGross     = document.getElementById('lcdGross');
const lcdTare      = document.getElementById('lcdTare');
const lcdNet       = document.getElementById('lcdNet');

// Receipt panel
const receiptList    = document.getElementById('receiptList');
const receiptDivider = document.getElementById('receiptDivider');
const receiptFooter  = document.getElementById('receiptFooter');
const footerSubtotal = document.getElementById('footerSubtotal');
const footerCount    = document.getElementById('footerCount');
const footerTotal    = document.getElementById('footerTotal');

// Topbar
const liveClock = document.getElementById('liveClock');

// Modal
const modalOverlay   = document.getElementById('modalOverlay');
const modalList      = document.getElementById('modalList');
const mfNama         = document.getElementById('mfNama');
const mfHarga        = document.getElementById('mfHarga');
const editIdInput    = document.getElementById('editId');
const btnSave        = document.getElementById('btnSave');
const btnCancelEdit  = document.getElementById('btnCancelEdit');

// ════════════════════════════════════════════════════════════
//  RECEIPT STATE
// ════════════════════════════════════════════════════════════

let receiptItems = [];
let nextReceiptId = 1;

// ════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════

function formatRp(value) {
  return 'Rp ' + Math.round(value).toLocaleString('id-ID');
}

function toKg(gram) {
  return (parseFloat(gram) || 0) / 1000;
}

function setLcd(el, gram) {
  el.innerHTML = toKg(gram).toFixed(3) + ' <span class="lcd-unit">kg</span>';
}

function triggerFlash(el) {
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ════════════════════════════════════════════════════════════
//  LIVE CLOCK
// ════════════════════════════════════════════════════════════

function updateClock() {
  var now = new Date();
  var pad = function (n) { return String(n).padStart(2, '0'); };
  liveClock.textContent =
    pad(now.getDate()) + '/' + pad(now.getMonth() + 1) + '/' + now.getFullYear() +
    '  ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
}
updateClock();
setInterval(updateClock, 1000);

// ════════════════════════════════════════════════════════════
//  DROPDOWN  (rebuild from products array)
// ════════════════════════════════════════════════════════════

function rebuildDropdown() {
  var selected = itemSelect.value;
  itemSelect.innerHTML = '<option value="">— Pilih Barang —</option>';
  products.forEach(function (p) {
    var opt = document.createElement('option');
    opt.value          = p.name;
    opt.dataset.price  = p.price;
    opt.dataset.prodId = p.id;
    opt.textContent    = p.name;
    if (p.name === selected) opt.selected = true;
    itemSelect.appendChild(opt);
  });
}

itemSelect.addEventListener('change', function () {
  var opt = this.options[this.selectedIndex];
  priceInput.value = opt.dataset.price || '';
  recalculate();
});

// ════════════════════════════════════════════════════════════
//  REAL-TIME RECALCULATION
// ════════════════════════════════════════════════════════════

function recalculate() {
  var grossG = parseFloat(grossInput.value) || 0;
  var tareG  = parseFloat(tareInput.value)  || 0;
  var netG   = Math.max(0, grossG - tareG);
  var price  = parseFloat(priceInput.value) || 0;
  var total  = toKg(netG) * price;

  setLcd(lcdGross, grossG);
  setLcd(lcdTare,  tareG);
  setLcd(lcdNet,   netG);

  netWeightBox.textContent = netG.toLocaleString('id-ID') + ' gram';

  var prev = totalPriceEl.textContent;
  var next = formatRp(total);
  totalPriceEl.textContent = next;
  if (prev !== next) triggerFlash(totalPriceEl);
}

grossInput.addEventListener('input', recalculate);
tareInput.addEventListener('input',  recalculate);
priceInput.addEventListener('input', recalculate);

// ════════════════════════════════════════════════════════════
//  TAMBAH KE STRUK
// ════════════════════════════════════════════════════════════

function tambahKeStruk() {
  var name   = itemSelect.value;
  var grossG = parseFloat(grossInput.value) || 0;
  var tareG  = parseFloat(tareInput.value)  || 0;
  var netG   = Math.max(0, grossG - tareG);
  var price  = parseFloat(priceInput.value) || 0;

  if (!name)       { alert('Pilih barang terlebih dahulu.');                        itemSelect.focus(); return; }
  if (grossG <= 0) { alert('Masukkan berat kotor yang valid (lebih dari 0 gram).'); grossInput.focus(); return; }
  if (price  <= 0) { alert('Masukkan harga per kg yang valid.');                    priceInput.focus(); return; }
  if (netG   <= 0) { alert('Berat bersih tidak boleh 0 atau negatif. Periksa berat tare.'); return; }

  receiptItems.push({
    id: nextReceiptId++,
    name: name,
    grossG: grossG,
    tareG:  tareG,
    netG:   netG,
    pricePerKg: price,
    total: toKg(netG) * price
  });

  renderReceipt();
  resetTimbangan();
}

// ════════════════════════════════════════════════════════════
//  RECEIPT RENDER
// ════════════════════════════════════════════════════════════

function renderReceipt() {
  receiptList.innerHTML = '';

  if (receiptItems.length === 0) {
    receiptList.innerHTML = '<div class="receipt-empty">Belum ada barang ditambahkan.</div>';
    receiptDivider.style.display = 'none';
    receiptFooter.style.display  = 'none';
    return;
  }

  receiptItems.forEach(function (item) {
    var div = document.createElement('div');
    div.className  = 'receipt-item';
    div.dataset.id = item.id;
    div.innerHTML =
      '<span class="ri-name">' + escHtml(item.name) + '</span>' +
      '<span class="ri-price">' + formatRp(item.total) + '</span>' +
      '<span class="ri-detail">' +
        item.netG.toLocaleString('id-ID') + ' g' +
        ' &times; ' + formatRp(item.pricePerKg) + '/kg' +
        (item.tareG > 0 ? ' (tare ' + item.tareG + ' g)' : '') +
      '</span>' +
      '<button class="ri-delete" title="Hapus" onclick="hapusItemStruk(' + item.id + ')">✕</button>';
    receiptList.appendChild(div);
  });

  var subtotal = receiptItems.reduce(function (s, i) { return s + i.total; }, 0);
  footerSubtotal.textContent = formatRp(subtotal);
  footerCount.textContent    = receiptItems.length + ' pcs';
  footerTotal.textContent    = formatRp(subtotal);

  receiptDivider.style.display = 'block';
  receiptFooter.style.display  = 'block';
}

function hapusItemStruk(id) {
  receiptItems = receiptItems.filter(function (i) { return i.id !== id; });
  renderReceipt();
}

// ════════════════════════════════════════════════════════════
//  RESET / CLEAR
// ════════════════════════════════════════════════════════════

function resetTimbangan() {
  itemSelect.selectedIndex  = 0;
  grossInput.value  = '';
  tareInput.value   = '';
  priceInput.value  = '';
  netWeightBox.textContent = '0 gram';
  totalPriceEl.textContent = 'Rp 0';
  totalPriceEl.classList.remove('flash');
  setLcd(lcdGross, 0);
  setLcd(lcdTare,  0);
  setLcd(lcdNet,   0);
  grossInput.focus();
}

function kosongkanStruk() {
  if (receiptItems.length === 0) return;
  if (!confirm('Kosongkan seluruh struk?')) return;
  receiptItems = [];
  renderReceipt();
}

function printStruk() {
  if (receiptItems.length === 0) { alert('Struk masih kosong.'); return; }
  window.print();
}

// ════════════════════════════════════════════════════════════
//  PRODUCT MANAGER MODAL
// ════════════════════════════════════════════════════════════

function bukaManagerBarang() {
  batalEdit();           // clear form first
  renderModalList();
  modalOverlay.classList.add('open');
  mfNama.focus();
}

function tutupManagerBarang() {
  modalOverlay.classList.remove('open');
  batalEdit();
}

function tutupModalJikaOverlay(event) {
  if (event.target === modalOverlay) tutupManagerBarang();
}

/** Render the product list inside the modal */
function renderModalList() {
  modalList.innerHTML = '';

  if (products.length === 0) {
    modalList.innerHTML = '<div class="modal-empty">Belum ada barang. Tambahkan di atas.</div>';
    return;
  }

  var editingId = parseInt(editIdInput.value) || null;

  products.forEach(function (p) {
    var isEditing = (p.id === editingId);
    var row = document.createElement('div');
    row.className = 'modal-item' + (isEditing ? ' is-editing' : '');
    row.dataset.id = p.id;
    row.innerHTML =
      '<span class="mi-name">' + escHtml(p.name) + '</span>' +
      '<span class="mi-price">' + formatRp(p.price) + '/kg</span>' +
      '<span class="mi-actions">' +
        '<button class="mi-btn edit" onclick="mulaiEditBarang(' + p.id + ')" title="Edit">✏ Edit</button>' +
        '<button class="mi-btn del"  onclick="hapusBarang(' + p.id + ')"       title="Hapus">🗑 Hapus</button>' +
      '</span>';
    modalList.appendChild(row);
  });
}

/** Populate form for editing */
function mulaiEditBarang(id) {
  var prod = products.find(function (p) { return p.id === id; });
  if (!prod) return;

  editIdInput.value  = prod.id;
  mfNama.value       = prod.name;
  mfHarga.value      = prod.price;

  btnSave.textContent        = '💾 Simpan Perubahan';
  btnCancelEdit.style.display = 'inline-flex';

  renderModalList();   // re-render to highlight edited row
  mfNama.focus();
  mfNama.select();
}

/** Cancel edit mode, back to add mode */
function batalEdit() {
  editIdInput.value  = '';
  mfNama.value       = '';
  mfHarga.value      = '';
  btnSave.textContent          = '💾 Simpan';
  btnCancelEdit.style.display  = 'none';
  renderModalList();
}

/** Add new or update existing product */
function simpanBarang() {
  var nama  = mfNama.value.trim();
  var harga = parseFloat(mfHarga.value);
  var editId = parseInt(editIdInput.value) || null;

  if (!nama)           { alert('Nama barang tidak boleh kosong.'); mfNama.focus();  return; }
  if (isNaN(harga) || harga <= 0) { alert('Harga harus lebih dari 0.'); mfHarga.focus(); return; }

  if (editId) {
    // ── UPDATE ──
    var idx = products.findIndex(function (p) { return p.id === editId; });
    if (idx === -1) return;

    // Check duplicate name (exclude self)
    var dup = products.find(function (p) {
      return p.name.toLowerCase() === nama.toLowerCase() && p.id !== editId;
    });
    if (dup) { alert('Nama "' + nama + '" sudah ada di daftar.'); mfNama.focus(); return; }

    products[idx].name  = nama;
    products[idx].price = harga;

  } else {
    // ── ADD ──
    var dup2 = products.find(function (p) {
      return p.name.toLowerCase() === nama.toLowerCase();
    });
    if (dup2) { alert('Barang "' + nama + '" sudah ada di daftar.'); mfNama.focus(); return; }

    products.push({ id: prodNextId++, name: nama, price: harga });
  }

  saveProducts();
  rebuildDropdown();
  batalEdit();          // clears form, re-renders list, resets button label
}

/** Delete a product */
function hapusBarang(id) {
  var prod = products.find(function (p) { return p.id === id; });
  if (!prod) return;
  if (!confirm('Hapus "' + prod.name + '" dari daftar barang?')) return;

  products = products.filter(function (p) { return p.id !== id; });
  saveProducts();
  rebuildDropdown();

  // If currently being edited, cancel edit
  if (parseInt(editIdInput.value) === id) batalEdit();
  else renderModalList();
}

// ════════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ════════════════════════════════════════════════════════════

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    if (modalOverlay.classList.contains('open')) {
      tutupManagerBarang();
    } else {
      resetTimbangan();
    }
  }
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    tambahKeStruk();
  }
});

// ════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════

loadProducts();
rebuildDropdown();
recalculate();
