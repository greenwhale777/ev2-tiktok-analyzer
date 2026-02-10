/**
 * 로컬 작업 워커 - DB에서 대기 중인 스크래핑 요청을 확인하고 로컬에서 실행
 * 
 * 동작:
 * 1. 30초마다 DB에서 status='pending' 작업 확인
 * 2. 대기 작업 발견 시 로컬에서 TikTok 스크래핑 실행
 * 3. 결과를 DB에 저장
 * 
 * 사용법:
 *   node task-worker.js              (30초 간격 폴링)
 *   node task-worker.js --once       (1회만 실행 후 종료)
 * 
 * n8n에서 실행하거나, PC 시작 시 자동 실행하도록 설정
 */

require('dotenv').config();
const { notifySearchComplete, notifySearchFailed } = require('./services/telegram');
const { Pool } = require('pg');
const TikTokScraper = require('./services/scraper');

const POLL_INTERVAL = 30000; // 30초
const isOnce = process.argv.includes('--once');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false
});

// 테이블 초기화
async function initTaskTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tiktok_tasks (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50) NOT NULL DEFAULT 'search',
      keyword VARCHAR(200),
      top_n INTEGER DEFAULT 10,
      status VARCHAR(20) DEFAULT 'pending',
      requested_by VARCHAR(100) DEFAULT 'dashboard',
      result JSONB,
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      started_at TIMESTAMP,
      completed_at TIMESTAMP
    )
  `);
  // analysis 컬럼 추가 (없으면)
  await pool.query(
    `ALTER TABLE tiktok_searches ADD COLUMN IF NOT EXISTS analysis JSONB`
  ).catch(() => {});
}

// 이전 검색 결과와 비교 분석
async function analyzeChanges(keyword, currentVideos, searchId) {
  try {
    const prevSearch = await pool.query(
      `SELECT id FROM tiktok_searches 
       WHERE keyword = $1 AND status = 'completed' AND id < $2
       ORDER BY id DESC LIMIT 1`,
      [keyword, searchId]
    );

    if (prevSearch.rows.length === 0) {
      return { isFirst: true, summary: '첫 번째 검색 - 비교 데이터 없음' };
    }

    const prevId = prevSearch.rows[0].id;
    const prevVideos = await pool.query(
      `SELECT * FROM tiktok_videos WHERE search_id = $1 ORDER BY rank`,
      [prevId]
    );

    const prevMap = {};
    prevVideos.rows.forEach(v => { prevMap[v.video_url] = v; });

    const currentMap = {};
    currentVideos.forEach(v => { currentMap[v.videoUrl] = v; });

    const newEntries = [];
    const exited = [];
    const rankChanges = [];
    const statChanges = [];

    currentVideos.forEach(curr => {
      const prev = prevMap[curr.videoUrl];
      if (!prev) {
        newEntries.push({ rank: curr.rank, creatorId: curr.creatorId });
      } else {
        const rankDiff = prev.rank - curr.rank;
        if (rankDiff !== 0) {
          rankChanges.push({ creatorId: curr.creatorId, oldRank: prev.rank, newRank: curr.rank, diff: rankDiff });
        }
        const prevLikes = parseInt(prev.likes) || 0;
        const currLikes = parseInt(curr.likes) || 0;
        if (prevLikes > 0 && currLikes > prevLikes * 1.5) {
          statChanges.push({ creatorId: curr.creatorId, metric: '좋아요', old: prevLikes, new: currLikes, changePercent: Math.round((currLikes - prevLikes) / prevLikes * 100) });
        }
        const prevViews = parseInt(prev.views) || 0;
        const currViews = parseInt(curr.views) || 0;
        if (prevViews > 0 && currViews > prevViews * 1.5) {
          statChanges.push({ creatorId: curr.creatorId, metric: '조회수', old: prevViews, new: currViews, changePercent: Math.round((currViews - prevViews) / prevViews * 100) });
        }
      }
    });

    prevVideos.rows.forEach(prev => {
      if (!currentMap[prev.video_url]) {
        exited.push({ rank: prev.rank, creatorId: prev.creator_id });
      }
    });

    const analysis = { isFirst: false, newEntries, exited, rankChanges, statChanges };
    const summary = [];
    if (newEntries.length > 0) summary.push(`🆕 신규 ${newEntries.length}건`);
    if (exited.length > 0) summary.push(`📤 이탈 ${exited.length}건`);
    if (rankChanges.length > 0) summary.push(`📊 순위변동 ${rankChanges.length}건`);
    if (statChanges.length > 0) summary.push(`🔥 지표급등 ${statChanges.length}건`);
    analysis.summary = summary.length > 0 ? summary.join(' | ') : '변동 없음';

    await pool.query(
      `UPDATE tiktok_searches SET analysis = $1 WHERE id = $2`,
      [JSON.stringify(analysis), searchId]
    );

    return analysis;
  } catch (err) {
    console.error('분석 오류:', err.message);
    return { isFirst: true, summary: '분석 실패' };
  }
}

// 단일 키워드 스크래핑 실행
async function executeSearch(keyword, topN = 10) {
  const scraper = new TikTokScraper();
  let searchId = null;

  try {
    // 키워드 등록
    const kwResult = await pool.query(
      `INSERT INTO tiktok_keywords (keyword) VALUES ($1) 
       ON CONFLICT (keyword) DO UPDATE SET updated_at = NOW() RETURNING id`,
      [keyword]
    );
    const keywordId = kwResult.rows[0].id;

    // 검색 기록 생성
    const searchResult = await pool.query(
      `INSERT INTO tiktok_searches (keyword_id, keyword, status) 
       VALUES ($1, $2, 'running') RETURNING id`,
      [keywordId, keyword]
    );
    searchId = searchResult.rows[0].id;

    // 스크래핑
    const videos = await scraper.searchKeyword(keyword, topN, (status, percent, msg) => {
      process.stdout.write(`\r   [${percent}%] ${msg}          `);
    });
    console.log('');

    // DB 저장
    for (const video of videos) {
      await pool.query(
        `INSERT INTO tiktok_videos 
         (search_id, rank, video_url, creator_id, creator_name, description, posted_date, likes, comments, bookmarks, shares, views)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [searchId, video.rank, video.videoUrl, video.creatorId, video.creatorName,
         video.description, video.postedDate, video.likes, video.comments,
         video.bookmarks, video.shares, video.views]
      );
    }

    // 상태 업데이트
    await pool.query(
      `UPDATE tiktok_searches SET status = 'completed', video_count = $1, completed_at = NOW() WHERE id = $2`,
      [videos.length, searchId]
    );

    // 분석
    const analysis = await analyzeChanges(keyword, videos, searchId);

    await pool.query(
      `UPDATE tiktok_keywords SET updated_at = NOW() WHERE id = $1`,
      [keywordId]
    );

    return { success: true, count: videos.length, searchId, analysis: analysis.summary };

  } catch (err) {
    if (searchId) {
      await pool.query(
        `UPDATE tiktok_searches SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
        [err.message, searchId]
      ).catch(() => {});
    }
    throw err;
  } finally {
    await scraper.close();
  }
}

// 대기 중인 작업 처리
async function processPendingTasks() {
  try {
    // pending 상태인 가장 오래된 작업 1개 가져오기 (FOR UPDATE SKIP LOCKED 방식)
    const taskResult = await pool.query(
      `UPDATE tiktok_tasks 
       SET status = 'running', started_at = NOW() 
       WHERE id = (
         SELECT id FROM tiktok_tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1
       )
       RETURNING *`
    );

    if (taskResult.rows.length === 0) return false;

    const task = taskResult.rows[0];
    console.log(`\n📋 작업 발견: [${task.type}] ${task.keyword || '전체'} (Task #${task.id})`);

    try {
      if (task.type === 'search' && task.keyword) {
        // 단일 키워드 검색
        const result = await executeSearch(task.keyword, task.top_n || 10);
        await pool.query(
          `UPDATE tiktok_tasks SET status = 'completed', result = $1, completed_at = NOW() WHERE id = $2`,
          [JSON.stringify(result), task.id]
        );
        console.log(`   ✅ 완료: ${result.count}개 수집 | ${result.analysis}`);
	await notifySearchComplete(task.keyword || '전체', result.count, task.id);

      } else if (task.type === 'run_all') {
        // 전체 키워드 실행
        const kwResult = await pool.query(
          `SELECT id, keyword FROM tiktok_keywords WHERE is_active = true ORDER BY id`
        );
        const results = [];

        for (const kw of kwResult.rows) {
          console.log(`\n   🔍 [${kw.keyword}] 스크래핑...`);
          try {
            const result = await executeSearch(kw.keyword, task.top_n || 10);
            results.push({ keyword: kw.keyword, ...result });
            console.log(`   ✅ ${result.count}개 | ${result.analysis}`);

            // 키워드 간 딜레이
            if (kwResult.rows.indexOf(kw) < kwResult.rows.length - 1) {
              console.log('   ⏳ 10초 대기...');
              await new Promise(r => setTimeout(r, 10000));
            }
          } catch (err) {
            results.push({ keyword: kw.keyword, success: false, error: err.message });
            console.log(`   ❌ 실패: ${err.message}`);
          }
        }

        await pool.query(
          `UPDATE tiktok_tasks SET status = 'completed', result = $1, completed_at = NOW() WHERE id = $2`,
          [JSON.stringify({ keywords: results.length, results }), task.id]
        );
      }
    } catch (err) {
      await pool.query(
        `UPDATE tiktok_tasks SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
        [err.message, task.id]
      );
      console.log(`   ❌ 작업 실패: ${err.message}`);
	await notifySearchFailed(task.keyword || '전체', err.message);
    }

    return true;

  } catch (err) {
    console.error('폴링 오류:', err.message);
    return false;
  }
}

// 메인 루프
async function main() {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`🔄 TikTok 작업 워커 시작`);
  console.log(`📌 폴링 간격: ${POLL_INTERVAL / 1000}초`);
  console.log(`📌 모드: ${isOnce ? '1회 실행' : '상시 실행'}`);
  console.log(`${'='.repeat(50)}\n`);

  await initTaskTable();
  console.log('✅ 작업 테이블 준비 완료');

  if (isOnce) {
    const hadTask = await processPendingTasks();
    if (!hadTask) console.log('📭 대기 중인 작업 없음');
    await pool.end();
    return;
  }

  // 상시 폴링
  console.log('👀 대기 중인 작업을 감시합니다...\n');

  const poll = async () => {
    const hadTask = await processPendingTasks();
    // 작업이 있었으면 바로 다시 확인 (연속 작업 처리)
    if (hadTask) {
      setTimeout(poll, 2000);
    } else {
      setTimeout(poll, POLL_INTERVAL);
    }
  };

  poll();
}

main().catch(err => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
