require('dotenv').config();
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
(async()=>{
  const dates = await p.query("SELECT DISTINCT ON (TO_CHAR(completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) id, TO_CHAR(completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') as d FROM tiktok_searches WHERE keyword='skin1004' AND status='completed' AND video_count>0 ORDER BY TO_CHAR(completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') DESC, completed_at DESC LIMIT 2");
  for(const s of dates.rows){
    console.log('\n==',s.d,'==');
    const v=await p.query('SELECT rank,creator_name,views,likes FROM tiktok_videos WHERE search_id= ORDER BY rank LIMIT 10',[s.id]);
    console.table(v.rows);
  }
  p.end();
})();
