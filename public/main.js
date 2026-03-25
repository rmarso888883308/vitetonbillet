// ─── VISITORS HELPERS ───
function vTrack(name, props) {
  try { if (typeof visitors !== 'undefined' && visitors.track) visitors.track(name, props || {}); } catch {}
}

// Cart count
function updateCartCount() {
  try {
    const cart = JSON.parse(localStorage.getItem('vtbCart') || '{"items":[]}');
    const count = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    const el = document.getElementById('cartCount');
    if (el) { if (count > 0) { el.textContent = count; el.style.display = 'flex'; } else { el.style.display = 'none'; } }
  } catch {}
}
updateCartCount();

// ─── VISITORS: Identifier l'utilisateur connecte ───
try {
  const u = JSON.parse(localStorage.getItem('vtb_user') || '{}');
  if (u.id && typeof visitors !== 'undefined' && visitors.identify) {
    visitors.identify({ id: String(u.id), email: u.email || '', name: ((u.firstName || '') + ' ' + (u.lastName || '')).trim() });
  }
} catch {}

// ─── FAQ toggle ───
function toggleFaq(btn) {
  var item = btn.closest('.faq-item');
  var wasOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item.open').forEach(function(el) { el.classList.remove('open'); });
  if (!wasOpen) {
    item.classList.add('open');
    var q = btn.querySelector('span');
    vTrack('faq_open', { question: q ? q.textContent : '' });
  }
}

// ─── TRACK: Navigation header ───
document.querySelectorAll('.nav a, .mobile-nav a').forEach(function(link) {
  link.addEventListener('click', function() {
    vTrack('nav_click', { target: link.getAttribute('href') || link.textContent.trim() });
  });
});

// ─── TRACK: Hero CTA "Voir le programme" ───
var heroCta = document.querySelector('.hero-cta-link');
if (heroCta) heroCta.addEventListener('click', function() { vTrack('hero_cta_click'); });

// ─── TRACK: Hero search ───
var heroSearchTimeout;
var heroSearch = document.getElementById('heroSearchInput');
if (heroSearch) {
  heroSearch.addEventListener('focus', function() { vTrack('hero_search_focus'); });
  heroSearch.addEventListener('input', function() {
    var mainSearch = document.getElementById('searchInput');
    if (mainSearch) mainSearch.value = heroSearch.value;
    currentSearch = heroSearch.value.trim();
    var searchClearEl = document.getElementById('searchClear');
    if (searchClearEl) searchClearEl.style.display = currentSearch ? 'flex' : 'none';
    filterAndRender();
    clearTimeout(heroSearchTimeout);
    if (currentSearch) {
      heroSearchTimeout = setTimeout(function() { vTrack('hero_search', { query: currentSearch }); }, 800);
    }
  });
  heroSearch.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      currentSearch = heroSearch.value.trim();
      var mainSearch = document.getElementById('searchInput');
      if (mainSearch) mainSearch.value = heroSearch.value;
      filterAndRender();
      vTrack('hero_search_enter', { query: currentSearch });
      setTimeout(function() {
        document.getElementById('events').scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  });
}

// ─── TRACK: Category filters ───
var filtersEl = document.getElementById('filters');
if (filtersEl) {
  filtersEl.addEventListener('click', function(e) {
    var btn = e.target.closest('.filter-btn');
    if (btn) vTrack('filter_category', { category: btn.dataset.category || btn.textContent.trim() });
  });
}

// ─── TRACK: Reviews section visibility ───
var reviewsSection = document.getElementById('reviews');
if (reviewsSection && 'IntersectionObserver' in window) {
  var reviewsTracked = false;
  new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting && !reviewsTracked) {
      reviewsTracked = true;
      vTrack('reviews_viewed');
    }
  }, { threshold: 0.3 }).observe(reviewsSection);
}

// ─── TRACK: "Voir tous les avis" link ───
var seeMoreReviews = document.querySelector('.reviews-see-more');
if (seeMoreReviews) seeMoreReviews.addEventListener('click', function() { vTrack('reviews_see_all'); });

// ─── TRACK: FAQ section visibility ───
var faqSection = document.getElementById('faq');
if (faqSection && 'IntersectionObserver' in window) {
  var faqTracked = false;
  new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting && !faqTracked) {
      faqTracked = true;
      vTrack('faq_viewed');
    }
  }, { threshold: 0.3 }).observe(faqSection);
}

// ─── TRACK: Events section visibility ───
var eventsSection = document.getElementById('events');
if (eventsSection && 'IntersectionObserver' in window) {
  var eventsTracked = false;
  new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting && !eventsTracked) {
      eventsTracked = true;
      vTrack('events_section_viewed');
    }
  }, { threshold: 0.2 }).observe(eventsSection);
}

// ─── TRACK: Contact floating button ───
var contactBtn = document.getElementById('floatingContact');
if (contactBtn) contactBtn.addEventListener('click', function() { vTrack('contact_click', { method: 'twitter_dm' }); });

// ─── TRACK: Footer legal links ───
document.querySelectorAll('.footer a').forEach(function(link) {
  link.addEventListener('click', function() { vTrack('footer_link', { target: link.textContent.trim() }); });
});

// ─── TRACK: Twitter/X link in header ───
var twitterLink = document.querySelector('.header-twitter');
if (twitterLink) twitterLink.addEventListener('click', function() { vTrack('twitter_profile_click'); });

// ─── TRACK: Account icon click ───
var accountLink = document.querySelector('.header-account');
if (accountLink) accountLink.addEventListener('click', function() { vTrack('account_icon_click'); });

// ─── TRACK: Cart icon click ───
var cartLink = document.getElementById('headerCart');
if (cartLink) cartLink.addEventListener('click', function() { vTrack('cart_icon_click'); });

// ─── TRACK: Scroll depth ───
var scrollDepths = { 25: false, 50: false, 75: false, 100: false };
window.addEventListener('scroll', function() {
  var scrollPct = Math.round((window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100);
  [25, 50, 75, 100].forEach(function(depth) {
    if (scrollPct >= depth && !scrollDepths[depth]) {
      scrollDepths[depth] = true;
      vTrack('scroll_depth', { percent: String(depth) });
    }
  });
});

// ─── TRACK: "Afficher plus" button ───
document.addEventListener('click', function(e) {
  if (e.target.id === 'loadMoreBtn' || e.target.closest('#loadMoreBtn')) {
    vTrack('load_more_events');
  }
});

// ─── TRACK: Carousel prev/next buttons ───
var carouselPrev = document.getElementById('carouselPrev');
var carouselNext = document.getElementById('carouselNext');
if (carouselPrev) carouselPrev.addEventListener('click', function() { vTrack('reviews_carousel_prev'); });
if (carouselNext) carouselNext.addEventListener('click', function() { vTrack('reviews_carousel_next'); });

// ─── TRACK: Carousel dots ───
var carouselDots = document.getElementById('carouselDots');
if (carouselDots) carouselDots.addEventListener('click', function(e) {
  if (e.target.classList.contains('carousel-dot')) {
    vTrack('reviews_carousel_dot');
  }
});

// ─── TRACK: Mobile menu toggle ───
var menuToggle = document.getElementById('menuToggle');
if (menuToggle) menuToggle.addEventListener('click', function() { vTrack('mobile_menu_toggle'); });
