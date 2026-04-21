'use strict';

// Stripe checkout — gestisce sia carta che bonifico bancario

(function () {
  const form = document.getElementById('checkout-form');
  if (!form) return;

  const stripeKey = window.STRIPE_KEY;
  if (!stripeKey) {
    console.error('Stripe public key not set');
    return;
  }

  const stripe = Stripe(stripeKey);
  const elements = stripe.elements();

  // Monta Stripe Card Element
  const cardEl = document.getElementById('card-element');
  const cardErrors = document.getElementById('card-errors');
  const stripeFields = document.getElementById('stripe-fields');
  const submitBtn = document.getElementById('submit-btn');
  const checkoutError = document.getElementById('checkout-error');

  let card = null;

  function mountCard() {
    if (card) return;
    card = elements.create('card', {
      style: {
        base: {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '16px',
          color: '#1a1a2e',
          '::placeholder': { color: '#9ca3af' },
        },
        invalid: { color: '#dc2626' },
      },
      hidePostalCode: true,
    });
    card.mount('#card-element');
    card.addEventListener('change', ({ error }) => {
      if (error) {
        cardErrors.textContent = error.message;
        cardErrors.style.display = '';
      } else {
        cardErrors.style.display = 'none';
      }
    });
  }

  mountCard();

  // Toggle metodo pagamento
  document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'STRIPE') {
        stripeFields.style.display = '';
        mountCard();
      } else {
        stripeFields.style.display = 'none';
      }
    });
  });

  // Raccoglie dati form
  function getFormData() {
    const fd = new FormData(form);
    const data = {};
    for (const [key, value] of fd.entries()) {
      data[key] = value;
    }
    return data;
  }

  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.classList.toggle('is-loading', loading);
    if (!loading) {
      submitBtn.textContent = submitBtn.dataset.originalText || submitBtn.textContent;
    }
  }

  function showError(msg) {
    checkoutError.textContent = msg;
    checkoutError.style.display = '';
    checkoutError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  if (!submitBtn.dataset.originalText) {
    submitBtn.dataset.originalText = submitBtn.textContent;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setLoading(true);
    checkoutError.style.display = 'none';

    const formData = getFormData();
    const paymentMethod = formData.paymentMethod || 'STRIPE';

    try {
      // POST al server: crea ordine + ottiene clientSecret (per Stripe) o redirect (per bonifico)
      const csrfMeta = document.querySelector('meta[name="csrf-token"]');
      const csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';
      const res = await fetch('/shop/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify(formData),
      });

      // Se bonifico → redirect diretto alla pagina di successo
      if (paymentMethod === 'BANK_TRANSFER') {
        if (res.redirected) {
          window.location.href = res.url;
          return;
        }
        const text = await res.text();
        // Potrebbe essere un redirect via body o JSON
        if (res.ok) {
          window.location.href = '/shop/checkout/success';
        } else {
          showError('Errore durante la creazione dell\'ordine. Riprova.');
          setLoading(false);
        }
        return;
      }

      // Stripe: ottieni clientSecret
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showError(data.error || 'Errore durante la creazione dell\'ordine.');
        setLoading(false);
        return;
      }

      const { clientSecret, orderId } = await res.json();

      // Conferma pagamento con Stripe
      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card },
      });

      if (error) {
        showError(error.message);
        setLoading(false);
        return;
      }

      if (paymentIntent.status === 'succeeded') {
        window.location.href = `/shop/checkout/success?orderId=${orderId}`;
      } else {
        showError(`Stato pagamento: ${paymentIntent.status}. Contattaci se il problema persiste.`);
        setLoading(false);
      }
    } catch (err) {
      showError('Errore di rete. Controlla la connessione e riprova.');
      setLoading(false);
    }
  });
})();
