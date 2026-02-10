/**
 * 로컬 실행 스크립트 - 데스크탑에서 TikTok 스크래핑 후 Railway DB에 저장
 * 
 * 사용법:
 *   node run-local.js "메디큐브 PDRN"
 *   node run-local.js "메디큐브 PDRN" 10        (상위 10개)
 * 
 * 환경변수:
 *   DATABASE_URL=postgresql://... (Railway DB Public URL)
 *   .env 파일에 설정하거나 직접 입력
 */

require('dotenv').config();
const { Pool } = require('pg');
const TikTokScraper = require('./services/scraper');

// === 설정 ===
const keyword = process.argv[2];
const topN = parseInt(process.argv[3]) || 5;

if (!keyword) {
  console.log('사용법: node run-local.js "키워드" [개수]');
  console.log('예시:   node run-local.js "메디큐브 PDRN" 5');
  process.exit(1);
}

// DB 연결
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL 환경변수가 설정되지 않았습니다.');
  console.error('   .env 파일에 DATABASE_URL=postgresql://... 를 추가하세요.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false
});

async function run() {
  const scraper = new TikTokScraper();
  let searchId = null;

  try {
    console.log(`\n🎵 TikTok 로컬 스크래핑 시작`);
    console.log(`📌 키워드: ${keyword}`);
    console.log(`📌 수집 개수: ${topN}`);
    console.log(`📌 DB: Railway PostgreSQL\n`);

    // === 1. DB에 키워드 등록 (없으면 추가) ===
    const kwResult = await pool.query(
      `INSERT INTO tiktok_keywords (keyword) VALUES ($1) 
       ON CONFLICT (keyword) DO UPDATE SET updated_at = NOW() 
       RETURNING id`,
      [keyword]
    );
    const keywordId = kwResult.rows[0].id;
    console.log(`✅ 키워드 등록: "${keyword}" (ID: ${keywordId})`);

    // === 2. 검색 기록 생성 ===
    const searchResult = await pool.query(
      `INSERT INTO tiktok_searches (keyword_id, keyword, status) 
       VALUES ($1, $2, 'running') RETURNING id`,
      [keywordId, keyword]
    );
    searchId = searchResult.rows[0].id;
    console.log(`✅ 검색 기록 생성 (Search ID: ${searchId})\n`);

    // === 3. TikTok 스크래핑 (로컬 브라우저) ===
    const results = await scraper.searchKeyword(keyword, topN, (status, percent, msg) => {
      console.log(`   [${percent}%] ${msg}`);
    });

    console.log(`\n✅ ${results.length}개 비디오 수집 완료\n`);

    // === 4. 결과를 DB에 저장 ===
    for (const video of results) {
      await pool.query(
        `INSERT INTO tiktok_videos 
         (search_id, rank, video_url, creator_id, creator_name, description, posted_date, likes, comments, bookmarks, shares, views)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          searchId, video.rank, video.videoUrl,
          video.creatorId, video.creatorName, video.description,
          video.postedDate, video.likes, video.comments,
          video.bookmarks, video.shares, video.views
        ]
      );
    }

    // === 5. 검색 상태 업데이트 ===
    await pool.query(
      `UPDATE tiktok_searches 
       SET status = 'completed', video_count = $1, completed_at = NOW() 
       WHERE id = $2`,
      [results.length, searchId]
    );

    // === 결과 출력 ===
    console.log('='.repeat(60));
    console.log(`📊 검색 결과: "${keyword}" 상위 ${results.length}개`);
    console.log('='.repeat(60));
    results.forEach(v => {
      console.log(`\n#${v.rank} @${v.creatorId} (${v.creatorName})`);
      console.log(`   👁️ ${v.views} views | ❤️ ${v.likes} | 💬 ${v.comments} | 🔖 ${v.bookmarks} | 🔄 ${v.shares}`);
      console.log(`   📅 ${v.postedDate}`);
      console.log(`   🔗 ${v.videoUrl}`);
    });

    console.log(`\n✅ DB 저장 완료! 대시보드에서 확인하세요.`);

  } catch (err) {
    console.error(`\n❌ 에러: ${err.message}`);

    // 검색 상태를 실패로 업데이트
    if (searchId) {
      await pool.query(
        `UPDATE tiktok_searches SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
        [err.message, searchId]
      ).catch(() => {});
    }
  } finally {
    await scraper.close();
    await pool.end();
    console.log('\n🔚 종료');
  }
}

run();
