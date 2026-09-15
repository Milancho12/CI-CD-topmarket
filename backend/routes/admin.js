const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db, pool } = require('../database');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const ExcelJS = require('exceljs');

const DISTRIBUTER_CODE = '300189';

const BREAD_GROUPS = {
  sekojedneven: { label: 'Секојдневен леб', codes: ['94', '868', '430', '725', '814'] },
  specijalen: { label: 'Специјален леб', codes: ['737', '738', '770', '644', '643', '870', '806'] },
  tost: { label: 'Тост леб', codes: ['89', '90', '641', '642', '669', '417', '418', '948', '949', '723', '778'] },
};

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Helper: convert ? placeholders to $1,$2,... for PostgreSQL
function toPg(sql, params = []) {
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  return { sql: pgSql, params };
}

// ── DASHBOARD ────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const date = req.query.date || today();
    const stats = {
      deliveries: (await db.getAsync('SELECT COUNT(*) c FROM deliveries d JOIN markets m ON m.id=d.market_id WHERE d.date=$1 AND m.is_large=0', [date])).c,
      delivered: (await db.getAsync('SELECT COALESCE(SUM(di.delivered_qty),0) c FROM delivery_items di JOIN deliveries d ON d.id=di.delivery_id JOIN markets m ON m.id=d.market_id WHERE d.date=$1 AND m.is_large=0', [date])).c,
      returned: (await db.getAsync('SELECT COALESCE(SUM(di.returned_qty),0) c FROM delivery_items di JOIN deliveries d ON d.id=di.delivery_id JOIN markets m ON m.id=d.market_id WHERE d.date=$1 AND m.is_large=0', [date])).c,
      markets: (await db.getAsync('SELECT COUNT(*) c FROM markets WHERE active=1 AND is_large=0')).c,
      drivers: (await db.getAsync("SELECT COUNT(*) c FROM users WHERE role='driver' AND active=1")).c,
    };
    const recent = await db.allAsync(`
      SELECT d.id, d.date, d.submitted_at, d.edited_at, u.name driver_name, m.name market_name,
             COALESCE(SUM(di.delivered_qty),0) tot_del, COALESCE(SUM(di.returned_qty),0) tot_ret
      FROM deliveries d JOIN users u ON u.id=d.driver_id JOIN markets m ON m.id=d.market_id
      LEFT JOIN delivery_items di ON di.delivery_id=d.id WHERE d.date=$1 AND m.is_large=0
      GROUP BY d.id,d.date,d.submitted_at,d.edited_at,u.name,m.name ORDER BY d.submitted_at DESC`, [date]);
    res.json({ stats, recent, date });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SETTINGS ─────────────────────────────────────────────────
router.get('/settings/:userId', async (req, res) => {
  try {
    const admin = await db.getAsync('SELECT * FROM users WHERE id=$1', [req.params.userId]);
    res.json({ admin });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/settings/:userId', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username) return res.json({ success: false, error: 'Корисничкото име е задолжително' });
    const existing = await db.getAsync('SELECT id FROM users WHERE username=$1 AND id!=$2', [username, req.params.userId]);
    if (existing) return res.json({ success: false, error: 'Корисничкото ime е веќе зафатено' });
    if (password && password.trim() !== '') {
      const hash = await bcrypt.hash(password, 10);
      await db.runAsync('UPDATE users SET username=$1, password=$2 WHERE id=$3', [username, hash, req.params.userId]);
    } else {
      await db.runAsync('UPDATE users SET username=$1 WHERE id=$2', [username, req.params.userId]);
    }
    const admin = await db.getAsync('SELECT * FROM users WHERE id=$1', [req.params.userId]);
    res.json({ success: true, admin });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MARKETS PAGE DATA ────────────────────────────────────────
router.get('/markets-page', async (req, res) => {
  try {
    const markets = await db.allAsync('SELECT m.*, c.name company_name FROM markets m LEFT JOIN companies c ON c.id=m.company_id WHERE m.active=1 ORDER BY m.is_large, m.name');
    const companies = await db.allAsync('SELECT id,name FROM companies WHERE active=1 ORDER BY name');
    const allArticles = await db.allAsync('SELECT id,code,name,is_market_article FROM articles WHERE active=1 ORDER BY is_market_article, sort_order');
    res.json({ markets, companies, allArticles });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ARTICLES PAGE DATA ────────────────────────────────────────
router.get('/articles-page', async (req, res) => {
  try {
    const articles = await db.allAsync('SELECT * FROM articles WHERE active=1 ORDER BY sort_order');
    res.json({ articles });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DRIVERS PAGE DATA ────────────────────────────────────────
router.get('/drivers-page', async (req, res) => {
  try {
    const drivers = await db.allAsync("SELECT id,name,username,phone,active,portal_username,portal_password,portal_column_id FROM users WHERE role='driver' ORDER BY name");
    const markets = await db.allAsync('SELECT id,name FROM markets WHERE active=1 ORDER BY name');
    res.json({ drivers, markets });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ORDERS PAGE DATA ─────────────────────────────────────────
router.get('/orders-page', async (req, res) => {
  try {
    const date = req.query.date || today();
    const drivers = await db.allAsync("SELECT id,name FROM users WHERE role='driver' AND active=1 ORDER BY name");
    const markets = await db.allAsync('SELECT id,name FROM markets WHERE active=1 ORDER BY name');
    const orders = await db.allAsync(`
      SELECT o.id, o.driver_id, o.market_id, u.name driver_name, m.name market_name, d.submitted_at
      FROM orders o JOIN users u ON u.id=o.driver_id JOIN markets m ON m.id=o.market_id
      LEFT JOIN deliveries d ON d.driver_id=o.driver_id AND d.market_id=o.market_id AND d.date=o.date
      WHERE o.date=$1 ORDER BY u.name, m.name`, [date]);
    res.json({ date, drivers, markets, orders });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── REPORTS PAGE DATA ─────────────────────────────────────────
router.get('/reports-page', async (req, res) => {
  try {
    const t = today();
    const f = { date_from: req.query.date_from || t, date_to: req.query.date_to || t, driver_id: req.query.driver_id || '', market_id: req.query.market_id || '', company_id: req.query.company_id || '' };
    const drivers = await db.allAsync("SELECT id,name FROM users WHERE role='driver' ORDER BY name");
    const markets = await db.allAsync('SELECT id, name, company_id FROM markets WHERE is_large=0 ORDER BY name');
    const companies = await db.allAsync('SELECT id,name FROM companies WHERE active=1 ORDER BY name');
    let q = `SELECT d.id, d.date, d.submitted_at, d.edited_at, d.notes, u.name driver_name, m.name market_name,
             COALESCE(SUM(di.delivered_qty),0) tot_del, COALESCE(SUM(di.returned_qty),0) tot_ret
      FROM deliveries d JOIN users u ON u.id=d.driver_id JOIN markets m ON m.id=d.market_id
      LEFT JOIN delivery_items di ON di.delivery_id=d.id WHERE m.is_large=0`;
    let tQ = `SELECT COALESCE(SUM(di.delivered_qty),0) g_del, COALESCE(SUM(di.returned_qty),0) g_ret
              FROM deliveries d JOIN markets m ON m.id=d.market_id
              LEFT JOIN delivery_items di ON di.delivery_id=d.id WHERE m.is_large=0`;
    const params = [];
    let idx = 1;
    if (f.date_from) { q += ` AND d.date>=$${idx}`; tQ += ` AND d.date>=$${idx}`; params.push(f.date_from); idx++; }
    if (f.date_to) { q += ` AND d.date<=$${idx}`; tQ += ` AND d.date<=$${idx}`; params.push(f.date_to); idx++; }
    if (f.driver_id) { q += ` AND d.driver_id=$${idx}`; tQ += ` AND d.driver_id=$${idx}`; params.push(f.driver_id); idx++; }
    if (f.market_id) { q += ` AND d.market_id=$${idx}`; tQ += ` AND d.market_id=$${idx}`; params.push(f.market_id); idx++; }
    if (f.company_id) { q += ` AND m.company_id=$${idx}`; tQ += ` AND m.company_id=$${idx}`; params.push(f.company_id); idx++; }
    q += ' GROUP BY d.id,d.date,d.submitted_at,d.edited_at,d.notes,u.name,m.name ORDER BY d.date DESC, d.submitted_at DESC LIMIT 500';
    const deliveries = await db.allAsync(q, params);
    const totals = await db.getAsync(tQ, params);
    res.json({ deliveries, totals, drivers, markets, companies, filters: f });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── WORD EXPORT ───────────────────────────────────────────────
router.get('/reports/word', async (req, res) => {
  try {
    const { date_from, date_to, market_id, company_id } = req.query;
    if (!date_from || !date_to) return res.status(400).json({ error: 'Датумите се задолжителни' });
    const children = [];
    if (company_id && !market_id) {
      const comp = await db.getAsync('SELECT * FROM companies WHERE id=$1', [company_id]);
      const rows = await db.allAsync(`
        SELECT a.code, a.name, a.price, a.sort_order,
               COALESCE(SUM(di.delivered_qty),0) tot_del,
               COALESCE(SUM(di.returned_qty),0)  tot_ret,
               COALESCE(SUM(di.delivered_qty - di.returned_qty),0) net_qty
        FROM delivery_items di
        JOIN deliveries d ON d.id = di.delivery_id
        JOIN articles a ON a.id = di.article_id
        JOIN markets m ON m.id = d.market_id
        WHERE m.company_id=$1 AND d.date>=$2 AND d.date<=$3 AND m.is_large=0
        GROUP BY a.id,a.code,a.name,a.price,a.sort_order
        HAVING COALESCE(SUM(di.delivered_qty - di.returned_qty),0) > 0
        ORDER BY a.sort_order`, [company_id, date_from, date_to]);
      if (rows.length > 0) {
        const totalPrice = rows.reduce((sum, r) => sum + (r.net_qty * r.price), 0);
        children.push(new Paragraph({ children: [new TextRun({ text: `ЗБИРНО ЗА ФИРМА: ${comp.name}`, bold: true, size: 36, color: '1a1a2e' })], spacing: { before: 480, after: 240 } }));
        children.push(new Paragraph({ children: [new TextRun({ text: '─'.repeat(40), color: '888888', size: 18 })], spacing: { before: 0, after: 120 } }));
        for (const r of rows) {
          children.push(new Paragraph({ children: [new TextRun({ text: `${r.code}`, bold: true, size: 24 }), new TextRun({ text: ` - ${r.net_qty}`, size: 24 })], spacing: { after: 80 } }));
        }
        children.push(new Paragraph({ children: [new TextRun({ text: `Вкупен износ: ${Math.round(totalPrice)} ден.`, bold: true, size: 28, color: '1d4ed8' })], spacing: { before: 200, after: 480 } }));
      }
    } else {
      let marketsToExport;
      if (market_id) {
        marketsToExport = await db.allAsync('SELECT * FROM markets WHERE id=$1 AND is_large=0', [market_id]);
      } else {
        marketsToExport = await db.allAsync('SELECT * FROM markets WHERE active=1 AND is_large=0 ORDER BY name');
      }
      for (const market of marketsToExport) {
        const rows = await db.allAsync(`
          SELECT a.code, a.name, a.price, a.sort_order,
                 COALESCE(SUM(di.delivered_qty),0) tot_del,
                 COALESCE(SUM(di.returned_qty),0)  tot_ret,
                 COALESCE(SUM(di.delivered_qty - di.returned_qty),0) net_qty
          FROM delivery_items di
          JOIN deliveries d ON d.id = di.delivery_id
          JOIN articles a ON a.id = di.article_id
          WHERE d.market_id=$1 AND d.date>=$2 AND d.date<=$3
          GROUP BY a.id,a.code,a.name,a.price,a.sort_order
          HAVING COALESCE(SUM(di.delivered_qty - di.returned_qty),0) > 0
          ORDER BY a.sort_order`, [market.id, date_from, date_to]);
        if (rows.length === 0) continue;
        const marketHeading = market.client_code ? `${market.client_code} – ${market.name}` : market.name;
        const totalPrice = rows.reduce((sum, r) => sum + (r.net_qty * r.price), 0);
        children.push(new Paragraph({ children: [new TextRun({ text: marketHeading, bold: true, size: 36, color: '1a1a2e' })], spacing: { before: 480, after: 240 } }));
        children.push(new Paragraph({ children: [new TextRun({ text: '─'.repeat(40), color: '888888', size: 18 })], spacing: { before: 0, after: 120 } }));
        for (const r of rows) {
          children.push(new Paragraph({ children: [new TextRun({ text: `${r.code}`, bold: true, size: 24 }), new TextRun({ text: ` - ${r.net_qty}`, size: 24 })], spacing: { after: 80 } }));
        }
        children.push(new Paragraph({ children: [new TextRun({ text: `Вкупен износ: ${Math.round(totalPrice)} ден.`, bold: true, size: 28, color: '1d4ed8' })], spacing: { before: 200, after: 480 } }));
      }
    }
    if (children.length === 0) return res.status(404).json({ error: 'Нема податоци за избраниот период' });
    const doc = new Document({ creator: 'ZitoLuks', title: `Извештај ${date_from} – ${date_to}`, sections: [{ children }] });
    const buffer = await Packer.toBuffer(doc);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `attachment; filename="Izvestaj_${date_from}_${date_to}.docx"`);
    res.set('Content-Length', buffer.length);
    res.end(buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── INVOICES ─────────────────────────────────────────────────
router.get('/invoices-page', async (req, res) => {
  try {
    const t = today();
    const markets = await db.allAsync('SELECT id,name FROM markets WHERE active=1 AND is_large=0 ORDER BY name');
    const f = { market_id: req.query.market_id || '', date_from: req.query.date_from || t, date_to: req.query.date_to || t };
    let invoiceData = null, selMarket = null;
    if (f.market_id && f.date_from && f.date_to) {
      selMarket = await db.getAsync('SELECT * FROM markets WHERE id=$1 AND is_large=0', [f.market_id]);
      if (selMarket) {
        const rows = await db.allAsync(`
          SELECT a.code, a.name, a.price, a.unit,
                 SUM(di.delivered_qty) tot_del, SUM(di.returned_qty) tot_ret,
                 SUM(di.delivered_qty - di.returned_qty) net_qty
          FROM delivery_items di JOIN deliveries d ON d.id=di.delivery_id JOIN articles a ON a.id=di.article_id
          WHERE d.market_id=$1 AND d.date>=$2 AND d.date<=$3
          GROUP BY a.id,a.code,a.name,a.price,a.unit
          HAVING SUM(di.delivered_qty - di.returned_qty)>0 ORDER BY a.sort_order`, [f.market_id, f.date_from, f.date_to]);
        invoiceData = rows.map(r => ({ ...r, total: r.net_qty * r.price }));
      }
    }
    res.json({ markets, invoiceData, selMarket, filters: f });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ZITO-REPORT PAGE DATA ─────────────────────────────────────
router.get('/zito-report-page', async (req, res) => {
  try {
    const t = today();
    const drivers = await db.allAsync("SELECT id,name FROM users WHERE role='driver' ORDER BY name");
    const markets = await db.allAsync('SELECT id, name, company_id FROM markets WHERE active=1 AND is_large=0 ORDER BY name');
    const companies = await db.allAsync('SELECT id,name FROM companies WHERE active=1 ORDER BY name');
    const f = { date_from: req.query.date_from || t, date_to: req.query.date_to || t, driver_id: req.query.driver_id || '', market_id: req.query.market_id || '', company_id: req.query.company_id || '' };
    res.json({ drivers, markets, companies, filters: f });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ZITO-REPORT EXCEL ─────────────────────────────────────────
router.get('/zito-report/excel', async (req, res) => {
  try {
    const { date_from, date_to, driver_id, market_id, company_id } = req.query;
    if (!date_from || !date_to) return res.status(400).json({ error: 'Датумите се задолжителни' });
    let sql = '', params = [date_from, date_to];
    let idx = 3;
    if (company_id && !market_id) {
      sql = `SELECT c.id as market_id, c.name as market_name, '' as market_city, '' as market_address,
                    '' as client_code, '' as object_code,
                    a.code art_code, a.name art_name, a.price,
                    SUM(di.delivered_qty) delivered_qty, SUM(di.returned_qty) returned_qty,
                    SUM(di.delivered_qty - di.returned_qty) net_qty
             FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id
             JOIN articles a ON a.id = di.article_id
             JOIN markets m ON m.id = d.market_id
             JOIN companies c ON c.id = m.company_id
             WHERE d.date>=$1 AND d.date<=$2 AND m.company_id=$${idx} AND m.is_large=0`;
      params.push(company_id); idx++;
      if (driver_id) { sql += ` AND d.driver_id=$${idx}`; params.push(driver_id); idx++; }
      sql += ' GROUP BY c.id, c.name, a.id,a.code,a.name,a.price HAVING SUM(di.delivered_qty - di.returned_qty) > 0 ORDER BY c.name, a.sort_order';
    } else {
      sql = `SELECT m.id market_id, m.name market_name, m.city market_city, m.address market_address,
                    m.client_code, m.object_code, a.code art_code, a.name art_name, a.price,
                    SUM(di.delivered_qty) delivered_qty, SUM(di.returned_qty) returned_qty,
                    SUM(di.delivered_qty - di.returned_qty) net_qty
             FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id
             JOIN articles a ON a.id = di.article_id JOIN markets m ON m.id = d.market_id
             WHERE d.date>=$1 AND d.date<=$2 AND m.is_large=0`;
      if (driver_id) { sql += ` AND d.driver_id=$${idx}`; params.push(driver_id); idx++; }
      if (market_id) { sql += ` AND d.market_id=$${idx}`; params.push(market_id); idx++; }
      sql += ' GROUP BY m.id,m.name,m.city,m.address,m.client_code,m.object_code,a.id,a.code,a.name,a.price HAVING SUM(di.delivered_qty - di.returned_qty) > 0 ORDER BY m.name, a.sort_order';
    }
    const rows = await db.allAsync(sql, params);
    const dateStr = date_from === date_to ? date_from : `${date_from} do ${date_to}`;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ZitoLuks';
    const ws = wb.addWorksheet('ZitoLuks Извештај', { views: [{ state: 'frozen', ySplit: 2 }] });
    ws.columns = [{ width: 14 },{ width: 12 },{ width: 12 },{ width: 22 },{ width: 12 },{ width: 14 },{ width: 24 },{ width: 14 },{ width: 28 },{ width: 11 },{ width: 12 },{ width: 10 },{ width: 13 },{ width: 14 },{ width: 12 }];
    const C = { orange: 'FFFFC000', clientBg: 'FFFF8C00', prodBg: 'FFFF6600', greenBg: 'FF00B050', yellowBg: 'FFFFFF00' };
    const hStyle = (argbBg, argbFg = 'FF000000') => ({ font: { bold: true, color: { argb: argbFg }, size: 10 }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argbBg } }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }, border: { top: { style: 'medium', color: { argb: 'FF000000' } }, left: { style: 'medium', color: { argb: 'FF000000' } }, bottom: { style: 'medium', color: { argb: 'FF000000' } }, right: { style: 'medium', color: { argb: 'FF000000' } } } });
    const row1 = ws.getRow(1); row1.height = 30;
    ws.mergeCells('A1:A2'); ws.getCell('A1').value = 'Sifra-distributer'; Object.assign(ws.getCell('A1'), hStyle(C.orange));
    ws.mergeCells('B1:B2'); ws.getCell('B1').value = 'Datum'; Object.assign(ws.getCell('B1'), hStyle(C.orange));
    ws.mergeCells('C1:G1'); ws.getCell('C1').value = 'Podatoci za klientot i objektot'; Object.assign(ws.getCell('C1'), hStyle(C.clientBg));
    ws.mergeCells('H1:I1'); ws.getCell('H1').value = 'Podatoci za Proizvod'; Object.assign(ws.getCell('H1'), hStyle(C.prodBg, 'FFFFFFFF'));
    ws.mergeCells('J1:L1'); ws.getCell('J1').value = 'Kolicini'; Object.assign(ws.getCell('J1'), hStyle(C.greenBg, 'FFFFFFFF'));
    ws.mergeCells('M1:O1'); ws.getCell('M1').value = 'Vrednost(Bez DDV)'; Object.assign(ws.getCell('M1'), hStyle(C.yellowBg));
    const row2 = ws.getRow(2); row2.height = 34;
    const cols = ['DISTRIBUTER','DATUM','KLIENT SIFRA','KLIENT OPIS','OBJEKT SIFRA','OBJEKT GRAD','OBJEKT ADRESA','PROIZVOD SIFRA','PROIZVOD OPIS','BRUTO KOL','VRATENO KOL','NETO KOL','BRUTO IZNOS','VRATENO IZNOS','NETO IZNOS'];
    const colBgs = [C.orange,C.orange,C.clientBg,C.clientBg,C.clientBg,C.clientBg,C.clientBg,C.prodBg,C.prodBg,C.greenBg,C.greenBg,C.greenBg,C.yellowBg,C.yellowBg,C.yellowBg];
    const colFgs = ['FF000000','FF000000','FF000000','FF000000','FF000000','FF000000','FF000000','FFFFFFFF','FFFFFFFF','FFFFFFFF','FFFFFFFF','FFFFFFFF','FF000000','FF000000','FF000000'];
    cols.forEach((name, i) => { const cell = row2.getCell(i + 1); cell.value = name; cell.style = hStyle(colBgs[i], colFgs[i]); });
    let gDel=0,gRet=0,gNet=0,gDelIznos=0,gRetIznos=0,gNetIznos=0;
    const dataStyle = { font: { size: 10 }, border: { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }, alignment: { vertical: 'middle' } };
    const numStyle = { ...dataStyle, alignment: { horizontal: 'right', vertical: 'middle' } };
    let currentMarketId = null, rowIdx = 0;
    rows.forEach((r) => {
      if (currentMarketId !== null && currentMarketId !== r.market_id) { for (let i = 0; i < 5; i++) ws.addRow([]); rowIdx = 0; }
      currentMarketId = r.market_id;
      gDel += parseInt(r.delivered_qty)||0; gRet += parseInt(r.returned_qty)||0; gNet += parseInt(r.net_qty)||0;
      gDelIznos += (parseInt(r.delivered_qty)||0) * r.price; gRetIznos += (parseInt(r.returned_qty)||0) * r.price; gNetIznos += (parseInt(r.net_qty)||0) * r.price;
      const row = ws.addRow([DISTRIBUTER_CODE, dateStr, r.client_code||'', r.market_name||'', r.object_code||'', r.market_city||'', r.market_address||'', r.art_code, r.art_name, parseInt(r.delivered_qty)||0, parseInt(r.returned_qty)||0, parseInt(r.net_qty)||0, parseFloat(((parseInt(r.delivered_qty)||0)*r.price).toFixed(2)), parseFloat(((parseInt(r.returned_qty)||0)*r.price).toFixed(2)), parseFloat(((parseInt(r.net_qty)||0)*r.price).toFixed(2))]);
      row.height = 18;
      row.eachCell({ includeEmpty: true }, (cell, colNum) => { cell.style = colNum >= 10 ? numStyle : dataStyle; if (rowIdx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } }; });
      rowIdx++;
    });
    if (rows.length > 0) {
      ws.addRow([]);
      const grandTotalRow = ws.addRow(['','','','','','','','','ВКУПНО:',gDel,gRet,gNet,parseFloat(gDelIznos.toFixed(2)),parseFloat(gRetIznos.toFixed(2)),parseFloat(gNetIznos.toFixed(2))]);
      grandTotalRow.height = 20;
      grandTotalRow.eachCell({ includeEmpty: true }, (cell, colNum) => { if (colNum >= 9) { cell.style = colNum >= 10 ? numStyle : dataStyle; cell.font = { bold: true, size: 11 }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE066' } }; } });
    }
    if (rows.length === 0) ws.addRow(['Нема податоци за избраниот период']);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ZitoLuks_${date_from}_${date_to}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RETURN BY CLIENT ──────────────────────────────────────────
router.get('/return-by-client-page', async (req, res) => {
  try {
    const t = today();
    const f = { date_from: req.query.date_from || t, date_to: req.query.date_to || t, market_id: req.query.market_id || '', article_code: req.query.article_code || '', company_id: req.query.company_id || '' };
    const markets = await db.allAsync('SELECT id, name, company_id FROM markets WHERE active=1 AND is_large=0 ORDER BY name');
    const companies = await db.allAsync('SELECT id, name FROM companies WHERE active=1 ORDER BY name');
    const articles = await db.allAsync('SELECT id,code,name FROM articles WHERE active=1 AND is_market_article=0 ORDER BY sort_order');
    let sql = `SELECT m.name market_name, m.client_code, a.code art_code, a.name art_name,
               SUM(di.delivered_qty) tot_del, SUM(di.returned_qty) tot_ret,
               SUM(di.delivered_qty - di.returned_qty) net_qty
        FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id
        JOIN markets m ON m.id = d.market_id JOIN articles a ON a.id = di.article_id
        WHERE d.date>=$1 AND d.date<=$2 AND m.is_large=0`;
    const params = [f.date_from, f.date_to]; let idx = 3;
    if (f.company_id) { sql += ` AND m.company_id=$${idx}`; params.push(f.company_id); idx++; }
    if (f.market_id) { sql += ` AND d.market_id=$${idx}`; params.push(f.market_id); idx++; }
    if (f.article_code) { sql += ` AND a.code=$${idx}`; params.push(f.article_code); idx++; }
    sql += ' GROUP BY m.id,m.name,m.client_code,a.id,a.code,a.name HAVING SUM(di.returned_qty) > 0 ORDER BY m.name, a.sort_order';
    const rows = await db.allAsync(sql, params);
    res.json({ rows, markets, companies, articles, filters: f });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RETURN BY GROUP ───────────────────────────────────────────
router.get('/return-by-group-page', async (req, res) => {
  try {
    const t = today();
    const f = { date_from: req.query.date_from || t, date_to: req.query.date_to || t };
    const result = [];
    for (const [key, g] of Object.entries(BREAD_GROUPS)) {
      const placeholders = g.codes.map((_, i) => `$${i + 3}`).join(',');
      const rows = await db.allAsync(`
        SELECT a.code art_code, a.name art_name,
               SUM(di.delivered_qty) tot_del, SUM(di.returned_qty) tot_ret,
               SUM(di.delivered_qty - di.returned_qty) net_qty
        FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id
        JOIN markets m ON m.id = d.market_id JOIN articles a ON a.id = di.article_id
        WHERE d.date>=$1 AND d.date<=$2 AND m.is_large=0 AND a.code IN (${placeholders})
        GROUP BY a.id,a.code,a.name ORDER BY a.sort_order`, [f.date_from, f.date_to, ...g.codes]);
      result.push({ ...g, key, rows });
    }
    res.json({ result, filters: f });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── BREAD REPORT ──────────────────────────────────────────────
router.get('/bread-report/:group', async (req, res) => {
  try {
    const group = BREAD_GROUPS[req.params.group];
    if (!group) return res.status(404).json({ error: 'Непозната група' });
    const t = today();
    const f = { date_from: req.query.date_from || t, date_to: req.query.date_to || t, market_id: req.query.market_id || '' };
    const markets = await db.allAsync('SELECT id,name FROM markets WHERE active=1 AND is_large=0 ORDER BY name');
    const placeholders = group.codes.map((_, i) => `$${i + 3}`).join(',');
    let sql = `SELECT m.name market_name, a.code art_code, a.name art_name,
               SUM(di.delivered_qty) tot_del, SUM(di.returned_qty) tot_ret,
               SUM(di.delivered_qty - di.returned_qty) net_qty, a.price,
               SUM(di.delivered_qty - di.returned_qty) * a.price net_amount
        FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id
        JOIN markets m ON m.id = d.market_id JOIN articles a ON a.id = di.article_id
        WHERE d.date>=$1 AND d.date<=$2 AND m.is_large=0 AND a.code IN (${placeholders})`;
    const params = [f.date_from, f.date_to, ...group.codes];
    let idx = group.codes.length + 3;
    if (f.market_id) { sql += ` AND d.market_id=$${idx}`; params.push(f.market_id); }
    sql += ' GROUP BY m.id,m.name,a.id,a.code,a.name,a.price HAVING SUM(di.delivered_qty - di.returned_qty) > 0 ORDER BY m.name, a.sort_order';
    const rows = await db.allAsync(sql, params);
    res.json({ rows, markets, filters: f, group, groupKey: req.params.group });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── COMPANIES PAGE DATA ───────────────────────────────────────
router.get('/companies-page', async (req, res) => {
  try {
    const companies = await db.allAsync(`
      SELECT c.id, c.name, COUNT(m.id) market_count
      FROM companies c LEFT JOIN markets m ON m.company_id=c.id AND m.active=1
      WHERE c.active=1 GROUP BY c.id,c.name ORDER BY c.name`);
    res.json({ companies });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: MARKETS ──────────────────────────────────────────────
router.post('/api/markets', async (req, res) => {
  try {
    const { name, address, city, contact_name, contact_phone, client_code, object_code, company_id, is_large, portal_column_id } = req.body;
    if (!name) return res.json({ success: false, error: 'Назив е задолжителен' });
    const r = await pool.query('INSERT INTO markets (name,address,city,contact_name,contact_phone,client_code,object_code,company_id,is_large,portal_column_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id', [name, address||null, city||null, contact_name||null, contact_phone||null, client_code||null, object_code||null, company_id||null, is_large?1:0, portal_column_id||null]);
    res.json({ success: true, id: r.rows[0].id });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

router.put('/api/markets/:id', async (req, res) => {
  try {
    const { name, address, city, contact_name, contact_phone, client_code, object_code, company_id, is_large, portal_column_id } = req.body;
    await db.runAsync('UPDATE markets SET name=$1,address=$2,city=$3,contact_name=$4,contact_phone=$5,client_code=$6,object_code=$7,company_id=$8,is_large=$9,portal_column_id=$10 WHERE id=$11', [name, address||null, city||null, contact_name||null, contact_phone||null, client_code||null, object_code||null, company_id||null, is_large?1:0, portal_column_id||null, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

router.get('/api/markets/:id/articles', async (req, res) => {
  try {
    const rows = await db.allAsync('SELECT article_id FROM market_articles WHERE market_id=$1', [req.params.id]);
    res.json(rows);
  } catch (e) { res.json({ error: e.message }); }
});

router.post('/api/markets/:id/articles', async (req, res) => {
  try {
    const { article_ids } = req.body;
    await db.runAsync('DELETE FROM market_articles WHERE market_id=$1', [req.params.id]);
    for (const aid of (article_ids || [])) {
      await db.runAsync('INSERT INTO market_articles (market_id, article_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, aid]);
    }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

router.delete('/api/markets/:id', async (req, res) => {
  try { await db.runAsync('UPDATE markets SET active=0 WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

// ── API: ARTICLES ─────────────────────────────────────────────
router.post('/api/articles', async (req, res) => {
  try {
    const { code, name, price, unit, external_code, is_market_article } = req.body;
    if (!name) return res.json({ success: false, error: 'Назив е задолжителен' });
    const mx = await db.getAsync('SELECT MAX(sort_order) mo FROM articles WHERE active=1');
    const r = await pool.query('INSERT INTO articles (code,name,price,unit,sort_order,external_code,is_market_article) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [code||'', name, parseFloat(price)||0, unit||'kom', (mx.mo||0)+1, external_code||null, is_market_article?1:0]);
    res.json({ success: true, id: r.rows[0].id });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

router.put('/api/articles/:id', async (req, res) => {
  try {
    const { code, name, price, unit, external_code, is_market_article } = req.body;
    await db.runAsync('UPDATE articles SET code=$1,name=$2,price=$3,unit=$4,external_code=$5,is_market_article=$6 WHERE id=$7', [code||'', name, parseFloat(price)||0, unit||'kom', external_code||null, is_market_article?1:0, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

router.delete('/api/articles/:id', async (req, res) => {
  try { await db.runAsync('UPDATE articles SET active=0 WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

router.post('/api/articles/:id/move', async (req, res) => {
  try {
    const { direction } = req.body;
    const art = await db.getAsync('SELECT * FROM articles WHERE id=$1 AND active=1', [req.params.id]);
    if (!art) return res.json({ success: false, error: 'Не е пронајден' });
    const swap = direction === 'up'
      ? await db.getAsync('SELECT * FROM articles WHERE sort_order<$1 AND active=1 ORDER BY sort_order DESC LIMIT 1', [art.sort_order])
      : await db.getAsync('SELECT * FROM articles WHERE sort_order>$1 AND active=1 ORDER BY sort_order ASC LIMIT 1', [art.sort_order]);
    if (!swap) return res.json({ success: false, error: 'Не може' });
    await db.runAsync('UPDATE articles SET sort_order=$1 WHERE id=$2', [swap.sort_order, art.id]);
    await db.runAsync('UPDATE articles SET sort_order=$1 WHERE id=$2', [art.sort_order, swap.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// ── API: DRIVERS ──────────────────────────────────────────────
router.post('/api/drivers', async (req, res) => {
  try {
    const { name, username, password, phone, portal_username, portal_password, portal_column_id } = req.body;
    if (!name || !username || !password) return res.json({ success: false, error: 'Сите полиња се задолжителни' });
    const hash = bcrypt.hashSync(password, 10);
    const r = await pool.query("INSERT INTO users (name,username,password,role,phone,portal_username,portal_password,portal_column_id) VALUES ($1,$2,$3,'driver',$4,$5,$6,$7) RETURNING id", [name, username, hash, phone||null, portal_username||null, portal_password||null, portal_column_id||null]);
    res.json({ success: true, id: r.rows[0].id });
  } catch (e) { res.json({ success: false, error: e.message.includes('unique') ? 'Корисничкото ime веќе постои' : e.message }); }
});

router.put('/api/drivers/:id', async (req, res) => {
  try {
    const { name, username, password, phone, active, portal_username, portal_password, portal_column_id } = req.body;
    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      await db.runAsync("UPDATE users SET name=$1,username=$2,password=$3,phone=$4,active=$5,portal_username=$6,portal_password=$7,portal_column_id=$8 WHERE id=$9 AND role='driver'", [name, username, hash, phone||null, active?1:0, portal_username||null, portal_password||null, portal_column_id||null, req.params.id]);
    } else {
      await db.runAsync("UPDATE users SET name=$1,username=$2,phone=$3,active=$4,portal_username=$5,portal_password=$6,portal_column_id=$7 WHERE id=$8 AND role='driver'", [name, username, phone||null, active?1:0, portal_username||null, portal_password||null, portal_column_id||null, req.params.id]);
    }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

router.post('/api/drivers/:id/test-matrix', async (req, res) => {
  try {
    const driver = await db.getAsync("SELECT * FROM users WHERE id=$1 AND role='driver'", [req.params.id]);
    if (!driver) return res.json({ success: false, error: 'Возачот не е пронајден' });
    if (!driver.portal_username || !driver.portal_password || !driver.portal_column_id) {
      return res.json({ success: false, error: 'Возачот нема подесено параметри за Matrix порталот' });
    }
    // Signal to worker via HTTP — worker URL comes from env
    const workerUrl = process.env.WORKER_URL || 'http://worker:3001';
    fetch(`${workerUrl}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId: req.params.id })
    }).catch(e => console.error('Worker call failed:', e));
    res.json({ success: true, message: 'Процесот за испраќање е стартуван во позадина. Проверете ги логовите.' });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// ── API: ORDERS ───────────────────────────────────────────────
router.get('/api/orders', async (req, res) => {
  const { date, driver_id } = req.query;
  const rows = await db.allAsync('SELECT o.id, o.market_id, m.name market_name FROM orders o JOIN markets m ON m.id=o.market_id WHERE o.date=$1 AND o.driver_id=$2 ORDER BY m.name', [date, driver_id]);
  res.json(rows);
});

router.post('/api/orders', async (req, res) => {
  try {
    const { driver_id, market_id, date } = req.body;
    await db.runAsync('INSERT INTO orders (driver_id,market_id,date) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [driver_id, market_id, date]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

router.delete('/api/orders/:id', async (req, res) => {
  try { await db.runAsync('DELETE FROM orders WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

// ── API: REPORT DETAIL ────────────────────────────────────────
router.get('/api/reports/:id', async (req, res) => {
  const delivery = await db.getAsync('SELECT d.*, u.name driver_name, m.name market_name FROM deliveries d JOIN users u ON u.id=d.driver_id JOIN markets m ON m.id=d.market_id WHERE d.id=$1', [req.params.id]);
  if (!delivery) return res.json({ error: 'Not found' });
  const items = await db.allAsync('SELECT di.*, a.name article_name, a.code, a.price, a.unit FROM delivery_items di JOIN articles a ON a.id=di.article_id WHERE di.delivery_id=$1 ORDER BY a.sort_order', [req.params.id]);
  res.json({ delivery, items });
});

router.delete('/api/reports/:id', async (req, res) => {
  try { await db.runAsync('DELETE FROM deliveries WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

// ── API: DRIVER MARKETS ───────────────────────────────────────
router.get('/api/driver-markets/:driverId', async (req, res) => {
  try {
    const rows = await db.allAsync(`SELECT dm.id, m.id market_id, m.name market_name
      FROM driver_markets dm JOIN markets m ON m.id=dm.market_id
      WHERE dm.driver_id=$1 ORDER BY m.name`, [req.params.driverId]);
    res.json(rows);
  } catch (e) { res.json({ error: e.message }); }
});

router.post('/api/driver-markets', async (req, res) => {
  try {
    const { driver_id, market_id } = req.body;
    await db.runAsync('INSERT INTO driver_markets (driver_id,market_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [driver_id, market_id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

router.delete('/api/driver-markets/:id', async (req, res) => {
  try { await db.runAsync('DELETE FROM driver_markets WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

// ── API: COMPANIES ────────────────────────────────────────────
router.get('/api/companies', async (req, res) => {
  try { res.json(await db.allAsync('SELECT id,name FROM companies WHERE active=1 ORDER BY name')); }
  catch (e) { res.json({ error: e.message }); }
});

router.post('/api/companies', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.json({ success: false, error: 'Назив е задолжителен' });
    const r = await pool.query('INSERT INTO companies (name) VALUES ($1) RETURNING id', [name]);
    res.json({ success: true, id: r.rows[0].id });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

router.put('/api/companies/:id', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.json({ success: false, error: 'Назив е задолжителен' });
    await db.runAsync('UPDATE companies SET name=$1 WHERE id=$2', [name, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

router.delete('/api/companies/:id', async (req, res) => {
  try { await db.runAsync('UPDATE companies SET active=0 WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

// ── API: HOLIDAYS ─────────────────────────────────────────────
router.get('/api/holidays', async (req, res) => {
  try { res.json(await db.allAsync('SELECT date FROM holidays ORDER BY date DESC')); }
  catch (e) { res.json({ error: e.message }); }
});

router.post('/api/holidays', async (req, res) => {
  try {
    const { date } = req.body;
    if (!date) return res.json({ success: false, error: 'Датумот е задолжителен' });
    await db.runAsync('INSERT INTO holidays (date) VALUES ($1) ON CONFLICT DO NOTHING', [date]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

router.delete('/api/holidays/:date', async (req, res) => {
  try { await db.runAsync('DELETE FROM holidays WHERE date=$1', [req.params.date]); res.json({ success: true }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

module.exports = router;
