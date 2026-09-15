const express = require('express');
const router = express.Router();
const { db, pool } = require('../database');

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function getHolidays() {
  try {
    const rows = await db.allAsync('SELECT date FROM holidays');
    return rows.map(r => r.date);
  } catch (e) { return []; }
}

function nextWorkingDay(dateStr, holidays = []) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || holidays.includes(d.toISOString().split('T')[0])) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString().split('T')[0];
}

function prevWorkingDay(dateStr, holidays = []) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || holidays.includes(d.toISOString().split('T')[0])) {
    d.setDate(d.getDate() - 1);
  }
  return d.toISOString().split('T')[0];
}

// GET /api/driver/home — driver home page data
router.get('/home', async (req, res) => {
  try {
    const driverId = req.query.driverId;
    const date = req.query.date || today();
    const isToday = date === today();

    const orderMarkets = await db.allAsync(`
      SELECT m.id, m.name, m.address, m.is_large, d.id del_id, d.submitted_at
      FROM orders o JOIN markets m ON m.id=o.market_id
      LEFT JOIN deliveries d ON d.driver_id=$1 AND d.market_id=m.id AND d.date=$2
      WHERE o.driver_id=$3 AND o.date=$4 AND m.active=1 ORDER BY m.name`,
      [driverId, date, driverId, date]);

    const permMarkets = await db.allAsync(`
      SELECT m.id, m.name, m.address, m.is_large, d.id del_id, d.submitted_at
      FROM driver_markets dm JOIN markets m ON m.id=dm.market_id
      LEFT JOIN deliveries d ON d.driver_id=$1 AND d.market_id=m.id AND d.date=$2
      WHERE dm.driver_id=$3 AND m.active=1
      AND m.id NOT IN (SELECT market_id FROM orders WHERE driver_id=$4 AND date=$5)
      ORDER BY m.name`,
      [driverId, date, driverId, driverId, date]);

    const assignedIds = new Set(orderMarkets.map(m => m.id));
    const assigned = [...orderMarkets, ...permMarkets.filter(m => !assignedIds.has(m.id))];

    const extra = await db.allAsync(`
      SELECT m.id, m.name, m.address, m.is_large, d.id del_id, d.submitted_at
      FROM deliveries d JOIN markets m ON m.id=d.market_id
      WHERE d.driver_id=$1 AND d.date=$2
      AND m.id NOT IN (SELECT market_id FROM orders WHERE driver_id=$3 AND date=$4)
      AND m.id NOT IN (SELECT market_id FROM driver_markets WHERE driver_id=$5)
      ORDER BY m.name`,
      [driverId, date, driverId, date, driverId]);

    const allMarkets = await db.allAsync('SELECT id,name FROM markets WHERE active=1 ORDER BY name');
    const driverRecord = await db.getAsync(
      'SELECT portal_username, portal_password, portal_column_id, last_order_sent_at FROM users WHERE id=$1', [driverId]);
    const hasPortal = !!(driverRecord && driverRecord.portal_username && driverRecord.portal_password && driverRecord.portal_column_id);

    let orderChanged = false;
    if (hasPortal && driverRecord.last_order_sent_at) {
      const changed = await db.getAsync(`
        SELECT 1 FROM deliveries d JOIN delivery_items di ON di.delivery_id = d.id
        WHERE d.driver_id = $1 AND d.date = $2
          AND di.next_day_qty > 0
          AND COALESCE(d.edited_at, d.submitted_at) > $3
        LIMIT 1`,
        [driverId, date, driverRecord.last_order_sent_at]);
      orderChanged = !!changed;
    } else if (hasPortal && !driverRecord.last_order_sent_at) {
      const hasItems = await db.getAsync(`
        SELECT 1 FROM deliveries d JOIN delivery_items di ON di.delivery_id = d.id
        WHERE d.driver_id = $1 AND d.date = $2 AND di.next_day_qty > 0 LIMIT 1`,
        [driverId, date]);
      orderChanged = !!hasItems;
    }

    res.json({ date, isToday, assigned, extra, allMarkets, orderChanged, hasPortal });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/driver/tomorrow-orders
router.get('/tomorrow-orders', async (req, res) => {
  try {
    const driverId = req.query.driverId;
    const date = req.query.date || today();
    const holidays = await getHolidays();
    const deliveryDate = nextWorkingDay(date, holidays);
    const nextDay = new Date(date + 'T12:00:00');
    nextDay.setDate(nextDay.getDate() + 1);
    const isSundaySkipped = deliveryDate !== nextDay.toISOString().split('T')[0];

    const normalItems = await db.allAsync(`
      SELECT a.code, a.name, a.sort_order,
             COALESCE(SUM(di.next_day_qty), 0) total_qty
      FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id
      JOIN articles a ON a.id = di.article_id JOIN markets m ON m.id = d.market_id
      WHERE d.driver_id=$1 AND d.date=$2 AND m.is_large=0 AND di.next_day_qty > 0
      GROUP BY a.id,a.code,a.name,a.sort_order ORDER BY a.sort_order`, [driverId, date]);

    const normalByMarket = await db.allAsync(`
      SELECT m.name market_name, a.code, a.name art_name, di.next_day_qty
      FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id
      JOIN articles a ON a.id = di.article_id JOIN markets m ON m.id = d.market_id
      WHERE d.driver_id=$1 AND d.date=$2 AND m.is_large=0 AND di.next_day_qty > 0
      ORDER BY m.name, a.sort_order`, [driverId, date]);

    const largeByMarket = await db.allAsync(`
      SELECT m.id market_id, m.name market_name, a.code, a.name art_name, di.next_day_qty
      FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id
      JOIN articles a ON a.id = di.article_id JOIN markets m ON m.id = d.market_id
      WHERE d.driver_id=$1 AND d.date=$2 AND m.is_large=1 AND di.next_day_qty > 0
      ORDER BY m.name, a.sort_order`, [driverId, date]);

    res.json({ date, deliveryDate, isSundaySkipped, normalItems, normalByMarket, largeByMarket });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/driver/market/:marketId
router.get('/market/:marketId', async (req, res) => {
  try {
    const driverId = req.query.driverId;
    const { marketId } = req.params;
    const date = req.query.date || today();
    const isToday = date === today();
    const market = await db.getAsync('SELECT * FROM markets WHERE id=$1 AND active=1', [marketId]);
    if (!market) return res.status(404).json({ error: 'Not found' });

    let articles;
    if (market.is_large) {
      articles = await db.allAsync(`SELECT a.* FROM articles a JOIN market_articles ma ON ma.article_id = a.id WHERE ma.market_id = $1 AND a.active = 1 ORDER BY a.sort_order`, [marketId]);
    } else {
      articles = await db.allAsync('SELECT * FROM articles WHERE active=1 AND is_market_article=0 ORDER BY sort_order');
    }

    const delivery = await db.getAsync('SELECT * FROM deliveries WHERE driver_id=$1 AND market_id=$2 AND date=$3', [driverId, marketId, date]);
    const itemsMap = {};
    if (delivery) {
      const rows = await db.allAsync('SELECT * FROM delivery_items WHERE delivery_id=$1', [delivery.id]);
      rows.forEach(r => { itemsMap[r.article_id] = r; });
    }

    const holidays = await getHolidays();
    const nextDayMap = {};
    if (!delivery && isToday) {
      const prevDate = prevWorkingDay(date, holidays);
      const yDelivery = await db.getAsync('SELECT * FROM deliveries WHERE driver_id=$1 AND market_id=$2 AND date=$3', [driverId, marketId, prevDate]);
      if (yDelivery) {
        const yItems = await db.allAsync('SELECT * FROM delivery_items WHERE delivery_id=$1', [yDelivery.id]);
        yItems.forEach(r => { if (r.next_day_qty > 0) nextDayMap[r.article_id] = r.next_day_qty; });
      }
    }
    res.json({ market, date, isToday, articles, delivery, itemsMap, nextDayMap });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/driver/market/:marketId
router.post('/market/:marketId', async (req, res) => {
  try {
    const driverId = req.query.driverId;
    const { marketId } = req.params;
    const date = req.query.date || today();
    const now = new Date().toISOString();
    const { notes, items } = req.body;

    let delivery = await db.getAsync('SELECT * FROM deliveries WHERE driver_id=$1 AND market_id=$2 AND date=$3', [driverId, marketId, date]);
    if (delivery && delivery.locked) return res.json({ success: false, error: 'Испораката е заклучена од администраторот' });

    if (!delivery) {
      const r = await pool.query('INSERT INTO deliveries (driver_id,market_id,date,submitted_at,notes) VALUES ($1,$2,$3,$4,$5) RETURNING id', [driverId, marketId, date, now, notes||null]);
      delivery = { id: r.rows[0].id };
    } else {
      await db.runAsync('UPDATE deliveries SET edited_at=$1,notes=$2 WHERE id=$3', [now, notes||null, delivery.id]);
    }

    if (items && typeof items === 'object') {
      for (const [aId, q] of Object.entries(items)) {
        const del = parseInt(q.delivered)||0;
        const ret = parseInt(q.returned)||0;
        const nxt = parseInt(q.next_day)||0;
        await pool.query(
          `INSERT INTO delivery_items (delivery_id,article_id,delivered_qty,returned_qty,next_day_qty) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT(delivery_id,article_id) DO UPDATE SET delivered_qty=EXCLUDED.delivered_qty, returned_qty=EXCLUDED.returned_qty, next_day_qty=EXCLUDED.next_day_qty`,
          [delivery.id, parseInt(aId), del, ret, nxt]);
      }
    }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// GET /api/driver/loading-list
router.get('/loading-list', async (req, res) => {
  try {
    const driverId = req.query.driverId;
    const date = req.query.date || today();
    const articles = await db.allAsync('SELECT * FROM articles WHERE active=1 ORDER BY sort_order');
    const loadingList = await db.getAsync('SELECT * FROM loading_lists WHERE driver_id=$1 AND date=$2', [driverId, date]);
    const itemsMap = {};
    if (loadingList) {
      const rows = await db.allAsync('SELECT * FROM loading_list_items WHERE loading_list_id=$1', [loadingList.id]);
      rows.forEach(r => { itemsMap[r.article_id] = r; });
    }
    const holidays = await getHolidays();
    const nextDayMap = {};
    if (!loadingList) {
      const prevDate = prevWorkingDay(date, holidays);
      const nd = await db.allAsync(`
        SELECT di.article_id, SUM(di.next_day_qty) total_qty
        FROM delivery_items di JOIN deliveries d ON d.id=di.delivery_id
        JOIN markets m ON m.id=d.market_id
        WHERE d.driver_id=$1 AND d.date=$2 AND di.next_day_qty>0 AND m.is_large=0
        GROUP BY di.article_id`, [driverId, prevDate]);
      nd.forEach(r => { nextDayMap[r.article_id] = r.total_qty; });
    }
    res.json({ date, articles, loadingList, itemsMap, nextDayMap });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/driver/loading-list
router.post('/loading-list', async (req, res) => {
  try {
    const driverId = req.query.driverId;
    const date = req.query.date || today();
    const now = new Date().toISOString();
    const { notes, items } = req.body;
    let ll = await db.getAsync('SELECT * FROM loading_lists WHERE driver_id=$1 AND date=$2', [driverId, date]);
    if (!ll) {
      const r = await pool.query('INSERT INTO loading_lists (driver_id,date,submitted_at,notes) VALUES ($1,$2,$3,$4) RETURNING id', [driverId, date, now, notes||null]);
      ll = { id: r.rows[0].id };
    } else {
      await db.runAsync('UPDATE loading_lists SET submitted_at=$1,notes=$2 WHERE id=$3', [now, notes||null, ll.id]);
    }
    if (items && typeof items === 'object') {
      for (const [aId, q] of Object.entries(items)) {
        const loaded = parseInt(q.loaded) || 0;
        await pool.query(
          `INSERT INTO loading_list_items (loading_list_id,article_id,loaded_qty) VALUES ($1,$2,$3)
           ON CONFLICT(loading_list_id,article_id) DO UPDATE SET loaded_qty=EXCLUDED.loaded_qty`,
          [ll.id, parseInt(aId), loaded]);
      }
    }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// GET /api/driver/total-returns
router.get('/total-returns', async (req, res) => {
  try {
    const driverId = req.query.driverId;
    const date = req.query.date || today();
    const items = await db.allAsync(`
      SELECT a.id art_id, a.code, a.name, a.sort_order,
             COALESCE(SUM(di.delivered_qty),0) total_delivered,
             COALESCE(SUM(di.returned_qty),0)  total_returned,
             COALESCE(SUM(di.delivered_qty - di.returned_qty),0) total_net
      FROM delivery_items di JOIN deliveries d ON d.id=di.delivery_id
      JOIN articles a ON a.id=di.article_id JOIN markets m ON m.id=d.market_id
      WHERE d.driver_id=$1 AND d.date=$2 AND m.is_large=0
      GROUP BY a.id,a.code,a.name,a.sort_order ORDER BY a.sort_order`, [driverId, date]);

    const byMarket = await db.allAsync(`
      SELECT m.name market_name, a.code, a.name art_name, di.returned_qty, di.delivered_qty
      FROM delivery_items di JOIN deliveries d ON d.id=di.delivery_id
      JOIN articles a ON a.id=di.article_id JOIN markets m ON m.id=d.market_id
      WHERE d.driver_id=$1 AND d.date=$2 AND di.returned_qty>0 AND m.is_large=0
      ORDER BY m.name, a.sort_order`, [driverId, date]);

    const loadingList = await db.getAsync('SELECT * FROM loading_lists WHERE driver_id=$1 AND date=$2', [driverId, date]);
    const loadedMap = {};
    if (loadingList) {
      const li = await db.allAsync('SELECT * FROM loading_list_items WHERE loading_list_id=$1', [loadingList.id]);
      li.forEach(r => { loadedMap[r.article_id] = r.loaded_qty; });
    }
    res.json({ date, items, byMarket, loadingList, loadedMap });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/driver/send-order
router.post('/send-order', async (req, res) => {
  try {
    const driverId = req.body.driverId;
    const driver = await db.getAsync("SELECT * FROM users WHERE id=$1 AND role='driver' AND active=1", [driverId]);
    if (!driver) return res.json({ success: false, error: 'Возачот не е пронајден' });
    if (!driver.portal_username || !driver.portal_password || !driver.portal_column_id) {
      return res.json({ success: false, error: 'Немате поставено Matrix portal параметри' });
    }

    const todayStr = new Date().toISOString().split('T')[0];
    if (driver.last_order_sent_at) {
      const changed = await db.getAsync(`
        SELECT 1 FROM deliveries d JOIN delivery_items di ON di.delivery_id = d.id
        WHERE d.driver_id = $1 AND d.date = $2
          AND di.next_day_qty > 0
          AND COALESCE(d.edited_at, d.submitted_at) > $3
        LIMIT 1`, [driverId, todayStr, driver.last_order_sent_at]);
      if (!changed) return res.json({ success: false, error: 'Нема промени во нарачката од последното испраќање.' });
    } else {
      const hasItems = await db.getAsync(`
        SELECT 1 FROM deliveries d JOIN delivery_items di ON di.delivery_id = d.id
        WHERE d.driver_id = $1 AND d.date = $2 AND di.next_day_qty > 0 LIMIT 1`, [driverId, todayStr]);
      if (!hasItems) return res.json({ success: false, error: 'Нема нарачки за утре за испраќање.' });
    }

    const workerUrl = process.env.WORKER_URL || 'http://worker:3001';
    fetch(`${workerUrl}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId })
    }).catch(e => console.error('[send-order] worker call failed:', e));

    await db.runAsync('UPDATE users SET last_order_sent_at=$1 WHERE id=$2', [new Date().toISOString(), driverId]);
    res.json({ success: true, message: 'Нарачката е ставена во ред за испраќање.' });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

module.exports = router;
