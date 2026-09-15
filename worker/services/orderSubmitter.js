const { fork } = require('child_process');
const path = require('path');
const { db } = require('../database');

function today() { return new Date().toISOString().split('T')[0]; }

const MAX_CONCURRENT_WORKERS = 3;
let activeWorkers = 0;
const globalQueue = [];

function processGlobalQueue() {
  if (activeWorkers >= MAX_CONCURRENT_WORKERS || globalQueue.length === 0) return;
  const { account, resolve, reject } = globalQueue.shift();
  activeWorkers++;
  submitOrdersForAccount(account)
    .then(resolve)
    .catch(reject)
    .finally(() => {
      activeWorkers--;
      processGlobalQueue();
    });
}

function enqueueGlobal(account) {
  return new Promise((resolve, reject) => {
    globalQueue.push({ account, resolve, reject });
    processGlobalQueue();
  });
}

const accountQueues = new Map();

function enqueueAccount(account) {
  const key = `${account.username}|${account.password}`;
  const prev = accountQueues.get(key) || Promise.resolve();
  const next = prev
    .then(() => enqueueGlobal(account))
    .catch(err => console.error(`[Queue] Error for account ${account.username}:`, err));
  accountQueues.set(key, next);
  next.finally(() => {
    if (accountQueues.get(key) === next) accountQueues.delete(key);
  });
  return next;
}

async function submitOrdersForAccount(account) {
  const date = today();
  const driverTasks = [];

  for (const driver of account.drivers) {
    // Normal market next_day quantities
    const normalItems = await db.allAsync(`
      SELECT a.code, a.external_code, a.name, a.sort_order,
             COALESCE(SUM(di.next_day_qty), 0) total_qty
      FROM delivery_items di
      JOIN deliveries d ON d.id = di.delivery_id
      JOIN articles a ON a.id = di.article_id
      JOIN markets m ON m.id = d.market_id
      WHERE d.driver_id=$1 AND d.date=$2 AND di.next_day_qty > 0
        AND m.is_large = 0
      GROUP BY a.id,a.code,a.external_code,a.name,a.sort_order
      ORDER BY a.sort_order`, [driver.id, date]);

    // Large markets — each gets its OWN column
    const largeMarkets = await db.allAsync(`
      SELECT DISTINCT m.id, m.name, m.portal_column_id
      FROM markets m JOIN deliveries d ON d.market_id = m.id
      WHERE d.driver_id = $1 AND d.date = $2 AND m.is_large = 1 AND m.active = 1`, [driver.id, date]);

    const largeMarketTasks = [];
    for (const lm of largeMarkets) {
      if (!lm.portal_column_id) continue;
      const lmItems = await db.allAsync(`
        SELECT a.code, a.external_code, a.name, a.sort_order,
               COALESCE(SUM(di.next_day_qty), 0) total_qty
        FROM delivery_items di
        JOIN deliveries d ON d.id = di.delivery_id
        JOIN articles a ON a.id = di.article_id
        WHERE d.driver_id=$1 AND d.market_id=$2 AND d.date=$3 AND di.next_day_qty > 0
        GROUP BY a.id,a.code,a.external_code,a.name,a.sort_order
        ORDER BY a.sort_order`, [driver.id, lm.id, date]);
      if (lmItems.length > 0) {
        largeMarketTasks.push({
          driver: { ...driver, portal_column_id: lm.portal_column_id, name: lm.name },
          items: lmItems
        });
      }
    }

    if (normalItems.length > 0) {
      driverTasks.push({ driver, items: normalItems });
    } else {
      console.log(`[${new Date().toLocaleString('mk-MK')}] Account ${account.username}: Vozach ${driver.name} nema narachki za utre.`);
    }
    driverTasks.push(...largeMarketTasks);
  }

  if (driverTasks.length === 0) {
    console.log(`[${new Date().toLocaleString('mk-MK')}] Account ${account.username}: Nema nitu eden vozach so narachki.`);
    return;
  }

  console.log(`[${new Date().toLocaleString('mk-MK')}] Account ${account.username}: Pronadjeni narachki za ${driverTasks.length} vozachi.`);

  return new Promise((resolve) => {
    const worker = fork(path.join(__dirname, 'orderWorker.js'), [], {
      env: process.env,
      silent: false
    });

    worker.send({ account: { ...account, driverTasks }, date });

    let settled = false;
    let forceKillTimeout;

    function finish() {
      if (settled) return;
      settled = true;
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      resolve();
    }

    forceKillTimeout = setTimeout(() => {
      if (!settled) {
        console.error(`[Worker] Account ${account.username}: Timeout reached (6 min), forcefully killing worker.`);
        try { worker.kill('SIGKILL'); } catch (_) {}
        finish();
      }
    }, 6 * 60 * 1000);

    worker.on('message', (msg) => {
      const timePrefix = `[${new Date().toLocaleString('mk-MK')}]`;
      switch (msg.type) {
        case 'log':   console.log(`${timePrefix} ${msg.msg}`);   break;
        case 'warn':  console.warn(`${timePrefix} ${msg.msg}`);  break;
        case 'error': console.error(`${timePrefix} ${msg.msg}`); break;
        case 'done':
          console.log(`${timePrefix} [Worker] Account ${account.username}: done.`);
          break;
        case 'failed':
          console.error(`${timePrefix} [Worker] Account ${account.username}: failed — ${msg.msg}`);
          break;
      }
    });

    worker.on('error', (err) => { console.error(`Worker process error: ${err.message}`); finish(); });
    worker.on('exit', (code, signal) => {
      if (!settled) {
        if (code !== 0) console.error(`Worker exited unexpectedly (code=${code}, signal=${signal})`);
        else console.log(`[Worker] Account ${account.username}: worker process exited cleanly.`);
        finish();
      }
    });
  });
}

async function submitOrdersForDriver(driver) {
  return enqueueAccount({
    username: driver.portal_username,
    password: driver.portal_password,
    drivers: [driver]
  });
}

async function runAllOrders() {
  const drivers = await db.allAsync("SELECT * FROM users WHERE role='driver' AND active=1 AND portal_username IS NOT NULL AND portal_password IS NOT NULL AND portal_column_id IS NOT NULL");
  const accountsMap = {};
  for (const d of drivers) {
    if (d.portal_username.trim() === '') continue;
    const key = `${d.portal_username.trim()}|${d.portal_password.trim()}`;
    if (!accountsMap[key]) {
      accountsMap[key] = { username: d.portal_username.trim(), password: d.portal_password.trim(), drivers: [] };
    }
    accountsMap[key].drivers.push(d);
  }
  const accounts = Object.values(accountsMap);
  console.log(`Zapocnuva avtomatsko isprakanje za ${drivers.length} vozaci (${accounts.length} accounti).`);
  for (const acc of accounts) {
    await enqueueAccount(acc);
    console.log('Pauza od 2 minuti pred sledniot account...');
    await new Promise(r => setTimeout(r, 120000));
  }
}

module.exports = { runAllOrders, submitOrdersForDriver, enqueueAccount };
