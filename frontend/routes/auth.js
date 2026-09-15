const express = require('express');
const router = express.Router();

const BACKEND = process.env.BACKEND_URL || 'http://backend:3002';

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/driver');
  res.render('login', { error: req.query.error || null });
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const response = await fetch(`${BACKEND}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      return res.redirect('/login?error=' + encodeURIComponent(data.error || 'Погрешно корисничко ime или лозинка'));
    }
    req.session.user = { id: data.id, name: data.name, username: data.username, role: data.role };
    res.redirect(data.role === 'admin' ? '/admin' : '/driver');
  } catch (e) { res.redirect('/login?error=Грешка при најава'); }
});

router.post('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

module.exports = router;
