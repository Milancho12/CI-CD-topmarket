/**
 * worker.js — HTTP entry point for the Worker service.
 * Exposes POST /submit to receive order submission requests from the frontend.
 * Runs Puppeteer (Chrome) in a forked child process, isolated from Express.
 */

const express = require('express');
const { db } = require('./database');
const { submitOrdersForDriver, runAllOrders } = require('./services/orderSubmitter');
const { initScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'worker' }));

// POST /submit — trigger order submission for a specific driver
// Body: { driverId: number }
app.post('/submit', async (req, res) => {
  try {
    const { driverId } = req.body;
    if (!driverId) return res.status(400).json({ success: false, error: 'driverId is required' });

    const driver = await db.getAsync(
      "SELECT * FROM users WHERE id=$1 AND role='driver' AND active=1",
      [driverId]
    );

    if (!driver) return res.status(404).json({ success: false, error: 'Возачот не е пронајден' });
    if (!driver.portal_username || !driver.portal_password || !driver.portal_column_id) {
      return res.status(400).json({ success: false, error: 'Возачот нема подесено Matrix portal параметри' });
    }

    // Respond immediately — Chrome runs async in background
    res.json({ success: true, message: 'Процесот за испраќање е стартуван во позадина.' });

    // Fire-and-forget
    submitOrdersForDriver(driver)
      .catch(e => console.error('[worker] submitOrdersForDriver error:', e));

  } catch (e) {
    console.error('[worker] /submit error:', e);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
});

// POST /submit-all — trigger order submission for ALL drivers (admin use)
app.post('/submit-all', async (req, res) => {
  try {
    res.json({ success: true, message: 'Процесот за испраќање на сите нарачки е стартуван.' });
    runAllOrders().catch(e => console.error('[worker] runAllOrders error:', e));
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
});

// Start the HTTP server
app.listen(PORT, () => {
  console.log(`\n🤖 TopMarket Worker работи на: http://localhost:${PORT}\n`);
  initScheduler();
});
