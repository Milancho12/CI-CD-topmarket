const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Wrapper to keep the same interface as the old SQLite db object
// so routes don't need to change much.
const db = {
  getAsync: async (sql, params = []) => {
    const res = await pool.query(sql, params);
    return res.rows[0] || null;
  },
  allAsync: async (sql, params = []) => {
    const res = await pool.query(sql, params);
    return res.rows;
  },
  // runAsync returns { lastID, changes } to stay compatible with SQLite callers
  runAsync: async (sql, params = []) => {
    const res = await pool.query(sql, params);
    return {
      lastID: res.rows[0]?.id ?? null,
      changes: res.rowCount
    };
  },
};

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'driver',
    phone TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    portal_username TEXT,
    portal_password TEXT,
    portal_column_id TEXT,
    last_order_sent_at TEXT,
    created_at TEXT DEFAULT (NOW()::TEXT)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS markets (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    contact_name TEXT,
    contact_phone TEXT,
    client_code TEXT,
    object_code TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    is_large INTEGER NOT NULL DEFAULT 0,
    portal_column_id TEXT,
    company_id INTEGER REFERENCES companies(id)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS articles (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'kom',
    price REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    external_code TEXT,
    is_market_article INTEGER NOT NULL DEFAULT 0
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    driver_id INTEGER NOT NULL REFERENCES users(id),
    market_id INTEGER NOT NULL REFERENCES markets(id),
    date TEXT NOT NULL,
    UNIQUE(driver_id, market_id, date)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS deliveries (
    id SERIAL PRIMARY KEY,
    driver_id INTEGER NOT NULL REFERENCES users(id),
    market_id INTEGER NOT NULL REFERENCES markets(id),
    date TEXT NOT NULL,
    submitted_at TEXT,
    edited_at TEXT,
    notes TEXT,
    locked INTEGER NOT NULL DEFAULT 0,
    UNIQUE(driver_id, market_id, date)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS delivery_items (
    id SERIAL PRIMARY KEY,
    delivery_id INTEGER NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES articles(id),
    delivered_qty INTEGER NOT NULL DEFAULT 0,
    returned_qty INTEGER NOT NULL DEFAULT 0,
    next_day_qty INTEGER NOT NULL DEFAULT 0,
    UNIQUE(delivery_id, article_id)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS driver_markets (
    id SERIAL PRIMARY KEY,
    driver_id INTEGER NOT NULL REFERENCES users(id),
    market_id INTEGER NOT NULL REFERENCES markets(id),
    UNIQUE(driver_id, market_id)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS loading_lists (
    id SERIAL PRIMARY KEY,
    driver_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    submitted_at TEXT,
    notes TEXT,
    UNIQUE(driver_id, date)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS loading_list_items (
    id SERIAL PRIMARY KEY,
    loading_list_id INTEGER NOT NULL REFERENCES loading_lists(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES articles(id),
    loaded_qty INTEGER NOT NULL DEFAULT 0,
    UNIQUE(loading_list_id, article_id)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS holidays (
    date TEXT PRIMARY KEY
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS market_articles (
    market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    PRIMARY KEY (market_id, article_id)
  )`);

  // Seed admin user if none exists
  const admin = await db.getAsync("SELECT id FROM users WHERE role='admin'");
  if (!admin) {
    const hash = bcrypt.hashSync('admin123', 10);
    await pool.query(
      "INSERT INTO users (name,username,password,role) VALUES ($1,$2,$3,'admin')",
      ['Администратор', 'admin', hash]
    );
    console.log('✅ Admin: admin / admin123');
  }

  // Seed articles if none exist
  const { rows } = await pool.query('SELECT COUNT(*) c FROM articles');
  if (parseInt(rows[0].c) === 0) {
    const arts = [
      ['814', 'Bel Rolovan leb', 30, 0], ['94', 'Bel leb na parcinja', 33, 1],
      ['737', '100% Integ Rzano brasno.', 64, 2], ['738', '100% Integ miks seminja', 64, 3],
      ['770', '100% Celo zrno CIA i KINOA', 73, 4], ['868', '7 Dnevna svezina', 37, 5],
      ['417', 'XL Rzan tost 500gr.', 83, 6], ['418', 'XL Bel Tost 500pr.', 80, 7],
      ['644', 'Bavarski leb', 49, 8], ['643', 'Graham Leb', 49, 9],
      ['870', 'Nordik', 49, 10], ['806', 'Nutri 6 Seminja', 59, 11],
      ['89', 'Bel Tost', 58, 12], ['90', 'Rzan Tost', 60, 13],
      ['641', 'Integraln tost', 60, 14], ['642', 'Miks od Zrna', 62, 15],
      ['669', 'Puter Brios', 66, 16], ['723', 'DIJA tost leb', 60, 17],
      ['778', 'Proteinski tost leb', 75, 18], ['948', 'Dvojno Pak. Bel Tost', 93, 19],
      ['949', 'Dvojno Pak. Rzan Tost', 94, 20], ['725', 'Vodenicar 400gr.', 25, 21],
      ['430', 'Bel leb na parc.400gr.', 27, 22],
    ];
    for (const a of arts) {
      await pool.query(
        'INSERT INTO articles (code,name,price,sort_order) VALUES ($1,$2,$3,$4)',
        [a[0], a[1], a[2], a[3]]
      );
    }
    console.log(`✅ ${arts.length} артикли додадени`);
  }

  console.log('✅ PostgreSQL база подготвена');
}

module.exports = { db, pool, init };
