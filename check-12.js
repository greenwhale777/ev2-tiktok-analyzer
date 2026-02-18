require('dotenv').config();
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
p.query("SELECT id, TO_CHAR(completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') as kst, TO_CHAR(started_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') as started_kst, keyword, video_count FROM tiktok_searches WHERE keyword IN ('kbeauty','koreanskincare') AND status='completed' ORDER BY completed_at DESC LIMIT 10").then(r=>{console.table(r.rows);p.end()});
