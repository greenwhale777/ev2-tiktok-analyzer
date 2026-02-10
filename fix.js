require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
p.query("UPDATE tiktok_tasks SET status='failed', error='stuck' WHERE status='running'").then(r => { console.log('Updated:', r.rowCount); p.end(); });