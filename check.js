require('dotenv').config();
const{Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
p.query("SELECT id,type,keyword,status FROM tiktok_tasks WHERE status IN ('pending','running')").then(r=>{console.log(r.rows);p.end()})
