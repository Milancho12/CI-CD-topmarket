const express = require('express');
const router = express.Router();

const BACKEND = process.env.BACKEND_URL || 'http://backend:3002';
const WORKER  = process.env.WORKER_URL  || 'http://worker:3001';

// Helper: call backend and get JSON
async function api(path, opts = {}) {
  const res = await fetch(`${BACKEND}${path}`, opts);
  return res;
}

// ── PAGES ──────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const date = req.query.date || '';
    const r = await api(`/api/admin/dashboard${date ? '?date=' + date : ''}`);
    const data = await r.json();
    res.render('admin/dashboard', data);
  } catch (e) { res.status(500).send(e.message); }
});

router.get('/settings', async (req, res) => {
  try {
    const r = await api(`/api/admin/settings/${req.session.user.id}`);
    const data = await r.json();
    res.render('admin/settings', { ...data, error: null, success: null });
  } catch (e) { res.status(500).send(e.message); }
});

router.post('/settings', async (req, res) => {
  try {
    const r = await api(`/api/admin/settings/${req.session.user.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await r.json();
    res.render('admin/settings', { admin: data.admin, error: data.error || null, success: data.success ? 'Промените се зачувани!' : null });
  } catch (e) { res.status(500).send(e.message); }
});

router.get('/markets', async (req, res) => {
  try {
    const data = await api('/api/admin/markets-page').then(r => r.json());
    res.render('admin/markets', data);
  } catch (e) { res.status(500).send(e.message); }
});

router.get('/articles', async (req, res) => {
  try {
    const data = await api('/api/admin/articles-page').then(r => r.json());
    res.render('admin/articles', data);
  } catch (e) { res.status(500).send(e.message); }
});

router.get('/drivers', async (req, res) => {
  try {
    const data = await api('/api/admin/drivers-page').then(r => r.json());
    res.render('admin/drivers', data);
  } catch (e) { res.status(500).send(e.message); }
});

router.get('/orders', async (req, res) => {
  try {
    const qs = req.query.date ? `?date=${req.query.date}` : '';
    const data = await api(`/api/admin/orders-page${qs}`).then(r => r.json());
    res.render('admin/orders', data);
  } catch (e) { res.status(500).send(e.message); }
});

router.get('/reports', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const data = await api(`/api/admin/reports-page${qs ? '?' + qs : ''}`).then(r => r.json());
    res.render('admin/reports', data);
  } catch (e) { res.status(500).send(e.message); }
});

router.get('/reports/word', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const r = await api(`/api/admin/reports/word?${qs}`);
    if (!r.ok) return res.status(r.status).send(await r.text());
    res.set('Content-Type', r.headers.get('content-type'));
    res.set('Content-Disposition', r.headers.get('content-disposition'));
    const buffer = Buffer.from(await r.arrayBuffer());
    res.set('Content-Length', buffer.length);
    res.end(buffer);
  } catch (e) { res.status(500).send(e.message); }
});

router.get('/invoices', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const data = await api(`/api/admin/invoices-page${qs ? '?' + qs : ''}`).then(r => r.json());
    res.render('admin/invoices', data);
  } catch (e) { res.status(500).send(e.message); }
});

router.get('/zito-report', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const data = await api(`/api/admin/zito-report-page${qs ? '?' + qs : ''}`).then(r => r.json());
    res.render('admin/zito-report', data);
  } catch (e) { res.status(500).send(e.message); }
});

router.get('/zito-report/excel', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const r = await api(`/api/admin/zito-report/excel?${qs}`);
    if (!r.ok) return res.status(r.status).send(await r.text());
    res.set('Content-Type', r.headers.get('content-type'));
    res.set('Content-Disposition', r.headers.get('content-disposition'));
    const buffer = Buffer.from(await r.arrayBuffer());
    res.end(buffer);
  } catch (e) { res.status(500).send(e.message); }
});

router.get('/return-by-client', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const data = await api(`/api/admin/return-by-client-page${qs ? '?' + qs : ''}`).then(r => r.json());
    res.render('admin/return-by-client', data);
  } catch (e) { res.status(500).send(e.message); }
});

router.get('/return-by-group', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const data = await api(`/api/admin/return-by-group-page${qs ? '?' + qs : ''}`).then(r => r.json());
    res.render('admin/return-by-group', data);
  } catch (e) { res.status(500).send(e.message); }
});

router.get('/bread-report/:group', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const data = await api(`/api/admin/bread-report/${req.params.group}${qs ? '?' + qs : ''}`).then(r => r.json());
    res.render('admin/bread-report', data);
  } catch (e) { res.status(500).send(e.message); }
});

router.get('/companies', async (req, res) => {
  try {
    const data = await api('/api/admin/companies-page').then(r => r.json());
    res.render('admin/companies', data);
  } catch (e) { res.status(500).send(e.message); }
});

// ── API PROXY — forwards JSON API calls from browser JS to backend ──

// Markets
router.post('/api/markets', async (req, res) => {
  const r = await api('/api/admin/api/markets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
  res.status(r.status).json(await r.json());
});
router.put('/api/markets/:id', async (req, res) => {
  const r = await api(`/api/admin/api/markets/${req.params.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
  res.status(r.status).json(await r.json());
});
router.get('/api/markets/:id/articles', async (req, res) => {
  const r = await api(`/api/admin/api/markets/${req.params.id}/articles`);
  res.status(r.status).json(await r.json());
});
router.post('/api/markets/:id/articles', async (req, res) => {
  const r = await api(`/api/admin/api/markets/${req.params.id}/articles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
  res.status(r.status).json(await r.json());
});
router.delete('/api/markets/:id', async (req, res) => {
  const r = await api(`/api/admin/api/markets/${req.params.id}`, { method: 'DELETE' });
  res.status(r.status).json(await r.json());
});

// Articles
router.post('/api/articles', async (req, res) => {
  const r = await api('/api/admin/api/articles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
  res.status(r.status).json(await r.json());
});
router.put('/api/articles/:id', async (req, res) => {
  const r = await api(`/api/admin/api/articles/${req.params.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
  res.status(r.status).json(await r.json());
});
router.delete('/api/articles/:id', async (req, res) => {
  const r = await api(`/api/admin/api/articles/${req.params.id}`, { method: 'DELETE' });
  res.status(r.status).json(await r.json());
});
router.post('/api/articles/:id/move', async (req, res) => {
  const r = await api(`/api/admin/api/articles/${req.params.id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
  res.status(r.status).json(await r.json());
});

// Drivers
router.post('/api/drivers', async (req, res) => {
  const r = await api('/api/admin/api/drivers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
  res.status(r.status).json(await r.json());
});
router.put('/api/drivers/:id', async (req, res) => {
  const r = await api(`/api/admin/api/drivers/${req.params.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
  res.status(r.status).json(await r.json());
});
router.post('/api/drivers/:id/test-matrix', async (req, res) => {
  const r = await api(`/api/admin/api/drivers/${req.params.id}/test-matrix`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
  res.status(r.status).json(await r.json());
});

// Orders
router.get('/api/orders', async (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  const r = await api(`/api/admin/api/orders?${qs}`);
  res.status(r.status).json(await r.json());
});
router.post('/api/orders', async (req, res) => {
  const r = await api('/api/admin/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
  res.status(r.status).json(await r.json());
});
router.delete('/api/orders/:id', async (req, res) => {
  const r = await api(`/api/admin/api/orders/${req.params.id}`, { method: 'DELETE' });
  res.status(r.status).json(await r.json());
});

// Report detail
router.get('/api/reports/:id', async (req, res) => {
  const r = await api(`/api/admin/api/reports/${req.params.id}`);
  res.status(r.status).json(await r.json());
});
router.delete('/api/reports/:id', async (req, res) => {
  const r = await api(`/api/admin/api/reports/${req.params.id}`, { method: 'DELETE' });
  res.status(r.status).json(await r.json());
});

// Driver markets
router.get('/api/driver-markets/:driverId', async (req, res) => {
  const r = await api(`/api/admin/api/driver-markets/${req.params.driverId}`);
  res.status(r.status).json(await r.json());
});
router.post('/api/driver-markets', async (req, res) => {
  const r = await api('/api/admin/api/driver-markets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
  res.status(r.status).json(await r.json());
});
router.delete('/api/driver-markets/:id', async (req, res) => {
  const r = await api(`/api/admin/api/driver-markets/${req.params.id}`, { method: 'DELETE' });
  res.status(r.status).json(await r.json());
});

// Companies
router.get('/api/companies', async (req, res) => {
  const r = await api('/api/admin/api/companies');
  res.status(r.status).json(await r.json());
});
router.post('/api/companies', async (req, res) => {
  const r = await api('/api/admin/api/companies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
  res.status(r.status).json(await r.json());
});
router.put('/api/companies/:id', async (req, res) => {
  const r = await api(`/api/admin/api/companies/${req.params.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
  res.status(r.status).json(await r.json());
});
router.delete('/api/companies/:id', async (req, res) => {
  const r = await api(`/api/admin/api/companies/${req.params.id}`, { method: 'DELETE' });
  res.status(r.status).json(await r.json());
});

// Holidays
router.get('/api/holidays', async (req, res) => {
  const r = await api('/api/admin/api/holidays');
  res.status(r.status).json(await r.json());
});
router.post('/api/holidays', async (req, res) => {
  const r = await api('/api/admin/api/holidays', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
  res.status(r.status).json(await r.json());
});
router.delete('/api/holidays/:date', async (req, res) => {
  const r = await api(`/api/admin/api/holidays/${req.params.date}`, { method: 'DELETE' });
  res.status(r.status).json(await r.json());
});

module.exports = router;
