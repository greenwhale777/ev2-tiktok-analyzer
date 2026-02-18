require('dotenv').config();
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
(async()=>{
  // 1. 컬럼 타입 변경
  await p.query("ALTER TABLE tiktok_searches ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC'");
  await p.query("ALTER TABLE tiktok_searches ALTER COLUMN started_at TYPE timestamptz USING started_at AT TIME ZONE 'UTC'");
  console.log('컬럼 타입 변경 완료');
  
  // 2. 확인
  const r = await p.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='tiktok_searches' AND column_name IN ('started_at','completed_at')");
  console.table(r.rows);
  
  // 3. 데이터 확인
  const r2 = await p.query("SELECT id, TO_CHAR(completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') as kst, keyword FROM tiktok_searches WHERE id IN (349,351)");
  console.table(r2.rows);
  
  p.end();
})();
