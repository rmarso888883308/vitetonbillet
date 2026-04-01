require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const INFLOW_API_KEY = process.env.INFLOW_API_KEY;
const INFLOW_API_BASE = 'https://api.inflowpay.xyz';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'vitetonbillet2026';
const PUSHOVER_USER_KEY = process.env.PUSHOVER_USER_KEY;
const PUSHOVER_API_TOKEN = process.env.PUSHOVER_API_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const INFLOW_WEBHOOK_SECRET = process.env.INFLOW_WEBHOOK_SECRET;
const DATA_DIR = path.join(__dirname, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Settings (bannière promo, etc.)
function readSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      const defaults = { promoBanner: { enabled: true, text: 'Celine Dion', subtitle: 'Places disponibles !', linkText: 'Voir les places', searchQuery: 'Celine Dion' } };
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaults, null, 2), 'utf-8');
      return defaults;
    }
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch(e) { return { promoBanner: { enabled: false } }; }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

// Envoyer un email via Resend HTTP API (pas de SMTP, pas de port bloqué)
async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) { console.log('RESEND_API_KEY manquant, email non envoyé'); return false; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'ViteTonBillet <contact@vitetonbillet.com>',
        to: [to],
        subject,
        html
      })
    });
    const data = await res.json();
    console.log('Resend response status:', res.status, 'data:', JSON.stringify(data));
    if (!res.ok) { console.error('Resend error:', res.status, JSON.stringify(data)); return false; }
    console.log(`Email envoyé à ${to} (id: ${data.id})`);
    return true;
  } catch (err) {
    console.error('Erreur envoi email:', err);
    return false;
  }
}

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
app.use(helmet({
  contentSecurityPolicy: false, // Trop de scripts externes (Twitter, Visitors, Google Fonts)
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));

// Cache-Control pour les assets statiques
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1y',
  immutable: true,
  setHeaders: function(res, filePath) {
    // Pas de cache long sur HTML, JS, CSS (ils changent souvent)
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Servir les uploads depuis le volume persistant (data/uploads)
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1y', immutable: true }));

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
// USERS MANAGEMENT
// =====================
function readUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
    fs.writeFileSync(USERS_FILE, '[]', 'utf-8');
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeUsers(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

function findUserByToken(token) {
  if (!token) return null;
  const users = readUsers();
  return users.find(u => u.token === token) || null;
}

function requireAuth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  const user = findUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Non connecte' });
  req.user = user;
  next();
}

// =====================
// EMAIL — TEMPLATE HTML PRO
// =====================
function buildOrderEmailHtml(order) {
  const productsHtml = (order.products || []).map(p => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #eef2f7;font-size:14px;color:#334155;">${p.name}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #eef2f7;font-size:14px;color:#334155;text-align:center;">${p.quantity}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #eef2f7;font-size:14px;color:#334155;text-align:right;font-weight:600;">${((p.price * p.quantity) / 100).toFixed(2)} &euro;</td>
    </tr>
  `).join('');

  const totalEur = (order.amount / 100).toFixed(2);

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#050033,#0e0847);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:800;letter-spacing:-0.02em;">ViteTonBillet</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.6);font-size:13px;">Votre billetterie en ligne</p>
          </td>
        </tr>

        <!-- Content -->
        <tr>
          <td style="padding:40px;">
            <div style="text-align:center;margin-bottom:32px;">
              <div style="width:56px;height:56px;background:#dcfce7;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
                <span style="font-size:28px;">&#10003;</span>
              </div>
              <h2 style="margin:0 0 8px;font-size:22px;color:#0f172a;font-weight:800;">Commande confirmee !</h2>
              <p style="margin:0;color:#64748b;font-size:14px;">Commande #${order.id} du ${new Date(order.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </div>

            <!-- Order details -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border:1px solid #eef2f7;border-radius:12px;overflow:hidden;">
              <tr style="background:#f8fafc;">
                <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Article</td>
                <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;text-align:center;">Qte</td>
                <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;text-align:right;">Prix</td>
              </tr>
              ${productsHtml}
              <tr style="background:#f8fafc;">
                <td colspan="2" style="padding:14px 16px;font-size:15px;font-weight:800;color:#0f172a;">Total</td>
                <td style="padding:14px 16px;font-size:15px;font-weight:800;color:#0f172a;text-align:right;">${totalEur} &euro;</td>
              </tr>
            </table>

            <!-- Info box -->
            <div style="background:#eff6ff;border:1px solid #dbeafe;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
              <p style="margin:0;font-size:13px;color:#1e40af;line-height:1.6;">
                <strong>Livraison de vos billets :</strong> Vos billets electroniques vous seront envoyes par email sous 24h. Pensez a verifier vos spams.
              </p>
            </div>

            <!-- CTA -->
            <div style="text-align:center;margin-bottom:16px;">
              <a href="${BASE_URL}/mon-compte" style="display:inline-block;padding:14px 36px;background:#3b82f6;color:#ffffff;font-weight:700;font-size:14px;border-radius:10px;text-decoration:none;">Suivre ma commande</a>
            </div>
            ${order.invoiceUrl ? `<div style="text-align:center;margin-bottom:16px;">
              <a href="${order.invoiceUrl}" style="color:#3b82f6;font-size:13px;text-decoration:underline;" target="_blank">T&eacute;l&eacute;charger ma facture</a>
            </div>` : ''}

            <p style="text-align:center;color:#94a3b8;font-size:12px;margin:0;">
              Une question ? Contactez-nous sur <a href="https://x.com/Vitetonbillet" style="color:#3b82f6;">X (@Vitetonbillet)</a> ou par email a <a href="mailto:contact@vitetonbillet.com" style="color:#3b82f6;">contact@vitetonbillet.com</a>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #eef2f7;">
            <p style="margin:0;color:#94a3b8;font-size:11px;">&copy; 2026 ViteTonBillet — Tous droits reserves</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Envoyer email de confirmation
async function sendOrderConfirmationEmail(order) {
  if (!order.customerEmail) return;
  await sendEmail({
    to: order.customerEmail,
    subject: `Commande #${order.id} confirmée — ViteTonBillet`,
    html: buildOrderEmailHtml(order)
  });
}

// =====================
// PUBLIC API
// =====================

// GET /api/events — liste publique (featured en premier)
app.get('/api/events', (req, res) => {
  const events = readEvents();
  const eventsWithSlugs = events.map(e => ({ ...e, slug: e.slug || generateEventSlug(e) }));
  // Trier : featured d'abord (par ordre de featuredOrder), puis les autres
  eventsWithSlugs.sort((a, b) => {
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;
    if (a.featured && b.featured) return (a.featuredOrder || 0) - (b.featuredOrder || 0);
    return 0;
  });
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
  const { eventId, ticketTypeIndex, quantity, customerEmail, customerName, customerPhone, dateIndex, userToken } = req.body;

  if (!eventId || ticketTypeIndex === undefined || !quantity) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }

  // Si un token utilisateur est fourni, utiliser les infos du compte
  let finalEmail = customerEmail || '';
  let finalName = customerName || '';
  let finalPhone = customerPhone || '';
  if (userToken) {
    const user = findUserByToken(userToken);
    if (user) {
      finalEmail = user.email;
      finalName = `${user.firstName} ${user.lastName}`.trim();
      finalPhone = user.phone || '';
    }
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
    customerEmail: finalEmail,
    customerName: finalName,
    customerPhone: finalPhone,
    products: orderProducts,
    amount: totalAmount,
    currency: ticket.currency,
    createdAt: new Date().toISOString()
  };
  orders.push(newOrder);
  writeOrders(orders);

  // Envoyer le prix HT pour que le total TTC (après TVA 20%) = prix affiché
  const priceHT = Math.round(ticket.price / 1.20);

  const payload = {
    currency: ticket.currency,
    successUrl: `${BASE_URL}/success.html?orderId=${orderId}`,
    cancelUrl: `${BASE_URL}/index.html`,
    expiresAt: Math.floor(Date.now() / 1000) + 15 * 60,
    products: [
      {
        name: productName,
        price: priceHT,
        quantity: parseInt(quantity)
      }
    ],
    metadatas: {
      orderId: String(orderId),
      source: 'vitetonbillet',
      eventName: event.name,
      ticketType: ticket.type,
      customerName: finalName || 'Anonyme'
    },
    sessionCustomization: {
      merchantName: "ViteTonBillet",
      logoUrl: `${BASE_URL}/images/logo-128.png`,
      bgColor: "#f8fafc",
      fontColor: "#0f172a"
    }
  };

  if (finalEmail) payload.customerEmail = finalEmail;

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

// POST /api/admin/test-email — tester l'envoi d'email
app.post('/api/admin/test-email', requireAdmin, async (req, res) => {
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY non configuré' });
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Adresse email requise' });
  try {
    const testOrder = {
      id: 9999,
      customerName: 'Test Client',
      customerEmail: to,
      products: [{ name: 'Concert Test — Fosse Or', price: 4500, quantity: 2 }],
      amount: 9000,
      currency: 'EUR',
      createdAt: new Date().toISOString()
    };
    // Appel direct pour avoir l'erreur exacte
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'ViteTonBillet <contact@vitetonbillet.com>',
        to: [to],
        subject: '[TEST] Commande #9999 confirmée — ViteTonBillet',
        html: buildOrderEmailHtml(testOrder)
      })
    });
    const emailData = await emailRes.json();
    console.log('Test email Resend response:', emailRes.status, JSON.stringify(emailData));
    if (emailRes.ok) {
      res.json({ success: true, message: `Email test envoyé à ${to} (id: ${emailData.id})` });
    } else {
      res.status(500).json({ error: `Resend: ${emailData.message || JSON.stringify(emailData)}` });
    }
  } catch (err) {
    console.error('Erreur test email:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/test-pushover — tester la notification Pushover
app.post('/api/admin/test-pushover', requireAdmin, async (req, res) => {
  if (!PUSHOVER_USER_KEY || !PUSHOVER_API_TOKEN) {
    return res.status(500).json({ error: 'Pushover non configuré (PUSHOVER_USER_KEY ou PUSHOVER_API_TOKEN manquant)' });
  }
  try {
    await sendPushoverNotification(
      'Test ViteTonBillet',
      'Si tu vois cette notification, Pushover fonctionne !'
    );
    res.json({ success: true, message: 'Notification Pushover envoyée !' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/orders — liste des commandes (payées + remboursées)
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const orders = readOrders().filter(o => o.status === 'completed' || o.status === 'refunded');
  res.json(orders.reverse());
});

// GET /api/admin/orders/:id — détail d'une commande
app.get('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const orders = readOrders();
  const order = orders.find(o => o.id === parseInt(req.params.id));
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  res.json(order);
});

// POST /api/admin/orders/:id/refund — rembourser une commande via Inflow
app.post('/api/admin/orders/:id/refund', requireAdmin, async (req, res) => {
  const orders = readOrders();
  const idx = orders.findIndex(o => o.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Commande introuvable' });

  const order = orders[idx];
  if (!order.paymentId) return res.status(400).json({ error: 'Pas de paymentId pour cette commande' });
  if (order.status === 'refunded') return res.status(400).json({ error: 'Commande déjà remboursée' });

  const reason = req.body.reason || 'Remboursement demandé par l\'administrateur';

  try {
    const refundRes = await fetch(`${INFLOW_API_BASE}/api/payment/${order.paymentId}/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Inflow-Api-Key': INFLOW_API_KEY
      },
      body: JSON.stringify({ reason })
    });

    const refundData = await refundRes.json();

    if (!refundRes.ok) {
      console.error('Erreur remboursement Inflow:', refundData);
      return res.status(refundRes.status).json({ error: refundData.message || 'Erreur remboursement' });
    }

    orders[idx].status = 'refunded';
    orders[idx].refundedAt = new Date().toISOString();
    orders[idx].refundReason = reason;
    writeOrders(orders);

    // Notification Pushover
    await sendPushoverNotification(
      'Remboursement ViteTonBillet',
      `Commande #${order.id} remboursée\nClient: ${order.customerName || order.customerEmail || 'N/A'}\nMontant: ${(order.amount / 100).toFixed(2)}€\nRaison: ${reason}`
    );

    res.json({ success: true, refundData });
  } catch (err) {
    console.error('Erreur remboursement:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin/orders/:id/payment-details — détails paiement Inflow (tentatives, timeline)
app.get('/api/admin/orders/:id/payment-details', requireAdmin, async (req, res) => {
  const orders = readOrders();
  const order = orders.find(o => o.id === parseInt(req.params.id));
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  if (!order.paymentId) return res.status(400).json({ error: 'Pas de paymentId' });

  try {
    const payRes = await fetch(`${INFLOW_API_BASE}/api/payment/${order.paymentId}`, {
      headers: { 'X-Inflow-Api-Key': INFLOW_API_KEY }
    });

    if (!payRes.ok) {
      const errData = await payRes.json();
      return res.status(payRes.status).json({ error: errData.message || 'Erreur Inflow' });
    }

    const payData = await payRes.json();
    res.json(payData);
  } catch (err) {
    console.error('Erreur récupération détails paiement:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin/users — liste des utilisateurs inscrits
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = readUsers().map(u => ({
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    phone: u.phone || '',
    createdAt: u.createdAt
  }));
  res.json(users.reverse());
});

// GET /api/admin/stats — statistiques globales
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const users = readUsers();
  const orders = readOrders().filter(o => o.status === 'completed');
  const events = readEvents();
  const totalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  res.json({
    totalUsers: users.length,
    totalOrders: orders.length,
    totalEvents: events.length,
    totalRevenue
  });
});

// POST /api/admin/upload — upload d'image
app.post('/api/admin/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucune image envoyée' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// POST /api/admin/events — créer un événement
app.post('/api/admin/events', requireAdmin, (req, res) => {
  const events = readEvents();
  const { name, artist, date, time, location, image, category, description, tickets, available, dates, featured, featuredOrder } = req.body;

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
    available: available !== false,
    featured: featured || false,
    featuredOrder: featuredOrder || 0
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

// POST /api/admin/events/:id/featured — toggle mise en avant
app.post('/api/admin/events/:id/featured', requireAdmin, (req, res) => {
  const events = readEvents();
  const idx = events.findIndex(e => e.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Événement introuvable' });

  events[idx].featured = !events[idx].featured;
  if (events[idx].featured) {
    // Donner le plus petit order (sera en premier)
    const maxOrder = Math.max(0, ...events.filter(e => e.featured).map(e => e.featuredOrder || 0));
    events[idx].featuredOrder = maxOrder + 1;
  } else {
    events[idx].featuredOrder = 0;
  }

  writeEvents(events);
  res.json(events[idx]);
});

// POST /api/admin/events/reorder-featured — réordonner les événements à la une
app.post('/api/admin/events/reorder-featured', requireAdmin, (req, res) => {
  const { orderedIds } = req.body;
  if (!orderedIds || !Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds requis' });

  const events = readEvents();
  orderedIds.forEach((id, index) => {
    const ev = events.find(e => e.id === id);
    if (ev) ev.featuredOrder = index + 1;
  });

  writeEvents(events);
  res.json({ success: true });
});

// GET /api/settings — settings publiques (bannière, etc.)
app.get('/api/settings', (req, res) => {
  const settings = readSettings();
  res.json(settings);
});

// GET /api/admin/settings — settings complètes
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  res.json(readSettings());
});

// PUT /api/admin/settings — modifier les settings
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const current = readSettings();
  const updated = { ...current, ...req.body };
  writeSettings(updated);
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
  const { items, customerEmail, customerName, customerPhone, userToken } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Panier vide' });
  }

  // Si un token utilisateur est fourni, utiliser les infos du compte
  let finalEmail = customerEmail || '';
  let finalName = customerName || '';
  let finalPhone = customerPhone || '';
  if (userToken) {
    const user = findUserByToken(userToken);
    if (user) {
      finalEmail = user.email;
      finalName = `${user.firstName} ${user.lastName}`.trim();
      finalPhone = user.phone || '';
    }
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

    // Prix HT pour que le total TTC (après TVA 20%) = prix affiché
    const priceHT = Math.round(ticket.price / 1.20);

    products.push({
      name: cartProductName,
      price: priceHT,
      quantity: qty
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
    customerEmail: finalEmail,
    customerName: finalName,
    customerPhone: finalPhone,
    products: orderProducts,
    amount: totalAmount,
    currency,
    createdAt: new Date().toISOString()
  };
  orders.push(newOrder);
  writeOrders(orders);

  // Résumé des événements pour les métadonnées
  const eventNames = [...new Set(items.map(item => {
    const ev = events.find(e => e.id === parseInt(item.eventId));
    return ev ? ev.name : '';
  }).filter(Boolean))].join(', ');

  const payload = {
    currency,
    successUrl: `${BASE_URL}/success.html?orderId=${orderId}`,
    cancelUrl: `${BASE_URL}/cart.html`,
    expiresAt: Math.floor(Date.now() / 1000) + 15 * 60,
    products,
    metadatas: {
      orderId: String(orderId),
      source: 'vitetonbillet',
      eventNames,
      customerName: finalName || 'Anonyme',
      itemCount: String(items.length)
    },
    sessionCustomization: {
      merchantName: "ViteTonBillet",
      logoUrl: `${BASE_URL}/images/logo-128.png`,
      bgColor: "#f8fafc",
      fontColor: "#0f172a"
    }
  };

  if (finalEmail) payload.customerEmail = finalEmail;

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

// Fonction partagée pour confirmer une commande (utilisée par confirm-order et webhook)
async function confirmOrderById(orderId) {
  const orders = readOrders();
  const idx = orders.findIndex(o => o.id === parseInt(orderId));
  if (idx === -1) return { error: 'Commande introuvable' };

  // Ne confirmer qu'une seule fois
  if (orders[idx].status === 'completed') {
    return { success: true, alreadyConfirmed: true };
  }

  // Vérification côté serveur : interroger Inflow pour confirmer le paiement
  const order = orders[idx];
  if (order.paymentId) {
    try {
      const payRes = await fetch(`${INFLOW_API_BASE}/api/payment/${order.paymentId}`, {
        headers: { 'X-Inflow-Api-Key': INFLOW_API_KEY }
      });
      if (payRes.ok) {
        const payData = await payRes.json();
        // Vérifier que le paiement est bien réussi
        const validStatuses = ['PAYMENT_SUCCESS', 'PAYMENT_RECEIVED', 'CHECKOUT_SUCCESS'];
        if (!validStatuses.includes(payData.status)) {
          return { error: `Paiement non confirmé (statut: ${payData.status})` };
        }
        // Récupérer l'URL de la facture si disponible
        if (payData.invoiceUrl) {
          orders[idx].invoiceUrl = payData.invoiceUrl;
        }
      }
    } catch (err) {
      console.error('Erreur vérification paiement Inflow:', err.message);
      // On continue quand même pour ne pas bloquer la commande
    }
  }

  orders[idx].status = 'completed';
  orders[idx].completedAt = new Date().toISOString();
  writeOrders(orders);

  // Notification Pushover
  const confirmedOrder = orders[idx];
  const productNames = (confirmedOrder.products || []).map(p => `${p.name} x${p.quantity}`).join('\n');
  await sendPushoverNotification(
    'Nouvelle vente ViteTonBillet !',
    `Client: ${confirmedOrder.customerName || confirmedOrder.customerEmail || 'Anonyme'}\n${productNames}\nTotal: ${(confirmedOrder.amount / 100).toFixed(2)}€`
  );

  // Email de confirmation au client
  await sendOrderConfirmationEmail(confirmedOrder);

  // Lier la commande au compte utilisateur si l'email correspond
  if (confirmedOrder.customerEmail) {
    const users = readUsers();
    const user = users.find(u => u.email.toLowerCase() === confirmedOrder.customerEmail.toLowerCase());
    if (user) {
      if (!user.orderIds) user.orderIds = [];
      if (!user.orderIds.includes(confirmedOrder.id)) {
        user.orderIds.push(confirmedOrder.id);
        writeUsers(users);
      }
    }
  }

  return { success: true };
}

// POST /api/confirm-order — appelé par success.html après paiement
app.post('/api/confirm-order', async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ error: 'orderId manquant' });

  const result = await confirmOrderById(orderId);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// POST /api/webhooks/inflow — webhook Inflow (via Svix) pour mise à jour de paiement
// Format payload Inflow: { data: [{ eventType: "payment_created"|"payment_status_updated", payload: { id, status, subscriptionId? } }] }
app.post('/api/webhooks/inflow', express.json(), async (req, res) => {
  try {
    const { data } = req.body;

    if (!data || !Array.isArray(data)) {
      console.error('Webhook Inflow: format invalide', req.body);
      return res.status(400).json({ error: 'Format invalide' });
    }

    for (const event of data) {
      const { eventType, payload } = event;
      if (!payload || !payload.id) continue;

      const paymentId = payload.id;
      const status = payload.status;

      console.log(`Webhook Inflow: ${eventType} — paymentId=${paymentId}, status=${status}`);

      const orders = readOrders();
      const order = orders.find(o => o.paymentId === paymentId);

      if (!order) {
        console.log(`Webhook: aucune commande trouvée pour paymentId=${paymentId}`);
        continue;
      }

      if (eventType === 'payment_status_updated') {
        if (status === 'settled' || status === 'authorized') {
          await confirmOrderById(order.id);
        } else if (status === 'failed') {
          const idx = orders.findIndex(o => o.id === order.id);
          if (idx !== -1) {
            orders[idx].status = 'failed';
            orders[idx].failedAt = new Date().toISOString();
            writeOrders(orders);
          }
        } else if (status === 'refunded') {
          const idx = orders.findIndex(o => o.id === order.id);
          if (idx !== -1) {
            orders[idx].status = 'refunded';
            orders[idx].refundedAt = new Date().toISOString();
            orders[idx].refundStatus = status;
            writeOrders(orders);
          }
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Erreur webhook Inflow:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// =====================
// USER ACCOUNT API
// =====================

// Email de bienvenue
function buildWelcomeEmailHtml(user) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:linear-gradient(135deg,#050033,#0e0847);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:800;letter-spacing:-0.02em;">ViteTonBillet</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.6);font-size:13px;">Votre billetterie en ligne</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <div style="text-align:center;margin-bottom:32px;">
              <div style="width:56px;height:56px;background:#dcfce7;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
                <span style="font-size:28px;">&#127881;</span>
              </div>
              <h2 style="margin:0 0 8px;font-size:22px;color:#0f172a;font-weight:800;">Bienvenue ${user.firstName || ''} !</h2>
              <p style="margin:0;color:#64748b;font-size:14px;">Votre compte ViteTonBillet a bien &eacute;t&eacute; cr&eacute;&eacute;.</p>
            </div>
            <div style="background:#eff6ff;border:1px solid #dbeafe;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
              <p style="margin:0;font-size:13px;color:#1e40af;line-height:1.6;">
                Vous pouvez d&eacute;sormais commander vos billets en un clic et retrouver l'historique de toutes vos commandes dans votre espace <strong>Mon Compte</strong>.
              </p>
            </div>
            <div style="text-align:center;margin-bottom:16px;">
              <a href="${BASE_URL}" style="display:inline-block;padding:14px 36px;background:#3b82f6;color:#ffffff;font-weight:700;font-size:14px;border-radius:10px;text-decoration:none;">D&eacute;couvrir les &eacute;v&eacute;nements</a>
            </div>
            <p style="text-align:center;color:#94a3b8;font-size:12px;margin:0;">
              Une question ? Contactez-nous sur <a href="https://x.com/Vitetonbillet" style="color:#3b82f6;">X (@Vitetonbillet)</a> ou par email &agrave; <a href="mailto:contact@vitetonbillet.com" style="color:#3b82f6;">contact@vitetonbillet.com</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #eef2f7;">
            <p style="margin:0;color:#94a3b8;font-size:11px;">&copy; 2026 ViteTonBillet &mdash; Tous droits r&eacute;serv&eacute;s</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendWelcomeEmail(user) {
  if (!user.email) return;
  await sendEmail({
    to: user.email,
    subject: 'Bienvenue sur ViteTonBillet !',
    html: buildWelcomeEmailHtml(user)
  });
}

// POST /api/auth/register — inscription
app.post('/api/auth/register', async (req, res) => {
  const { email, password, firstName, lastName, phone } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caracteres minimum)' });

  const users = readUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'Un compte existe deja avec cet email' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const token = uuidv4();
  const newUser = {
    id: uuidv4(),
    email: email.toLowerCase().trim(),
    password: hashedPassword,
    firstName: firstName || '',
    lastName: lastName || '',
    phone: phone || '',
    token,
    orderIds: [],
    createdAt: new Date().toISOString()
  };

  // Lier les commandes existantes avec cet email
  const orders = readOrders();
  orders.forEach(o => {
    if (o.customerEmail && o.customerEmail.toLowerCase() === newUser.email) {
      newUser.orderIds.push(o.id);
    }
  });

  users.push(newUser);
  writeUsers(users);

  // Envoyer email de bienvenue
  sendWelcomeEmail(newUser);

  res.json({ token, user: { email: newUser.email, firstName: newUser.firstName, lastName: newUser.lastName, phone: newUser.phone } });
});

// POST /api/auth/login — connexion
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  const users = readUsers();
  const user = users.find(u => u.email === email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

  // Renouveler le token
  user.token = uuidv4();
  writeUsers(users);

  res.json({ token: user.token, user: { email: user.email, firstName: user.firstName, lastName: user.lastName, phone: user.phone } });
});

// GET /api/auth/me — profil utilisateur
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    email: req.user.email,
    firstName: req.user.firstName,
    lastName: req.user.lastName,
    phone: req.user.phone,
    createdAt: req.user.createdAt
  });
});

// GET /api/auth/orders — commandes de l'utilisateur
app.get('/api/auth/orders', requireAuth, (req, res) => {
  const orders = readOrders();
  const userOrders = orders.filter(o => {
    if (o.status !== 'completed') return false; // Uniquement les commandes payées
    // Par orderIds lies au compte
    if (req.user.orderIds && req.user.orderIds.includes(o.id)) return true;
    // Ou par email correspondant
    if (o.customerEmail && o.customerEmail.toLowerCase() === req.user.email) return true;
    return false;
  });
  res.json(userOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

// =====================
// robots.txt
// =====================
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *
Disallow: /cart.html
Disallow: /mon-compte
Disallow: /api/
Disallow: /admin.html
Allow: /
Sitemap: ${BASE_URL}/sitemap.xml
`);
});

// =====================
// sitemap.xml dynamique
// =====================
app.get('/sitemap.xml', (req, res) => {
  const events = readEvents();
  const today = new Date().toISOString().split('T')[0];
  let urls = `
  <url><loc>${BASE_URL}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>${BASE_URL}/mentions-legales</loc><changefreq>yearly</changefreq><priority>0.1</priority></url>
  <url><loc>${BASE_URL}/cgv</loc><changefreq>yearly</changefreq><priority>0.1</priority></url>
  <url><loc>${BASE_URL}/confidentialite</loc><changefreq>yearly</changefreq><priority>0.1</priority></url>`;
  events.forEach(function(e) {
    var slug = e.slug || generateEventSlug(e);
    urls += `\n  <url><loc>${BASE_URL}/concert-${slug}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`;
  });
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}
</urlset>`);
});

// =====================
// llms.txt
// =====================
app.get('/llms.txt', (req, res) => {
  res.type('text/plain').send(`# ViteTonBillet

> Marketplace de revente de billets pour concerts, festivals et spectacles en France.
> Billets 100% authentiques, verifies manuellement, livres en PDF par email.

## Pages essentielles
- [Accueil](${BASE_URL}/)
- [CGV](${BASE_URL}/cgv)
- [Mentions legales](${BASE_URL}/mentions-legales)

## Garanties
- Billets verifies avant mise en vente
- Remboursement integral si billet invalide
- Paiement securise (Visa, Mastercard, virement via Inflow)
- Livraison par email en PDF

## Contact
- Email: contact@vitetonbillet.com
- X / Twitter: @Vitetonbillet
`);
});

// Route /mon-compte → page compte
app.get('/mon-compte', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'account.html'));
});

// =====================
// SSR : /concert-[slug] — page evenement avec meta SEO dans le HTML
// =====================
app.get('/concert-:slug', (req, res) => {
  var events = readEvents();
  var slug = req.params.slug;
  var event = events.find(function(e) { return e.slug === slug; });
  if (!event) event = events.find(function(e) { return generateEventSlug(e) === slug; });

  // Si pas d'evenement, renvoyer le template client-side quand meme
  if (!event) {
    return res.sendFile(path.join(__dirname, 'public', 'event.html'));
  }

  var eventSlug = event.slug || generateEventSlug(event);
  var eventUrl = BASE_URL + '/concert-' + eventSlug;
  var title = event.name + ' — Billets | ViteTonBillet';
  var description = (event.description || ('Achetez vos billets pour ' + event.name + ' a ' + event.location)).substring(0, 160);
  var image = event.image || '';
  if (image.startsWith('/')) image = BASE_URL + image;

  // Prix min/max pour le schema
  var allTickets = event.tickets || [];
  if (event.dates) {
    event.dates.forEach(function(d) {
      if (d.tickets) allTickets = allTickets.concat(d.tickets);
    });
  }
  var prices = allTickets.map(function(t) { return t.price; }).filter(function(p) { return p > 0; });
  var minPrice = prices.length ? (Math.min.apply(null, prices) / 100).toFixed(2) : '0';
  var maxPrice = prices.length ? (Math.max.apply(null, prices) / 100).toFixed(2) : '0';

  // Schema Event + AggregateOffer JSON-LD
  var schemaEvent = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    'name': event.name,
    'eventStatus': 'https://schema.org/EventScheduled',
    'eventAttendanceMode': 'https://schema.org/OfflineEventAttendanceMode',
    'location': {
      '@type': 'Place',
      'name': event.location,
      'address': { '@type': 'PostalAddress', 'addressCountry': 'FR' }
    },
    'organizer': { '@type': 'Organization', 'name': 'ViteTonBillet', 'url': BASE_URL },
    'offers': {
      '@type': 'AggregateOffer',
      'lowPrice': minPrice,
      'highPrice': maxPrice,
      'priceCurrency': 'EUR',
      'availability': event.available !== false ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
      'url': eventUrl
    }
  };
  if (event.date) schemaEvent.startDate = event.date;
  if (event.artist) schemaEvent.performer = { '@type': 'MusicGroup', 'name': event.artist };
  if (image) schemaEvent.image = image;

  // Lire le template event.html et injecter les meta
  var html = fs.readFileSync(path.join(__dirname, 'public', 'event.html'), 'utf-8');

  // Remplacer le <title> generique
  html = html.replace(/<title>[^<]*<\/title>/, '<title>' + title.replace(/</g, '&lt;') + '</title>');

  // Injecter meta description, canonical, og, twitter:card, et schema AVANT </head>
  var inject = '\n  <meta name="description" content="' + description.replace(/"/g, '&quot;') + '" />';
  inject += '\n  <link rel="canonical" href="' + eventUrl + '" />';
  inject += '\n  <meta property="og:title" content="' + title.replace(/"/g, '&quot;') + '" />';
  inject += '\n  <meta property="og:description" content="' + description.replace(/"/g, '&quot;') + '" />';
  inject += '\n  <meta property="og:url" content="' + eventUrl + '" />';
  inject += '\n  <meta property="og:type" content="website" />';
  const ogImage = image || 'https://vitetonbillet.com/images/og-default.png';
  inject += '\n  <meta property="og:image" content="' + ogImage + '" />';
  inject += '\n  <meta property="og:image:width" content="1200" />';
  inject += '\n  <meta property="og:image:height" content="630" />';
  inject += '\n  <meta name="twitter:card" content="summary_large_image" />';
  inject += '\n  <meta name="twitter:title" content="' + title.replace(/"/g, '&quot;') + '" />';
  inject += '\n  <meta name="twitter:description" content="' + description.replace(/"/g, '&quot;') + '" />';
  inject += '\n  <meta name="twitter:image" content="' + ogImage + '" />';
  inject += '\n  <script type="application/ld+json">' + JSON.stringify(schemaEvent) + '</script>';
  html = html.replace('</head>', inject + '\n</head>');

  // Injecter le nom de l'event dans le H1 pour que le HTML statique ait le contenu
  html = html.replace('<h1 id="evName"></h1>', '<h1 id="evName">' + event.name.replace(/</g, '&lt;') + '</h1>');
  html = html.replace('<h1 id="evName" class="event-title"></h1>', '<h1 id="evName" class="event-title">' + event.name.replace(/</g, '&lt;') + '</h1>');

  res.send(html);
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

// Auto-expiration des commandes pending > 15 minutes
function expireOldPendingOrders() {
  const orders = readOrders();
  const now = Date.now();
  let changed = false;
  for (const order of orders) {
    if (order.status === 'pending' && order.createdAt) {
      const age = now - new Date(order.createdAt).getTime();
      if (age > 15 * 60 * 1000) {
        order.status = 'expired';
        order.expiredAt = new Date().toISOString();
        changed = true;
      }
    }
  }
  if (changed) writeOrders(orders);
}

// Vérifier toutes les 5 minutes
setInterval(expireOldPendingOrders, 5 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`ViteTonBillet — Serveur démarré sur http://localhost:${PORT}`);
  console.log(`Admin : http://localhost:${PORT}/admin.html`);
  expireOldPendingOrders(); // Nettoyage au démarrage
});
