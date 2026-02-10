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
  } catch (err) {
    console.error('Task table init error:', err.message);
  }
})();

// ============================================================
// GET /api/tiktok/tasks/active - 활성 작업 상태 조회 (대시보드 폴링용)
// ============================================================
router.get('/tasks/active', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, type, keyword, status, created_at, started_at
       FROM tiktok_tasks 
       WHERE status IN ('pending', 'running')
       OR (status IN ('completed', 'failed') AND completed_at > NOW() - INTERVAL '2 minutes')
       ORDER BY id DESC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/tiktok/tasks - 작업 요청 (대시보드에서 호출)
// ============================================================
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

// ============================================================
// GET /api/tiktok/tasks - 작업 목록 조회
// ============================================================
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

// ============================================================
// GET /api/tiktok/tasks/:id - 작업 상태 조회
// ============================================================
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
// GET /api/tiktok/tasks/pending/count - 대기 작업 수
// ============================================================
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

// ============================================================
// POST /api/tiktok/search - TikTok 검색 시작
// ============================================================
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
    await pool.query(
      `UPDATE tiktok_searches SET status = 'scraping' WHERE id = $1`,
      [searchId]
    );

    const progressCallback = async (status, percent, message) => {
      await pool.query(
        `UPDATE tiktok_searches SET status = $1 WHERE id = $2`,
        [status === 'completed' ? 'completed' : 'scraping', searchId]
      );
    };

    const results = await scraper.searchKeyword(keyword, topN, progressCallback);

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

    await pool.query(
      `UPDATE tiktok_searches
       SET status = 'completed', video_count = $1, completed_at = NOW()
       WHERE id = $2`,
      [results.length, searchId]
    );

    console.log(`✅ Search ${searchId} completed: ${results.length} videos`);
    await notifySearchComplete(keyword, results.length, searchId);

  } catch (err) {
    console.error(`❌ Search ${searchId} failed:`, err.message);
    await pool.query(
      `UPDATE tiktok_searches SET status = 'failed', error = $1 WHERE id = $2`,
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

    const search = result.rows[0];
    let progress = 0;
    switch (search.status) {
      case 'pending': progress = 0; break;
      case 'scraping': progress = 50; break;
      case 'completed': progress = 100; break;
      case 'failed': progress = 0; break;
    }

    res.json({
      success: true,
      data: { ...search, progress }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/tiktok/search/:id - 검색 결과 상세 조회
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
        videos: videosResult.rows,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/tiktok/searches - 전체 검색 목록
// ============================================================
router.get('/searches', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const countResult = await pool.query('SELECT COUNT(*) FROM tiktok_searches');
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT s.*, k.is_active
       FROM tiktok_searches s
       LEFT JOIN tiktok_keywords k ON s.keyword_id = k.id
       ORDER BY s.started_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/tiktok/keywords - 키워드 목록 조회
// ============================================================
router.get('/keywords', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT k.*,
        (SELECT COUNT(*) FROM tiktok_searches s WHERE s.keyword_id = k.id) as search_count,
        (SELECT MAX(s.started_at) FROM tiktok_searches s WHERE s.keyword_id = k.id) as last_searched
       FROM tiktok_keywords k
       ORDER BY k.updated_at DESC`
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/tiktok/keywords - 키워드 추가
// ============================================================
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

// ============================================================
// DELETE /api/tiktok/keywords/:id - 키워드 삭제
// ============================================================
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
    await pool.query('DELETE FROM tiktok_searches WHERE id = $1', [id]);
    res.json({ success: true, message: '검색 결과가 삭제되었습니다' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
