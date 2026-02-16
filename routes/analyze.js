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
      `SELECT s.id FROM tiktok_searches s
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
      `SELECT s.id FROM tiktok_searches s
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

module.exports = router;
