const express = require('express');
const router = express.Router();
const TikTokScraper = require('../services/scraper');
const { pool, initDatabase } = require('../services/database');
const { notifySearchComplete, notifySearchFailed } = require('../services/telegram');

// DB 초기화
initDatabase();

// ============================================================
// 작업 큐 테이블 초기화
// ============================================================
(async () => {
  try {
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
    // source 컬럼 추가 (없으면) - scheduled, dashboard, manual 구분
    await pool.query(
      `ALTER TABLE tiktok_searches ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual'`
    ).catch(() => {});
    console.log('✅ tiktok_tasks table ready');
  } catch (err) {
    console.error('Task table init error:', err.message);
  }
})();

// ============================================================
// TASK QUEUE API
// ============================================================

// POST /api/tiktok/tasks - 작업 요청 (대시보드에서 호출)
router.post('/tasks', async (req, res) => {
  try {
    const { type = 'run_all', keyword, topN = 10 } = req.body;

    // 이미 대기 중인 동일 작업이 있는지 확인
    const existing = await pool.query(
      `SELECT id FROM tiktok_tasks 
       WHERE status IN ('pending', 'running') 
       AND type = $1 
       AND ($2::text IS NULL OR keyword = $2)
       LIMIT 1`,
      [type, keyword || null]
    );

    if (existing.rows.length > 0) {
      return res.json({
        success: false,
        error: '이미 대기 중인 동일 작업이 있습니다',
        taskId: existing.rows[0].id
      });
    }

    const result = await pool.query(
      `INSERT INTO tiktok_tasks (type, keyword, top_n, requested_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [type, keyword || null, topN, 'dashboard']
    );

    res.json({
      success: true,
      task: result.rows[0],
      message: type === 'run_all' 
        ? '전체 키워드 스크래핑이 요청되었습니다. PC가 켜져있으면 곧 실행됩니다.'
        : `'${keyword}' 스크래핑이 요청되었습니다.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/tiktok/tasks - 작업 목록 조회
router.get('/tasks', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const result = await pool.query(
      `SELECT * FROM tiktok_tasks ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/tiktok/tasks/pending/count - 대기 작업 수
router.get('/tasks/pending/count', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'running') as running
       FROM tiktok_tasks`
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/tiktok/tasks/:id - 작업 상태 조회
router.get('/tasks/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM tiktok_tasks WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '작업을 찾을 수 없습니다' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// SEARCH API (기존)
// ============================================================

// POST /api/tiktok/search - TikTok 검색 시작
router.post('/search', async (req, res) => {
  const { keyword, topN = 5 } = req.body;

  if (!keyword || keyword.trim() === '') {
    return res.status(400).json({
      success: false,
      error: '키워드를 입력해주세요'
    });
  }

  try {
    // 1. 키워드 등록 (없으면 생성)
    const kwResult = await pool.query(
      `INSERT INTO tiktok_keywords (keyword) VALUES ($1)
       ON CONFLICT (keyword) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [keyword.trim()]
    );
    const keywordId = kwResult.rows[0].id;

    // 2. 검색 기록 생성
    const searchResult = await pool.query(
      `INSERT INTO tiktok_searches (keyword_id, keyword, status)
       VALUES ($1, $2, 'pending') RETURNING id`,
      [keywordId, keyword.trim()]
    );
    const searchId = searchResult.rows[0].id;

    // 3. 즉시 응답 (비동기 처리)
    res.json({
      success: true,
      searchId,
      message: `'${keyword}' 검색을 시작합니다`,
    });

    // 4. 백그라운드에서 스크래핑 실행
    runSearch(searchId, keywordId, keyword.trim(), topN);

  } catch (err) {
    console.error('Search start error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 백그라운드 검색 실행
 */
async function runSearch(searchId, keywordId, keyword, topN) {
  const scraper = new TikTokScraper();

  try {
    // 상태 업데이트: scraping
    await pool.query(
      `UPDATE tiktok_searches SET status = 'scraping', started_at = NOW() WHERE id = $1`,
      [searchId]
    );

    // 스크래핑 실행
    const results = await scraper.searchKeyword(keyword, topN);

    // DB에 비디오 결과 저장
    for (const video of results) {
      await pool.query(
        `INSERT INTO tiktok_videos 
         (search_id, rank, video_url, creator_id, creator_name, description, 
          posted_date, likes, comments, bookmarks, shares, views)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          searchId, video.rank, video.videoUrl, video.creatorId,
          video.creatorName, video.description, video.postedDate,
          video.likes, video.comments, video.bookmarks,
          video.shares, video.views
        ]
      );
    }

    // 완료 처리
    await pool.query(
      `UPDATE tiktok_searches 
       SET status = 'completed', video_count = $1, completed_at = NOW() 
       WHERE id = $2`,
      [results.length, searchId]
    );

    // 키워드 업데이트 시간
    await pool.query(
      `UPDATE tiktok_keywords SET updated_at = NOW() WHERE id = $1`,
      [keywordId]
    );

    console.log(`✅ Search ${searchId} completed: ${results.length} videos`);
    await notifySearchComplete(keyword, results.length, searchId);

  } catch (err) {
    console.error(`❌ Search ${searchId} failed:`, err.message);
    await pool.query(
      `UPDATE tiktok_searches SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
      [err.message, searchId]
    );
    await notifySearchFailed(keyword, err.message);
  } finally {
    await scraper.close();
  }
}

// ============================================================
// GET /api/tiktok/search/:id/status - 검색 상태 조회
// ============================================================
router.get('/search/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, keyword, status, video_count, error, started_at, completed_at 
       FROM tiktok_searches WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '검색을 찾을 수 없습니다' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/tiktok/search/:id - 검색 결과 상세 (비디오 목록 포함)
// ============================================================
router.get('/search/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const searchResult = await pool.query(
      `SELECT * FROM tiktok_searches WHERE id = $1`,
      [id]
    );

    if (searchResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: '검색을 찾을 수 없습니다' });
    }

    const videosResult = await pool.query(
      `SELECT * FROM tiktok_videos WHERE search_id = $1 ORDER BY rank ASC`,
      [id]
    );

    res.json({
      success: true,
      data: {
        search: searchResult.rows[0],
        videos: videosResult.rows
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/tiktok/searches - 전체 검색 목록 (페이지네이션)
// ============================================================
router.get('/searches', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(
      `SELECT s.*, k.keyword as keyword_name
       FROM tiktok_searches s
       LEFT JOIN tiktok_keywords k ON s.keyword_id = k.id
       ORDER BY s.id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await pool.query('SELECT COUNT(*) FROM tiktok_searches');

    res.json({
      success: true,
      data: result.rows,
      total: parseInt(countResult.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// KEYWORDS API
// ============================================================

// GET /api/tiktok/keywords - 키워드 목록
router.get('/keywords', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT k.*, 
        (SELECT COUNT(*) FROM tiktok_searches WHERE keyword_id = k.id) as search_count,
        (SELECT MAX(completed_at) FROM tiktok_searches WHERE keyword_id = k.id AND status = 'completed') as last_searched
       FROM tiktok_keywords k
       ORDER BY k.created_at DESC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/tiktok/keywords - 키워드 추가
router.post('/keywords', async (req, res) => {
  try {
    const { keyword } = req.body;
    if (!keyword) {
      return res.status(400).json({ success: false, error: '키워드를 입력해주세요' });
    }

    const result = await pool.query(
      `INSERT INTO tiktok_keywords (keyword) VALUES ($1)
       ON CONFLICT (keyword) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [keyword.trim()]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/tiktok/keywords/:id - 키워드 삭제
router.delete('/keywords/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM tiktok_keywords WHERE id = $1', [id]);
    res.json({ success: true, message: '키워드가 삭제되었습니다' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// DELETE /api/tiktok/search/:id - 검색 결과 삭제
// ============================================================
router.delete('/search/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM tiktok_videos WHERE search_id = $1', [id]);
    await pool.query('DELETE FROM tiktok_searches WHERE id = $1', [id]);
    res.json({ success: true, message: '검색 결과가 삭제되었습니다' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// PATCH /api/tiktok/keywords/:id/toggle - 키워드 활성/비활성 토글
// ============================================================
router.patch('/keywords/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE tiktok_keywords SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '키워드를 찾을 수 없습니다' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// DAILY REPORT API
// ============================================================

// GET /api/tiktok/daily-reports - 일자별 리포트 목록
router.get('/daily-reports', async (req, res) => {
  try {
    const result = await pool.query(
      `WITH latest_per_keyword AS (
        SELECT DISTINCT ON (TO_CHAR(completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'), keyword)
          id, keyword, video_count, completed_at,
          TO_CHAR(completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') as report_date
        FROM tiktok_searches
        WHERE status = 'completed' AND video_count > 0
        ORDER BY TO_CHAR(completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'), keyword, completed_at DESC
      )
      SELECT 
        report_date,
        COUNT(DISTINCT keyword) as keyword_count,
        SUM(video_count) as total_videos
      FROM latest_per_keyword
      GROUP BY report_date
      ORDER BY report_date DESC
      LIMIT 30`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/tiktok/daily-reports/:date - 특정 일자 리포트 상세
router.get('/daily-reports/:date', async (req, res) => {
  try {
    const { date } = req.params;

    // 해당 날짜의 키워드별 마지막 수집 결과
    const searches = await pool.query(
      `SELECT DISTINCT ON (keyword)
        s.id, s.keyword, s.video_count, s.started_at, s.completed_at, s.analysis,
        (SELECT COUNT(*) FROM tiktok_videos WHERE search_id = s.id) as actual_video_count
       FROM tiktok_searches s
       WHERE status = 'completed'
         AND TO_CHAR(s.completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = $1
         AND video_count > 0
       ORDER BY keyword, s.completed_at DESC`,
      [date]
    );

    // 전일 데이터 (키워드별 마지막 수집)
    const prevDate = new Date(date + 'T00:00:00');
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0];

    const prevSearches = await pool.query(
      `SELECT DISTINCT ON (keyword)
        s.id, s.keyword, s.video_count, s.analysis
       FROM tiktok_searches s
       WHERE status = 'completed'
         AND TO_CHAR(s.completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = $1
         AND video_count > 0
       ORDER BY keyword, s.completed_at DESC`,
      [prevDateStr]
    );

    // 키워드별 요약
    const summary = searches.rows.map(search => {
      const prevSearch = prevSearches.rows.find(p => p.keyword === search.keyword);
      return {
        ...search,
        has_previous: !!prevSearch,
        previous_video_count: prevSearch ? prevSearch.video_count : null,
        previous_search_id: prevSearch ? prevSearch.id : null,
      };
    });

    res.json({ 
      success: true, 
      data: {
        date,
        previous_date: prevDateStr,
        has_previous: prevSearches.rows.length > 0,
        searches: summary,
        total_keywords: searches.rows.length,
        total_videos: searches.rows.reduce((sum, s) => sum + (s.video_count || 0), 0),
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/tiktok/daily-reports/:date/compare/:keyword - 키워드별 전일 비교 상세
router.get('/daily-reports/:date/compare/:keyword', async (req, res) => {
  try {
    const { date, keyword } = req.params;

    // 당일 마지막 수집
    const todaySearch = await pool.query(
      `SELECT s.id, TO_CHAR(s.completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as completed_kst FROM tiktok_searches s
       WHERE status = 'completed'
         AND s.keyword = $1
         AND TO_CHAR(s.completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = $2
         AND video_count > 0
       ORDER BY s.completed_at DESC LIMIT 1`,
      [keyword, date]
    );

    // 전일 마지막 수집
    const prevDate = new Date(date + 'T00:00:00');
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0];

    const prevSearch = await pool.query(
      `SELECT s.id, TO_CHAR(s.completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as completed_kst FROM tiktok_searches s
       WHERE status = 'completed'
         AND s.keyword = $1
         AND TO_CHAR(s.completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = $2
         AND video_count > 0
       ORDER BY s.completed_at DESC LIMIT 1`,
      [keyword, prevDateStr]
    );

    if (todaySearch.rows.length === 0) {
      return res.status(404).json({ success: false, error: '해당 날짜의 데이터가 없습니다' });
    }

    // 당일 비디오
    const todayVideos = await pool.query(
      `SELECT * FROM tiktok_videos WHERE search_id = $1 ORDER BY rank`,
      [todaySearch.rows[0].id]
    );

    // 전일 비디오
    let prevVideos = { rows: [] };
    if (prevSearch.rows.length > 0) {
      prevVideos = await pool.query(
        `SELECT * FROM tiktok_videos WHERE search_id = $1 ORDER BY rank`,
        [prevSearch.rows[0].id]
      );
    }

    // 비교 분석
    const todayList = todayVideos.rows;
    const prevList = prevVideos.rows;
    const prevMap = {};
    prevList.forEach(v => { prevMap[v.video_url] = v; });

    const parseNum = (val) => {
      if (!val || val === 'N/A') return 0;
      const num = parseInt(val.replace(/,/g, ''));
      return isNaN(num) ? 0 : num;
    };

    const comparison = todayList.map(video => {
      const prev = prevMap[video.video_url];
      const views = parseNum(video.views);
      const prevViews = prev ? parseNum(prev.views) : 0;
      const likes = parseNum(video.likes);
      const prevLikes = prev ? parseNum(prev.likes) : 0;
      const comments = parseNum(video.comments);
      const prevComments = prev ? parseNum(prev.comments) : 0;
      const viewsChange = prev ? views - prevViews : 0;
      const likesChange = prev ? likes - prevLikes : 0;
      const commentsChange = prev ? comments - prevComments : 0;
      const viewsChangeRate = prevViews > 0 ? ((viewsChange / prevViews) * 100) : 0;

      return {
        ...video,
        is_new: !prev,
        prev_rank: prev ? prev.rank : null,
        rank_change: prev ? prev.rank - video.rank : null,
        prev_views: prev ? prev.views : null,
        prev_likes: prev ? prev.likes : null,
        prev_comments: prev ? prev.comments : null,
        views_num: views,
        prev_views_num: prevViews,
        likes_num: likes,
        prev_likes_num: prevLikes,
        views_change: viewsChange,
        likes_change: likesChange,
        comments_change: commentsChange,
        views_change_rate: Math.round(viewsChangeRate),
      };
    });

    // 이탈 영상
    const todayUrls = new Set(todayList.map(v => v.video_url));
    const exited = prevList.filter(v => !todayUrls.has(v.video_url)).map(v => ({
      ...v,
      views_num: parseNum(v.views),
      likes_num: parseNum(v.likes),
    }));

    // 인사이트 분석
    const insights = [];

    // 1. 급등 영상 (신규 진입 + 높은 순위)
    const hotNewEntries = comparison.filter(v => v.is_new && v.rank <= 10);
    if (hotNewEntries.length > 0) {
      insights.push({
        type: 'hot_new',
        icon: '🔥',
        label: '신규 급등',
        desc: 'TOP 10에 새로 진입한 영상',
        videos: hotNewEntries,
      });
    }

    // 2. 순위 급상승 (5순위 이상 상승)
    const rankUp = comparison.filter(v => !v.is_new && v.rank_change !== null && v.rank_change >= 5);
    if (rankUp.length > 0) {
      insights.push({
        type: 'rank_up',
        icon: '🚀',
        label: '순위 급상승',
        desc: '5순위 이상 상승한 영상',
        videos: rankUp.sort((a, b) => (b.rank_change || 0) - (a.rank_change || 0)),
      });
    }

    // 3. 조회수/좋아요 급등 (기존 영상 중 조회수 50% 이상 증가)
    const viewsSpike = comparison.filter(v => !v.is_new && v.prev_views_num > 0 && v.views_change_rate >= 50);
    if (viewsSpike.length > 0) {
      insights.push({
        type: 'views_spike',
        icon: '📈',
        label: '조회수 급등',
        desc: '조회수가 50% 이상 증가한 영상',
        videos: viewsSpike.sort((a, b) => b.views_change_rate - a.views_change_rate),
      });
    }

    // 4. 순위 급하락 (5순위 이상 하락)
    const rankDown = comparison.filter(v => !v.is_new && v.rank_change !== null && v.rank_change <= -5);
    if (rankDown.length > 0) {
      insights.push({
        type: 'rank_down',
        icon: '📉',
        label: '순위 급하락',
        desc: '5순위 이상 하락한 영상',
        videos: rankDown.sort((a, b) => (a.rank_change || 0) - (b.rank_change || 0)),
      });
    }

    // 5. 인기 이탈 (전일 TOP 10이었으나 이탈)
    const hotExited = exited.filter(v => v.rank <= 10);
    if (hotExited.length > 0) {
      insights.push({
        type: 'hot_exited',
        icon: '💨',
        label: 'TOP 10 이탈',
        desc: '전일 TOP 10에서 사라진 영상',
        videos: hotExited,
      });
    }

    res.json({
      success: true,
      data: {
        keyword,
        date,
        previous_date: prevDateStr,
        today_time: todaySearch.rows[0]?.completed_kst || null,
        prev_time: prevSearch.rows.length > 0 ? prevSearch.rows[0].completed_kst : null,
        today_count: todayList.length,
        prev_count: prevList.length,
        new_entries: comparison.filter(v => v.is_new).length,
        exited_count: exited.length,
        insights,
        videos: comparison,
        exited_videos: exited,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// DATA ANALYTICS API - 정형 분석
// ============================================================

// GET /api/tiktok/analytics/dates/:keyword - 키워드별 수집 날짜 목록
// ⚠️ 이 라우트가 /analytics/:keyword/:date 보다 먼저 와야 함
router.get('/analytics/dates/:keyword', async (req, res) => {
  try {
    const { keyword } = req.params;
    const result = await pool.query(
      `SELECT TO_CHAR(completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') as date,
        COUNT(*) as search_count,
        SUM(video_count) as total_videos
       FROM tiktok_searches
       WHERE keyword = $1 AND status = 'completed' AND video_count > 0
       GROUP BY TO_CHAR(completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
       ORDER BY date DESC LIMIT 30`,
      [keyword]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/tiktok/analytics/:keyword/:date - 키워드별 당일 전체 수집 데이터 분석
router.get('/analytics/:keyword/:date', async (req, res) => {
  try {
    const { keyword, date } = req.params;

    // 해당 날짜의 모든 수집 데이터 (KST 기준)
    const searches = await pool.query(
      `SELECT s.id, s.video_count, s.completed_at,
        TO_CHAR(s.completed_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') as time_kst
       FROM tiktok_searches s
       WHERE s.keyword = $1 AND status = 'completed' AND video_count > 0
         AND TO_CHAR(s.completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = $2
       ORDER BY s.completed_at ASC`,
      [keyword, date]
    );

    if (searches.rows.length === 0) {
      return res.status(404).json({ success: false, error: '해당 날짜의 데이터가 없습니다' });
    }

    // 각 수집의 비디오 데이터
    const parseNum = (val) => {
      if (!val || val === 'N/A') return 0;
      const num = parseInt(String(val).replace(/,/g, ''));
      return isNaN(num) ? 0 : num;
    };

    const allSnapshots = [];
    for (const search of searches.rows) {
      const vids = await pool.query(
        `SELECT * FROM tiktok_videos WHERE search_id = $1 ORDER BY rank`,
        [search.id]
      );
      allSnapshots.push({
        searchId: search.id,
        time: search.time_kst,
        completedAt: search.completed_at,
        videos: vids.rows
      });
    }

    // 전일 마지막 수집 데이터
    const prevSearch = await pool.query(
      `SELECT s.id FROM tiktok_searches s
       WHERE s.keyword = $1 AND status = 'completed' AND video_count > 0
         AND TO_CHAR(s.completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') < $2
       ORDER BY s.completed_at DESC LIMIT 1`,
      [keyword, date]
    );

    let prevVideos = [];
    if (prevSearch.rows.length > 0) {
      const pv = await pool.query(
        `SELECT * FROM tiktok_videos WHERE search_id = $1 ORDER BY rank`,
        [prevSearch.rows[0].id]
      );
      prevVideos = pv.rows;
    }
    const prevMap = {};
    prevVideos.forEach(v => { prevMap[v.video_url] = v; });

    // 최신 수집 기준 분석
    const latest = allSnapshots[allSnapshots.length - 1];
    const latestVideos = latest.videos;

    // 분석 항목들
    const analytics = {
      keyword,
      date,
      snapshotCount: allSnapshots.length,
      snapshots: allSnapshots.map(s => ({ searchId: s.searchId, time: s.time, videoCount: s.videos.length })),

      // 1. 좋아요 TOP 5
      topLikes: [...latestVideos].sort((a, b) => parseNum(b.likes) - parseNum(a.likes)).slice(0, 5).map(v => ({
        rank: v.rank, creator: v.creator_name, likes: v.likes, views: v.views, url: v.video_url, description: v.description?.substring(0, 80)
      })),

      // 2. 조회수 TOP 5
      topViews: [...latestVideos].sort((a, b) => parseNum(b.views) - parseNum(a.views)).slice(0, 5).map(v => ({
        rank: v.rank, creator: v.creator_name, views: v.views, likes: v.likes, url: v.video_url, description: v.description?.substring(0, 80)
      })),

      // 3. 신규 진입 영상 (전일 대비)
      newEntries: latestVideos.filter(v => !prevMap[v.video_url]).map(v => ({
        rank: v.rank, creator: v.creator_name, views: v.views, likes: v.likes, url: v.video_url, description: v.description?.substring(0, 80)
      })),

      // 4. 전일 대비 좋아요 급증 (50% 이상)
      likesSpike: latestVideos.filter(v => {
        const prev = prevMap[v.video_url];
        if (!prev) return false;
        const curr = parseNum(v.likes);
        const old = parseNum(prev.likes);
        return old > 0 && ((curr - old) / old) >= 0.5;
      }).map(v => {
        const prev = prevMap[v.video_url];
        return {
          rank: v.rank, creator: v.creator_name, 
          likes: v.likes, prevLikes: prev.likes,
          changeRate: Math.round(((parseNum(v.likes) - parseNum(prev.likes)) / parseNum(prev.likes)) * 100),
          url: v.video_url
        };
      }).sort((a, b) => b.changeRate - a.changeRate),

      // 5. 전일 대비 조회수 급증 (50% 이상)
      viewsSpike: latestVideos.filter(v => {
        const prev = prevMap[v.video_url];
        if (!prev) return false;
        const curr = parseNum(v.views);
        const old = parseNum(prev.views);
        return old > 0 && ((curr - old) / old) >= 0.5;
      }).map(v => {
        const prev = prevMap[v.video_url];
        return {
          rank: v.rank, creator: v.creator_name,
          views: v.views, prevViews: prev.views,
          changeRate: Math.round(((parseNum(v.views) - parseNum(prev.views)) / parseNum(prev.views)) * 100),
          url: v.video_url
        };
      }).sort((a, b) => b.changeRate - a.changeRate),

      // 6. 이탈 영상 (전일 있었으나 오늘 없음)
      exitedVideos: prevVideos.filter(v => !latestVideos.find(lv => lv.video_url === v.video_url)).map(v => ({
        prevRank: v.rank, creator: v.creator_name, views: v.views, likes: v.likes, url: v.video_url
      })),

      // 7. 순위 변동 (전일 대비)
      rankChanges: latestVideos.filter(v => prevMap[v.video_url]).map(v => {
        const prev = prevMap[v.video_url];
        return { rank: v.rank, prevRank: prev.rank, change: prev.rank - v.rank, creator: v.creator_name, url: v.video_url };
      }).filter(v => Math.abs(v.change) >= 3).sort((a, b) => b.change - a.change),

      // 8. 크리에이터 빈도 (같은 크리에이터가 여러 영상)
      creatorFrequency: (() => {
        const freq = {};
        latestVideos.forEach(v => {
          if (!freq[v.creator_id]) freq[v.creator_id] = { name: v.creator_name, count: 0, ranks: [] };
          freq[v.creator_id].count++;
          freq[v.creator_id].ranks.push(v.rank);
        });
        return Object.values(freq).filter(c => c.count >= 2).sort((a, b) => b.count - a.count);
      })(),

      // 9. 수집 간 변동 (같은 날 여러번 수집 시)
      intradayChanges: allSnapshots.length >= 2 ? (() => {
        const first = allSnapshots[0];
        const last = allSnapshots[allSnapshots.length - 1];
        const firstMap = {};
        first.videos.forEach(v => { firstMap[v.video_url] = v; });
        
        const entered = last.videos.filter(v => !firstMap[v.video_url]).length;
        const exited = first.videos.filter(v => !last.videos.find(lv => lv.video_url === v.video_url)).length;
        return { firstTime: first.time, lastTime: last.time, entered, exited, firstCount: first.videos.length, lastCount: last.videos.length };
      })() : null,
    };

    res.json({ success: true, data: analytics });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// AI CHAT ANALYSIS API - Gemini 2단계 호출 (쿼리 판단 → 데이터 조회 → 답변)
// ============================================================

// 사용 가능한 데이터 쿼리 함수들
const dataQueries = {
  // 1. 특정 키워드 최근 데이터 (최대 2일)
  async keyword_recent(params) {
    const { keyword, days = 2 } = params;
    const dates = await pool.query(
      `SELECT DISTINCT TO_CHAR(completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') as d
       FROM tiktok_searches WHERE keyword = $1 AND status = 'completed' AND video_count > 0
       ORDER BY d DESC LIMIT $2`,
      [keyword, days]
    );
    let result = '';
    for (const row of dates.rows) {
      const search = await pool.query(
        `SELECT s.id, TO_CHAR(s.completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as time_kst
         FROM tiktok_searches s WHERE s.keyword = $1 AND status = 'completed' AND video_count > 0
           AND TO_CHAR(s.completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = $2
         ORDER BY s.completed_at DESC LIMIT 1`,
        [keyword, row.d]
      );
      if (search.rows.length > 0) {
        const videos = await pool.query(
          `SELECT rank, creator_name, creator_id, description, views, likes, comments, shares, video_url
           FROM tiktok_videos WHERE search_id = $1 ORDER BY rank`, [search.rows[0].id]
        );
        result += `\n== ${row.d} (${search.rows[0].time_kst}) - ${videos.rows.length}개 영상 ==\n`;
        videos.rows.forEach(v => {
          result += `#${v.rank} @${v.creator_id}(${v.creator_name}) | 조회:${v.views} 좋아요:${v.likes} 댓글:${v.comments} 공유:${v.shares} | ${(v.description||'').substring(0,80)}\n`;
        });
      }
    }
    return result || `"${keyword}" 데이터 없음`;
  },

  // 2. 전체 키워드 최근 현황
  async all_keywords_summary() {
    const result = await pool.query(
      `SELECT DISTINCT ON (keyword) keyword, video_count,
        TO_CHAR(completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as time_kst
       FROM tiktok_searches WHERE status = 'completed' AND video_count > 0
       ORDER BY keyword, completed_at DESC`
    );
    return '전체 키워드 현황:\n' + result.rows.map(s => `- ${s.keyword}: ${s.video_count}개 (${s.time_kst})`).join('\n');
  },

  // 3. 크로스 키워드 크리에이터 분석
  async cross_keyword_creators() {
    const result = await pool.query(
      `WITH latest AS (
        SELECT DISTINCT ON (keyword) id, keyword
        FROM tiktok_searches WHERE status = 'completed' AND video_count > 0
        ORDER BY keyword, completed_at DESC
      )
      SELECT v.creator_id, v.creator_name, 
        ARRAY_AGG(DISTINCT l.keyword) as keywords,
        COUNT(*) as total_appearances,
        ARRAY_AGG(v.rank ORDER BY l.keyword) as ranks
      FROM tiktok_videos v JOIN latest l ON v.search_id = l.id
      WHERE v.creator_id IS NOT NULL AND v.creator_id != ''
      GROUP BY v.creator_id, v.creator_name
      HAVING COUNT(DISTINCT l.keyword) >= 2
      ORDER BY COUNT(DISTINCT l.keyword) DESC, COUNT(*) DESC
      LIMIT 20`
    );
    if (result.rows.length === 0) return '여러 키워드에 걸쳐 등장하는 크리에이터 없음';
    return '크로스 키워드 크리에이터:\n' + result.rows.map(r => 
      `@${r.creator_id}(${r.creator_name}) - ${r.keywords.join(', ')} (총 ${r.total_appearances}회)`
    ).join('\n');
  },

  // 4. 특정 날짜 전체 키워드 데이터
  async date_all_keywords(params) {
    const { date } = params;
    const searches = await pool.query(
      `SELECT DISTINCT ON (keyword) s.id, s.keyword, s.video_count,
        TO_CHAR(s.completed_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') as time_kst
       FROM tiktok_searches s WHERE status = 'completed' AND video_count > 0
         AND TO_CHAR(s.completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = $1
       ORDER BY keyword, s.completed_at DESC`,
      [date]
    );
    let result = `${date} 전체 현황 (${searches.rows.length}개 키워드):\n`;
    for (const s of searches.rows) {
      const top5 = await pool.query(
        `SELECT rank, creator_name, views, likes FROM tiktok_videos WHERE search_id = $1 ORDER BY rank LIMIT 5`, [s.id]
      );
      result += `\n[${s.keyword}] ${s.video_count}개 (${s.time_kst})\n`;
      top5.rows.forEach(v => {
        result += `  #${v.rank} ${v.creator_name} 조회:${v.views} 좋아요:${v.likes}\n`;
      });
    }
    return result;
  },

  // 5. 키워드 시계열 추이 (최근 7일)
  async keyword_trend(params) {
    const { keyword, days = 7 } = params;
    const result = await pool.query(
      `SELECT TO_CHAR(s.completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') as date,
        s.video_count,
        (SELECT string_agg(creator_name, ', ' ORDER BY rank) FROM tiktok_videos WHERE search_id = s.id AND rank <= 3) as top3
       FROM tiktok_searches s
       WHERE s.keyword = $1 AND status = 'completed' AND video_count > 0
       ORDER BY s.completed_at DESC LIMIT $2`,
      [keyword, days]
    );
    if (result.rows.length === 0) return `"${keyword}" 시계열 데이터 없음`;
    return `"${keyword}" 최근 추이:\n` + result.rows.map(r => 
      `${r.date}: ${r.video_count}개 수집 | TOP3: ${r.top3 || '-'}`
    ).join('\n');
  },

  // 6. 전체 TOP 크리에이터 (좋아요/조회수 기준)
  async top_creators(params) {
    const { metric = 'likes', limit = 15 } = params;
    const orderCol = metric === 'views' ? 'views' : 'likes';
    // 최근 수집 기준
    const result = await pool.query(
      `WITH latest AS (
        SELECT DISTINCT ON (keyword) id, keyword
        FROM tiktok_searches WHERE status = 'completed' AND video_count > 0
        ORDER BY keyword, completed_at DESC
      )
      SELECT v.creator_name, v.creator_id, l.keyword, v.rank, v.views, v.likes, v.comments
      FROM tiktok_videos v JOIN latest l ON v.search_id = l.id
      ORDER BY CAST(NULLIF(REPLACE(v.${orderCol}, ',', ''), 'N/A') AS BIGINT) DESC NULLS LAST
      LIMIT $1`,
      [limit]
    );
    return `전체 TOP ${metric} 크리에이터:\n` + result.rows.map((r, i) => 
      `${i+1}. @${r.creator_id}(${r.creator_name}) [${r.keyword} #${r.rank}] 조회:${r.views} 좋아요:${r.likes}`
    ).join('\n');
  },

  // 7. 여러 키워드 비교
  async compare_keywords(params) {
    const { keywords } = params;
    let result = '';
    for (const kw of keywords) {
      const search = await pool.query(
        `SELECT s.id, s.video_count, TO_CHAR(s.completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as time_kst
         FROM tiktok_searches s WHERE s.keyword = $1 AND status = 'completed' AND video_count > 0
         ORDER BY s.completed_at DESC LIMIT 1`, [kw]
      );
      if (search.rows.length > 0) {
        const top5 = await pool.query(
          `SELECT rank, creator_name, views, likes FROM tiktok_videos WHERE search_id = $1 ORDER BY rank LIMIT 5`, [search.rows[0].id]
        );
        result += `\n[${kw}] (${search.rows[0].time_kst})\n`;
        top5.rows.forEach(v => { result += `  #${v.rank} ${v.creator_name} 조회:${v.views} 좋아요:${v.likes}\n`; });
      }
    }
    return result || '해당 키워드 데이터 없음';
  },

  // 8. 수집 가능한 키워드 목록
  async available_keywords() {
    const result = await pool.query(
      `SELECT keyword, is_active FROM tiktok_keywords ORDER BY created_at DESC`
    );
    return '등록된 키워드:\n' + result.rows.map(r => `- ${r.keyword} (${r.is_active ? '활성' : '비활성'})`).join('\n');
  },

  // 9. 수집 가능한 날짜 목록
  async available_dates(params) {
    const { keyword } = params;
    let q, p;
    if (keyword) {
      q = `SELECT TO_CHAR(completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') as d, COUNT(*) as cnt
           FROM tiktok_searches WHERE keyword = $1 AND status = 'completed' AND video_count > 0
           GROUP BY d ORDER BY d DESC LIMIT 14`;
      p = [keyword];
    } else {
      q = `SELECT TO_CHAR(completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') as d, COUNT(*) as cnt, COUNT(DISTINCT keyword) as kw_cnt
           FROM tiktok_searches WHERE status = 'completed' AND video_count > 0
           GROUP BY d ORDER BY d DESC LIMIT 14`;
      p = [];
    }
    const result = await pool.query(q, p);
    return '수집된 날짜:\n' + result.rows.map(r => `- ${r.d}: ${r.cnt}회 수집${r.kw_cnt ? ` (${r.kw_cnt}개 키워드)` : ''}`).join('\n');
  }
};

router.post('/ai-chat', async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ success: false, error: '질문을 입력해주세요' });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ success: false, error: 'GEMINI_API_KEY가 설정되지 않았습니다' });
    }

    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

    // 등록된 키워드 목록 가져오기
    const kwList = await pool.query(`SELECT keyword FROM tiktok_keywords WHERE is_active = true ORDER BY keyword`);
    const keywordList = kwList.rows.map(r => r.keyword).join(', ');

    // 1단계: 질문 분석 → 필요한 쿼리 결정
    const step1Prompt = `당신은 TikTok 데이터 분석 시스템의 쿼리 플래너입니다.
사용자의 질문을 분석하고, 답변에 필요한 데이터 쿼리를 결정해주세요.

## 사용 가능한 키워드 목록
${keywordList}

## 사용 가능한 쿼리 함수
1. keyword_recent(keyword, days) - 특정 키워드의 최근 N일 영상 데이터 (순위, 크리에이터, 조회수, 좋아요 등)
2. all_keywords_summary() - 전체 키워드 최근 수집 현황 요약
3. cross_keyword_creators() - 여러 키워드에 걸쳐 등장하는 크리에이터 분석
4. date_all_keywords(date) - 특정 날짜의 전체 키워드 데이터 (TOP5씩)
5. keyword_trend(keyword, days) - 키워드의 시계열 추이 (최근 N일)
6. top_creators(metric, limit) - 전체 키워드 통합 TOP 크리에이터 (metric: likes 또는 views)
7. compare_keywords(keywords[]) - 여러 키워드 TOP5 비교
8. available_keywords() - 등록된 키워드 목록
9. available_dates(keyword?) - 수집된 날짜 목록

## 규칙
- 최대 3개 쿼리까지 선택 가능
- 질문에 가장 적합한 쿼리를 선택
- 키워드명이 질문에 포함되면 해당 키워드 사용
- "전체", "모든 키워드" → all_keywords_summary 또는 date_all_keywords
- "크리에이터 분석", "누가 여러 키워드에" → cross_keyword_creators
- "추이", "변화", "트렌드" → keyword_trend
- "비교" → compare_keywords
- 오늘 날짜: ${new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}

사용자 질문: ${question}

다음 JSON 형식으로만 응답하세요:
{
  "queries": [
    {"function": "함수명", "params": {"키": "값"}}
  ],
  "reasoning": "이 쿼리를 선택한 이유 (한 줄)"
}`;

    console.log('🤖 [AI Chat 1단계] 쿼리 플래닝...');
    const step1Result = await model.generateContent(step1Prompt);
    const step1Text = step1Result.response.text();
    
    let queryPlan;
    try {
      const jsonMatch = step1Text.match(/```json\n?([\s\S]*?)\n?```/) || step1Text.match(/\{[\s\S]*\}/);
      queryPlan = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    } catch (e) {
      console.error('쿼리 플랜 파싱 실패:', step1Text);
      queryPlan = { queries: [{ function: 'all_keywords_summary', params: {} }] };
    }

    console.log('📋 쿼리 플랜:', JSON.stringify(queryPlan.queries));

    // 2단계: 데이터 조회
    let contextData = '';
    for (const q of (queryPlan.queries || []).slice(0, 3)) {
      const fn = dataQueries[q.function];
      if (fn) {
        try {
          const data = await fn(q.params || {});
          contextData += data + '\n\n';
        } catch (e) {
          console.error(`쿼리 실행 실패 (${q.function}):`, e.message);
          contextData += `[${q.function} 실행 실패]\n\n`;
        }
      }
    }

    if (!contextData.trim()) {
      contextData = '데이터를 조회할 수 없습니다.';
    }

    // 3단계: 최종 답변 생성
    console.log('🤖 [AI Chat 2단계] 답변 생성...');
    const step2Prompt = `당신은 TikTok 뷰티/스킨케어 마케팅 데이터 분석 전문가입니다.
아래는 데이터베이스에서 조회한 실제 TikTok 영상 랭킹 데이터입니다.

${contextData}

사용자 질문: ${question}

답변 가이드라인:
- 위 데이터에 기반한 구체적인 답변을 해주세요
- 영상 순위, 크리에이터명(@아이디), 조회수/좋아요 수치를 구체적으로 언급해주세요
- 2일 이상의 데이터가 있으면 같은 video_url 기준으로 변화량 비교 가능
- 마케팅 인사이트나 트렌드 발견 시 언급해주세요
- 한국어로 간결하고 명확하게 답변하세요
- 데이터에 없는 내용은 추측하지 말고 솔직하게 말해주세요`;

    const step2Result = await model.generateContent(step2Prompt);
    const answer = step2Result.response.text();

    console.log('✅ AI Chat 완료');
    res.json({ success: true, data: { answer, queriesUsed: queryPlan.queries?.map(q => q.function) } });
  } catch (err) {
    console.error('AI Chat error:', err.message);
    res.status(500).json({ success: false, error: 'AI 분석 실패: ' + err.message });
  }
});

module.exports = router;
