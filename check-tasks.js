require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

p.query("SELECT id, type, keyword, status, created_at FROM tiktok_tasks WHERE status IN ('pending','running') ORDER BY id DESC LIMIT 10")
  .then(r => { console.log(r.rows); p.end(); })
  .catch(e => { console.error(e); p.end(); });
