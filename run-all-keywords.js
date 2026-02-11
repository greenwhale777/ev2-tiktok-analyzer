/**
 * 전체 키워드 자동 스크래핑 스크립트
 * 
 * DB에 등록된 모든 활성 키워드를 순차적으로 스크래핑하고 결과를 DB에 저장
 * Windows 작업 스케줄러에서 매일 오전 10시에 실행
 * 
 * 사용법:
 *   node run-all-keywords.js
 *   node run-all-keywords.js 10    (키워드당 상위 10개, 기본값 30)
 */

require('dotenv').config();
const { Pool } = require('pg');
const TikTokScraper = require('./services/scraper');

const topN = parseInt(process.argv[2]) || 30;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false
});

// 텔레그램 알림 (선택)
async function sendTelegram(message) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
    });
  } catch {}
}

// 이전 검색 결과와 비교 분석
async function analyzeChanges(keyword, currentVideos, searchId) {
  try {
    // 직전 성공한 검색 찾기
    const prevSearch = await pool.query(
      `SELECT id FROM tiktok_searches 
       WHERE keyword = $1 AND status = 'completed' AND id < $2
       ORDER BY id DESC LIMIT 1`,
      [keyword, searchId]
    );

    if (prevSearch.rows.length === 0) {
      return { isFirst: true, summary: '첫번째 검색 - 비교 데이터 없음' };
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

    // 분석
    const newEntries = []; // 신규 진입
    const exited = [];     // 이탈
    const rankChanges = []; // 순위 변동
    const statChanges = []; // 지표 급등

    // 신규 진입 & 순위/지표 변동
    currentVideos.forEach(curr => {
      const prev = prevMap[curr.videoUrl];
      if (!prev) {
        newEntries.push({ rank: curr.rank, creatorId: curr.creatorId, url: curr.videoUrl });
      } else {
        // 순위 변동
        const rankDiff = prev.rank - curr.rank;
        if (rankDiff !== 0) {
          rankChanges.push({
            creatorId: curr.creatorId,
            oldRank: prev.rank,
            newRank: curr.rank,
            diff: rankDiff
          });
        }

        // 좋아요 변동
        const prevLikes = parseInt(prev.likes) || 0;
        const currLikes = parseInt(curr.likes) || 0;
        if (prevLikes > 0 && currLikes > prevLikes * 1.5) {
          statChanges.push({
            creatorId: curr.creatorId,
            metric: '좋아요',
            old: prevLikes,
            new: currLikes,
            changePercent: Math.round((currLikes - prevLikes) / prevLikes * 100)
          });
        }

        // 조회수 변동
        const prevViews = parseInt(prev.views) || 0;
        const currViews = parseInt(curr.views) || 0;
        if (prevViews > 0 && currViews > prevViews * 1.5) {
          statChanges.push({
            creatorId: curr.creatorId,
            metric: '조회수',
            old: prevViews,
            new: currViews,
            changePercent: Math.round((currViews - prevViews) / prevViews * 100)
          });
        }
      }
    });

    // 이탈 (이전에 있었는데 현재 없는 것)
    prevVideos.rows.forEach(prev => {
      if (!currentMap[prev.video_url]) {
        exited.push({ rank: prev.rank, creatorId: prev.creator_id, url: prev.video_url });
      }
    });

    const analysis = { isFirst: false, newEntries, exited, rankChanges, statChanges };

    // 분석 결과를 DB에 저장
    const summary = [];
    if (newEntries.length > 0) summary.push(`🆕 신규 ${newEntries.length}건`);
    if (exited.length > 0) summary.push(`📤 이탈 ${exited.length}건`);
    if (rankChanges.length > 0) summary.push(`📊 순위변동 ${rankChanges.length}건`);
    if (statChanges.length > 0) summary.push(`📈 지표급등 ${statChanges.length}건`);

    analysis.summary = summary.length > 0 ? summary.join(' | ') : '변동 없음';

    // analysis JSON을 searches 테이블에 저장
    await pool.query(
      `ALTER TABLE tiktok_searches ADD COLUMN IF NOT EXISTS analysis JSONB`,
      []
    ).catch(() => {});

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

async function run() {
  const scraper = new TikTokScraper();
  const startTime = new Date();
  const results = [];

  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 TikTok 전체 키워드 자동 스크래핑`);
    console.log(`📅 ${startTime.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
    console.log(`📌 키워드당 상위 ${topN}개 수집`);
    console.log(`${'='.repeat(60)}\n`);

    // analysis 컬럼 추가 (없으면)
    await pool.query(
      `ALTER TABLE tiktok_searches ADD COLUMN IF NOT EXISTS analysis JSONB`
    ).catch(() => {});

    // DB에서 활성 키워드 조회
    const kwResult = await pool.query(
      `SELECT id, keyword FROM tiktok_keywords WHERE is_active = true ORDER BY id`
    );

    if (kwResult.rows.length === 0) {
      console.log('⚠️ 등록된 활성 키워드가 없습니다.');
      return;
    }

    console.log(`📋 활성 키워드 ${kwResult.rows.length}개: ${kwResult.rows.map(r => r.keyword).join(', ')}\n`);

    // 각 키워드별 스크래핑
    for (const kw of kwResult.rows) {
      const kwStart = Date.now();
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`🔍 [${kw.keyword}] 스크래핑 시작...`);

      let searchId = null;
      try {
        // 검색 기록 생성
        const searchResult = await pool.query(
          `INSERT INTO tiktok_searches (keyword_id, keyword, status) 
           VALUES ($1, $2, 'running') RETURNING id`,
          [kw.id, kw.keyword]
        );
        searchId = searchResult.rows[0].id;

        // 스크래핑 실행
        const videos = await scraper.searchKeyword(kw.keyword, topN, (status, percent, msg) => {
          process.stdout.write(`\r   [${percent}%] ${msg}          `);
        });
        console.log('');

        // DB에 비디오 저장
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

        // 검색 상태 업데이트
        await pool.query(
          `UPDATE tiktok_searches SET status = 'completed', video_count = $1, completed_at = NOW() WHERE id = $2`,
          [videos.length, searchId]
        );

        // 변동 분석
        const analysis = await analyzeChanges(kw.keyword, videos, searchId);

        const elapsed = ((Date.now() - kwStart) / 1000).toFixed(1);
        console.log(`   ✅ ${videos.length}개 수집 완료 (${elapsed}초)`);
        console.log(`   📊 분석: ${analysis.summary}`);

        results.push({
          keyword: kw.keyword,
          count: videos.length,
          status: 'success',
          analysis: analysis.summary,
          elapsed
        });

        // 키워드 업데이트 시간 갱신
        await pool.query(
          `UPDATE tiktok_keywords SET updated_at = NOW() WHERE id = $1`,
          [kw.id]
        );

        // 키워드 간 딜레이 (봇감지 방지)
        if (kwResult.rows.indexOf(kw) < kwResult.rows.length - 1) {
          console.log('   ⏳ 다음 키워드까지 10초 대기...');
          await new Promise(r => setTimeout(r, 10000));
        }

      } catch (err) {
        console.log(`\n   ❌ 실패: ${err.message}`);
        if (searchId) {
          await pool.query(
            `UPDATE tiktok_searches SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
            [err.message, searchId]
          ).catch(() => {});
        }
        results.push({ keyword: kw.keyword, count: 0, status: 'failed', error: err.message });
      }
    }

    // === 최종 리포트 ===
    const totalTime = ((Date.now() - startTime.getTime()) / 1000).toFixed(1);
    const successCount = results.filter(r => r.status === 'success').length;
    const failCount = results.filter(r => r.status === 'failed').length;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 실행 결과 리포트`);
    console.log(`${'='.repeat(60)}`);
    results.forEach(r => {
      const icon = r.status === 'success' ? '✅' : '❌';
      console.log(`${icon} ${r.keyword}: ${r.count}개 ${r.status === 'success' ? `(${r.elapsed}초) - ${r.analysis}` : `- ${r.error}`}`);
    });
    console.log(`\n⏱️ 총 소요시간: ${totalTime}초 | 성공: ${successCount} | 실패: ${failCount}`);

    // 텔레그램 알림
    let teleMsg = `🚀 <b>TikTok 자동 스크래핑 완료</b>\n`;
    teleMsg += `📅 ${startTime.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n\n`;
    results.forEach(r => {
      const icon = r.status === 'success' ? '✅' : '❌';
      teleMsg += `${icon} <b>${r.keyword}</b>: ${r.count}개`;
      if (r.analysis) teleMsg += ` | ${r.analysis}`;
      if (r.error) teleMsg += ` | ${r.error}`;
      teleMsg += '\n';
    });
    teleMsg += `\n⏱️ ${totalTime}초 | 성공 ${successCount} | 실패 ${failCount}`;
    await sendTelegram(teleMsg);

  } catch (err) {
    console.error(`\n❌ 전체 오류: ${err.message}`);
    await sendTelegram(`❌ TikTok 자동 스크래핑 오류: ${err.message}`);
  } finally {
    await scraper.close();
    await pool.end();
    console.log('\n🔚 종료');
  }
}

run();
