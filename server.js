require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const INFLOW_API_KEY = process.env.INFLOW_API_KEY;
const INFLOW_API_BASE = 'https://api.inflowpay.xyz';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'vitetonbillet2026';
const PUSHOVER_USER_KEY = process.env.PUSHOVER_USER_KEY;
const PUSHOVER_API_TOKEN = process.env.PUSHOVER_API_TOKEN;
const DATA_DIR = path.join(__dirname, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

// Config multer pour l'upload d'images
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Format d\'image non supporté'));
    }
  }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Servir les uploads depuis le volume persistant (data/uploads)
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

// =====================
// HELPERS
// =====================
function readEvents() {
  if (!fs.existsSync(EVENTS_FILE)) {
    fs.mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });
    fs.writeFileSync(EVENTS_FILE, '[]', 'utf-8');
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeEvents(events) {
  fs.mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2), 'utf-8');
}

function getNextId(events) {
  if (events.length === 0) return 1;
  return Math.max(...events.map(e => e.id)) + 1;
}

// Générer un slug SEO depuis un événement
function generateEventSlug(event) {
  const text = (event.artist || event.name) + '-' + event.location;
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Middleware d'auth admin simple
function requireAdmin(req, res, next) {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Mot de passe admin incorrect' });
  }
  next();
}

// =====================
// ORDERS MANAGEMENT
// =====================
function readOrders() {
  if (!fs.existsSync(ORDERS_FILE)) {
    fs.mkdirSync(path.dirname(ORDERS_FILE), { recursive: true });
    fs.writeFileSync(ORDERS_FILE, '[]', 'utf-8');
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeOrders(orders) {
  fs.mkdirSync(path.dirname(ORDERS_FILE), { recursive: true });
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf-8');
}

function getNextOrderId(orders) {
  if (orders.length === 0) return 1;
  return Math.max(...orders.map(o => o.id)) + 1;
}

// Send Pushover notification
async function sendPushoverNotification(title, message) {
  if (!PUSHOVER_USER_KEY) return;
  try {
    await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: PUSHOVER_API_TOKEN,
        user: PUSHOVER_USER_KEY,
        title,
        message,
        priority: 1,
        sound: 'cashregister'
      })
    });
  } catch (err) {
    console.error('Pushover error:', err);
  }
}

// =====================
// PUBLIC API
// =====================

// GET /api/events — liste publique
app.get('/api/events', (req, res) => {
  const events = readEvents();
  const eventsWithSlugs = events.map(e => ({ ...e, slug: e.slug || generateEventSlug(e) }));
  res.json(eventsWithSlugs);
});

// GET /api/events/by-slug/:slug — lookup par slug SEO
app.get('/api/events/by-slug/:slug', (req, res) => {
  const events = readEvents();
  const slug = req.params.slug;
  let event = events.find(e => e.slug === slug);
  if (!event) event = events.find(e => generateEventSlug(e) === slug);
  if (!event) return res.status(404).json({ error: 'Événement introuvable' });
  res.json({ ...event, slug: event.slug || generateEventSlug(event) });
});

// GET /api/events/:id
app.get('/api/events/:id', (req, res) => {
  const events = readEvents();
  const event = events.find(e => e.id === parseInt(req.params.id));
  if (!event) return res.status(404).json({ error: 'Événement introuvable' });
  res.json({ ...event, slug: event.slug || generateEventSlug(event) });
});

// POST /api/checkout — paiement Inflow
app.post('/api/checkout', async (req, res) => {
  const { eventId, ticketTypeIndex, quantity, customerEmail, customerName, customerPhone, dateIndex } = req.body;

  if (!eventId || ticketTypeIndex === undefined || !quantity) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }

  const events = readEvents();
  const event = events.find(e => e.id === parseInt(eventId));
  if (!event) return res.status(404).json({ error: 'Événement introuvable' });
  if (!event.available) return res.status(400).json({ error: 'Événement complet' });

  // Billets spécifiques à la date ou billets globaux
  let tickets = event.tickets;
  let dateLabel = '';
  if (event.dates && dateIndex !== undefined && event.dates[dateIndex]) {
    dateLabel = event.dates[dateIndex].label;
    if (event.dates[dateIndex].tickets && event.dates[dateIndex].tickets.length > 0) {
      tickets = event.dates[dateIndex].tickets;
    }
  }

  const ticket = tickets[parseInt(ticketTypeIndex)];
  if (!ticket) return res.status(400).json({ error: 'Type de billet invalide' });

  let productName = `${event.name} — ${ticket.type}`;
  if (dateLabel) {
    productName = `${event.name} — ${dateLabel} — ${ticket.type}`;
  }

  const orderProducts = [{
    name: productName,
    price: ticket.price,
    quantity: parseInt(quantity)
  }];
  const totalAmount = ticket.price * parseInt(quantity);

  // Sauvegarder la commande en "pending"
  const orders = readOrders();
  const orderId = getNextOrderId(orders);
  const newOrder = {
    id: orderId,
    status: 'pending',
    customerEmail: customerEmail || '',
    customerName: customerName || '',
    customerPhone: customerPhone || '',
    products: orderProducts,
    amount: totalAmount,
    currency: ticket.currency,
    createdAt: new Date().toISOString()
  };
  orders.push(newOrder);
  writeOrders(orders);

  const payload = {
    currency: ticket.currency,
    successUrl: `${BASE_URL}/success.html?orderId=${orderId}`,
    cancelUrl: `${BASE_URL}/index.html`,
    products: [
      {
        name: productName,
        price: ticket.price,
        quantity: parseInt(quantity),
        taxRatePercentage: 0
      }
    ],
    sessionCustomization: {
      merchantName: "ViteTonBillet",
      bgColor: "#f8fafc",
      fontColor: "#0f172a"
    }
  };

  if (customerEmail) payload.customerEmail = customerEmail;
  if (customerName) payload.customerName = customerName;
  if (customerPhone) payload.customerPhone = customerPhone;

  try {
    const response = await fetch(`${INFLOW_API_BASE}/api/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Inflow-Api-Key': INFLOW_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Inflow API error:', data);
      return res.status(response.status).json({ error: data.message || 'Erreur de paiement' });
    }

    // Mettre à jour la commande avec le paymentId
    const updatedOrders = readOrders();
    const orderIdx = updatedOrders.findIndex(o => o.id === orderId);
    if (orderIdx !== -1) {
      updatedOrders[orderIdx].paymentId = data.paymentId;
      writeOrders(updatedOrders);
    }

    res.json({ purchaseUrl: data.purchaseUrl, paymentId: data.paymentId, orderId });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// =====================
// ADMIN API
// =====================

// POST /api/admin/login — vérifier le mot de passe
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Mot de passe incorrect' });
  }
});

// GET /api/admin/orders — liste des commandes
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const orders = readOrders();
  res.json(orders.reverse());
});

// GET /api/admin/orders/:id — détail d'une commande
app.get('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const orders = readOrders();
  const order = orders.find(o => o.id === parseInt(req.params.id));
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  res.json(order);
});

// POST /api/admin/upload — upload d'image
app.post('/api/admin/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucune image envoyée' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// POST /api/admin/events — créer un événement
app.post('/api/admin/events', requireAdmin, (req, res) => {
  const events = readEvents();
  const { name, artist, date, time, location, image, category, description, tickets, available, dates } = req.body;

  if (!name || !date || !location || !category || !tickets || tickets.length === 0) {
    return res.status(400).json({ error: 'Champs obligatoires manquants' });
  }

  const newEvent = {
    id: getNextId(events),
    name,
    artist: artist || '',
    date,
    time: time || '',
    location,
    image: image || 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80',
    category,
    description: description || '',
    tickets: tickets.map(t => ({
      type: t.type,
      price: parseInt(t.price),
      currency: t.currency || 'EUR',
      maxQuantity: t.maxQuantity ? parseInt(t.maxQuantity) : 10
    })),
    available: available !== false
  };

  if (dates && Array.isArray(dates) && dates.length > 0) {
    newEvent.dates = dates.map(d => {
      const dateObj = { label: d.label || '', time: d.time || '', location: d.location || '' };
      if (d.tickets && Array.isArray(d.tickets) && d.tickets.length > 0) {
        dateObj.tickets = d.tickets.map(t => ({
          type: t.type,
          price: parseInt(t.price),
          currency: t.currency || 'EUR',
          maxQuantity: t.maxQuantity ? parseInt(t.maxQuantity) : 10
        }));
      }
      return dateObj;
    });
  }

  events.push(newEvent);
  writeEvents(events);
  res.status(201).json(newEvent);
});

// PUT /api/admin/events/:id — modifier un événement
app.put('/api/admin/events/:id', requireAdmin, (req, res) => {
  const events = readEvents();
  const idx = events.findIndex(e => e.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Événement introuvable' });

  const updated = { ...events[idx], ...req.body, id: events[idx].id };
  if (req.body.tickets) {
    updated.tickets = req.body.tickets.map(t => ({
      type: t.type,
      price: parseInt(t.price),
      currency: t.currency || 'EUR',
      maxQuantity: t.maxQuantity ? parseInt(t.maxQuantity) : 10
    }));
  }
  if (req.body.dates && Array.isArray(req.body.dates) && req.body.dates.length > 0) {
    updated.dates = req.body.dates.map(d => {
      const dateObj = { label: d.label || '', time: d.time || '', location: d.location || '' };
      if (d.tickets && Array.isArray(d.tickets) && d.tickets.length > 0) {
        dateObj.tickets = d.tickets.map(t => ({
          type: t.type,
          price: parseInt(t.price),
          currency: t.currency || 'EUR',
          maxQuantity: t.maxQuantity ? parseInt(t.maxQuantity) : 10
        }));
      }
      return dateObj;
    });
  } else if ('dates' in req.body) {
    delete updated.dates;
  }

  events[idx] = updated;
  writeEvents(events);
  res.json(updated);
});

// DELETE /api/admin/events/:id — supprimer
app.delete('/api/admin/events/:id', requireAdmin, (req, res) => {
  let events = readEvents();
  const idx = events.findIndex(e => e.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Événement introuvable' });

  events.splice(idx, 1);
  writeEvents(events);
  res.json({ success: true });
});

// POST /api/cart-checkout — paiement panier multi-produits
app.post('/api/cart-checkout', async (req, res) => {
  const { items, customerEmail, customerName, customerPhone } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Panier vide' });
  }

  const events = readEvents();
  const products = [];
  const orderProducts = [];
  let currency = 'EUR';
  let totalAmount = 0;

  for (const item of items) {
    const event = events.find(e => e.id === parseInt(item.eventId));
    if (!event) return res.status(404).json({ error: `Événement introuvable` });
    if (!event.available) return res.status(400).json({ error: `${event.name} est complet` });

    // Billets spécifiques à la date ou billets globaux
    let tickets = event.tickets;
    let dateLabel = '';
    if (event.dates && item.dateIndex !== undefined && event.dates[item.dateIndex]) {
      dateLabel = event.dates[item.dateIndex].label;
      if (event.dates[item.dateIndex].tickets && event.dates[item.dateIndex].tickets.length > 0) {
        tickets = event.dates[item.dateIndex].tickets;
      }
    }

    const ticket = tickets[parseInt(item.ticketTypeIndex)];
    if (!ticket) return res.status(400).json({ error: 'Type de billet invalide' });

    const maxQty = ticket.maxQuantity || 10;
    if (parseInt(item.quantity) > maxQty) {
      return res.status(400).json({ error: `Maximum ${maxQty} billets pour ${event.name}` });
    }

    let cartProductName = `${event.name} — ${ticket.type}`;
    if (dateLabel) {
      cartProductName = `${event.name} — ${dateLabel} — ${ticket.type}`;
    }

    currency = ticket.currency;
    const qty = parseInt(item.quantity);
    totalAmount += ticket.price * qty;

    products.push({
      name: cartProductName,
      price: ticket.price,
      quantity: qty,
      taxRatePercentage: 0
    });

    orderProducts.push({
      name: cartProductName,
      price: ticket.price,
      quantity: qty
    });
  }

  // Sauvegarder la commande en "pending"
  const orders = readOrders();
  const orderId = getNextOrderId(orders);
  const newOrder = {
    id: orderId,
    status: 'pending',
    customerEmail: customerEmail || '',
    customerName: customerName || '',
    customerPhone: customerPhone || '',
    products: orderProducts,
    amount: totalAmount,
    currency,
    createdAt: new Date().toISOString()
  };
  orders.push(newOrder);
  writeOrders(orders);

  const payload = {
    currency,
    successUrl: `${BASE_URL}/success.html?orderId=${orderId}`,
    cancelUrl: `${BASE_URL}/cart.html`,
    products,
    sessionCustomization: {
      merchantName: "ViteTonBillet",
      bgColor: "#f8fafc",
      fontColor: "#0f172a"
    }
  };

  if (customerEmail) payload.customerEmail = customerEmail;
  if (customerName) payload.customerName = customerName;
  if (customerPhone) payload.customerPhone = customerPhone;

  try {
    const response = await fetch(`${INFLOW_API_BASE}/api/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Inflow-Api-Key': INFLOW_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Inflow API error:', data);
      return res.status(response.status).json({ error: data.message || 'Erreur de paiement' });
    }

    // Mettre à jour avec paymentId
    const updatedOrders = readOrders();
    const orderIdx = updatedOrders.findIndex(o => o.id === orderId);
    if (orderIdx !== -1) {
      updatedOrders[orderIdx].paymentId = data.paymentId;
      writeOrders(updatedOrders);
    }

    res.json({ purchaseUrl: data.purchaseUrl, orderId });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/confirm-order — appelé par success.html après paiement
app.post('/api/confirm-order', async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ error: 'orderId manquant' });

  const orders = readOrders();
  const idx = orders.findIndex(o => o.id === parseInt(orderId));
  if (idx === -1) return res.status(404).json({ error: 'Commande introuvable' });

  // Ne confirmer qu'une seule fois
  if (orders[idx].status === 'completed') {
    return res.json({ success: true, alreadyConfirmed: true });
  }

  orders[idx].status = 'completed';
  orders[idx].completedAt = new Date().toISOString();
  writeOrders(orders);

  // Notification Pushover
  const order = orders[idx];
  const productNames = (order.products || []).map(p => `${p.name} x${p.quantity}`).join('\n');
  await sendPushoverNotification(
    'Nouvelle vente ViteTonBillet !',
    `Client: ${order.customerName || order.customerEmail || 'Anonyme'}\n${productNames}\nTotal: ${(order.amount / 100).toFixed(2)}€`
  );

  res.json({ success: true });
});

// Route SEO : /concert-[slug] → event.html
app.get('/concert-:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'event.html'));
});

// Routes pages légales
app.get('/mentions-legales', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mentions-legales.html'));
});
app.get('/cgv', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cgv.html'));
});
app.get('/confidentialite', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'confidentialite.html'));
});

app.listen(PORT, () => {
  console.log(`ViteTonBillet — Serveur démarré sur http://localhost:${PORT}`);
  console.log(`Admin : http://localhost:${PORT}/admin.html`);
});
