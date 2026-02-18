require('dotenv').config();
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
p.query("SELECT NOW() as db_now, NOW() AT TIME ZONE 'Asia/Seoul' as db_kst, TO_CHAR(NOW() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') as db_kst_str").then(r=>{console.table(r.rows); console.log('JS now:', new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})); p.end()});
