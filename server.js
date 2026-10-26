require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET is not set. Set it in .env locally and in Render environment variables.');
}
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  console.warn('WARNING: ADMIN_USERNAME / ADMIN_PASSWORD are not set. Admin login will be unavailable until configured.');
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(session({
  name: 'ewaste_admin_session',
  secret: process.env.SESSION_SECRET || 'local-development-only-change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 2 * 60 * 60 * 1000
  }
}));

const publicDir = path.join(__dirname, 'public');
const viewsDir = path.join(__dirname, 'views');
app.use(express.static(publicDir, { index: false }));

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin === true) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Admin login required' });
  return res.redirect('/admin/login');
}

app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/admin/login', (req, res) => {
  if (req.session && req.session.isAdmin === true) return res.redirect('/admin');
  res.sendFile(path.join(publicDir, 'login.html'));
});
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPassword) {
    return res.status(503).json({ error: 'Admin login is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD.' });
  }
  if (typeof username !== 'string' || typeof password !== 'string' || username !== expectedUser || password !== expectedPassword) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not start admin session.' });
    req.session.isAdmin = true;
    req.session.adminUsername = expectedUser;
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ error: 'Could not save admin session.' });
      res.json({ message: 'Login successful', redirect: '/admin' });
    });
  });
});
app.post('/admin/logout', (req, res) => {
  req.session.destroy(err => {
    res.clearCookie('ewaste_admin_session', { httpOnly: true, sameSite: 'lax', secure: isProduction });
    if (err) return res.status(500).json({ error: 'Could not log out.' });
    res.json({ message: 'Logged out' });
  });
});
app.get('/admin', requireAdmin, (req, res) => res.sendFile(path.join(viewsDir, 'admin-dashboard.html')));

// Public: collection centres are visible to everyone.
app.get('/api/centres', (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM recycling_centres ORDER BY centre_id').all());
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch centres' });
  }
});

// Public: users may register, but cannot read or edit other users' records through this endpoint.
app.post('/api/users', (req, res) => {
  try {
    const { name, email, phone, address } = req.body || {};
    if (![name, email, phone, address].every(v => typeof v === 'string' && v.trim())) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const result = db.prepare('INSERT INTO users (name, email, phone, address) VALUES (?, ?, ?, ?)')
      .run(name.trim(), email.trim().toLowerCase(), phone.trim(), address.trim());
    res.status(201).json({ message: 'User registered successfully!', user_id: result.lastInsertRowid });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Email already registered' });
    console.error(error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Public: submit a request. Admin-only read/update endpoints are protected below.
app.post('/api/requests', (req, res) => {
  try {
    const { user_id, centre_id, item_type, item_condition, estimated_weight, collection_date } = req.body || {};
    const weight = Number(estimated_weight);
    if (!user_id || !Number.isInteger(Number(user_id)) || !item_type || !item_condition || estimated_weight === '' || estimated_weight === undefined || !Number.isFinite(weight) || weight <= 0) {
      return res.status(400).json({ error: 'Please provide valid required fields' });
    }
    const result = db.prepare(`INSERT INTO collection_requests
      (user_id, centre_id, item_type, item_condition, estimated_weight, collection_date)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(Number(user_id), centre_id ? Number(centre_id) : null, String(item_type), String(item_condition), weight, collection_date || null);
    res.status(201).json({ message: 'Collection request submitted successfully!', request_id: result.lastInsertRowid });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(400).json({ error: 'Invalid user ID or recycling centre ID' });
    console.error(error);
    res.status(500).json({ error: 'Failed to submit collection request' });
  }
});

// Everything below exposes private operational data or changes records: admin session required.
app.get('/api/requests', requireAdmin, (req, res) => {
  try {
    const requests = db.prepare(`SELECT cr.*, u.name AS user_name, rc.centre_name
      FROM collection_requests cr JOIN users u ON cr.user_id = u.user_id
      LEFT JOIN recycling_centres rc ON cr.centre_id = rc.centre_id
      ORDER BY cr.request_id DESC`).all();
    res.json(requests);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

app.get('/api/dashboard', requireAdmin, (req, res) => {
  try {
    const users = db.prepare('SELECT COUNT(*) AS total FROM users').get().total;
    const requests = db.prepare('SELECT COUNT(*) AS total FROM collection_requests').get().total;
    const pending = db.prepare("SELECT COUNT(*) AS total FROM collection_requests WHERE status = 'Pending'").get().total;
    const collected = db.prepare("SELECT COUNT(*) AS total FROM collection_requests WHERE status = 'Collected'").get().total;
    const recycled = db.prepare("SELECT COUNT(*) AS total FROM collection_requests WHERE status = 'Recycled'").get().total;
    const weight = db.prepare("SELECT COALESCE(SUM(actual_weight), 0) AS total FROM collection_requests WHERE status IN ('Collected', 'Recycled')").get().total;
    res.json({ totalUsers: users, totalRequests: requests, pendingRequests: pending, collectedRequests: collected, recycledRequests: recycled, totalCollectedWeight: weight });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

app.put('/api/requests/:id/status', requireAdmin, (req, res) => {
  try {
    const { status, actualWeight } = req.body || {};
    const id = Number(req.params.id);
    const allowedStatuses = ['Pending', 'Collected', 'Recycled'];
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid request ID' });
    if (!allowedStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    let result;
    if (status === 'Collected' || status === 'Recycled') {
      const weight = Number(actualWeight);
      if (actualWeight === undefined || actualWeight === null || actualWeight === '' || !Number.isFinite(weight) || weight < 0) {
        return res.status(400).json({ error: 'Please enter a valid actual weight' });
      }
      result = db.prepare('UPDATE collection_requests SET status = ?, actual_weight = ? WHERE request_id = ?').run(status, weight, id);
    } else {
      result = db.prepare('UPDATE collection_requests SET status = ? WHERE request_id = ?').run(status, id);
    }
    if (!result.changes) return res.status(404).json({ error: 'Collection request not found' });
    res.json({ message: 'Request status and weight updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update request status and weight' });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
