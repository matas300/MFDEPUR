/* ══════════════════════════════════════════════════
   MFDEPUR – main.js
   AOS · Navbar · Mobile menu · Smooth scroll ·
   Counter animation · Form · Back-to-top
══════════════════════════════════════════════════ */

'use strict';

/* ─── AOS ────────────────────────────────────── */
AOS.init({
  duration: 700,
  easing:   'ease-out-cubic',
  once:     true,
  offset:   70,
});

/* ─── GSAP ───────────────────────────────────── */
gsap.registerPlugin(ScrollTrigger);


/* ══════════════════════════════════════════════
   NAVBAR – transparent / scrolled + active link
══════════════════════════════════════════════ */
const header   = document.getElementById('site-header');
const sections = [...document.querySelectorAll('section[id], div[id="hero"]')];
const navLinks = [...document.querySelectorAll('.nav-link[data-s]')];

function onScroll() {
  const scrolled = window.scrollY > 60;

  // Transparent vs scrolled class
  if (scrolled) {
    header.classList.remove('is-transparent');
    header.classList.add('is-scrolled');
  } else {
    header.classList.add('is-transparent');
    header.classList.remove('is-scrolled');
  }

  // Active section highlight
  let current = '';
  sections.forEach(sec => {
    if (sec.getBoundingClientRect().top <= 90) current = sec.id;
  });
  navLinks.forEach(link => {
    link.classList.toggle('is-active', link.dataset.s === current);
  });

  // Back-to-top visibility
  backToTop.classList.toggle('is-visible', window.scrollY > 500);
}

window.addEventListener('scroll', onScroll, { passive: true });
// Run once on load to set initial state
onScroll();


/* ══════════════════════════════════════════════
   MOBILE MENU
══════════════════════════════════════════════ */
const hamburger  = document.querySelector('.hamburger');
const mobileNav  = document.getElementById('mobile-nav');
const backdrop   = document.querySelector('.mobile-nav__backdrop');
const closeBtn   = document.querySelector('.mobile-nav__close');
const mobileLinks= document.querySelectorAll('.mobile-nav__link');

function openMenu() {
  hamburger.classList.add('is-open');
  mobileNav.classList.add('is-open');
  backdrop.classList.add('is-open');
  mobileNav.setAttribute('aria-hidden', 'false');
  hamburger.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}

function closeMenu() {
  hamburger.classList.remove('is-open');
  mobileNav.classList.remove('is-open');
  backdrop.classList.remove('is-open');
  mobileNav.setAttribute('aria-hidden', 'true');
  hamburger.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

hamburger.addEventListener('click', () =>
  mobileNav.classList.contains('is-open') ? closeMenu() : openMenu()
);
closeBtn.addEventListener('click', closeMenu);
backdrop.addEventListener('click', closeMenu);
mobileLinks.forEach(link => link.addEventListener('click', closeMenu));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && mobileNav.classList.contains('is-open')) closeMenu();
});
window.addEventListener('resize', () => {
  if (window.innerWidth > 768) closeMenu();
});


/* ══════════════════════════════════════════════
   SMOOTH SCROLL
══════════════════════════════════════════════ */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const href   = this.getAttribute('href').split('?')[0]; // strip query params
    const target = document.querySelector(href);
    if (!target) return;
    e.preventDefault();

    const navH    = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 70;
    const offsetY = target.getBoundingClientRect().top + window.scrollY - navH;
    window.scrollTo({ top: offsetY, behavior: 'smooth' });
  });
});


/* ══════════════════════════════════════════════
   COUNTER ANIMATION (GSAP)
══════════════════════════════════════════════ */
document.querySelectorAll('.count[data-target]').forEach(el => {
  const target = parseFloat(el.dataset.target);
  if (isNaN(target)) return;

  // Detect if value is a year (4-digit number)
  const isYear = target > 1900 && target < 2100;

  ScrollTrigger.create({
    trigger: el,
    start:   'top 88%',
    once:    true,
    onEnter: () => {
      const obj = { val: isYear ? target - 30 : 0 };
      gsap.to(obj, {
        val:      target,
        duration: isYear ? 1.2 : 1.6,
        ease:     'power2.out',
        onUpdate: function () {
          el.textContent = Math.round(obj.val);
        },
      });
    },
  });
});


/* ══════════════════════════════════════════════
   PRODUCT CARD – subtle GSAP hover boost
══════════════════════════════════════════════ */
document.querySelectorAll('.product-card').forEach(card => {
  card.addEventListener('mouseenter', () =>
    gsap.to(card, { duration: .25, y: -8, ease: 'power2.out' })
  );
  card.addEventListener('mouseleave', () =>
    gsap.to(card, { duration: .25, y: 0, ease: 'power2.out' })
  );
});


/* ══════════════════════════════════════════════
   HERO LOGO SCALE ON SCROLL
══════════════════════════════════════════════ */
ScrollTrigger.create({
  trigger: 'body',
  start:   'top -100px',
  onEnter:     () => gsap.to('.header-logo img', { duration: .3, scale: .88, ease: 'power2.out' }),
  onLeaveBack: () => gsap.to('.header-logo img', { duration: .3, scale: 1,   ease: 'power2.out' }),
});


/* ══════════════════════════════════════════════
   BACK TO TOP
══════════════════════════════════════════════ */
const backToTop = document.getElementById('backToTop');
backToTop.addEventListener('click', () =>
  window.scrollTo({ top: 0, behavior: 'smooth' })
);


/* ══════════════════════════════════════════════
   CONTACT FORM
══════════════════════════════════════════════ */
const contactForm = document.getElementById('contactForm');
const formStatus  = document.getElementById('form-status');
const submitBtn   = document.getElementById('submitBtn');

// Pre-select dropdown if URL has ?settore=…
(function () {
  const hash = window.location.hash; // e.g. #contact?settore=caldaie
  if (!hash.includes('?settore=')) return;
  const val = hash.split('?settore=')[1];
  const sel = document.getElementById('settore');
  if (sel && val) sel.value = val;
})();

// Also handle click on product CTA buttons
document.querySelectorAll('a[href*="?settore="]').forEach(btn => {
  btn.addEventListener('click', function (e) {
    const val = this.getAttribute('href').split('?settore=')[1];
    const sel = document.getElementById('settore');
    if (sel && val) {
      // Small delay to let smooth scroll land first
      setTimeout(() => { sel.value = val; }, 800);
    }
  });
});

if (contactForm) {
  contactForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    if (!contactForm.checkValidity()) {
      contactForm.reportValidity();
      return;
    }

    const privacyBox = document.getElementById('privacy');
    if (!privacyBox?.checked) {
      setStatus('Accetta la Privacy Policy per inviare il modulo.', 'error');
      return;
    }

    // UI – loading state
    const btnLabel = submitBtn.querySelector('.btn__label');
    const btnIco   = submitBtn.querySelector('.btn__ico');
    submitBtn.disabled  = true;
    if (btnLabel) btnLabel.textContent = 'Invio in corso…';
    if (btnIco)   { btnIco.classList.remove('fa-paper-plane'); btnIco.classList.add('fa-spinner', 'fa-spin'); }

    try {
      const res  = await fetch('/contact.php', { method: 'POST', body: new FormData(contactForm) });
      const ct   = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json() : null;

      if (data?.success) {
        setStatus(data.message || 'Richiesta inviata! Ti contatteremo entro 2 ore.', 'success');
        contactForm.reset();
        if (btnLabel) btnLabel.textContent = 'Inviato ✓';
        if (btnIco)   { btnIco.classList.remove('fa-spinner', 'fa-spin'); btnIco.classList.add('fa-check'); }
        setTimeout(() => resetBtn(btnLabel, btnIco), 4000);
      } else {
        throw new Error(data?.message || 'Errore durante l\'invio.');
      }
    } catch (err) {
      console.error('[MFDEPUR form]', err);
      setStatus(err.message || 'Errore di connessione. Riprova o chiamaci direttamente.', 'error');
      resetBtn(btnLabel, btnIco);
    }
  });
}

function setStatus(msg, type) {
  if (!formStatus) return;
  formStatus.textContent = msg;
  formStatus.className   = 'form-status is-' + type;
  // Auto-hide success after 8s
  if (type === 'success') setTimeout(() => { formStatus.className = 'form-status'; }, 8000);
}

function resetBtn(label, ico) {
  if (submitBtn) submitBtn.disabled = false;
  if (label) label.textContent = 'Invia Richiesta';
  if (ico)   { ico.className = 'fas fa-paper-plane btn__ico'; }
}
