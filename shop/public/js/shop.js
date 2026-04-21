'use strict';

// ── GuestCart — carrello locale per utenti non registrati ─────────────────────

const GuestCart = {
  KEY: 'mfdepur_cart',

  get() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); }
    catch { return []; }
  },

  save(items) {
    localStorage.setItem(this.KEY, JSON.stringify(items));
  },

  add(product, qty) {
    const items = this.get();
    const existing = items.find(i => i.id === product.id);
    if (existing) {
      existing.qty += qty;
    } else {
      items.push({ ...product, qty });
    }
    this.save(items);
    return this.count();
  },

  update(id, qty) {
    const items = this.get();
    const item = items.find(i => i.id === id);
    if (item) { item.qty = qty; this.save(items); }
    return this.count();
  },

  remove(id) {
    const items = this.get().filter(i => i.id !== id);
    this.save(items);
    return this.count();
  },

  clear() { localStorage.removeItem(this.KEY); },

  count() { return this.get().reduce((s, i) => s + i.qty, 0); },
};

// ── Utility ───────────────────────────────────────────────────────────────────

function updateCartBadge(count) {
  const badges = document.querySelectorAll('#navCartBadge');
  badges.forEach(badge => {
    badge.textContent = count;
    badge.style.display = count > 0 ? '' : 'none';
  });
  const mobileSpans = document.querySelectorAll('#mobileCartCount');
  mobileSpans.forEach(el => { el.textContent = count > 0 ? ` (${count})` : ''; });
}

function showToast(message, type = 'success') {
  const iconPaths = {
    success: ['polyline', { points: '20 6 9 17 4 12' }],
    error:   ['path', { d: 'M12 2a10 10 0 100 20 10 10 0 000-20zM9 9l6 6M15 9l-6 6' }],
    info:    ['path', { d: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 8h.01M12 12v4' }],
  };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'toast__icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const [tag, attrs] = iconPaths[type] || iconPaths.info;
  const shape = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => shape.setAttribute(k, v));
  svg.appendChild(shape);

  const msg = document.createElement('span');
  msg.className = 'toast__msg';
  msg.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast__close';
  closeBtn.setAttribute('aria-label', 'Chiudi');
  closeBtn.textContent = '×';

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  toast.appendChild(svg);
  toast.appendChild(msg);
  toast.appendChild(closeBtn);
  document.body.appendChild(toast);

  const dismiss = () => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 300);
  };
  closeBtn.addEventListener('click', dismiss);
  requestAnimationFrame(() => toast.classList.add('toast--visible'));
  setTimeout(dismiss, 4000);
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

// ── Init — badge guest su ogni pagina ─────────────────────────────────────────

(function initGuestBadge() {
  if (window.SHOP && !window.SHOP.loggedIn) {
    const count = GuestCart.count();
    if (count > 0) updateCartBadge(count);
  }
})();

// ── Auto-merge carrello guest dopo il login ───────────────────────────────────

(async function autoMergeGuestCart() {
  // Merge solo se loggato E approvato — non toccare il localStorage di utenti in attesa
  if (!window.SHOP || !window.SHOP.loggedIn || !window.SHOP.approved) return;
  const items = GuestCart.get();
  if (items.length === 0) return;

  let merged = 0;
  for (const item of items) {
    try {
      await apiFetch('/shop/cart/add', {
        method: 'POST',
        body: JSON.stringify({ productId: item.id, quantity: item.qty }),
      });
      merged++;
    } catch { /* ignora errori di stock/priceOnRequest */ }
  }
  GuestCart.clear();

  if (merged > 0) {
    showToast(`${merged} prodott${merged === 1 ? 'o' : 'i'} del tuo carrello temporaneo aggiunt${merged === 1 ? 'o' : 'i'} all'account.`);
    // aggiorna badge con il nuovo conteggio dal server
    try {
      const cart = await apiFetch('/shop/cart/count');
      updateCartBadge(cart.count);
    } catch { window.location.reload(); }
  }
})();

// ── Add to cart — catalogo (btn-add-cart) ─────────────────────────────────────

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-add-cart');
  if (!btn) return;

  const productId = btn.dataset.id;
  const qty = parseInt(btn.dataset.qty) || 1;

  btn.disabled = true;
  const original = btn.innerHTML;
  btn.textContent = '...';

  try {
    if (window.SHOP && window.SHOP.loggedIn && window.SHOP.approved) {
      // Utente loggato e approvato → carrello DB
      const data = await apiFetch('/shop/cart/add', {
        method: 'POST',
        body: JSON.stringify({ productId, quantity: qty }),
      });
      updateCartBadge(data.cartCount);
    } else if (window.SHOP && window.SHOP.loggedIn) {
      // Loggato ma non approvato
      showToast('Il tuo account è in attesa di approvazione.', 'info');
      btn.innerHTML = original;
      btn.disabled = false;
      return;
    } else {
      // Guest → carrello localStorage
      const count = GuestCart.add({
        id: productId,
        name: btn.dataset.name || '',
        price: parseFloat(btn.dataset.price) || 0,
        unit: btn.dataset.unit || '',
        imageUrl: btn.dataset.img || '',
        minQty: qty,
      }, qty);
      updateCartBadge(count);
    }
    showToast('Prodotto aggiunto al carrello');
    btn.innerHTML = '<i class="fa-solid fa-check"></i>';
    setTimeout(() => { btn.innerHTML = original; btn.disabled = false; }, 1500);
  } catch (err) {
    showToast(err.message, 'error');
    btn.innerHTML = original;
    btn.disabled = false;
  }
});

// ── Add to cart — dettaglio prodotto (btn-add-cart-detail) ───────────────────

const detailBtn = document.querySelector('.btn-add-cart-detail');
if (detailBtn) {
  detailBtn.addEventListener('click', async () => {
    const productId = detailBtn.dataset.id;
    const minQty = parseInt(detailBtn.dataset.min) || 1;
    const qtyInput = document.getElementById('qty');
    const qty = qtyInput ? Math.max(parseInt(qtyInput.value) || minQty, minQty) : minQty;

    detailBtn.disabled = true;
    const original = detailBtn.innerHTML;
    detailBtn.textContent = 'Aggiungendo...';

    try {
      if (window.SHOP && window.SHOP.loggedIn && window.SHOP.approved) {
        const data = await apiFetch('/shop/cart/add', {
          method: 'POST',
          body: JSON.stringify({ productId, quantity: qty }),
        });
        updateCartBadge(data.cartCount);
      } else if (window.SHOP && window.SHOP.loggedIn) {
        showToast('Il tuo account è in attesa di approvazione.', 'info');
        detailBtn.innerHTML = original;
        detailBtn.disabled = false;
        return;
      } else {
        const count = GuestCart.add({
          id: productId,
          name: detailBtn.dataset.name || document.querySelector('.product-detail-title')?.textContent?.trim() || '',
          price: parseFloat(detailBtn.dataset.price) || 0,
          unit: detailBtn.dataset.unit || '',
          imageUrl: detailBtn.dataset.img || '',
          minQty,
        }, qty);
        updateCartBadge(count);
      }
      showToast('Prodotto aggiunto al carrello!');
      detailBtn.innerHTML = '<i class="fa-solid fa-check"></i> Aggiunto';
      setTimeout(() => { detailBtn.innerHTML = original; detailBtn.disabled = false; }, 2000);
    } catch (err) {
      showToast(err.message, 'error');
      detailBtn.innerHTML = original;
      detailBtn.disabled = false;
    }
  });
}

// ── Qty controls (+ / −) ─────────────────────────────────────────────────────

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.qty-btn');
  if (!btn) return;

  const action = btn.dataset.action;
  const itemId = btn.dataset.item;

  // Product detail page
  const detailInput = document.getElementById('qty');
  if (detailInput && !itemId) {
    const min = parseInt(detailInput.min) || 1;
    let val = parseInt(detailInput.value) || min;
    if (action === 'plus') val++;
    if (action === 'minus') val = Math.max(val - 1, min);
    detailInput.value = val;
    return;
  }

  // Cart page
  if (itemId) {
    const input = document.querySelector(`.cart-qty[data-item="${itemId}"]`);
    if (!input) return;
    const min = parseInt(btn.dataset.min) || 1;
    let val = parseInt(input.value) || min;
    if (action === 'plus') val++;
    if (action === 'minus') val = Math.max(val - 1, min);
    input.value = val;
    input.dispatchEvent(new Event('change'));
  }
});

// ── Cart — update quantity on change (utente loggato) ────────────────────────

document.addEventListener('change', async (e) => {
  const input = e.target.closest('.cart-qty');
  if (!input) return;

  const itemId = input.dataset.item;
  const qty = parseInt(input.value);
  const price = parseFloat(input.dataset.price);

  if (isNaN(qty) || qty < 1) return;

  try {
    const data = await apiFetch(`/shop/cart/item/${itemId}`, {
      method: 'POST',
      body: JSON.stringify({ quantity: qty }),
    });
    updateCartBadge(data.cartCount);

    const row = input.closest('.cart-row');
    if (row) {
      const rowTotal = row.querySelector('.cart-row-total');
      if (rowTotal) rowTotal.textContent = '€' + (price * qty).toFixed(2);
    }
    recalcCartSummary();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

function recalcCartSummary() {
  let subtotal = 0;
  document.querySelectorAll('.cart-qty').forEach(input => {
    const qty = parseInt(input.value) || 0;
    const price = parseFloat(input.dataset.price) || 0;
    subtotal += qty * price;
  });
  const tax = subtotal * 0.22;
  const elSub = document.getElementById('cart-subtotal');
  const elTax = document.getElementById('cart-tax');
  const elTotal = document.getElementById('cart-total');
  if (elSub) elSub.textContent = '€' + subtotal.toFixed(2);
  if (elTax) elTax.textContent = '€' + tax.toFixed(2);
  if (elTotal) elTotal.textContent = '€' + (subtotal + tax).toFixed(2);
}

// ── Cart — remove item (utente loggato) ──────────────────────────────────────

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-remove-item');
  if (!btn) return;

  const itemId = btn.dataset.item;

  try {
    const data = await apiFetch(`/shop/cart/item/${itemId}/remove`, { method: 'POST' });
    updateCartBadge(data.cartCount);

    const row = btn.closest('.cart-row');
    if (row) row.remove();
    recalcCartSummary();

    const tbody = document.querySelector('.cart-table tbody');
    if (tbody && tbody.children.length === 0) {
      window.location.reload();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ── Guest cart — render pagina carrello ──────────────────────────────────────

(function renderGuestCart() {
  const container = document.getElementById('guest-cart-container');
  if (!container) return;

  function render() {
    const items = GuestCart.get();
    if (items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity:0.3;margin-bottom:1rem"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
          <p>Il carrello è vuoto.</p>
          <a href="/shop" class="btn btn-primary">Vai al catalogo</a>
        </div>`;
      return;
    }

    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const tax = subtotal * 0.22;
    const total = subtotal + tax;

    const rows = items.map(item => `
      <tr class="cart-row" data-guest-id="${item.id}">
        <td class="cart-product">
          ${item.imageUrl
            ? `<img src="${item.imageUrl}" alt="${item.name}" class="cart-product-img">`
            : ''}
          <div><strong>${item.name}</strong></div>
        </td>
        <td>&euro;${item.price.toFixed(2)}/${item.unit}</td>
        <td>
          <div class="qty-control qty-control--sm">
            <button type="button" class="qty-btn guest-qty-btn" data-action="minus" data-guest="${item.id}" data-min="${item.minQty}">−</button>
            <input type="number" class="qty-input qty-input--sm guest-qty"
                   value="${item.qty}" min="${item.minQty}"
                   data-guest="${item.id}" data-price="${item.price}">
            <button type="button" class="qty-btn guest-qty-btn" data-action="plus" data-guest="${item.id}">+</button>
          </div>
        </td>
        <td class="cart-row-total">&euro;${(item.price * item.qty).toFixed(2)}</td>
        <td>
          <button class="btn-icon guest-remove-btn" data-guest="${item.id}" title="Rimuovi">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </td>
      </tr>`).join('');

    container.innerHTML = `
      <div class="cart-layout">
        <div class="cart-items">
          <table class="cart-table">
            <thead><tr>
              <th>Prodotto</th><th>Prezzo unitario</th><th>Quantità</th><th>Totale</th><th></th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="cart-actions">
            <a href="/shop" class="btn btn-outline">← Continua gli acquisti</a>
            <button class="btn btn-danger-outline" id="guestClearCart">Svuota carrello</button>
          </div>
        </div>
        <div class="cart-summary">
          <h3>Riepilogo ordine</h3>
          <div class="cart-summary-row"><span>Subtotale</span><span>&euro;${subtotal.toFixed(2)}</span></div>
          <div class="cart-summary-row"><span>IVA (22%)</span><span>&euro;${tax.toFixed(2)}</span></div>
          <div class="cart-summary-row"><span>Spedizione</span><span style="color:var(--text-muted)">Calcolata al checkout</span></div>
          <div class="cart-summary-total"><span>Totale stimato</span><span>&euro;${total.toFixed(2)}</span></div>
          <a href="/auth/login?redirect=/shop/cart" class="btn btn-primary btn-block" style="margin-top:1rem">
            <i class="fa-solid fa-right-to-bracket"></i> Accedi per completare l'ordine
          </a>
          <a href="/auth/register" class="btn btn-outline btn-block" style="margin-top:.5rem">
            Registra azienda
          </a>
          <p style="font-size:.8rem;color:var(--text-muted);margin-top:.75rem;text-align:center">
            Il carrello verrà salvato nel tuo account dopo l'accesso.
          </p>
        </div>
      </div>`;

    // Event: svuota
    document.getElementById('guestClearCart')?.addEventListener('click', () => {
      if (confirm('Svuotare il carrello?')) { GuestCart.clear(); updateCartBadge(0); render(); }
    });

    // Event: qty +/-
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.guest-qty-btn');
      if (!btn) return;
      const id = btn.dataset.guest;
      const action = btn.dataset.action;
      const input = container.querySelector(`.guest-qty[data-guest="${id}"]`);
      if (!input) return;
      const min = parseInt(btn.dataset.min) || 1;
      let val = parseInt(input.value) || min;
      if (action === 'plus') val++;
      if (action === 'minus') val = Math.max(val - 1, min);
      input.value = val;
      input.dispatchEvent(new Event('change'));
    });

    // Event: qty change
    container.addEventListener('change', (e) => {
      const input = e.target.closest('.guest-qty');
      if (!input) return;
      const id = input.dataset.guest;
      const qty = parseInt(input.value);
      const price = parseFloat(input.dataset.price);
      if (isNaN(qty) || qty < 1) return;
      const count = GuestCart.update(id, qty);
      updateCartBadge(count);
      const row = input.closest('.cart-row');
      if (row) {
        const rowTotal = row.querySelector('.cart-row-total');
        if (rowTotal) rowTotal.textContent = '€' + (price * qty).toFixed(2);
      }
      // Ricalcola totali
      const items = GuestCart.get();
      const sub = items.reduce((s, i) => s + i.price * i.qty, 0);
      render(); // ri-renderizza per semplicità
    });

    // Event: rimuovi
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.guest-remove-btn');
      if (!btn) return;
      const id = btn.dataset.guest;
      const count = GuestCart.remove(id);
      updateCartBadge(count);
      render();
    });
  }

  render();
})();

// ── Checkout — toggle address fields ─────────────────────────────────────────

const addressSelect = document.getElementById('address-select');
const newAddressFields = document.getElementById('new-address-fields');
if (addressSelect && newAddressFields) {
  addressSelect.addEventListener('change', () => {
    newAddressFields.style.display = addressSelect.value ? 'none' : '';
    newAddressFields.querySelectorAll('[required]').forEach(el => {
      el.required = !addressSelect.value;
    });
  });
  if (addressSelect.value) {
    newAddressFields.style.display = 'none';
  }
}
