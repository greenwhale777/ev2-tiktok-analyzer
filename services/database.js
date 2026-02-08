const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') 
    ? { rejectUnauthorized: false } 
    : false
});

// 테이블 초기화
async function initDatabase() {
  const client = await pool.connect();
  try {
    // 키워드 관리 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS tiktok_keywords (
        id SERIAL PRIMARY KEY,
        keyword VARCHAR(200) NOT NULL UNIQUE,
        is_active BOOLEAN DEFAULT true,
        schedule_cron VARCHAR(50) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 검색 실행 기록 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS tiktok_searches (
        id SERIAL PRIMARY KEY,
        keyword_id INTEGER REFERENCES tiktok_keywords(id),
        keyword VARCHAR(200) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        video_count INTEGER DEFAULT 0,
        error TEXT,
        started_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `);

    // 비디오 결과 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS tiktok_videos (
        id SERIAL PRIMARY KEY,
        search_id INTEGER REFERENCES tiktok_searches(id) ON DELETE CASCADE,
        rank INTEGER NOT NULL,
        video_url TEXT NOT NULL,
        creator_id VARCHAR(200),
        creator_name VARCHAR(200),
        description TEXT,
        posted_date VARCHAR(100),
        likes VARCHAR(50),
        comments VARCHAR(50),
        bookmarks VARCHAR(50),
        shares VARCHAR(50),
        views VARCHAR(50),
        scraped_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('✅ Database tables initialized');
  } catch (err) {
    console.error('❌ Database init error:', err.message);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDatabase };
