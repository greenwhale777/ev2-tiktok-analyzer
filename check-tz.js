require('dotenv').config();
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
p.query("SHOW timezone").then(r=>{console.log('DB timezone:', r.rows[0].TimeZone); p.end()});
