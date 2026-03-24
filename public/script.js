// =====================
// STATE
// =====================
let allEvents = [];
let currentCategory = 'all';
let currentSearch = '';
let visibleCount = 6;

// =====================
// HELPERS
// =====================
function formatPrice(cents, currency = 'EUR') {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2
  }).format(cents / 100);
}

function icon(name) {
  const icons = {
    calendar: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    pin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    user: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
  };
  return icons[name] || '';
}

// =====================
// CHARGER LES ÉVÉNEMENTS
// =====================
async function loadEvents() {
  try {
    const res = await fetch('/api/events');
    allEvents = await res.json();
    buildFilters();
    filterAndRender();
  } catch {
    document.getElementById('eventsGrid').innerHTML =
      '<div class="empty-state">Impossible de charger les événements. Vérifiez que le serveur est lancé.</div>';
  }
}

// =====================
// CONSTRUIRE LES FILTRES
// =====================
function buildFilters() {
  const categories = [...new Set(allEvents.map(e => e.category))];
  const filtersEl = document.getElementById('filters');
  filtersEl.innerHTML = '<button class="filter-btn active" data-category="all">Tous</button>';
  categories.forEach(cat => {
    filtersEl.innerHTML += `<button class="filter-btn" data-category="${cat}">${cat}</button>`;
  });
}

// =====================
// RENDU DES CARTES
// =====================
function renderEvents(events) {
  const grid = document.getElementById('eventsGrid');

  if (events.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:rgba(255,255,255,0.25);margin-bottom:12px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <p style="color:rgba(255,255,255,0.5);font-weight:500">Aucun résultat trouvé</p>
      <p style="color:rgba(255,255,255,0.35);font-size:0.85rem">Essayez un autre terme de recherche ou une autre catégorie</p>
    </div>`;
    return;
  }

  const minPrice = (event) => {
    let allPrices = event.tickets.map(t => t.price);
    // Inclure les prix des dates si elles ont leurs propres billets
    if (event.dates && event.dates.length > 0) {
      event.dates.forEach(d => {
        if (d.tickets && d.tickets.length > 0) {
          allPrices = allPrices.concat(d.tickets.map(t => t.price));
        }
      });
    }
    return Math.min(...allPrices);
  };

  // Afficher seulement visibleCount événements
  const eventsToShow = events.slice(0, visibleCount);
  const hasMore = events.length > visibleCount;

  grid.innerHTML = eventsToShow.map(event => {
    const slug = event.slug || event.id;
    return `
    <div class="card${event.available ? '' : ' sold-out'}" onclick="${event.available ? `openEvent('${slug}')` : ''}">
      <div class="card-img-wrap">
        <img class="card-img" src="${event.image}" alt="Affiche du concert de ${event.artist || event.name}" loading="lazy" />
        <div class="card-img-overlay"></div>
        <span class="card-cat">${event.category}</span>
        ${!event.available ? '<div class="sold-out-label">Complet</div>' : ''}
        <div class="card-img-info">
          <h3 class="card-title">${event.name}</h3>
          ${event.artist ? `<span class="card-artist">${event.artist}</span>` : ''}
        </div>
      </div>
      <div class="card-body">
        <h3 class="card-title">${event.name}</h3>
        ${event.artist ? `<span class="card-artist">${event.artist}</span>` : ''}
        <div class="card-details">
          <div class="card-detail">${icon('calendar')} <span>${event.dates && event.dates.length > 1 ? event.dates.length + ' dates disponibles' : event.date}</span></div>
          <div class="card-detail">${icon('clock')} <span>${event.dates && event.dates.length > 1 ? (event.dates[0].time || event.time) : event.time}</span></div>
          <div class="card-detail">${icon('pin')} <span>${event.dates && event.dates.length > 1 ? (event.dates[0].location || event.location) : event.location}</span></div>
        </div>
        <div class="card-footer">
          <div class="card-price-tag">
            <span class="card-price-from">à partir de</span>
            <span class="card-price-value">${formatPrice(minPrice(event), event.tickets[0].currency)}</span>
          </div>
          ${event.available
            ? `<button class="card-cta" onclick="event.stopPropagation(); openEvent('${slug}')">Voir les billets</button>`
            : `<button class="card-cta" disabled>Complet</button>`}
        </div>
      </div>
    </div>
  `;
  }).join('');

  // Bouton "Afficher plus"
  const existingBtn = document.getElementById('showMoreBtn');
  if (existingBtn) existingBtn.remove();

  if (hasMore) {
    const remaining = events.length - visibleCount;
    const btn = document.createElement('button');
    btn.id = 'showMoreBtn';
    btn.className = 'show-more-btn';
    btn.textContent = `Afficher plus (${remaining} restant${remaining > 1 ? 's' : ''})`;
    btn.addEventListener('click', () => {
      visibleCount += 6;
      filterAndRender();
    });
    grid.parentNode.insertBefore(btn, grid.nextSibling);
  }
}

// =====================
// SEARCH + FILTRES
// =====================
function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function filterAndRender() {
  let filtered = allEvents;

  // Category filter
  if (currentCategory !== 'all') {
    filtered = filtered.filter(ev => ev.category === currentCategory);
  }

  // Search filter
  if (currentSearch) {
    const q = normalize(currentSearch);
    filtered = filtered.filter(ev => {
      const text = normalize([ev.name, ev.artist, ev.location, ev.date, ev.category].join(' '));
      return text.includes(q);
    });
  }

  renderEvents(filtered);

  // Update results count
  const countEl = document.getElementById('resultsCount');
  if (countEl) {
    if (currentSearch || currentCategory !== 'all') {
      countEl.textContent = `${filtered.length} résultat${filtered.length !== 1 ? 's' : ''}`;
    } else {
      countEl.textContent = '';
    }
  }
}

// Search input
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');

if (searchInput) {
  searchInput.addEventListener('input', () => {
    currentSearch = searchInput.value.trim();
    visibleCount = 6;
    searchClear.style.display = currentSearch ? 'flex' : 'none';
    filterAndRender();
  });
}

if (searchClear) {
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    currentSearch = '';
    searchClear.style.display = 'none';
    searchInput.focus();
    filterAndRender();
  });
}

// Category filter buttons
document.getElementById('filters').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentCategory = btn.dataset.category;
  visibleCount = 6;
  filterAndRender();
});

// =====================
// NAVIGATION VERS PAGE ÉVÉNEMENT
// =====================
function openEvent(slug) {
  /* tracking removed */
  window.location.href = '/concert-' + slug;
}

// =====================
// HEADER SCROLL
// =====================
window.addEventListener('scroll', () => {
  document.getElementById('header').classList.toggle('scrolled', window.scrollY > 10);
});

// =====================
// CARROUSEL AVIS
// =====================
function initCarousel() {
  const track = document.getElementById('carouselTrack');
  const slides = track.querySelectorAll('.carousel-slide');
  const dotsContainer = document.getElementById('carouselDots');
  const prevBtn = document.getElementById('carouselPrev');
  const nextBtn = document.getElementById('carouselNext');

  if (!track || slides.length === 0) return;

  let current = 0;
  let autoplayTimer;
  const isMobile = window.innerWidth <= 768;
  const slideWidth = isMobile ? 290 : 420;

  // Créer les dots
  slides.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
    dot.addEventListener('click', () => goTo(i));
    dotsContainer.appendChild(dot);
  });

  function goTo(index) {
    current = Math.max(0, Math.min(index, slides.length - 1));
    track.style.transform = `translateX(-${current * slideWidth}px)`;

    // Update dots
    dotsContainer.querySelectorAll('.carousel-dot').forEach((d, i) => {
      d.classList.toggle('active', i === current);
    });

    resetAutoplay();
  }

  function next() {
    goTo(current >= slides.length - 1 ? 0 : current + 1);
  }

  function prev() {
    goTo(current <= 0 ? slides.length - 1 : current - 1);
  }

  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);

  // Autoplay
  function resetAutoplay() {
    clearInterval(autoplayTimer);
    autoplayTimer = setInterval(next, 4000);
  }

  // Pause on hover
  track.addEventListener('mouseenter', () => clearInterval(autoplayTimer));
  track.addEventListener('mouseleave', resetAutoplay);

  // Swipe mobile
  let startX = 0;
  track.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  track.addEventListener('touchend', (e) => {
    const diff = startX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      diff > 0 ? next() : prev();
    }
  }, { passive: true });

  resetAutoplay();
}

// =====================
// MOBILE MENU
// =====================
const menuToggle = document.getElementById('menuToggle');
const mobileNav = document.getElementById('mobileNav');

if (menuToggle && mobileNav) {
  menuToggle.addEventListener('click', () => {
    const isOpen = mobileNav.classList.toggle('open');
    menuToggle.innerHTML = isOpen
      ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
  });
}

function closeMobileNav() {
  if (mobileNav) mobileNav.classList.remove('open');
  if (menuToggle) menuToggle.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
}

// =====================
// INIT
// =====================
loadEvents();
initCarousel();
