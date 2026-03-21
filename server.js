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
const EVENTS_FILE = path.join(__dirname, 'data', 'events.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

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

// =====================
// HELPERS
// =====================
function readEvents() {
  const data = fs.readFileSync(EVENTS_FILE, 'utf-8');
  return JSON.parse(data);
}

function writeEvents(events) {
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2), 'utf-8');
}

function getNextId(events) {
  if (events.length === 0) return 1;
  return Math.max(...events.map(e => e.id)) + 1;
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
// PUBLIC API
// =====================

// GET /api/events — liste publique
app.get('/api/events', (req, res) => {
  const events = readEvents();
  res.json(events);
});

// GET /api/events/:id
app.get('/api/events/:id', (req, res) => {
  const events = readEvents();
  const event = events.find(e => e.id === parseInt(req.params.id));
  if (!event) return res.status(404).json({ error: 'Événement introuvable' });
  res.json(event);
});

// POST /api/checkout — paiement Inflow
app.post('/api/checkout', async (req, res) => {
  const { eventId, ticketTypeIndex, quantity, customerEmail } = req.body;

  if (!eventId || ticketTypeIndex === undefined || !quantity) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }

  const events = readEvents();
  const event = events.find(e => e.id === parseInt(eventId));
  if (!event) return res.status(404).json({ error: 'Événement introuvable' });
  if (!event.available) return res.status(400).json({ error: 'Événement complet' });

  const ticket = event.tickets[parseInt(ticketTypeIndex)];
  if (!ticket) return res.status(400).json({ error: 'Type de billet invalide' });

  const payload = {
    currency: ticket.currency,
    successUrl: `${BASE_URL}/success.html?event=${encodeURIComponent(event.name)}`,
    cancelUrl: `${BASE_URL}/index.html`,
    products: [
      {
        name: `${event.name} — ${ticket.type}`,
        price: ticket.price,
        quantity: parseInt(quantity)
      }
    ],
    sessionCustomization: {
      merchantName: "ViteTonBillet",
      bgColor: "#f8fafc",
      fontColor: "#0f172a"
    }
  };

  if (customerEmail) payload.customerEmail = customerEmail;

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

    res.json({ purchaseUrl: data.purchaseUrl, paymentId: data.paymentId });
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

// POST /api/admin/upload — upload d'image
app.post('/api/admin/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucune image envoyée' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// POST /api/admin/events — créer un événement
app.post('/api/admin/events', requireAdmin, (req, res) => {
  const events = readEvents();
  const { name, artist, date, time, location, image, category, description, tickets, available } = req.body;

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
  const { items, customerEmail } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Panier vide' });
  }

  const events = readEvents();
  const products = [];
  let currency = 'EUR';

  for (const item of items) {
    const event = events.find(e => e.id === parseInt(item.eventId));
    if (!event) return res.status(404).json({ error: `Événement introuvable` });
    if (!event.available) return res.status(400).json({ error: `${event.name} est complet` });

    const ticket = event.tickets[parseInt(item.ticketTypeIndex)];
    if (!ticket) return res.status(400).json({ error: 'Type de billet invalide' });

    const maxQty = ticket.maxQuantity || 10;
    if (parseInt(item.quantity) > maxQty) {
      return res.status(400).json({ error: `Maximum ${maxQty} billets pour ${event.name}` });
    }

    currency = ticket.currency;
    products.push({
      name: `${event.name} — ${ticket.type}`,
      price: ticket.price,
      quantity: parseInt(item.quantity)
    });
  }

  const payload = {
    currency,
    successUrl: `${BASE_URL}/success.html`,
    cancelUrl: `${BASE_URL}/cart.html`,
    products,
    sessionCustomization: {
      merchantName: "ViteTonBillet",
      bgColor: "#f8fafc",
      fontColor: "#0f172a"
    }
  };

  if (customerEmail) payload.customerEmail = customerEmail;

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

    res.json({ purchaseUrl: data.purchaseUrl });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.listen(PORT, () => {
  console.log(`ViteTonBillet — Serveur démarré sur http://localhost:${PORT}`);
  console.log(`Admin : http://localhost:${PORT}/admin.html`);
});
