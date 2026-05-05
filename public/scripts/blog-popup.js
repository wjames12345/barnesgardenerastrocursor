(function(){
  /* iOS-style notification popup — first visit to What's Growing.
     Markup lives in blog.astro overlay slot; init defers to DOMContentLoaded
     so getElementById finds the popup. Lifted from THE WEBSITE.html script B
     7666–7831, wrapped in our own IIFE. */
  function initBlogPopup() {
    const popup       = document.getElementById('blogPopup');
    const popupForm   = document.getElementById('blogPopupForm');
    const veil        = document.getElementById('blogBlurVeil');
    if (!popup) return;

    const STORAGE_KEY = 'blogPopupSeen';
    const FADE_MS = 480;
    let showTimer = null;
    let hideTimer = null;
    let previouslyFocused = null;

    function showPopup() {
      // Always show on every blog visit — no session suppression.
      // Cancel any in-flight fade-out so a fresh open isn't undone by it.
      clearTimeout(hideTimer); hideTimer = null;
      if (veil) veil.style.opacity = '';
      // Remember what was focused so we can restore it on close.
      previouslyFocused = document.activeElement;
      popup.setAttribute('aria-hidden', 'false');
      document.body.classList.add('blog-popup-open');
      if (veil) veil.setAttribute('aria-hidden', 'false');
      // Slight delay so the entry animation reads clearly after a page transition.
      // Once the popup is visible, move focus into the email input — typing
      // is the primary action and that's where the user is going next.
      clearTimeout(showTimer);
      showTimer = setTimeout(() => {
        popup.classList.add('visible');
        const firstInput = popup.querySelector('input[type="email"]');
        if (firstInput) {
          try { firstInput.focus({ preventScroll: true }); } catch (_) { firstInput.focus(); }
        }
      }, 480);
    }

    // Internal: fade the popup + veil out IN PLACE, then strip the
    // blog-popup-open class only AFTER the fade completes. Removing that
    // class earlier snaps the popup back toward its default top-right
    // anchor mid-animation — that's the "flying" we want to avoid.
    function fadeOutInPlace(setSeen) {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      popup.classList.remove('visible');
      // Fade the veil simultaneously by overriding its CSS opacity rule.
      if (veil) veil.style.opacity = '0';
      if (setSeen) sessionStorage.setItem(STORAGE_KEY, '1');
      // Return focus to whatever the user was using before the popup
      // hijacked it. Doing this synchronously (not in the timeout) means
      // the focus ring doesn't sit on a fading element.
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        try { previouslyFocused.focus({ preventScroll: true }); } catch (_) { previouslyFocused.focus(); }
        previouslyFocused = null;
      }
      hideTimer = setTimeout(() => {
        document.body.classList.remove('blog-popup-open');
        popup.setAttribute('aria-hidden', 'true');
        if (veil) {
          veil.style.opacity = '';
          veil.setAttribute('aria-hidden', 'true');
        }
        hideTimer = null;
      }, FADE_MS);
    }

    // Escape-key dismissal — standard modal behaviour. Only acts when
    // the popup is actually visible so it doesn't fire when there's
    // nothing to close.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!document.body.classList.contains('blog-popup-open')) return;
      e.preventDefault();
      hidePopup();
    });

    // hidePopup: full dismiss (X button / Maybe later / form submit).
    // Sets the seen flag so the popup doesn't reappear this session.
    function hidePopup() { fadeOutInPlace(true); }

    // softHide: dismiss the popup without flagging it as seen — used when
    // the user navigates away from the blog page without engaging. The
    // popup will re-show if they return later in the same session.
    function softHide() { fadeOutInPlace(false); }

    // Cursor-tracked unblur lens — while the popup is open, every mousemove
    // updates two CSS variables on the veil. The veil's mask is a radial
    // gradient centred at (--lens-x, --lens-y), so the lens follows the
    // pointer and reveals a sharp circular spotlight onto the post grid
    // underneath. Listening on document means even cards under pointer-
    // events:none still drive the lens.
    if (veil) {
      let rafId = null;
      let pendingX = 0, pendingY = 0;
      function schedule() {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          veil.style.setProperty('--lens-x', pendingX + 'px');
          veil.style.setProperty('--lens-y', pendingY + 'px');
          rafId = null;
        });
      }
      document.addEventListener('mousemove', (e) => {
        if (!document.body.classList.contains('blog-popup-open')) return;
        pendingX = e.clientX;
        pendingY = e.clientY;
        schedule();
      }, { passive: true });
      // Touch support — drag a finger to move the lens
      document.addEventListener('touchmove', (e) => {
        if (!document.body.classList.contains('blog-popup-open')) return;
        const t = e.touches && e.touches[0];
        if (!t) return;
        pendingX = t.clientX;
        pendingY = t.clientY;
        schedule();
      }, { passive: true });
    }

    // Close button + "Maybe later"
    popup.addEventListener('click', (e) => {
      if (e.target.closest('[data-popup-close]')) hidePopup();
    });

    // Submit (no backend wired — same pattern as the podcast form)
    if (popupForm) {
      popupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = (popupForm.email.value || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          popupForm.email.focus();
          return;
        }
        popup.classList.add('thanked');
        sessionStorage.setItem(STORAGE_KEY, '1');
        setTimeout(hidePopup, 2200);
      });
    }

    // Desktop: the router dispatches a custom event from setActive. We can't
    // rely on hashchange — navigateTo uses history.replaceState which doesn't
    // fire it. Mobile: body[data-mob-page] is a real attribute swap.
    // On leaving the blog, soft-hide so the popup doesn't linger over other
    // pages. softHide doesn't set the "seen" flag — re-entering the blog in
    // the same session shows the popup again unless it was actually
    // dismissed.
    document.addEventListener('page:active', (e) => {
      if (!e || !e.detail) return;
      if (e.detail.id === 'blog') showPopup();
      else softHide();
    });
    new MutationObserver(() => {
      if (document.body.getAttribute('data-mob-page') === 'blog') showPopup();
      else softHide();
    }).observe(document.body, {
      attributes: true,
      attributeFilter: ['data-mob-page']
    });
    // File-routing in Astro: the popup should fire when the path is /blog.
    // Both on cold load and after astro:after-swap (client-side nav).
    function checkPath() {
      if (location.pathname.replace(/\/$/, '') === '/blog') showPopup();
      else softHide();
    }
    document.addEventListener('astro:after-swap', checkPath);
    document.addEventListener('astro:page-load', checkPath);
    checkPath();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBlogPopup);
  } else {
    initBlogPopup();
  }
  // Navigation listener — re-runs init after every Astro client-side
  // navigation, so the popup also fires when the user reaches /blog
  // from another route (initBlogPopup() bails on cold load if the
  // overlay markup isn't in the DOM yet for non-blog routes).
  document.addEventListener('astro:page-load', initBlogPopup);
  document.addEventListener('astro:after-swap', initBlogPopup);
})();
