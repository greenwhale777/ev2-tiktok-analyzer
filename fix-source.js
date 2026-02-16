require('dotenv').config();
const {Pool} = require('pg');
const p = new Pool({connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
// 2/15(KST) 데이터의 source를 scheduled로 변경
p.query("UPDATE tiktok_searches SET source = 'scheduled' WHERE status = 'completed' AND DATE(completed_at AT TIME ZONE 'Asia/Seoul') = '2026-02-15' RETURNING id, keyword, source").then(function(r) { 
  console.log('Updated:', r.rowCount, 'rows');
  console.table(r.rows);
  p.end(); 
});
