// =============================================
// ViteTonBillet - Script principal
// Compatible tous navigateurs (Safari inclus)
// =============================================

// ─── STATE ───
var allEvents = [];
var currentCategory = 'all';
var currentSearch = '';
var visibleCount = 6;

// ─── TRACKING (Visitors) ───
function vt(name, props) {
  try {
    console.log('[VTB Track]', name, props || {});
    if (typeof visitors !== 'undefined' && visitors.track) {
      visitors.track(name, props || {});
    }
  } catch (e) {}
}

// ─── IDENTIFY USER ───
function identifyUser() {
  try {
    var u = JSON.parse(localStorage.getItem('vtb_user') || '{}');
    if (u.id && typeof visitors !== 'undefined' && visitors.identify) {
      visitors.identify({
        id: String(u.id),
        email: u.email || '',
        name: ((u.firstName || '') + ' ' + (u.lastName || '')).trim()
      });
    }
  } catch (e) {}
}

// ─── HELPERS ───
function formatPrice(cents, currency) {
  currency = currency || 'EUR';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2
  }).format(cents / 100);
}

function icon(name) {
  var icons = {
    calendar: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    pin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    user: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
  };
  return icons[name] || '';
}

function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ─── CHARGER LES EVENEMENTS ───
function loadEvents() {
  fetch('/api/events')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      allEvents = data;
      buildFilters();
      filterAndRender();
    })
    .catch(function () {
      var grid = document.getElementById('eventsGrid');
      if (grid) grid.innerHTML = '<div class="empty-state">Impossible de charger les evenements.</div>';
    });
}

// ─── CONSTRUIRE LES FILTRES ───
function buildFilters() {
  var seen = {};
  var categories = [];
  for (var i = 0; i < allEvents.length; i++) {
    var cat = allEvents[i].category;
    if (cat && !seen[cat]) {
      seen[cat] = true;
      categories.push(cat);
    }
  }
  var filtersEl = document.getElementById('filters');
  if (!filtersEl) return;
  filtersEl.innerHTML = '<button class="filter-btn active" data-category="all">Tous</button>';
  for (var j = 0; j < categories.length; j++) {
    filtersEl.innerHTML += '<button class="filter-btn" data-category="' + categories[j] + '">' + categories[j] + '</button>';
  }
}

// ─── RENDU DES CARTES ───
function renderEvents(events) {
  var grid = document.getElementById('eventsGrid');
  if (!grid) return;

  if (events.length === 0) {
    grid.innerHTML = '<div class="empty-state">' +
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:rgba(255,255,255,0.25);margin-bottom:12px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
      '<p style="color:rgba(255,255,255,0.5);font-weight:500">Aucun resultat trouve</p>' +
      '<p style="color:rgba(255,255,255,0.35);font-size:0.85rem">Essayez un autre terme de recherche ou une autre categorie</p>' +
      '</div>';
    return;
  }

  function minPrice(event) {
    var prices = [];
    for (var i = 0; i < event.tickets.length; i++) {
      prices.push(event.tickets[i].price);
    }
    if (event.dates && event.dates.length > 0) {
      for (var d = 0; d < event.dates.length; d++) {
        if (event.dates[d].tickets) {
          for (var t = 0; t < event.dates[d].tickets.length; t++) {
            prices.push(event.dates[d].tickets[t].price);
          }
        }
      }
    }
    return Math.min.apply(null, prices);
  }

  var eventsToShow = events.slice(0, visibleCount);
  var hasMore = events.length > visibleCount;
  var html = '';

  for (var i = 0; i < eventsToShow.length; i++) {
    var ev = eventsToShow[i];
    var slug = ev.slug || ev.id;
    var dateText = ev.dates && ev.dates.length > 1 ? ev.dates.length + ' dates disponibles' : ev.date;
    var timeText = ev.dates && ev.dates.length > 1 ? (ev.dates[0].time || ev.time) : ev.time;
    var locText = ev.dates && ev.dates.length > 1 ? (ev.dates[0].location || ev.location) : ev.location;

    var cardUrl = '/concert-' + slug;
    var featuredClass = ev.featured ? ' is-featured' : '';
    var isAvailable = ev.available !== false;
    html += '<a href="' + cardUrl + '" class="card-link' + (isAvailable ? '' : ' coming-soon') + featuredClass + '">' +
      '<div class="card">' +
      '<div class="card-img-wrap">' +
        '<img class="card-img" src="' + ev.image + '" alt="Affiche du concert de ' + (ev.artist || ev.name) + '" loading="lazy" />' +
        '<div class="card-img-overlay"></div>' +
        '<span class="card-cat">' + ev.category + '</span>' +
        (ev.featured ? '<span class="card-featured-badge">&#9733; A la une</span>' : '') +
        (!isAvailable ? '<div class="coming-soon-label">Bientot disponible</div>' : '') +
        '<div class="card-img-info"><h3 class="card-title">' + ev.name + '</h3>' +
        (ev.artist ? '<span class="card-artist">' + ev.artist + '</span>' : '') +
        '</div></div>' +
      '<div class="card-body">' +
        '<h3 class="card-title">' + ev.name + '</h3>' +
        (ev.artist ? '<span class="card-artist">' + ev.artist + '</span>' : '') +
        '<div class="card-details">' +
          '<div class="card-detail">' + icon('calendar') + ' <span>' + dateText + '</span></div>' +
          '<div class="card-detail">' + icon('clock') + ' <span>' + timeText + '</span></div>' +
          '<div class="card-detail">' + icon('pin') + ' <span>' + locText + '</span></div>' +
        '</div>' +
        '<div class="card-footer">' +
          '<div class="card-price-tag"><span class="card-price-from">a partir de</span>' +
          '<span class="card-price-value">' + formatPrice(minPrice(ev), ev.tickets[0].currency) + '</span></div>' +
          (isAvailable
            ? '<span class="card-cta">Voir les billets</span>'
            : '<span class="card-cta card-cta-soon">Bientot disponible</span>') +
        '</div></div></div></a>';
  }

  grid.innerHTML = html;

  // Bouton "Afficher plus"
  var existingBtn = document.getElementById('showMoreBtn');
  if (existingBtn) existingBtn.remove();

  if (hasMore) {
    var remaining = events.length - visibleCount;
    var btn = document.createElement('button');
    btn.id = 'showMoreBtn';
    btn.className = 'show-more-btn';
    btn.textContent = 'Afficher plus (' + remaining + ' restant' + (remaining > 1 ? 's' : '') + ')';
    btn.addEventListener('click', function () {
      visibleCount += 6;
      filterAndRender();
      vt('load_more_events');
    });
    grid.parentNode.insertBefore(btn, grid.nextSibling);
  }
}

// ─── FILTRER ET AFFICHER ───
function filterAndRender() {
  var filtered = allEvents;

  if (currentCategory !== 'all') {
    filtered = filtered.filter(function (ev) { return ev.category === currentCategory; });
  }

  if (currentSearch) {
    var q = normalize(currentSearch);
    filtered = filtered.filter(function (ev) {
      var text = normalize([ev.name, ev.artist, ev.location, ev.date, ev.category].join(' '));
      return text.indexOf(q) !== -1;
    });
  }

  renderEvents(filtered);

  if (currentSearch) {
    vt('search', { query: currentSearch, results: String(filtered.length) });
  }

  var countEl = document.getElementById('resultsCount');
  if (countEl) {
    if (currentSearch || currentCategory !== 'all') {
      countEl.textContent = filtered.length + ' resultat' + (filtered.length !== 1 ? 's' : '');
    } else {
      countEl.textContent = '';
    }
  }
}

// ─── SEARCH INPUTS ───
var searchInput = document.getElementById('searchInput');
var searchClear = document.getElementById('searchClear');
var heroSearchInput = document.getElementById('heroSearchInput');

if (searchInput) {
  searchInput.addEventListener('input', function () {
    currentSearch = searchInput.value.trim();
    visibleCount = 6;
    if (searchClear) searchClear.style.display = currentSearch ? 'flex' : 'none';
    if (heroSearchInput) heroSearchInput.value = searchInput.value;
    filterAndRender();
  });
}

if (searchClear) {
  searchClear.addEventListener('click', function () {
    searchInput.value = '';
    currentSearch = '';
    searchClear.style.display = 'none';
    searchInput.focus();
    if (heroSearchInput) heroSearchInput.value = '';
    filterAndRender();
  });
}

if (heroSearchInput) {
  heroSearchInput.addEventListener('input', function () {
    if (searchInput) searchInput.value = heroSearchInput.value;
    currentSearch = heroSearchInput.value.trim();
    if (searchClear) searchClear.style.display = currentSearch ? 'flex' : 'none';
    visibleCount = 6;
    filterAndRender();
  });
  heroSearchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      currentSearch = heroSearchInput.value.trim();
      if (searchInput) searchInput.value = heroSearchInput.value;
      if (searchClear) searchClear.style.display = currentSearch ? 'flex' : 'none';
      visibleCount = 6;
      filterAndRender();
      vt('hero_search_enter', { query: currentSearch });
      var eventsEl = document.getElementById('events');
      if (eventsEl) {
        setTimeout(function () { eventsEl.scrollIntoView({ behavior: 'smooth' }); }, 100);
      }
    }
  });
  heroSearchInput.addEventListener('focus', function () { vt('hero_search_focus'); });
}

// ─── CATEGORY FILTER BUTTONS ───
var filtersEl = document.getElementById('filters');
if (filtersEl) {
  filtersEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.filter-btn');
    if (!btn) return;
    var allBtns = document.querySelectorAll('.filter-btn');
    for (var i = 0; i < allBtns.length; i++) allBtns[i].classList.remove('active');
    btn.classList.add('active');
    currentCategory = btn.dataset.category;
    visibleCount = 6;
    filterAndRender();
    vt('filter_category', { category: currentCategory });
  });
}

// ─── NAVIGATION VERS PAGE EVENEMENT ───
function openEvent(slug) {
  vt('click_event', { slug: slug });
  window.location.href = '/concert-' + slug;
}

// ─── HEADER SCROLL ───
window.addEventListener('scroll', function () {
  var header = document.getElementById('header');
  if (header) header.classList.toggle('scrolled', window.scrollY > 10);
});

// ─── CARROUSEL AVIS ───
function initCarousel() {
  var track = document.getElementById('carouselTrack');
  if (!track) return;
  var slides = track.querySelectorAll('.carousel-slide');
  var dotsContainer = document.getElementById('carouselDots');
  var prevBtn = document.getElementById('carouselPrev');
  var nextBtn = document.getElementById('carouselNext');

  if (slides.length === 0) return;

  var current = 0;
  var autoplayTimer;
  var isMobile = window.innerWidth <= 768;
  var slideWidth = isMobile ? 290 : 420;

  // Creer les dots
  for (var i = 0; i < slides.length; i++) {
    var dot = document.createElement('button');
    dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
    dot.setAttribute('data-index', i);
    dotsContainer.appendChild(dot);
  }

  dotsContainer.addEventListener('click', function (e) {
    var d = e.target.closest('.carousel-dot');
    if (d) {
      goTo(parseInt(d.getAttribute('data-index'), 10));
      vt('reviews_carousel_dot');
    }
  });

  function goTo(index) {
    current = Math.max(0, Math.min(index, slides.length - 1));
    track.style.transform = 'translateX(-' + (current * slideWidth) + 'px)';
    var dots = dotsContainer.querySelectorAll('.carousel-dot');
    for (var i = 0; i < dots.length; i++) {
      if (i === current) dots[i].classList.add('active');
      else dots[i].classList.remove('active');
    }
    resetAutoplay();
  }

  function next() { goTo(current >= slides.length - 1 ? 0 : current + 1); }
  function prev() { goTo(current <= 0 ? slides.length - 1 : current - 1); }

  prevBtn.addEventListener('click', function () { prev(); vt('reviews_carousel_prev'); });
  nextBtn.addEventListener('click', function () { next(); vt('reviews_carousel_next'); });

  function resetAutoplay() {
    clearInterval(autoplayTimer);
    autoplayTimer = setInterval(next, 4000);
  }

  track.addEventListener('mouseenter', function () { clearInterval(autoplayTimer); });
  track.addEventListener('mouseleave', resetAutoplay);

  // Swipe mobile
  var startX = 0;
  track.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
  track.addEventListener('touchend', function (e) {
    var diff = startX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) next(); else prev();
    }
  }, { passive: true });

  resetAutoplay();
}

// ─── MOBILE MENU ───
var menuToggle = document.getElementById('menuToggle');
var mobileNav = document.getElementById('mobileNav');

if (menuToggle && mobileNav) {
  menuToggle.addEventListener('click', function () {
    var isOpen = mobileNav.classList.toggle('open');
    menuToggle.innerHTML = isOpen
      ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
    vt('mobile_menu_toggle');
  });
}

function closeMobileNav() {
  if (mobileNav) mobileNav.classList.remove('open');
  if (menuToggle) menuToggle.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
}

// ─── TRACKING: Scroll depth ───
var scrollDepths = { 25: false, 50: false, 75: false, 100: false };
window.addEventListener('scroll', function () {
  var scrollPct = Math.round((window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100);
  var depths = [25, 50, 75, 100];
  for (var i = 0; i < depths.length; i++) {
    if (scrollPct >= depths[i] && !scrollDepths[depths[i]]) {
      scrollDepths[depths[i]] = true;
      vt('scroll_depth', { percent: String(depths[i]) });
    }
  }
});

// ─── TRACKING: Section visibility ───
function trackVisibility(sectionId, eventName) {
  var el = document.getElementById(sectionId);
  if (el && 'IntersectionObserver' in window) {
    var tracked = false;
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting && !tracked) {
        tracked = true;
        vt(eventName);
      }
    }, { threshold: 0.3 }).observe(el);
  }
}

trackVisibility('events', 'events_section_viewed');
trackVisibility('faq', 'faq_viewed');
trackVisibility('reviews', 'reviews_viewed');

// ─── TRACKING: Contact, footer, header links ───
var contactBtn = document.getElementById('floatingContact');
if (contactBtn) contactBtn.addEventListener('click', function () { vt('contact_click', { method: 'twitter_dm' }); });

var footerLinks = document.querySelectorAll('.footer a');
for (var fl = 0; fl < footerLinks.length; fl++) {
  (function (link) {
    link.addEventListener('click', function () { vt('footer_link', { target: link.textContent.trim() }); });
  })(footerLinks[fl]);
}

var twitterLink = document.querySelector('.header-twitter');
if (twitterLink) twitterLink.addEventListener('click', function () { vt('twitter_profile_click'); });

var accountLink = document.querySelector('.header-account');
if (accountLink) accountLink.addEventListener('click', function () { vt('account_icon_click'); });

var cartLink = document.getElementById('headerCart');
if (cartLink) cartLink.addEventListener('click', function () { vt('cart_icon_click'); });

var navLinks = document.querySelectorAll('.nav a, .mobile-nav a');
for (var nl = 0; nl < navLinks.length; nl++) {
  (function (link) {
    link.addEventListener('click', function () { vt('nav_click', { target: link.getAttribute('href') || link.textContent.trim() }); });
  })(navLinks[nl]);
}

// ─── FAQ TOGGLE ───
function toggleFaq(btn) {
  var item = btn.closest('.faq-item');
  var wasOpen = item.classList.contains('open');
  var allOpen = document.querySelectorAll('.faq-item.open');
  for (var i = 0; i < allOpen.length; i++) { allOpen[i].classList.remove('open'); }
  if (!wasOpen) {
    item.classList.add('open');
    var q = btn.querySelector('span');
    vt('faq_open', { question: q ? q.textContent : '' });
  }
}

// ─── CART COUNT ───
function updateCartCount() {
  try {
    var cart = JSON.parse(localStorage.getItem('vtbCart') || '{"items":[]}');
    var count = 0;
    for (var i = 0; i < cart.items.length; i++) { count += cart.items[i].quantity; }
    var el = document.getElementById('cartCount');
    if (el) {
      if (count > 0) { el.textContent = count; el.style.display = 'flex'; }
      else { el.style.display = 'none'; }
    }
  } catch (e) {}
}

// ─── PROMO BANNER ───
function loadPromoBanner() {
  fetch('/api/settings')
    .then(function(res) { return res.json(); })
    .then(function(settings) {
      var banner = settings.promoBanner;
      var el = document.getElementById('promoBanner');
      if (!el || !banner || !banner.enabled) {
        if (el) el.style.display = 'none';
        // Reset header/mobile-nav position when no banner
        var header = document.getElementById('header');
        if (header) header.style.top = '0';
        var mobileNav = document.getElementById('mobileNav');
        if (mobileNav) mobileNav.style.top = '56px';
        return;
      }
      var textEl = document.getElementById('promoText');
      var linkEl = document.getElementById('promoLink');
      if (textEl) textEl.innerHTML = '<strong>' + (banner.text || '') + '</strong>' + (banner.subtitle ? ' — ' + banner.subtitle : '');
      if (linkEl) {
        linkEl.textContent = (banner.linkText || 'Voir les places') + ' \u2192';
        var query = banner.searchQuery || banner.text || '';
        linkEl.onclick = function(e) {
          e.preventDefault();
          var input = document.getElementById('searchInput');
          if (input) { input.value = query; input.dispatchEvent(new Event('input')); }
          var eventsEl = document.getElementById('events');
          if (eventsEl) eventsEl.scrollIntoView({ behavior: 'smooth' });
          vt('promo_banner_click', { text: banner.text });
        };
      }
      // Appliquer la couleur choisie
      var colorMap = {
        orange: 'linear-gradient(90deg, #f59e0b, #f97316, #f59e0b)',
        blue: 'linear-gradient(90deg, #3b82f6, #2563eb, #3b82f6)',
        purple: 'linear-gradient(90deg, #8b5cf6, #7c3aed, #8b5cf6)',
        red: 'linear-gradient(90deg, #ef4444, #dc2626, #ef4444)',
        green: 'linear-gradient(90deg, #22c55e, #16a34a, #22c55e)',
        pink: 'linear-gradient(90deg, #ec4899, #db2777, #ec4899)',
        dark: 'linear-gradient(90deg, #1e293b, #334155, #1e293b)',
        gold: 'linear-gradient(90deg, #d4a017, #b8860b, #d4a017)'
      };
      var bgGradient = colorMap[banner.color] || colorMap.orange;
      el.style.background = bgGradient;
      el.style.backgroundSize = '200% 100%';

      el.style.display = 'block';
      // Décaler header et mobile-nav sous la bannière
      var bannerHeight = el.offsetHeight || 36;
      var header = document.getElementById('header');
      if (header) header.style.top = bannerHeight + 'px';
      var mobileNav = document.getElementById('mobileNav');
      if (mobileNav) mobileNav.style.top = (bannerHeight + 56) + 'px';
      vt('promo_banner_viewed', { text: banner.text });
    })
    .catch(function() {
      var el = document.getElementById('promoBanner');
      if (el) el.style.display = 'none';
      var header = document.getElementById('header');
      if (header) header.style.top = '0';
    });
}

// ─── INIT ───
identifyUser();
updateCartCount();
loadPromoBanner();
loadEvents();
initCarousel();
