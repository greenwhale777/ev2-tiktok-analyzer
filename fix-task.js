require('dotenv').config();
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
p.query("UPDATE tiktok_tasks SET status='cancelled' WHERE keyword='koreanskincare' AND status IN ('pending','running')").then(r=>{console.log('Updated:', r.rowCount); p.end()}).catch(e=>{console.log(e.message); p.end()});
