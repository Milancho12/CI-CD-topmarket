const express = require('express');
const router = express.Router();

const BACKEND = process.env.BACKEND_URL || 'http://backend:3002';

async function api(path, opts = {}) {
  return fetch(`${BACKEND}${path}`, opts);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// GET /driver — home page
router.get('/', async (req, res) => {
  try {
    const driverId = req.session.user.id;
    const date = req.query.date || today();
    const qs = `driverId=${driverId}&date=${date}`;
    const data = await api(`/api/driver/home?${qs}`).then(r => r.json());
    // Expose hasPortal on res.locals.user for EJS
    if (res.locals.user) res.locals.user.hasPortal = data.hasPortal;
    res.render('driver/home', data);
  } catch (e) { res.status(500).send(e.message); }
});

// GET /driver/tomorrow-orders
router.get('/tomorrow-orders', async (req, res) => {
  try {
    const driverId = req.session.user.id;
    const date = req.query.date || today();
    const data = await api(`/api/driver/tomorrow-orders?driverId=${driverId}&date=${date}`).then(r => r.json());
    res.render('driver/tomorrow-orders', data);
  } catch (e) { res.status(500).send(e.message); }
});

// GET /driver/market/:marketId
router.get('/market/:marketId', async (req, res) => {
  try {
    const driverId = req.session.user.id;
    const { marketId } = req.params;
    const date = req.query.date || today();
    const data = await api(`/api/driver/market/${marketId}?driverId=${driverId}&date=${date}`).then(r => r.json());
    if (data.error) return res.redirect('/driver');
    res.render('driver/market', data);
  } catch (e) { res.status(500).send(e.message); }
});

// POST /driver/market/:marketId
router.post('/market/:marketId', async (req, res) => {
  try {
    const driverId = req.session.user.id;
    const { marketId } = req.params;
    const date = req.query.date || today();
    const r = await api(`/api/driver/market/${marketId}?driverId=${driverId}&date=${date}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    res.status(r.status).json(await r.json());
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// GET /driver/loading-list
router.get('/loading-list', async (req, res) => {
  try {
    const driverId = req.session.user.id;
    const date = req.query.date || today();
    const data = await api(`/api/driver/loading-list?driverId=${driverId}&date=${date}`).then(r => r.json());
    res.render('driver/loading-list', data);
  } catch (e) { res.status(500).send(e.message); }
});

// POST /driver/loading-list
router.post('/loading-list', async (req, res) => {
  try {
    const driverId = req.session.user.id;
    const date = req.query.date || today();
    const r = await api(`/api/driver/loading-list?driverId=${driverId}&date=${date}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    res.status(r.status).json(await r.json());
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// GET /driver/total-returns
router.get('/total-returns', async (req, res) => {
  try {
    const driverId = req.session.user.id;
    const date = req.query.date || today();
    const data = await api(`/api/driver/total-returns?driverId=${driverId}&date=${date}`).then(r => r.json());
    res.render('driver/total-returns', data);
  } catch (e) { res.status(500).send(e.message); }
});

// POST /driver/send-order
router.post('/send-order', async (req, res) => {
  try {
    const driverId = req.session.user.id;
    const r = await api('/api/driver/send-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId })
    });
    res.status(r.status).json(await r.json());
  } catch (e) { res.json({ success: false, error: e.message }); }
});

module.exports = router;
