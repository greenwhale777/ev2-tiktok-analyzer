require('dotenv').config();
const {Pool} = require('pg');
const p = new Pool({connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
p.query("SELECT source, COUNT(*), DATE(completed_at AT TIME ZONE 'Asia/Seoul') as d FROM tiktok_searches WHERE status='completed' GROUP BY source, d ORDER BY d DESC LIMIT 10").then(function(r) { console.table(r.rows); p.end(); });
