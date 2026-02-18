require('dotenv').config();
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
p.query("SELECT id FROM tiktok_searches WHERE keyword='skin1004' AND status='completed' AND video_count>0 ORDER BY completed_at DESC LIMIT 2").then(async r=>{for(const s of r.rows){const v=await p.query('SELECT rank,creator_name,views,likes FROM tiktok_videos WHERE search_id='+s.id+' ORDER BY rank LIMIT 10');console.log('search_id:',s.id);console.table(v.rows);}p.end();});
