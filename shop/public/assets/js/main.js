/* ================================================
   MFDEPUR – Script principale
   ================================================ */

'use strict';

/* -----------------------------------------------
   AOS – Animate On Scroll
----------------------------------------------- */
AOS.init({
    duration: 750,
    easing: 'ease-out-cubic',
    once: true,
    offset: 80,
});

/* -----------------------------------------------
   GSAP + ScrollTrigger
----------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {

    gsap.registerPlugin(ScrollTrigger);

    /* Logo scala al scroll */
    ScrollTrigger.create({
        trigger: 'body',
        start: 'top -100px',
        onEnter:     () => gsap.to('.nav-brand img', { duration: 0.3, scale: 0.88, ease: 'power2.out' }),
        onLeaveBack: () => gsap.to('.nav-brand img', { duration: 0.3, scale: 1,    ease: 'power2.out' }),
    });

    /* Hover sulle product cards (integra CSS) */
    document.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('mouseenter', () =>
            gsap.to(card, { duration: 0.28, y: -8, ease: 'power2.out' })
        );
        card.addEventListener('mouseleave', () =>
            gsap.to(card, { duration: 0.28, y: 0,  ease: 'power2.out' })
        );
    });

    /* Stat numbers counter animation */
    const statNumbers = document.querySelectorAll('.cstat-val, .stat-number');
    statNumbers.forEach(el => {
        const text = el.textContent.trim();
        const num  = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (!isNaN(num) && num > 0) {
            ScrollTrigger.create({
                trigger: el,
                start: 'top 88%',
                once: true,
                onEnter: () => {
                    gsap.from({ val: 0 }, {
                        val: num,
                        duration: 1.4,
                        ease: 'power2.out',
                        onUpdate: function () {
                            const prefix = text.replace(/[0-9.]+.*/, '');
                            const suffix = text.replace(/^[^0-9]*[0-9.]+/, '');
                            const current = Math.round(this.targets()[0].val);
                            el.textContent = prefix + current + suffix;
                        }
                    });
                }
            });
        }
    });

});

/* -----------------------------------------------
   NAVBAR – scroll class + active link
----------------------------------------------- */
const navbar   = document.getElementById('navbar');
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-link[data-target]');

function updateNavbar() {
    if (window.scrollY > 60) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
}

function updateActiveLink() {
    let current = '';
    sections.forEach(sec => {
        const top = sec.getBoundingClientRect().top;
        if (top <= 100) current = sec.id;
    });
    navLinks.forEach(link => {
        link.classList.toggle('active', link.dataset.target === current);
    });
}

window.addEventListener('scroll', () => {
    updateNavbar();
    updateActiveLink();
}, { passive: true });

updateNavbar();

/* -----------------------------------------------
   SMOOTH SCROLL per nav links
----------------------------------------------- */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const target = document.querySelector(this.getAttribute('href'));
        if (!target) return;
        e.preventDefault();
        const offsetTop = target.getBoundingClientRect().top + window.scrollY
                          - parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height'));
        window.scrollTo({ top: offsetTop, behavior: 'smooth' });

        // Chiudi menu mobile se aperto
        closeMobileMenu();
    });
});

/* -----------------------------------------------
   HAMBURGER – mobile menu
----------------------------------------------- */
const hamburger  = document.querySelector('.hamburger');
const mobileMenu = document.getElementById('mobile-menu');
const body       = document.body;

function openMobileMenu() {
    hamburger.classList.add('open');
    mobileMenu.classList.add('open');
    hamburger.setAttribute('aria-expanded', 'true');
    mobileMenu.setAttribute('aria-hidden', 'false');
    body.style.overflow = 'hidden';
}

function closeMobileMenu() {
    hamburger.classList.remove('open');
    mobileMenu.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    mobileMenu.setAttribute('aria-hidden', 'true');
    body.style.overflow = '';
}

hamburger.addEventListener('click', () => {
    if (mobileMenu.classList.contains('open')) {
        closeMobileMenu();
    } else {
        openMobileMenu();
    }
});

/* Close on mobile link click */
document.querySelectorAll('.mobile-link').forEach(link => {
    link.addEventListener('click', closeMobileMenu);
});

/* Close on Escape */
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mobileMenu.classList.contains('open')) closeMobileMenu();
});

/* Close on resize if desktop */
window.addEventListener('resize', () => {
    if (window.innerWidth > 768) closeMobileMenu();
});

/* -----------------------------------------------
   CONTACT FORM
----------------------------------------------- */
const contactForm = document.getElementById('contactForm');
const feedback    = document.getElementById('form-feedback');

if (contactForm) {
    contactForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        if (!contactForm.checkValidity()) {
            contactForm.reportValidity();
            return;
        }

        const privacyCheck = document.getElementById('privacy');
        if (!privacyCheck || !privacyCheck.checked) {
            showFeedback('Accetta la Privacy Policy per continuare.', 'error');
            return;
        }

        const submitBtn = contactForm.querySelector('.btn-submit');
        const label     = submitBtn.querySelector('.btn-label');
        const ico       = submitBtn.querySelector('.btn-ico');

        submitBtn.disabled = true;
        if (label) label.textContent = 'Invio in corso...';
        if (ico)   { ico.classList.remove('fa-paper-plane'); ico.classList.add('fa-spinner', 'fa-spin'); }

        const formData = new FormData(contactForm);

        try {
            const response = await fetch('/contact.php', {
                method: 'POST',
                body: formData,
            });

            const contentType = response.headers.get('content-type') || '';
            let data;

            if (contentType.includes('application/json')) {
                data = await response.json();
            } else {
                throw new Error('Risposta non valida dal server.');
            }

            if (data && data.success) {
                showFeedback(data.message || 'Richiesta inviata con successo! Ti contatteremo presto.', 'success');
                contactForm.reset();
                if (label) label.textContent = 'Inviato!';
                if (ico)   { ico.classList.remove('fa-spinner', 'fa-spin'); ico.classList.add('fa-check'); }
                setTimeout(() => resetBtn(submitBtn, label, ico), 3500);
            } else {
                throw new Error(data?.message || 'Errore durante l\'invio.');
            }

        } catch (err) {
            console.error('Form error:', err);
            showFeedback(err.message || 'Errore di connessione. Riprova più tardi.', 'error');
            resetBtn(submitBtn, label, ico);
        }
    });
}

function showFeedback(msg, type) {
    if (!feedback) return;
    feedback.textContent = msg;
    feedback.className   = 'form-feedback ' + type;
    setTimeout(() => { if (feedback) feedback.className = 'form-feedback'; }, 6000);
}

function resetBtn(btn, label, ico) {
    btn.disabled = false;
    if (label) label.textContent = 'Invia Richiesta';
    if (ico)   { ico.className = 'fas fa-paper-plane btn-ico'; }
}
