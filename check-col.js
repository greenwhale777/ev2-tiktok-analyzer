require('dotenv').config();
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
p.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='tiktok_searches' AND column_name IN ('started_at','completed_at','created_at')").then(r=>{console.table(r.rows);p.end()});
