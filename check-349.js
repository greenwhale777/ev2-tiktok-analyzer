require('dotenv').config();
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
p.query("SELECT id, completed_at, TO_CHAR(completed_at, 'YYYY-MM-DD HH24:MI:SS') as utc_raw, TO_CHAR(completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') as kst FROM tiktok_searches WHERE id IN (349,351)").then(r=>{console.table(r.rows);p.end()});
