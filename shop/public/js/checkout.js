'use strict';

// Checkout bonifico-only — submit handler con UX di loading.
// Il form supporta anche submit nativo senza JS (form action="/shop/checkout").

(function () {
  const form = document.getElementById('checkout-form');
  if (!form) return;

  const submitBtn = document.getElementById('submit-btn');
  const checkoutError = document.getElementById('checkout-error');

  if (submitBtn && !submitBtn.dataset.originalText) {
    submitBtn.dataset.originalText = submitBtn.textContent.trim();
  }

  function setLoading(loading) {
    if (!submitBtn) return;
    submitBtn.disabled = loading;
    submitBtn.classList.toggle('is-loading', loading);
    if (loading) {
      submitBtn.textContent = 'Invio in corso…';
    } else {
      submitBtn.textContent = submitBtn.dataset.originalText || submitBtn.textContent;
    }
  }

  // UX: prevent double-submit + loading state. Lascia al browser fare il submit nativo.
  form.addEventListener('submit', () => {
    setLoading(true);
    if (checkoutError) checkoutError.style.display = 'none';
    // submit nativo procede; il server risponde con redirect 302 a /shop/checkout/success
  });
})();
