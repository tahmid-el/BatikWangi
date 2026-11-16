'use strict';

/* ============================== Utilities ============================== */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const ROLE_LABEL = { admin: 'Admin', seller: 'Seller', buyer: 'Pembeli' };
const ROLE_BADGE = {
  admin: 'bg-rose-100 text-rose-700 border-rose-200',
  seller: 'bg-amber-100 text-amber-800 border-amber-200',
  buyer: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};
const PLACEHOLDER_IMG = '/img/gajah-oling.svg';
const WHATSAPP_RE = /^628\d{8,11}$/;

const state = {
  me: null,
  categories: [],
  products: [],
  seller: { products: [], stats: null },
  admin: { users: [], stats: null },
  currentView: 'catalog',
  sellerSearch: '',
  adminFilters: { search: '', role: '' },
  detail: null,
  qty: 1,
  cart: [],
  confirmResolve: null,
  catalogLoading: false,
  imageObjectUrl: null,
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rupiah(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

async function api(path, { method = 'GET', body, formData } = {}) {
  const options = { method, credentials: 'same-origin', headers: {} };
  if (formData) {
    options.body = formData;
  } else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(path, options);
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    if (response.status === 401) {
      state.me = null;
      renderHeader();
    }
    throw new Error((data && data.error) || 'Terjadi kesalahan. Coba lagi.');
  }
  return data;
}

function toast(message, type = 'success', options = {}) {
  const { detail = '', duration = 3200 } = options;
  const container = $('#toast-container');
  const node = document.createElement('div');
  const palette =
    type === 'error'
      ? 'bg-rose-900 text-rose-50 border-rose-500/40'
      : 'bg-soga-950 text-amber-300 border-amber-500/40';
  node.className = `pointer-events-auto px-4 py-3 rounded-xl border shadow-xl text-xs sm:text-sm font-medium flex items-start gap-2.5 max-w-xs sm:max-w-sm transition-all duration-300 translate-y-2 opacity-0 ${palette}`;
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  node.innerHTML = `<i data-lucide="${type === 'error' ? 'alert-circle' : 'check-circle-2'}" class="w-4 h-4 shrink-0 mt-0.5"></i><div class="min-w-0"><p class="font-semibold leading-snug">${esc(message)}</p>${detail ? `<p class="mt-1 text-[11px] font-normal leading-relaxed opacity-80">${esc(detail)}</p>` : ''}</div>`;
  container.appendChild(node);
  if (window.lucide) window.lucide.createIcons();
  requestAnimationFrame(() => node.classList.remove('translate-y-2', 'opacity-0'));
  setTimeout(() => {
    node.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => node.remove(), 300);
  }, duration);
}

function createIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.body.classList.add('overflow-hidden');
  createIcons();
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  if (!$$('.fixed.flex.inset-0').length) document.body.classList.remove('overflow-hidden');
}

function setButtonLoading(button, loading, text = 'Memproses…') {
  if (!button) return;
  if (loading) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add('opacity-70', 'cursor-not-allowed');
    button.innerHTML = `<span class="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></span><span>${text}</span>`;
  } else {
    button.disabled = false;
    button.classList.remove('opacity-70', 'cursor-not-allowed');
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
  }
}

function confirmAction({ title, message, confirmLabel = 'Ya, Lanjutkan', danger = true }) {
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  const yes = $('#confirm-yes');
  yes.textContent = confirmLabel;
  yes.className = danger
    ? 'px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold shadow-sm'
    : 'px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold shadow-sm';
  openModal('modal-confirm');
  return new Promise((resolve) => {
    state.confirmResolve = resolve;
  });
}

function resolveConfirm(result) {
  closeModal('modal-confirm');
  if (state.confirmResolve) {
    state.confirmResolve(result);
    state.confirmResolve = null;
  }
}

function buildWhatsAppUrl(product, qty = 1) {
  const number = String(product.seller.whatsapp || '').replace(/\D/g, '');
  if (!number) return null;
  const text =
    'Halo BatikWangi Banyuwangi, saya tertarik memesan produk berikut:\n\n' +
    `• Produk: *${product.name}*\n` +
    `• Kategori: ${product.category.name}\n` +
    `• Penjual: ${product.seller.name}\n` +
    `• Harga Satuan: ${rupiah(product.price)}\n` +
    `• Jumlah: ${qty} pcs\n` +
    `• Estimasi Total: *${rupiah(product.price * qty)}*\n\n` +
    'Apakah stok masih tersedia? Terima kasih.';
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/* ================================ Header =============================== */

function renderHeader() {
  const me = state.me;
  const account = $('#header-account');
  const sellerNav = $('[data-nav="seller"]');
  const adminNav = $('[data-nav="admin"]');

  sellerNav.classList.toggle('hidden', !me || me.role !== 'seller');
  sellerNav.classList.toggle('flex', Boolean(me && me.role === 'seller'));
  adminNav.classList.toggle('hidden', !me || me.role !== 'admin');
  adminNav.classList.toggle('flex', Boolean(me && me.role === 'admin'));

  if (!me) {
    account.innerHTML = `
      <button type="button" data-action="open-auth" class="px-3.5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-soga-950 text-xs sm:text-sm font-bold shadow-sm flex items-center gap-1.5">
        <i data-lucide="log-in" class="w-4 h-4"></i><span>Masuk</span>
      </button>`;
  } else {
    account.innerHTML = `
      ${me.role === 'buyer' ? `<button type="button" data-action="open-orders" class="px-3 py-2.5 rounded-xl bg-soga-900 border border-amber-500/25 hover:border-amber-500/50 text-soga-50 text-xs sm:text-sm font-semibold transition">Pesanan</button>` : ''}
      <button type="button" data-action="edit-profile" title="Profil saya" class="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl bg-soga-900 border border-amber-500/25 hover:border-amber-500/50 transition text-left">
        <span class="w-7 h-7 rounded-lg bg-amber-500 text-soga-950 text-xs font-bold flex items-center justify-center">${esc(me.name.slice(0, 1).toUpperCase())}</span>
        <span class="hidden sm:block leading-tight">
          <span class="block text-xs font-semibold text-soga-50 max-w-[120px] truncate">${esc(me.name)}</span>
          <span class="block text-[10px] font-bold uppercase tracking-wider text-amber-400">${esc(ROLE_LABEL[me.role])}</span>
        </span>
      </button>
      <button type="button" data-action="logout" title="Keluar" class="p-2.5 rounded-xl bg-soga-900 border border-soga-700 hover:border-rose-500/50 text-soga-300 hover:text-rose-300 transition">
        <i data-lucide="log-out" class="w-4 h-4"></i>
      </button>`;
  }
  const cartButton = $('#cart-button');
  if (cartButton) {
    const canBuy = !state.me || state.me.role === 'buyer';
    cartButton.classList.toggle('hidden', !canBuy);
  }
  updateNavStyles();
  createIcons();
}

function updateNavStyles() {
  $$('.nav-btn').forEach((button) => {
    const isActive = button.dataset.nav === state.currentView;
    button.classList.toggle('bg-amber-500', isActive);
    button.classList.toggle('text-soga-950', isActive);
    button.classList.toggle('shadow-sm', isActive);
    button.classList.toggle('text-soga-200', !isActive);
    button.classList.toggle('hover:text-white', !isActive);
  });
}

/* =============================== Navigasi ============================== */

function navigate(view, { force = false } = {}) {
  if (!force) {
    if (view === 'seller' && (!state.me || state.me.role !== 'seller')) view = 'catalog';
    if (view === 'admin' && (!state.me || state.me.role !== 'admin')) view = 'catalog';
  }
  state.currentView = view;
  $('#view-catalog').classList.toggle('hidden', view !== 'catalog');
  $('#view-seller').classList.toggle('hidden', view !== 'seller');
  $('#view-admin').classList.toggle('hidden', view !== 'admin');
  updateNavStyles();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (view === 'catalog') loadCatalog();
  if (view === 'seller') loadSellerDashboard();
  if (view === 'admin') loadAdminDashboard();
}

function homeViewFor(user) {
  if (user && user.role === 'seller') return 'seller';
  if (user && user.role === 'admin') return 'admin';
  return 'catalog';
}

/* =============================== Katalog ============================== */

function fillCategorySelects() {
  const filterSelect = $('#catalog-category');
  const currentFilter = filterSelect.value;
  filterSelect.innerHTML =
    '<option value="">Semua Kategori Wastra</option>' +
    state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if (state.categories.some((c) => String(c.id) === currentFilter)) filterSelect.value = currentFilter;

  const formSelect = $('#product-category');
  const currentForm = formSelect.value;
  formSelect.innerHTML = state.categories
    .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
    .join('');
  if (state.categories.some((c) => String(c.id) === currentForm)) formSelect.value = currentForm;
}

async function loadCategories() {
  const data = await api('/api/categories');
  state.categories = data.categories;
  fillCategorySelects();
}

async function loadCatalog() {
  if (state.catalogLoading) return;
  state.catalogLoading = true;
  const grid = $('#catalog-grid');
  const empty = $('#catalog-empty');
  grid.innerHTML = '<p class="col-span-full py-10 text-center text-sm text-stone-500">Memuat produk…</p>';
  empty.classList.add('hidden');

  try {
    const params = new URLSearchParams();
    const search = $('#catalog-search').value.trim();
    const categoryId = $('#catalog-category').value;
    const sort = $('#catalog-sort').value;
    const featured = $('#chip-featured').classList.contains('chip-active');
    const instock = $('#chip-instock').classList.contains('chip-active');

    if (search) params.set('search', search);
    if (categoryId) params.set('categoryId', categoryId);
    if (sort && sort !== 'default') params.set('sort', sort);
    if (featured) params.set('featured', '1');
    if (instock) params.set('instock', '1');

    const data = await api(`/api/products?${params.toString()}`);
    state.products = data.products;
    renderCatalog();
  } catch (err) {
    grid.innerHTML = `<p class="col-span-full py-10 text-center text-sm text-rose-600">${esc(err.message)}</p>`;
    $('#catalog-count').textContent = 'Gagal memuat produk';
  } finally {
    state.catalogLoading = false;
  }
}

function renderCatalog() {
  const grid = $('#catalog-grid');
  const empty = $('#catalog-empty');
  const products = state.products;

  $('#catalog-count').textContent = `Menampilkan ${products.length} produk`;
  empty.classList.toggle('hidden', products.length > 0);

  if (!products.length) {
    grid.innerHTML = '';
    createIcons();
    return;
  }

  grid.innerHTML = products
    .map((p) => {
      const soldOut = p.stock <= 0;
      const waUrl = buildWhatsAppUrl(p, 1);
      return `
        <article class="group bg-white rounded-2xl border border-soga-200/80 shadow-sm hover:shadow-xl hover:border-amber-400/60 transition-all duration-300 flex flex-col overflow-hidden">
          <div class="relative aspect-[5/4] bg-soga-100 overflow-hidden cursor-pointer" data-action="open-product" data-id="${p.id}">
            <img src="${esc(p.imageUrl)}" alt="${esc(p.name)}" loading="lazy" class="js-product-img w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ${soldOut ? 'grayscale opacity-75' : ''}" />
            <div class="absolute top-3 left-3 flex flex-wrap gap-1.5">
              ${p.featured ? '<span class="px-2.5 py-1 rounded-full bg-amber-500 text-soga-950 text-[11px] font-bold shadow-sm flex items-center gap-1"><i data-lucide="award" class="w-3 h-3"></i> Unggulan</span>' : ''}
            </div>
            <div class="absolute bottom-3 right-3">
              ${soldOut
                ? '<span class="px-2.5 py-1 rounded-lg bg-rose-950/90 text-rose-200 text-[11px] font-bold backdrop-blur-sm">Stok Habis</span>'
                : `<span class="px-2.5 py-1 rounded-lg bg-stone-950/80 text-emerald-300 text-[11px] font-semibold backdrop-blur-sm">Stok: ${p.stock}</span>`}
            </div>
          </div>
          <div class="p-5 flex-1 flex flex-col justify-between">
            <div>
              <span class="text-[11px] font-bold uppercase tracking-wider text-amber-700">${esc(p.category.name)}</span>
              <h3 data-action="open-product" data-id="${p.id}" class="font-serif text-lg font-bold text-soga-950 mt-1 line-clamp-1 cursor-pointer group-hover:text-amber-700 transition">${esc(p.name)}</h3>
              <p class="text-xs text-stone-500 mt-1.5 line-clamp-2 leading-relaxed">${esc(p.description)}</p>
              <p class="text-[11px] text-stone-400 mt-2 flex items-center gap-1"><i data-lucide="store" class="w-3 h-3"></i>${esc(p.seller.name)}</p>
            </div>
            <div class="mt-4 pt-3.5 border-t border-soga-100">
              <div class="flex items-baseline justify-between mb-3">
                <span class="text-xs text-stone-400">Harga</span>
                <span class="text-base sm:text-lg font-bold text-soga-950">${rupiah(p.price)}</span>
              </div>
              <div class="grid grid-cols-5 gap-2">
                <button type="button" data-action="open-product" data-id="${p.id}" class="col-span-2 py-2 px-2.5 rounded-xl border border-soga-200 hover:bg-soga-50 text-stone-700 text-xs font-semibold transition flex items-center justify-center gap-1">
                  <i data-lucide="eye" class="w-3.5 h-3.5"></i> Detail
                </button>
                ${soldOut || !waUrl
                  ? `<button type="button" disabled class="col-span-3 py-2 px-3 rounded-xl bg-stone-200 text-stone-400 text-xs font-semibold cursor-not-allowed flex items-center justify-center gap-1.5"><i data-lucide="slash" class="w-3.5 h-3.5"></i> ${soldOut ? 'Habis' : 'WA Kosong'}</button>`
                  : `<a href="${esc(waUrl)}" target="_blank" rel="noopener noreferrer" class="col-span-3 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition flex items-center justify-center gap-1.5"><i data-lucide="message-circle" class="w-3.5 h-3.5"></i> Pesan WA</a>`}
              </div>
            </div>
          </div>
        </article>`;
    })
    .join('');
  createIcons();
}

function openProductDetail(productId) {
  const product = state.products.find((p) => p.id === Number(productId)) ||
    state.seller.products.find((p) => p.id === Number(productId));
  if (!product) return;

  state.detail = product;
  state.qty = 1;
  $('#detail-img').src = product.imageUrl;
  $('#detail-img').alt = product.name;
  $('#detail-category').textContent = product.category.name;
  $('#detail-name').textContent = product.name;
  $('#detail-price').textContent = rupiah(product.price);
  $('#detail-desc').textContent = product.description;
  $('#detail-featured').classList.toggle('hidden', !product.featured);
  $('#detail-seller').textContent = `Penjual: ${product.seller.name}`;
  $('#detail-qty').value = 1;

  const stock = $('#detail-stock');
  const qtyWrapper = $('#detail-qty-wrapper');
  const waButton = $('#detail-wa');
  const waNote = $('#detail-wa-note');
  const addCartButton = $('#detail-add-cart');
  if (addCartButton) {
    const canBuy = !state.me || state.me.role === 'buyer';
    addCartButton.classList.toggle('hidden', !canBuy);
  }

  if (product.stock > 0) {
    stock.textContent = `Tersedia (${product.stock} unit)`;
    stock.className = 'px-2.5 py-1 rounded-full font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200';
    qtyWrapper.classList.remove('hidden');
  } else {
    stock.textContent = 'Stok Habis';
    stock.className = 'px-2.5 py-1 rounded-full font-semibold bg-rose-50 text-rose-700 border border-rose-200';
    qtyWrapper.classList.add('hidden');
  }

  const waUrl = product.stock > 0 ? buildWhatsAppUrl(product, 1) : null;
  if (waUrl) {
    waButton.href = waUrl;
    waButton.classList.remove('pointer-events-none', 'bg-stone-300', 'text-stone-500');
    waButton.classList.add('bg-emerald-600', 'hover:bg-emerald-700', 'text-white');
    waNote.classList.add('hidden');
  } else {
    waButton.removeAttribute('href');
    waButton.classList.add('pointer-events-none', 'bg-stone-300', 'text-stone-500');
    waButton.classList.remove('bg-emerald-600', 'hover:bg-emerald-700', 'text-white');
    waNote.classList.toggle('hidden', product.stock > 0);
    if (product.stock > 0) waNote.textContent = 'Penjual belum mengatur nomor WhatsApp.';
  }

  openModal('modal-product-detail');
  createIcons();
}

function adjustQty(delta) {
  const product = state.detail;
  if (!product || product.stock <= 0) return;
  state.qty = Math.max(1, Math.min(product.stock, state.qty + delta));
  $('#detail-qty').value = state.qty;
  const waUrl = buildWhatsAppUrl(product, state.qty);
  if (waUrl) $('#detail-wa').href = waUrl;
}

/* ================================ Seller =============================== */

async function loadSellerDashboard() {
  if (!state.me || state.me.role !== 'seller') return;
  try {
    const [mine, stats] = await Promise.all([
      api('/api/products/seller/mine'),
      api('/api/products/seller/stats'),
    ]);
    state.seller.products = mine.products;
    state.seller.stats = stats.stats;
    renderSeller();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderSeller() {
  const stats = state.seller.stats || { totalProducts: 0, totalStock: 0, featured: 0, outOfStock: 0 };
  $('#seller-wa-display').textContent = state.me && state.me.whatsapp ? `+${state.me.whatsapp}` : 'Belum diatur';
  $('#seller-kpi-products').textContent = stats.totalProducts;
  $('#seller-kpi-stock').textContent = stats.totalStock;
  $('#seller-kpi-featured').textContent = stats.featured;
  $('#seller-kpi-out').textContent = stats.outOfStock;
  renderSellerProducts();
  renderCategoryList();
}

function renderSellerProducts() {
  const query = state.sellerSearch.toLowerCase();
  const rows = state.seller.products.filter(
    (p) => p.name.toLowerCase().includes(query) || p.category.name.toLowerCase().includes(query)
  );
  const tbody = $('#seller-product-rows');
  const empty = $('#seller-products-empty');
  empty.classList.toggle('hidden', rows.length > 0);

  if (!rows.length) {
    tbody.innerHTML = '';
    return;
  }

  tbody.innerHTML = rows
    .map((p) => `
      <tr class="hover:bg-soga-50/70 transition">
        <td class="py-3.5 px-4">
          <div class="flex items-center gap-3">
            <img src="${esc(p.imageUrl)}" alt="${esc(p.name)}" class="js-product-img w-11 h-11 rounded-xl object-cover border border-soga-200 shrink-0" />
            <div>
              <p class="font-bold text-soga-950 line-clamp-1">${esc(p.name)}</p>
              <p class="text-xs text-stone-400 line-clamp-1 max-w-xs">${esc(p.description)}</p>
            </div>
          </div>
        </td>
        <td class="py-3.5 px-4"><span class="px-2.5 py-1 rounded-md bg-soga-100 text-soga-800 text-xs font-semibold whitespace-nowrap">${esc(p.category.name)}</span></td>
        <td class="py-3.5 px-4 font-semibold text-stone-800 whitespace-nowrap">${rupiah(p.price)}</td>
        <td class="py-3.5 px-4">
          <div class="flex items-center justify-center gap-1.5">
            <button type="button" data-action="stock-dec" data-id="${p.id}" class="w-7 h-7 rounded-lg border border-soga-200 hover:bg-soga-100 text-stone-700 font-bold flex items-center justify-center" aria-label="Kurangi stok">−</button>
            <span class="w-9 text-center font-bold text-xs ${p.stock === 0 ? 'text-rose-600' : 'text-emerald-700'}">${p.stock}</span>
            <button type="button" data-action="stock-inc" data-id="${p.id}" class="w-7 h-7 rounded-lg border border-soga-200 hover:bg-soga-100 text-stone-700 font-bold flex items-center justify-center" aria-label="Tambah stok">+</button>
          </div>
        </td>
        <td class="py-3.5 px-4 text-center">
          <button type="button" data-action="toggle-featured" data-id="${p.id}" title="Ubah status unggulan" class="p-1.5 rounded-lg transition ${p.featured ? 'bg-amber-100 text-amber-600' : 'bg-stone-100 text-stone-400 hover:text-stone-600'}">
            <i data-lucide="star" class="w-4 h-4 ${p.featured ? 'fill-amber-500' : ''}"></i>
          </button>
        </td>
        <td class="py-3.5 px-4 text-right whitespace-nowrap">
          <div class="inline-flex items-center gap-1.5">
            <button type="button" data-action="edit-product" data-id="${p.id}" class="p-2 rounded-lg bg-soga-100 hover:bg-amber-100 text-soga-800 transition" aria-label="Edit produk"><i data-lucide="pencil" class="w-4 h-4"></i></button>
            <button type="button" data-action="delete-product" data-id="${p.id}" class="p-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 transition" aria-label="Hapus produk"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
          </div>
        </td>
      </tr>`)
    .join('');
  createIcons();
}

function renderCategoryList() {
  const list = $('#seller-category-list');
  const empty = $('#seller-categories-empty');
  empty.classList.toggle('hidden', state.categories.length > 0);

  if (!state.categories.length) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = state.categories
    .map((c) => `
      <div class="p-4 sm:p-5 flex items-start sm:items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <p class="font-bold text-soga-950">${esc(c.name)}</p>
            <span class="px-2 py-0.5 rounded-md bg-soga-100 text-soga-700 text-[11px] font-semibold">${c.productCount} produk</span>
          </div>
          <p class="text-xs text-stone-500 mt-0.5">${esc(c.description || 'Tanpa deskripsi')}</p>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button type="button" data-action="edit-category" data-id="${c.id}" class="p-2 rounded-lg bg-soga-100 hover:bg-amber-100 text-soga-800 transition" aria-label="Edit kategori"><i data-lucide="pencil" class="w-4 h-4"></i></button>
          <button type="button" data-action="delete-category" data-id="${c.id}" class="p-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 transition" aria-label="Hapus kategori"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </div>
      </div>`)
    .join('');
  createIcons();
}

function openProductForm(productId = null) {
  const form = $('#product-form');
  form.reset();
  $('#product-image').value = '';
  const isEdit = Boolean(productId);
  $('#product-form-title').textContent = isEdit ? 'Edit Produk' : 'Tambah Produk';
  $('#product-id').value = productId || '';
  $('#product-image-required').textContent = isEdit ? '(kosongkan jika tetap)' : '*';
  fillCategorySelects();

  const preview = $('#product-image-preview');
  if (isEdit) {
    const product = state.seller.products.find((p) => p.id === Number(productId));
    if (!product) return;
    $('#product-name').value = product.name;
    $('#product-category').value = product.category.id;
    $('#product-price').value = product.price;
    $('#product-stock').value = product.stock;
    $('#product-featured').checked = product.featured;
    $('#product-desc').value = product.description;
    preview.src = product.imageUrl;
  } else {
    preview.src = PLACEHOLDER_IMG;
    if (state.categories.length) $('#product-category').value = state.categories[0].id;
  }
  openModal('modal-product-form');
}

async function saveProduct(event) {
  event.preventDefault();
  const submitButton = event.submitter || $('#product-form button[type="submit"]');
  const id = $('#product-id').value;
  const fileInput = $('#product-image');
  const formData = new FormData();
  formData.append('name', $('#product-name').value.trim());
  formData.append('categoryId', $('#product-category').value);
  formData.append('price', $('#product-price').value);
  formData.append('stock', $('#product-stock').value);
  formData.append('featured', $('#product-featured').checked ? '1' : '0');
  formData.append('description', $('#product-desc').value.trim());
  if (fileInput.files.length) formData.append('image', fileInput.files[0]);
  if (!id && !fileInput.files.length) {
    toast('Gambar produk wajib diunggah.', 'error');
    return;
  }

  setButtonLoading(submitButton, true, 'Menyimpan…');
  try {
    await api(id ? `/api/products/seller/${id}` : '/api/products/seller', {
      method: id ? 'PUT' : 'POST',
      formData,
    });
    closeModal('modal-product-form');
    toast(id ? 'Produk berhasil diperbarui.' : 'Produk baru berhasil ditambahkan.');
    await Promise.all([loadSellerDashboard(), loadCategories()]);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setButtonLoading(submitButton, false);
  }
}

async function adjustStock(productId, delta) {
  const product = state.seller.products.find((p) => p.id === Number(productId));
  if (!product) return;
  const nextStock = Math.max(0, product.stock + delta);
  if (nextStock === product.stock) return;
  try {
    await api(`/api/products/seller/${productId}/stock`, { method: 'PATCH', body: { stock: nextStock } });
    await loadSellerDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function toggleFeatured(productId) {
  try {
    const data = await api(`/api/products/seller/${productId}/featured`, { method: 'PATCH' });
    toast(data.featured ? 'Produk ditandai unggulan.' : 'Status unggulan dilepas.');
    await loadSellerDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteProduct(productId) {
  const product = state.seller.products.find((p) => p.id === Number(productId));
  if (!product) return;
  const ok = await confirmAction({
    title: 'Hapus Produk?',
    message: `Produk "${product.name}" beserta gambarnya akan dihapus permanen.`,
    confirmLabel: 'Hapus Produk',
  });
  if (!ok) return;
  try {
    await api(`/api/products/seller/${productId}`, { method: 'DELETE' });
    toast('Produk berhasil dihapus.');
    await Promise.all([loadSellerDashboard(), loadCategories()]);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openCategoryForm(categoryId = null) {
  $('#category-form').reset();
  const isEdit = Boolean(categoryId);
  $('#category-form-title').textContent = isEdit ? 'Edit Kategori' : 'Tambah Kategori';
  $('#category-id').value = categoryId || '';
  if (isEdit) {
    const category = state.categories.find((c) => c.id === Number(categoryId));
    if (!category) return;
    $('#category-name').value = category.name;
    $('#category-desc').value = category.description || '';
  }
  openModal('modal-category-form');
}

async function saveCategory(event) {
  event.preventDefault();
  const submitButton = event.submitter || $('#category-form button[type="submit"]');
  const id = $('#category-id').value;
  const payload = { name: $('#category-name').value.trim(), description: $('#category-desc').value.trim() };
  setButtonLoading(submitButton, true, 'Menyimpan…');
  try {
    await api(id ? `/api/categories/${id}` : '/api/categories', {
      method: id ? 'PUT' : 'POST',
      body: payload,
    });
    closeModal('modal-category-form');
    toast(id ? 'Kategori diperbarui.' : 'Kategori ditambahkan.');
    await loadCategories();
    if (state.me && state.me.role === 'seller') await loadSellerDashboard();
    if (state.currentView === 'catalog') await loadCatalog();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setButtonLoading(submitButton, false);
  }
}

async function deleteCategory(categoryId) {
  const category = state.categories.find((c) => c.id === Number(categoryId));
  if (!category) return;
  const ok = await confirmAction({
    title: 'Hapus Kategori?',
    message: `Kategori "${category.name}" akan dihapus. Kategori yang masih dipakai produk tidak dapat dihapus.`,
    confirmLabel: 'Hapus Kategori',
  });
  if (!ok) return;
  try {
    await api(`/api/categories/${categoryId}`, { method: 'DELETE' });
    toast('Kategori berhasil dihapus.');
    await loadCategories();
    if (state.me && state.me.role === 'seller') await loadSellerDashboard();
    if (state.currentView === 'catalog') await loadCatalog();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ================================= Admin =============================== */

function switchAdminTab(tab) {
  const usersPanel = $('#admin-users-panel');
  const ordersPanel = $('#admin-orders-panel');
  if (usersPanel) usersPanel.classList.toggle('hidden', tab !== 'users');
  if (ordersPanel) ordersPanel.classList.toggle('hidden', tab !== 'orders');
  $$('.admin-tab').forEach((button) => {
    const active = button.dataset.adminTab === tab;
    button.classList.toggle('border-amber-600', active);
    button.classList.toggle('text-soga-950', active);
    button.classList.toggle('border-transparent', !active);
    button.classList.toggle('text-stone-500', !active);
  });
  if (tab === 'orders') loadAdminOrders();
}

async function loadAdminDashboard() {
  if (!state.me || state.me.role !== 'admin') return;
  try {
    const [users, stats] = await Promise.all([api('/api/admin/users'), api('/api/admin/stats')]);
    state.admin.users = users.users;
    state.admin.stats = stats.stats;
    renderAdmin();
    loadAdminOrders();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderAdmin() {
  const stats = state.admin.stats;
  if (stats) {
    $('#admin-kpi-users').textContent = stats.users.total;
    $('#admin-kpi-users-sub').textContent = `${stats.users.inactive} nonaktif`;
    $('#admin-kpi-sellers').textContent = stats.users.sellers;
    $('#admin-kpi-buyers').textContent = stats.users.buyers;
    $('#admin-kpi-products').textContent = stats.products.total;
    $('#admin-kpi-products-sub').textContent = `${stats.categories} kategori · ${stats.products.featured} unggulan`;
  }
  renderAdminUsers();
}

function renderAdminUsers() {
  const search = state.adminFilters.search.toLowerCase();
  const role = state.adminFilters.role;
  const users = state.admin.users.filter((u) => {
    const matchSearch = u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search);
    const matchRole = !role || u.role === role;
    return matchSearch && matchRole;
  });

  const tbody = $('#admin-user-rows');
  const empty = $('#admin-users-empty');
  empty.classList.toggle('hidden', users.length > 0);

  if (!users.length) {
    tbody.innerHTML = '';
    return;
  }

  tbody.innerHTML = users
    .map((u) => `
      <tr class="hover:bg-soga-50/70 transition ${u.active ? '' : 'bg-stone-50/70'}">
        <td class="py-3.5 px-4">
          <div class="flex items-center gap-2.5">
            <span class="w-8 h-8 rounded-lg bg-soga-100 text-soga-800 text-xs font-bold flex items-center justify-center shrink-0">${esc(u.name.slice(0, 1).toUpperCase())}</span>
            <div>
              <p class="font-bold text-soga-950 ${u.active ? '' : 'text-stone-400'}">${esc(u.name)}${u.id === state.me.id ? ' <span class="text-[10px] text-amber-700 font-semibold">(Anda)</span>' : ''}</p>
              ${u.role === 'seller' ? `<p class="text-[11px] text-stone-400">${u.productCount} produk${!u.active ? ' · menunggu konfirmasi' : ''}</p>` : ''}
            </div>
          </div>
        </td>
        <td class="py-3.5 px-4 text-stone-700 break-all">${esc(u.email)}</td>
        <td class="py-3.5 px-4"><span class="px-2.5 py-1 rounded-md border text-xs font-semibold whitespace-nowrap ${ROLE_BADGE[u.role]}">${ROLE_LABEL[u.role]}</span></td>
        <td class="py-3.5 px-4 text-stone-600 whitespace-nowrap">${u.whatsapp ? `+${esc(u.whatsapp)}` : '<span class="text-stone-400">—</span>'}</td>
        <td class="py-3.5 px-4 text-center">
          <button type="button" data-action="toggle-user" data-id="${u.id}" class="px-2.5 py-1 rounded-full text-[11px] font-bold border transition ${u.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : (u.role === 'seller' ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' : 'bg-stone-100 text-stone-500 border-stone-200 hover:bg-stone-200')}" ${u.id === state.me.id ? 'disabled title="Tidak dapat mengubah status akun sendiri"' : `title="Klik untuk ${u.active ? 'menonaktifkan' : (u.role === 'seller' ? 'mengonfirmasi' : 'mengaktifkan')} akun"`}>
            ${u.active ? 'Aktif' : (u.role === 'seller' ? 'Menunggu Konfirmasi' : 'Nonaktif')}
          </button>
        </td>
        <td class="py-3.5 px-4 text-right whitespace-nowrap">
          <div class="inline-flex items-center gap-1.5">
            <button type="button" data-action="edit-user" data-id="${u.id}" class="p-2 rounded-lg bg-soga-100 hover:bg-amber-100 text-soga-800 transition" aria-label="Edit user"><i data-lucide="pencil" class="w-4 h-4"></i></button>
            ${u.id === state.me.id
              ? ''
              : `<button type="button" data-action="delete-user" data-id="${u.id}" class="p-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 transition" aria-label="Hapus user"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`}
          </div>
        </td>
      </tr>`)
    .join('');
  createIcons();
}

function openUserForm(userId = null) {
  $('#user-form').reset();
  const isEdit = Boolean(userId);
  $('#user-form-title').textContent = isEdit ? 'Edit User' : 'Tambah User';
  $('#user-id').value = userId || '';
  $('#user-active').checked = true;
  $('#user-password').required = !isEdit;
  $('#user-password-label').textContent = isEdit ? 'Kata Sandi Baru (opsional)' : 'Kata Sandi *';
  $('#user-password-hint').textContent = isEdit
    ? 'Kosongkan jika tidak ingin mengganti kata sandi.'
    : 'Minimal 8 karakter, memuat huruf dan angka.';

  if (isEdit) {
    const user = state.admin.users.find((u) => u.id === Number(userId));
    if (!user) return;
    $('#user-name').value = user.name;
    $('#user-email').value = user.email;
    $('#user-role').value = user.role;
    $('#user-whatsapp').value = user.whatsapp || '';
    $('#user-active').checked = user.active;
  }
  openModal('modal-user-form');
}

async function saveUser(event) {
  event.preventDefault();
  const submitButton = event.submitter || $('#user-form button[type="submit"]');
  const id = $('#user-id').value;
  const password = $('#user-password').value;
  const payload = {
    name: $('#user-name').value.trim(),
    email: $('#user-email').value.trim(),
    role: $('#user-role').value,
    whatsapp: $('#user-whatsapp').value.trim(),
    active: $('#user-active').checked,
  };
  if (password) payload.password = password;
  else if (!id) {
    toast('Kata sandi wajib diisi untuk user baru.', 'error');
    return;
  }

  setButtonLoading(submitButton, true, 'Menyimpan…');
  try {
    await api(id ? `/api/admin/users/${id}` : '/api/admin/users', {
      method: id ? 'PUT' : 'POST',
      body: payload,
    });
    closeModal('modal-user-form');
    toast(id ? 'Data user diperbarui.' : 'User baru berhasil dibuat.');
    await loadAdminDashboard();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setButtonLoading(submitButton, false);
  }
}

async function toggleUserActive(userId) {
  const user = state.admin.users.find((u) => u.id === Number(userId));
  if (!user) return;
  const activating = !user.active;
  if (!activating) {
    const ok = await confirmAction({
      title: 'Nonaktifkan User?',
      message: `Akun "${user.name}" tidak dapat masuk sampai diaktifkan kembali. Produk seller yang nonaktif tidak tampil di katalog.`,
      confirmLabel: 'Nonaktifkan',
    });
    if (!ok) return;
  }
  try {
    await api(`/api/admin/users/${userId}`, { method: 'PUT', body: { active: activating } });
    toast(activating ? 'User diaktifkan.' : 'User dinonaktifkan.');
    await loadAdminDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteUser(userId) {
  const user = state.admin.users.find((u) => u.id === Number(userId));
  if (!user) return;
  const ok = await confirmAction({
    title: 'Hapus User?',
    message: `Akun "${user.name}" (${ROLE_LABEL[user.role]}) akan dihapus permanen${user.role === 'seller' ? ', termasuk seluruh produk dan gambar miliknya' : ''}.`,
    confirmLabel: 'Hapus User',
  });
  if (!ok) return;
  try {
    await api(`/api/admin/users/${userId}`, { method: 'DELETE' });
    toast('User berhasil dihapus.');
    await Promise.all([loadAdminDashboard(), loadCategories()]);
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ================================ Profil =============================== */

function openProfileModal() {
  if (!state.me) return;
  $('#profile-name').value = state.me.name;
  $('#profile-whatsapp').value = state.me.whatsapp || '';
  openModal('modal-profile');
}

async function saveProfile(event) {
  event.preventDefault();
  const submitButton = event.submitter || $('#profile-form button[type="submit"]');
  setButtonLoading(submitButton, true, 'Menyimpan…');
  try {
    const data = await api('/api/auth/profile', {
      method: 'PATCH',
      body: { name: $('#profile-name').value.trim(), whatsapp: $('#profile-whatsapp').value.trim() },
    });
    state.me = data.user;
    renderHeader();
    closeModal('modal-profile');
    toast('Profil diperbarui.');
    if (state.currentView === 'seller') renderSeller();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setButtonLoading(submitButton, false);
  }
}

/* ================================== Auth =============================== */

function openAuthModal(tab = 'login') {
  switchAuthTab(tab);
  openModal('modal-auth');
}

function switchAuthTab(tab) {
  resetRegisterFieldErrors();
  resetPasswordVisibility();
  const isLogin = tab === 'login';
  $('#login-form').classList.toggle('hidden', !isLogin);
  $('#register-form').classList.toggle('hidden', isLogin);
  $('#auth-title').textContent = isLogin ? 'Masuk ke BatikWangi' : 'Daftar Akun';
  $$('.auth-tab').forEach((button) => {
    const active = button.dataset.authTab === tab;
    button.classList.toggle('bg-white', active);
    button.classList.toggle('shadow-sm', active);
    button.classList.toggle('text-soga-950', active);
    button.classList.toggle('text-stone-600', !active);
  });
}

async function afterAuth(user, message, toastOptions) {
  state.me = user;
  renderHeader();
  closeModal('modal-auth');
  toast(message, 'success', toastOptions);
  await loadCategories();
  navigate(homeViewFor(user), { force: true });
}

async function handleLogin(event) {
  event.preventDefault();
  const submitButton = event.submitter || $('#login-form button[type="submit"]');
  setButtonLoading(submitButton, true, 'Masuk…');
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: { email: $('#login-email').value.trim(), password: $('#login-password').value },
    });
    $('#login-form').reset();
    await afterAuth(data.user, `Selamat datang, ${data.user.name}.`);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setButtonLoading(submitButton, false);
  }
}

function setFieldError(input, errorNode, message) {
  const invalid = Boolean(message);
  if (errorNode) {
    errorNode.textContent = message || '';
    errorNode.classList.toggle('hidden', !invalid);
  }
  if (input) {
    input.classList.toggle('border-rose-400', invalid);
    input.classList.toggle('border-soga-200', !invalid);
    input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
  }
}

function passwordIssue(value) {
  if (!value) return 'Kata sandi wajib diisi.';
  if (value.length < 8) return 'Kata sandi minimal 8 karakter.';
  if (!/[A-Za-z]/.test(value)) return 'Kata sandi harus memuat minimal satu huruf.';
  if (!/\d/.test(value)) return 'Kata sandi harus memuat minimal satu angka.';
  return '';
}

function normalizeWhatsAppInput(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
}

function isRegisterSeller() {
  return $('#register-role')?.value === 'seller';
}

function whatsappIssue(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return isRegisterSeller() ? 'Nomor WhatsApp wajib diisi untuk penjual.' : '';
  }
  const digits = raw.replace(/\D/g, '');
  if (!digits) return 'Nomor WhatsApp hanya boleh berisi angka.';
  const normalized = normalizeWhatsAppInput(digits);
  if (!WHATSAPP_RE.test(normalized)) {
    return 'Nomor WhatsApp tidak valid. Gunakan nomor Indonesia, mis. 081234567890.';
  }
  return '';
}

function validateRegisterWhatsApp() {
  const input = $('#register-whatsapp');
  const issue = whatsappIssue(input.value);
  setFieldError(input, $('#register-whatsapp-error'), issue);
  return !issue;
}

function validateRegisterPassword() {
  const input = $('#register-password');
  const issue = passwordIssue(input.value);
  setFieldError(input, $('#register-password-error'), issue);
  return !issue;
}

function validateRegisterPasswordConfirm() {
  const input = $('#register-password-confirm');
  const password = $('#register-password').value;
  let issue = '';
  if (!input.value) issue = 'Konfirmasi kata sandi wajib diisi.';
  else if (input.value !== password) issue = 'Konfirmasi kata sandi tidak cocok.';
  setFieldError(input, $('#register-password-confirm-error'), issue);
  return !issue;
}

function resetRegisterFieldErrors() {
  setFieldError($('#register-whatsapp'), $('#register-whatsapp-error'), '');
  setFieldError($('#register-password'), $('#register-password-error'), '');
  setFieldError($('#register-password-confirm'), $('#register-password-confirm-error'), '');
}

function resetPasswordVisibility() {
  $$('[data-toggle-password]').forEach((button) => {
    const input = document.getElementById(button.dataset.togglePassword);
    if (input) input.type = 'password';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute(
      'aria-label',
      input && input.id === 'register-password'
        ? 'Tampilkan kata sandi'
        : 'Tampilkan konfirmasi kata sandi'
    );
    button.innerHTML = '<i data-lucide="eye" class="w-4 h-4"></i>';
  });
  createIcons();
}

function togglePasswordVisibility(button) {
  const input = document.getElementById(button.dataset.togglePassword);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(show));
  button.setAttribute(
    'aria-label',
    show
      ? `Sembunyikan ${input.id === 'register-password' ? 'kata sandi' : 'konfirmasi kata sandi'}`
      : `Tampilkan ${input.id === 'register-password' ? 'kata sandi' : 'konfirmasi kata sandi'}`
  );
  button.innerHTML = `<i data-lucide="${show ? 'eye-off' : 'eye'}" class="w-4 h-4"></i>`;
  createIcons();
}

async function handleRegister(event) {
  event.preventDefault();
  const passwordOk = validateRegisterPassword();
  const confirmOk = validateRegisterPasswordConfirm();
  const whatsappOk = validateRegisterWhatsApp();
  if (!passwordOk || !confirmOk || !whatsappOk) {
    const firstInvalid = [
      $('#register-whatsapp'),
      $('#register-password'),
      $('#register-password-confirm'),
    ].find((input) => input && input.getAttribute('aria-invalid') === 'true');
    if (firstInvalid) firstInvalid.focus();
    toast('Periksa kembali data pendaftaran Anda.', 'error');
    return;
  }

  const submitButton = event.submitter || $('#register-form button[type="submit"]');
  setButtonLoading(submitButton, true, 'Mendaftar…');
  try {
    const role = $('#register-role').value;
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: {
        name: $('#register-name').value.trim(),
        email: $('#register-email').value.trim(),
        role,
        whatsapp: normalizeWhatsAppInput($('#register-whatsapp').value),
        password: $('#register-password').value,
      },
    });
    $('#register-form').reset();
    resetRegisterFieldErrors();
    resetPasswordVisibility();
    if (data.pending) {
      switchAuthTab('login');
      toast('Pendaftaran penjual berhasil.', 'success', {
        detail: `${data.user.name} · ${data.user.email} — akun menunggu konfirmasi admin sebelum dapat masuk.`,
        duration: 7000,
      });
      return;
    }
    await afterAuth(data.user, 'Pendaftaran berhasil!', {
      detail: `${data.user.name} · ${data.user.email} — akun pembeli aktif dan siap digunakan.`,
      duration: 6000,
    });
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setButtonLoading(submitButton, false);
  }
}

async function handleLogout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {
    /* sesi mungkin sudah berakhir */
  }
  state.me = null;
  state.seller = { products: [], stats: null };
  state.admin = { users: [], stats: null };
  state.currentView = 'catalog';
  renderHeader();
  toast('Anda telah keluar.');
  navigate('catalog', { force: true });
}

/* ============================== Event wiring =========================== */

function bindEvents() {
  $('#brand-link').addEventListener('click', (event) => {
    event.preventDefault();
    navigate('catalog');
  });

  document.addEventListener('click', (event) => {
    const navButton = event.target.closest('[data-nav]');
    if (navButton) {
      navigate(navButton.dataset.nav);
      return;
    }

    const closeButton = event.target.closest('[data-close-modal]');
    if (closeButton) {
      closeModal(closeButton.dataset.closeModal);
      return;
    }

    const authTab = event.target.closest('[data-auth-tab]');
    if (authTab) {
      switchAuthTab(authTab.dataset.authTab);
      return;
    }

    const passwordToggle = event.target.closest('[data-toggle-password]');
    if (passwordToggle) {
      togglePasswordVisibility(passwordToggle);
      return;
    }

    const sellerTab = event.target.closest('[data-seller-tab]');
    if (sellerTab) {
      const tab = sellerTab.dataset.sellerTab;
      $$('.seller-tab').forEach((button) => {
        const active = button.dataset.sellerTab === tab;
        button.classList.toggle('border-amber-600', active);
        button.classList.toggle('text-soga-950', active);
        button.classList.toggle('border-transparent', !active);
        button.classList.toggle('text-stone-500', !active);
      });
      $('#seller-products-panel').classList.toggle('hidden', tab !== 'products');
      $('#seller-categories-panel').classList.toggle('hidden', tab !== 'categories');
      return;
    }

    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    const id = actionButton.dataset.id;

    switch (actionButton.dataset.action) {
      case 'open-auth':
        openAuthModal('login');
        break;
      case 'logout':
        handleLogout();
        break;
      case 'reset-filters':
        $('#catalog-search').value = '';
        $('#catalog-category').value = '';
        $('#catalog-sort').value = 'default';
        ['featured', 'instock'].forEach((key) => setChipActive(key, false));
        loadCatalog();
        break;
      case 'open-product':
        openProductDetail(id);
        break;
      case 'new-product':
        openProductForm();
        break;
      case 'edit-product':
        openProductForm(id);
        break;
      case 'delete-product':
        deleteProduct(id);
        break;
      case 'stock-dec':
        adjustStock(id, -1);
        break;
      case 'stock-inc':
        adjustStock(id, 1);
        break;
      case 'toggle-featured':
        toggleFeatured(id);
        break;
      case 'new-category':
        openCategoryForm();
        break;
      case 'edit-category':
        openCategoryForm(id);
        break;
      case 'delete-category':
        deleteCategory(id);
        break;
      case 'new-user':
        openUserForm();
        break;
      case 'edit-user':
        openUserForm(id);
        break;
      case 'delete-user':
        deleteUser(id);
        break;
      case 'toggle-user':
        toggleUserActive(id);
        break;
      case 'edit-profile':
        openProfileModal();
        break;
      case 'qty-increase':
        adjustQty(1);
        break;
      case 'qty-decrease':
        adjustQty(-1);
        break;
      case 'open-cart':
        openCart();
        break;
      case 'cart-increase': {
        const item = state.cart.find((i) => i.productId === Number(id));
        if (item) updateCartQty(item.productId, item.quantity + 1);
        break;
      }
      case 'cart-decrease': {
        const item = state.cart.find((i) => i.productId === Number(id));
        if (item) updateCartQty(item.productId, item.quantity - 1);
        break;
      }
      case 'cart-remove':
        removeFromCart(Number(id));
        break;
      case 'open-orders':
        openOrders();
        break;
      case 'admin-tab':
        switchAdminTab(target.dataset.tab || 'users');
        break;
      default:
        break;
    }
  });

  $('#login-form').addEventListener('submit', handleLogin);
  $('#register-form').addEventListener('submit', handleRegister);
  $('#register-role').addEventListener('change', () => {
    validateRegisterWhatsApp();
  });

  const detailAddCart = $('#detail-add-cart');
  if (detailAddCart) detailAddCart.addEventListener('click', () => {
    if (state.detail) addToCart(state.detail, state.qty);
  });

  const cartClear = $('#cart-clear');
  if (cartClear) cartClear.addEventListener('click', clearCart);
  const cartCheckout = $('#cart-checkout');
  if (cartCheckout) cartCheckout.addEventListener('click', openCheckout);
  const checkoutForm = $('#checkout-form');
  if (checkoutForm) checkoutForm.addEventListener('submit', handleCheckout);

  const adminOrderRows = $('#admin-order-rows');
  if (adminOrderRows) {
    adminOrderRows.addEventListener('change', async (event) => {
      const select = event.target.closest('select[data-action="order-status"]');
      if (!select) return;
      const id = Number(select.dataset.id);
      try {
        await api(`/api/orders/${id}/status`, { method: 'PATCH', body: { status: select.value } });
        toast('Status pesanan diperbarui.');
        loadAdminOrders();
      } catch (err) {
        toast(err.message, 'error');
        loadAdminOrders();
      }
    });
  }

  const registerWhatsApp = $('#register-whatsapp');
  const registerPassword = $('#register-password');
  const registerConfirm = $('#register-password-confirm');
  registerWhatsApp.addEventListener('blur', validateRegisterWhatsApp);
  registerWhatsApp.addEventListener('input', () => {
    if (!$('#register-whatsapp-error').classList.contains('hidden')) validateRegisterWhatsApp();
  });
  registerPassword.addEventListener('blur', validateRegisterPassword);
  registerPassword.addEventListener('input', () => {
    if (!$('#register-password-error').classList.contains('hidden')) validateRegisterPassword();
    if (registerConfirm.value && !$('#register-password-confirm-error').classList.contains('hidden')) {
      validateRegisterPasswordConfirm();
    }
  });
  registerConfirm.addEventListener('blur', validateRegisterPasswordConfirm);
  registerConfirm.addEventListener('input', () => {
    if (!$('#register-password-confirm-error').classList.contains('hidden') || registerConfirm.value) {
      validateRegisterPasswordConfirm();
    }
  });
  $('#product-form').addEventListener('submit', saveProduct);
  $('#category-form').addEventListener('submit', saveCategory);
  $('#user-form').addEventListener('submit', saveUser);
  $('#profile-form').addEventListener('submit', saveProfile);

  $('#catalog-search').addEventListener(
    'input',
    debounce(() => loadCatalog(), 300)
  );
  $('#catalog-category').addEventListener('change', () => loadCatalog());
  $('#catalog-sort').addEventListener('change', () => loadCatalog());

  $('#chip-featured').addEventListener('click', () => {
    setChipActive('featured', !$('#chip-featured').classList.contains('chip-active'));
    loadCatalog();
  });
  $('#chip-instock').addEventListener('click', () => {
    setChipActive('instock', !$('#chip-instock').classList.contains('chip-active'));
    loadCatalog();
  });

  $('#seller-search').addEventListener('input', (event) => {
    state.sellerSearch = event.target.value.trim();
    renderSellerProducts();
  });

  $('#admin-search').addEventListener(
    'input',
    debounce((event) => {
      state.adminFilters.search = event.target.value.trim();
      renderAdminUsers();
    }, 200)
  );
  $('#admin-role-filter').addEventListener('change', (event) => {
    state.adminFilters.role = event.target.value;
    renderAdminUsers();
  });

  $('#product-image').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (state.imageObjectUrl) URL.revokeObjectURL(state.imageObjectUrl);
    state.imageObjectUrl = URL.createObjectURL(file);
    $('#product-image-preview').src = state.imageObjectUrl;
  });

  $('#confirm-yes').addEventListener('click', () => resolveConfirm(true));
  $('#confirm-cancel').addEventListener('click', () => resolveConfirm(false));

  // Fallback gambar produk yang gagal dimuat.
  document.addEventListener(
    'error',
    (event) => {
      const img = event.target;
      if (img instanceof HTMLImageElement && img.classList.contains('js-product-img') && img.src !== location.origin + PLACEHOLDER_IMG) {
        img.src = PLACEHOLDER_IMG;
      }
    },
    true
  );

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!$('#modal-confirm').classList.contains('hidden')) {
      resolveConfirm(false);
      return;
    }
    $$('.fixed.flex.inset-0').forEach((modal) => closeModal(modal.id));
  });
}

function setChipActive(key, active) {
  const chip = $(key === 'featured' ? '#chip-featured' : '#chip-instock');
  chip.classList.toggle('chip-active', active);
  chip.classList.toggle('bg-amber-100', active);
  chip.classList.toggle('border-amber-500', active);
  chip.classList.toggle('text-soga-950', active);
  chip.classList.toggle('bg-soga-50', !active);
  chip.classList.toggle('text-stone-700', !active);
}

/* ================================== Init =============================== */

/* ================================ Keranjang ============================ */

function loadCart() {
  try {
    state.cart = JSON.parse(localStorage.getItem('batikwangi_cart') || '[]');
  } catch {
    state.cart = [];
  }
  if (!Array.isArray(state.cart)) state.cart = [];
}

function saveCart() {
  localStorage.setItem('batikwangi_cart', JSON.stringify(state.cart));
  updateCartCount();
}

function cartCount() {
  return state.cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function cartTotal() {
  return state.cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
}

function addToCart(product, quantity = 1) {
  const existing = state.cart.find((item) => item.productId === product.id);
  if (existing) {
    existing.quantity += quantity;
  } else {
    state.cart.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      imageUrl: product.imageUrl,
      sellerName: product.seller.name,
      quantity,
    });
  }
  saveCart();
  toast('Produk ditambahkan ke keranjang.', 'success');
}

function updateCartQty(productId, quantity) {
  const item = state.cart.find((i) => i.productId === productId);
  if (!item) return;
  if (quantity <= 0) {
    state.cart = state.cart.filter((i) => i.productId !== productId);
  } else {
    item.quantity = quantity;
  }
  saveCart();
  renderCart();
}

function removeFromCart(productId) {
  state.cart = state.cart.filter((i) => i.productId !== productId);
  saveCart();
  renderCart();
}

function clearCart() {
  state.cart = [];
  saveCart();
  renderCart();
}

function updateCartCount() {
  const badge = $('#cart-count');
  if (badge) badge.textContent = cartCount();
}

function renderCart() {
  const container = $('#cart-items');
  const empty = $('#cart-empty');
  if (!container) return;
  if (!state.cart.length) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    container.innerHTML = state.cart
      .map(
        (item) => `
      <div class="flex items-center gap-3 border border-soga-100 rounded-xl p-3">
        <img src="${esc(item.imageUrl || PLACEHOLDER_IMG)}" alt="${esc(item.name)}" class="w-14 h-14 rounded-lg object-cover bg-soga-100 shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-soga-950 truncate">${esc(item.name)}</p>
          <p class="text-[11px] text-stone-500">${esc(item.sellerName)} · ${rupiah(item.price)}</p>
        </div>
        <div class="flex items-center border border-soga-300 rounded-lg overflow-hidden">
          <button type="button" data-action="cart-decrease" data-id="${item.productId}" class="px-2 py-1 bg-soga-50 hover:bg-soga-100 text-stone-700" aria-label="Kurangi">-</button>
          <span class="w-8 text-center text-xs font-bold text-stone-800">${item.quantity}</span>
          <button type="button" data-action="cart-increase" data-id="${item.productId}" class="px-2 py-1 bg-soga-50 hover:bg-soga-100 text-stone-700" aria-label="Tambah">+</button>
        </div>
        <button type="button" data-action="cart-remove" data-id="${item.productId}" class="p-2 rounded-lg text-rose-600 hover:bg-rose-50" aria-label="Hapus"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
      </div>`
      )
      .join('');
  }
  $('#cart-total').textContent = rupiah(cartTotal());
  createIcons();
}

function openCart() {
  if (state.me && state.me.role !== 'buyer') {
    toast('Hanya pembeli yang dapat melakukan pembelian.', 'error');
    return;
  }
  renderCart();
  openModal('modal-cart');
}

function openCheckout() {
  if (!state.cart.length) {
    toast('Keranjang masih kosong.', 'error');
    return;
  }
  closeModal('modal-cart');
  if (state.me) {
    $('#checkout-name').value = state.me.name || '';
    $('#checkout-email').value = state.me.email || '';
    $('#checkout-whatsapp').value = state.me.whatsapp || '';
  }
  $('#checkout-total').textContent = rupiah(cartTotal());
  openModal('modal-checkout');
}

async function handleCheckout(event) {
  event.preventDefault();
  if (state.me && state.me.role !== 'buyer') {
    toast('Hanya pembeli yang dapat melakukan pembelian.', 'error');
    return;
  }
  if (!state.cart.length) {
    toast('Keranjang masih kosong.', 'error');
    return;
  }
  const submitButton = event.submitter || $('#checkout-form button[type="submit"]');
  setButtonLoading(submitButton, true, 'Membuat pesanan…');
  try {
    const data = await api('/api/orders', {
      method: 'POST',
      body: {
        buyer: {
          name: $('#checkout-name').value.trim(),
          email: $('#checkout-email').value.trim(),
          whatsapp: normalizeWhatsAppInput($('#checkout-whatsapp').value),
        },
        items: state.cart.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      },
    });
    clearCart();
    closeModal('modal-checkout');
    showPaymentInstructions(data.order, data.payment);
    if (state.me) loadMyOrders();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setButtonLoading(submitButton, false);
  }
}

function showPaymentInstructions(order, payment) {
  const content = $('#payment-content');
  content.innerHTML = `
    <p class="text-sm text-stone-700">Nomor Pesanan: <b>#${order.id}</b></p>
    <p class="text-sm text-stone-700">Total: <b class="text-amber-700">${rupiah(payment.amount)}</b></p>
    <div class="bg-soga-50 border border-soga-200 rounded-xl p-4 space-y-1">
      <p class="text-xs font-bold uppercase tracking-wider text-stone-600">Transfer ke rekening</p>
      <p class="text-sm text-stone-700">Bank: <b>${esc(payment.bankName)}</b></p>
      <p class="text-sm text-stone-700">No. Rekening: <b>${esc(payment.accountNumber)}</b></p>
      <p class="text-sm text-stone-700">Atas Nama: <b>${esc(payment.accountName)}</b></p>
      <p class="text-sm text-stone-700 mt-2">Berita transfer: <b>${esc(payment.reference)}</b></p>
    </div>
    <p class="text-[11px] text-stone-500 leading-relaxed">Setelah transfer, pesanan akan diverifikasi admin. Simpan nomor pesanan untuk konfirmasi.</p>
  `;
  openModal('modal-payment');
}

async function loadMyOrders() {
  if (!state.me) return;
  try {
    const data = await api('/api/orders/mine');
    renderMyOrders(data.orders || []);
  } catch {
    /* ignore */
  }
}

function orderStatusBadge(status) {
  const map = {
    pending_payment: 'bg-amber-50 text-amber-700 border-amber-200',
    paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    completed: 'bg-sky-50 text-sky-700 border-sky-200',
    cancelled: 'bg-stone-100 text-stone-500 border-stone-200',
  };
  const label = {
    pending_payment: 'Menunggu Pembayaran',
    paid: 'Dibayar',
    completed: 'Selesai',
    cancelled: 'Dibatalkan',
  };
  return `<span class="px-2.5 py-1 rounded-full text-[11px] font-bold border ${map[status] || ''}">${label[status] || status}</span>`;
}

function renderMyOrders(orders) {
  const container = $('#orders-list');
  const empty = $('#orders-empty');
  if (!container) return;
  if (!orders.length) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  container.innerHTML = orders
    .map(
      (order) => `
    <div class="border border-soga-100 rounded-xl p-4">
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm font-bold text-soga-950">Pesanan #${order.id}</p>
        ${orderStatusBadge(order.status)}
      </div>
      <p class="text-[11px] text-stone-500 mt-1">${new Date(order.createdAt).toLocaleString('id-ID')} · Total ${rupiah(order.totalAmount)}</p>
      <ul class="mt-2 text-xs text-stone-600 space-y-1">
        ${order.items.map((item) => `<li>${esc(item.productName)} × ${item.quantity} = ${rupiah(item.subtotal)}</li>`).join('')}
      </ul>
    </div>`
    )
    .join('');
}

function openOrders() {
  loadMyOrders();
  openModal('modal-orders');
}

/* ================================ Admin Pesanan ======================== */

async function loadAdminOrders() {
  try {
    const data = await api('/api/orders');
    renderAdminOrders(data.orders || []);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderAdminOrders(orders) {
  const tbody = $('#admin-order-rows');
  const empty = $('#admin-orders-empty');
  if (!tbody) return;
  empty.classList.toggle('hidden', orders.length > 0);
  if (!orders.length) {
    tbody.innerHTML = '';
    return;
  }
  tbody.innerHTML = orders
    .map(
      (order) => `
      <tr class="hover:bg-soga-50/70 transition">
        <td class="py-3.5 px-4 font-bold text-soga-950">#${order.id}</td>
        <td class="py-3.5 px-4">
          <p class="font-semibold text-soga-950">${esc(order.buyerName)}</p>
          <p class="text-[11px] text-stone-500">${esc(order.buyerEmail || '—')} · ${esc(order.buyerWhatsapp || '—')}</p>
        </td>
        <td class="py-3.5 px-4 font-bold text-amber-700">${rupiah(order.totalAmount)}</td>
        <td class="py-3.5 px-4">${orderStatusBadge(order.status)}</td>
        <td class="py-3.5 px-4 text-right whitespace-nowrap">
          <select data-action="order-status" data-id="${order.id}" class="px-2 py-1.5 bg-soga-50 border border-soga-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500">
            <option value="pending_payment" ${order.status === 'pending_payment' ? 'selected' : ''}>Menunggu Pembayaran</option>
            <option value="paid" ${order.status === 'paid' ? 'selected' : ''}>Dibayar</option>
            <option value="completed" ${order.status === 'completed' ? 'selected' : ''}>Selesai</option>
            <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Dibatalkan</option>
          </select>
        </td>
      </tr>`
    )
    .join('');
}

async function init() {
  $('#footer-year').textContent = new Date().getFullYear();
  loadCart();
  bindEvents();
  updateCartCount();

  try {
    const [{ user }, { products }, { categories }] = await Promise.all([
      api('/api/auth/me'),
      api('/api/products'),
      api('/api/categories'),
    ]);
    state.me = user;
    state.products = products;
    state.categories = categories;
    renderHeader();
    fillCategorySelects();
    renderCatalog();
    if (user && user.role !== 'buyer') {
      navigate(homeViewFor(user), { force: true });
    } else {
      navigate('catalog');
    }
  } catch (err) {
    toast(`Gagal memuat aplikasi: ${err.message}`, 'error');
    $('#catalog-count').textContent = 'Gagal memuat produk';
  }

  createIcons();
}

document.addEventListener('DOMContentLoaded', init);
