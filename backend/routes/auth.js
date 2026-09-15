const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../database');

// POST /api/auth/login — returns user object or error
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await db.getAsync(
      'SELECT * FROM users WHERE username=$1 AND active=1',
      [username]
    );
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Погрешно корисничко име или лозинка' });
    }
    res.json({ id: user.id, name: user.name, username: user.username, role: user.role });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/auth/user/:id — fetch fresh user data (for session refresh)
router.get('/user/:id', async (req, res) => {
  try {
    const user = await db.getAsync(
      'SELECT id,name,username,role FROM users WHERE id=$1 AND active=1',
      [req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
