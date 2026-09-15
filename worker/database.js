const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const db = {
  getAsync: async (sql, params = []) => {
    const res = await pool.query(sql, params);
    return res.rows[0] || null;
  },
  allAsync: async (sql, params = []) => {
    const res = await pool.query(sql, params);
    return res.rows;
  },
  runAsync: async (sql, params = []) => {
    const res = await pool.query(sql, params);
    return { lastID: res.rows[0]?.id ?? null, changes: res.rowCount };
  },
};

module.exports = { db, pool };
