/**
 * 로컬 작업 워커 - DB에서 대기 중인 스크래핑 요청을 확인하고 로컬에서 실행
 *
 * 동작:
 * 1. 30초마다 DB에서 status='pending' 작업 확인
 * 2. 대기 작업 발견 시 로컬에서 TikTok 스크래핑 실행
 * 3. 결과를 DB에 저장
 *
 * 개선사항:
 * - run_all 시 브라우저를 한 번만 열고 전체 키워드 처리 (캡차 방지)
 * - 로그인 체크 내장
 * - DEFAULT_TOP_N 환경변수로 수집 개수 통합 관리
 *
 * 사용법:
 *   node task-worker.js              (30초 간격 폴링)
 *   node task-worker.js --once       (1회만 실행 후 종료)
 */

require('dotenv').config();
const { notifySearchComplete, notifySearchFailed } = require('./services/telegram');
const { Pool } = require('pg');
const { execSync } = require('child_process');
const fs = require('fs');
const TikTokScraper = require('./services/scraper');

const POLL_INTERVAL = 30000;
const isOnce = process.argv.includes('--once');
const DEFAULT_TOP_N = parseInt(process.env.DEFAULT_TOP_N) || 30;

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
      top_n INTEGER DEFAULT 30,
      status VARCHAR(20) DEFAULT 'pending',
      requested_by VARCHAR(100) DEFAULT 'dashboard',
      result JSONB,
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      started_at TIMESTAMP,
      completed_at TIMESTAMP
    )
  `);
  await pool.query(
    'ALTER TABLE tiktok_searches ADD COLUMN IF NOT EXISTS analysis JSONB'
  ).catch(function() {});
}

// 브라우저 내에서 로그인 체크 & 자동 로그인
async function checkAndLogin(browser) {
  var GOOGLE_EMAIL = 'jitae1028@gmail.com';
  var GOOGLE_PASSWORD = process.env.GOOGLE_PASSWORD || 'Bqmdq6913!^';

  var page = browser.pages()[0] || await browser.newPage();

  try {
    console.log('📌 TikTok 로그인 상태 확인...');
    await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    var currentUrl = page.url();
    console.log('   📍 현재 URL: ' + currentUrl);

    // One Tap 로그인
    try {
      var oneTapBtns = ['button:has-text("계정으로 계속")', 'button:has-text("Continue as")'];
      for (var s = 0; s < oneTapBtns.length; s++) {
        var btn = await page.$(oneTapBtns[s]);
        if (btn && await btn.isVisible()) {
          console.log('   ✅ One Tap 로그인 클릭!');
          await btn.click();
          await page.waitForTimeout(5000);
          console.log('✅ One Tap 로그인 성공!');
          return true;
        }
      }
    } catch (e) {}

    var loginBtnVisible = await page.$('a[href*="/login"], button:has-text("로그인")');
    var isLoggedIn = currentUrl.includes('foryou') && !loginBtnVisible;

    if (isLoggedIn) {
      console.log('✅ 이미 로그인되어 있습니다!');
      return true;
    }

    console.log('🔓 로그인 필요 - 자동 구글 로그인 시도...');

    await page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    // Google 버튼 클릭
    var googleClicked = false;
    var googleTexts = ['Google로 계속 진행', 'Google로 계속하기', 'Continue with Google', 'Google'];
    for (var g = 0; g < googleTexts.length; g++) {
      try {
        var elements = await page.$$('text="' + googleTexts[g] + '"');
        for (var e = 0; e < elements.length; e++) {
          if (await elements[e].isVisible()) {
            console.log('   ✅ Google 버튼 클릭');
            await elements[e].click();
            googleClicked = true;
            break;
          }
        }
        if (googleClicked) break;
      } catch (err) { continue; }
    }

    if (!googleClicked) {
      console.log('   ⚠️ Google 버튼 미발견 - 로그인 없이 진행');
      return false;
    }

    await page.waitForTimeout(5000);

    // Google 페이지 찾기
    var googlePage = page;
    var allPages = browser.pages();
    for (var p = 0; p < allPages.length; p++) {
      if (allPages[p].url().includes('accounts.google.com')) {
        googlePage = allPages[p];
        break;
      }
    }

    if (!googlePage.url().includes('accounts.google.com')) {
      console.log('   ⚠️ Google 페이지 미발견 - 로그인 없이 진행');
      return false;
    }

    await googlePage.waitForTimeout(2000);

    // 이메일 입력 또는 계정 선택
    var emailInput = await googlePage.$('input[type="email"]');
    if (emailInput && await emailInput.isVisible()) {
      console.log('   📧 이메일 입력...');
      await emailInput.fill(GOOGLE_EMAIL);
      await googlePage.waitForTimeout(1000);
      var nextBtn = await googlePage.$('#identifierNext');
      if (nextBtn) { await nextBtn.click(); await googlePage.waitForTimeout(4000); }
    } else {
      var accountSels = [
        'div[data-email="' + GOOGLE_EMAIL + '"]',
        'div[data-identifier="' + GOOGLE_EMAIL + '"]',
        'text="' + GOOGLE_EMAIL + '"',
      ];
      for (var a = 0; a < accountSels.length; a++) {
        try {
          var el = await googlePage.$(accountSels[a]);
          if (el && await el.isVisible()) {
            console.log('   ✅ 계정 선택');
            await el.click();
            await googlePage.waitForTimeout(4000);
            break;
          }
        } catch (err) { continue; }
      }
    }

    // 동의 화면 체크
    await googlePage.waitForTimeout(2000);
    var consentDone = false;
    try {
      var consentBtns = ['button:has-text("계속")', 'button:has-text("Continue")'];
      for (var c = 0; c < consentBtns.length; c++) {
        var cb = await googlePage.$(consentBtns[c]);
        if (cb && await cb.isVisible()) {
          console.log('   ✅ OAuth 동의 버튼 클릭');
          await cb.click();
          consentDone = true;
          await page.waitForTimeout(5000);
          break;
        }
      }
    } catch (err) {}

    if (!consentDone) {
      // 비밀번호 입력
      try {
        await googlePage.waitForSelector('input[type="password"]', { timeout: 10000 });
        var pwInput = await googlePage.$('input[type="password"]');
        if (pwInput && await pwInput.isVisible()) {
          console.log('   🔑 비밀번호 입력...');
          await pwInput.fill(GOOGLE_PASSWORD);
          await googlePage.waitForTimeout(1000);
          var pwNext = await googlePage.$('#passwordNext');
          if (pwNext) { await pwNext.click(); await googlePage.waitForTimeout(5000); }
        }
      } catch (err) {
        console.log('   ⚠️ 비밀번호 필드 미발견');
      }

      // 비밀번호 입력 후 OAuth 동의 화면 즉시 체크
      try {
        await googlePage.waitForTimeout(3000);
        var earlyConsent = await googlePage.$('button:has-text("계속")') || await googlePage.$('button:has-text("Continue")');
        if (earlyConsent && await earlyConsent.isVisible()) {
          console.log('   ✅ OAuth 동의 버튼 클릭 (비밀번호 후)');
          await earlyConsent.click();
          await page.waitForTimeout(5000);
        }
      } catch (err) {}

      // 2단계 인증 대기
      try {
        if (googlePage.url().includes('accounts.google.com')) {
          console.log('   📱 2단계 인증 대기 중... (최대 120초)');
          var maxWait = 120000;
          var waited = 0;
          while (waited < maxWait) {
            await googlePage.waitForTimeout(3000);
            waited += 3000;

            var curUrl;
            try { curUrl = googlePage.url(); } catch (err) { break; }
            if (!curUrl.includes('accounts.google.com')) break;

            var mainUrl = page.url();
            if (mainUrl.includes('tiktok.com') && !mainUrl.includes('login')) break;

            try {
              var consentBtn = await googlePage.$('button:has-text("계속")') || await googlePage.$('button:has-text("Continue")');
              if (consentBtn && await consentBtn.isVisible()) {
                console.log('   ✅ OAuth 동의 버튼 클릭');
                await consentBtn.click();
                await page.waitForTimeout(5000);
                break;
              }
            } catch (err) {}

            console.log('   ⏳ 대기 중... (' + (waited / 1000) + '초)');
          }
        }
      } catch (err) {}
    }

    // 최종 확인
    await page.waitForTimeout(3000);
    try {
      if (!page.url().includes('tiktok.com')) {
        await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(3000);
      }
    } catch (err) {}

    var finalUrl;
    try { finalUrl = page.url(); } catch (err) { finalUrl = 'unknown'; }

    var success = finalUrl.includes('tiktok.com') && !finalUrl.includes('login');
    console.log(success ? '✅ 로그인 성공!' : '⚠️ 로그인 실패 - 스크래핑은 진행합니다.');
    return success;

  } catch (err) {
    console.log('⚠️ 로그인 체크 오류: ' + err.message);
    return false;
  }
}

// 이전 검색 결과와 비교 분석
async function analyzeChanges(keyword, currentVideos, searchId) {
  try {
    var prevSearch = await pool.query(
      'SELECT id FROM tiktok_searches WHERE keyword = $1 AND status = \'completed\' AND id < $2 ORDER BY id DESC LIMIT 1',
      [keyword, searchId]
    );

    if (prevSearch.rows.length === 0) {
      return { isFirst: true, summary: '첫 번째 검색 - 비교 데이터 없음' };
    }

    var prevId = prevSearch.rows[0].id;
    var prevVideos = await pool.query(
      'SELECT * FROM tiktok_videos WHERE search_id = $1 ORDER BY rank',
      [prevId]
    );

    var prevMap = {};
    prevVideos.rows.forEach(function(v) { prevMap[v.video_url] = v; });

    var currentMap = {};
    currentVideos.forEach(function(v) { currentMap[v.videoUrl] = v; });

    var newEntries = [];
    var exited = [];
    var rankChanges = [];
    var statChanges = [];

    currentVideos.forEach(function(curr) {
      var prev = prevMap[curr.videoUrl];
      if (!prev) {
        newEntries.push({ rank: curr.rank, creatorId: curr.creatorId });
      } else {
        var rankDiff = prev.rank - curr.rank;
        if (rankDiff !== 0) {
          rankChanges.push({ creatorId: curr.creatorId, oldRank: prev.rank, newRank: curr.rank, diff: rankDiff });
        }
        var prevLikes = parseInt(prev.likes) || 0;
        var currLikes = parseInt(curr.likes) || 0;
        if (prevLikes > 0 && currLikes > prevLikes * 1.5) {
          statChanges.push({ creatorId: curr.creatorId, metric: '좋아요', old: prevLikes, new: currLikes, changePercent: Math.round((currLikes - prevLikes) / prevLikes * 100) });
        }
        var prevViews = parseInt(prev.views) || 0;
        var currViews = parseInt(curr.views) || 0;
        if (prevViews > 0 && currViews > prevViews * 1.5) {
          statChanges.push({ creatorId: curr.creatorId, metric: '조회수', old: prevViews, new: currViews, changePercent: Math.round((currViews - prevViews) / prevViews * 100) });
        }
      }
    });

    prevVideos.rows.forEach(function(prev) {
      if (!currentMap[prev.video_url]) {
        exited.push({ rank: prev.rank, creatorId: prev.creator_id });
      }
    });

    var analysis = { isFirst: false, newEntries: newEntries, exited: exited, rankChanges: rankChanges, statChanges: statChanges };
    var summary = [];
    if (newEntries.length > 0) summary.push('🆕 신규 ' + newEntries.length + '건');
    if (exited.length > 0) summary.push('📤 이탈 ' + exited.length + '건');
    if (rankChanges.length > 0) summary.push('📊 순위변동 ' + rankChanges.length + '건');
    if (statChanges.length > 0) summary.push('🔥 지표급등 ' + statChanges.length + '건');
    analysis.summary = summary.length > 0 ? summary.join(' | ') : '변동 없음';

    await pool.query(
      'UPDATE tiktok_searches SET analysis = $1 WHERE id = $2',
      [JSON.stringify(analysis), searchId]
    );

    return analysis;
  } catch (err) {
    console.error('분석 오류:', err.message);
    return { isFirst: true, summary: '분석 실패' };
  }
}

// 단일 키워드 스크래핑 (공유 scraper 사용)
async function executeSearch(scraper, keyword, topN) {
  var searchId = null;

  try {
    var kwResult = await pool.query(
      'INSERT INTO tiktok_keywords (keyword) VALUES ($1) ON CONFLICT (keyword) DO UPDATE SET updated_at = NOW() RETURNING id',
      [keyword]
    );
    var keywordId = kwResult.rows[0].id;

    var searchResult = await pool.query(
      'INSERT INTO tiktok_searches (keyword_id, keyword, status, source) VALUES ($1, $2, \'running\', \'dashboard\') RETURNING id',
      [keywordId, keyword]
    );
    searchId = searchResult.rows[0].id;

    // 캡차 재시도 지원
    var videos;
    try {
      videos = await scraper.searchKeyword(keyword, topN, function(status, percent, msg) {
        process.stdout.write('\r   [' + percent + '%] ' + msg + '          ');
      });
    } catch (retryErr) {
      if (retryErr.message === 'CAPTCHA_RESOLVED_RETRY') {
        console.log('\n   🔄 캡차 해결 후 재시도...');
        videos = await scraper.searchKeyword(keyword, topN, function(status, percent, msg) {
          process.stdout.write('\r   [' + percent + '%] ' + msg + '          ');
        });
      } else {
        throw retryErr;
      }
    }
    console.log('');

    for (var i = 0; i < videos.length; i++) {
      var video = videos[i];
      await pool.query(
        'INSERT INTO tiktok_videos (search_id, rank, video_url, creator_id, creator_name, description, posted_date, likes, comments, bookmarks, shares, views) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
        [searchId, video.rank, video.videoUrl, video.creatorId, video.creatorName,
         video.description, video.postedDate, video.likes, video.comments,
         video.bookmarks, video.shares, video.views]
      );
    }

    await pool.query(
      'UPDATE tiktok_searches SET status = \'completed\', video_count = $1, completed_at = NOW() WHERE id = $2',
      [videos.length, searchId]
    );

    var analysis = await analyzeChanges(keyword, videos, searchId);

    await pool.query(
      'UPDATE tiktok_keywords SET updated_at = NOW() WHERE id = $1',
      [keywordId]
    );

    return { success: true, count: videos.length, searchId: searchId, analysis: analysis.summary };

  } catch (err) {
    if (searchId) {
      await pool.query(
        'UPDATE tiktok_searches SET status = \'failed\', error = $1, completed_at = NOW() WHERE id = $2',
        [err.message, searchId]
      ).catch(function() {});
    }
    throw err;
  }
}

// 대기 중인 작업 처리
async function processPendingTasks() {
  try {
    var taskResult = await pool.query(
      'UPDATE tiktok_tasks SET status = \'running\', started_at = NOW() WHERE id = (SELECT id FROM tiktok_tasks WHERE status = \'pending\' ORDER BY created_at ASC LIMIT 1) RETURNING *'
    );

    if (taskResult.rows.length === 0) return false;

    var task = taskResult.rows[0];
    var topN = task.top_n || DEFAULT_TOP_N;
    console.log('\n📋 작업 발견: [' + task.type + '] ' + (task.keyword || '전체') + ' (Task #' + task.id + ', 상위 ' + topN + '개)');

    var scraper = new TikTokScraper();

    try {
      // 기존 스크래핑 프로필 Chrome 종료 (프로필 충돌 방지)
      try {
        console.log('   🔄 스크래핑 프로필 Chrome 정리...');
        try {
          execSync('powershell -Command "Get-WmiObject Win32_Process -Filter \\"name=\'chrome.exe\'\\" | Where-Object { $_.CommandLine -match \'chrome-tiktok-profile-real\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"', { stdio: 'ignore', timeout: 10000 });
          console.log('   ✅ 스크래핑 프로필 Chrome 종료');
        } catch(e) {
          console.log('   ℹ️ 스크래핑 프로필 Chrome 미실행');
        }
        await new Promise(r => setTimeout(r, 3000));
        ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach(function(f) {
          try { fs.unlinkSync('C:\\EV-System\\chrome-tiktok-profile-real\\' + f); } catch(e) {}
        });
        console.log('   🔓 Lock 파일 정리 완료');
      } catch (e) {
        console.log('   ℹ️ Chrome 정리 스킵');
      }

      // 브라우저 한 번 열기
      await scraper.initBrowser();

      // 로그인 체크
      await checkAndLogin(scraper.browser);

      if (task.type === 'search' && task.keyword) {
        // 단일 키워드 검색
        var result = await executeSearch(scraper, task.keyword, topN);
        await pool.query(
          'UPDATE tiktok_tasks SET status = \'completed\', result = $1, completed_at = NOW() WHERE id = $2',
          [JSON.stringify(result), task.id]
        );
        console.log('   ✅ 완료: ' + result.count + '개 수집 | ' + result.analysis);
        await notifySearchComplete(task.keyword || '전체', result.count, task.id);

      } else if (task.type === 'run_all') {
        // 전체 키워드 실행 (같은 브라우저로!)
        var kwResult = await pool.query(
          'SELECT id, keyword FROM tiktok_keywords WHERE is_active = true ORDER BY id'
        );
        var results = [];

        for (var k = 0; k < kwResult.rows.length; k++) {
          var kw = kwResult.rows[k];

          // 취소 여부 확인
          var taskCheck = await pool.query('SELECT status FROM tiktok_tasks WHERE id = $1', [task.id]);
          if (taskCheck.rows[0] && taskCheck.rows[0].status === 'cancelled') {
            console.log('   ⏹ 작업이 취소되었습니다. 중단합니다.');
            break;
          }

          // 현재 키워드 업데이트 (대시보드 표시용)
          await pool.query(
            'UPDATE tiktok_tasks SET keyword = $1 WHERE id = $2',
            [kw.keyword, task.id]
          );

          console.log('\n   🔍 [' + kw.keyword + '] 스크래핑...');
          try {
            var kwSearchResult = await executeSearch(scraper, kw.keyword, topN);
            results.push({ keyword: kw.keyword, success: true, count: kwSearchResult.count, analysis: kwSearchResult.analysis });
            console.log('   ✅ ' + kwSearchResult.count + '개 | ' + kwSearchResult.analysis);

            // 키워드 간 랜덤 딜레이 (15~30초)
            if (k < kwResult.rows.length - 1) {
              var kwDelay = Math.floor(Math.random() * 15000) + 15000;
              console.log('   ⏳ 다음 키워드까지 ' + (kwDelay / 1000).toFixed(1) + '초 대기...');
              await new Promise(function(r) { setTimeout(r, kwDelay); });
            }
          } catch (err) {
            results.push({ keyword: kw.keyword, success: false, error: err.message });
            console.log('   ❌ 실패: ' + err.message);
          }
        }

        // 전체 결과 저장
        var successCount = results.filter(function(r) { return r.success; }).length;
        var failCount = results.filter(function(r) { return !r.success; }).length;

        await pool.query(
          'UPDATE tiktok_tasks SET status = \'completed\', result = $1, completed_at = NOW() WHERE id = $2',
          [JSON.stringify({ keywords: results.length, success: successCount, failed: failCount, results: results }), task.id]
        );

        // 텔레그램 전체 리포트
        var teleMsg = '🚀 TikTok 전체 스크래핑 완료\n\n';
        results.forEach(function(r) {
          var icon = r.success ? '✅' : '❌';
          teleMsg += icon + ' ' + r.keyword + ': ';
          teleMsg += r.success ? r.count + '개 | ' + r.analysis : r.error;
          teleMsg += '\n';
        });
        teleMsg += '\n성공 ' + successCount + ' | 실패 ' + failCount;

        try {
          var token = process.env.TELEGRAM_BOT_TOKEN;
          var chatId = process.env.TELEGRAM_CHAT_ID;
          if (token && chatId) {
            await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: teleMsg })
            });
          }
        } catch (err) {}
      }
    } catch (err) {
      await pool.query(
        'UPDATE tiktok_tasks SET status = \'failed\', error = $1, completed_at = NOW() WHERE id = $2',
        [err.message, task.id]
      );
      console.log('   ❌ 작업 실패: ' + err.message);
      await notifySearchFailed(task.keyword || '전체', err.message.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    } finally {
      // 작업 완료 후 브라우저 종료
      await scraper.close();
    }

    return true;

  } catch (err) {
    console.error('폴링 오류:', err.message);
    return false;
  }
}

// 메인 루프
async function main() {
  console.log('\n' + '='.repeat(50));
  console.log('🔄 TikTok 작업 워커 시작');
  console.log('📌 폴링 간격: ' + (POLL_INTERVAL / 1000) + '초');
  console.log('📌 기본 수집 개수: ' + DEFAULT_TOP_N + '개');
  console.log('📌 모드: ' + (isOnce ? '1회 실행' : '상시 실행'));
  console.log('='.repeat(50) + '\n');

  await initTaskTable();
  console.log('✅ 작업 테이블 준비 완료');

  if (isOnce) {
    var hadTask = await processPendingTasks();
    if (!hadTask) console.log('📭 대기 중인 작업 없음');
    await pool.end();
    return;
  }

  // 상시 폴링
  console.log('👀 대기 중인 작업을 감시합니다...\n');

  var poll = async function() {
    var hadTask = await processPendingTasks();
    if (hadTask) {
      setTimeout(poll, 2000);
    } else {
      setTimeout(poll, POLL_INTERVAL);
    }
  };

  poll();
}

main().catch(function(err) {
  console.error('치명적 오류:', err);
  process.exit(1);
});
