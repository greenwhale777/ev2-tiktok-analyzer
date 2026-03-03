require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

p.query("UPDATE tiktok_tasks SET status='failed' WHERE status IN ('pending','running') AND created_at < NOW() - INTERVAL '1 hour' RETURNING id, keyword, status")
  .then(r => { console.log('정리됨:', r.rows); p.end(); })
  .catch(e => { console.error(e); p.end(); });
