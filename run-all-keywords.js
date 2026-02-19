/**
 * 전체 키워드 자동 스크래핑 스크립트
 *
 * DB에 등록된 모든 활성 키워드를 순차적으로 스크래핑하고 결과를 DB에 저장
 * 로그인 체크를 스크래퍼 내부에서 처리 (브라우저를 한 번만 열어 캡차 방지)
 *
 * 사용법:
 *   node run-all-keywords.js
 *   node run-all-keywords.js 10    (키워드당 상위 10개, 기본값 30)
 */

require('dotenv').config();
const { Pool } = require('pg');
const { execSync } = require('child_process');
const TikTokScraper = require('./services/scraper');

const topN = parseInt(process.argv[2]) || parseInt(process.env.DEFAULT_TOP_N) || 30;

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

// 브라우저 내에서 로그인 체크 & 자동 로그인
async function checkAndLogin(browser) {
  const GOOGLE_EMAIL = 'jitae1028@gmail.com';
  const GOOGLE_PASSWORD = process.env.GOOGLE_PASSWORD || 'Bqmdq6913!^';

  const page = browser.pages()[0] || await browser.newPage();

  try {
    console.log('📌 TikTok 로그인 상태 확인...');
    await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    console.log('   📍 현재 URL: ' + currentUrl);

    // One Tap 로그인 팝업 확인
    try {
      const oneTapBtns = [
        'button:has-text("계정으로 계속")',
        'button:has-text("Continue as")',
      ];
      for (const sel of oneTapBtns) {
        const btn = await page.$(sel);
        if (btn && await btn.isVisible()) {
          console.log('   ✅ One Tap 로그인 클릭!');
          await btn.click();
          await page.waitForTimeout(5000);
          console.log('✅ One Tap 로그인 성공!');
          
          return true;
        }
      }
    } catch {}

    const loginBtnVisible = await page.$('a[href*="/login"], button:has-text("로그인")');
    const isLoggedIn = currentUrl.includes('foryou') && !loginBtnVisible;

    if (isLoggedIn) {
      console.log('✅ 이미 로그인되어 있습니다!');
      
      return true;
    }

    console.log('🔓 로그인 필요 - 자동 구글 로그인 시도...');

    // TikTok 로그인 페이지
    await page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    // Google 버튼 클릭
    let googleClicked = false;
    const googleTexts = ['Google로 계속 진행', 'Google로 계속하기', 'Continue with Google', 'Google'];
    for (const text of googleTexts) {
      try {
        const elements = await page.$$('text="' + text + '"');
        for (const el of elements) {
          if (await el.isVisible()) {
            console.log('   ✅ Google 버튼 클릭');
            await el.click();
            googleClicked = true;
            break;
          }
        }
        if (googleClicked) break;
      } catch { continue; }
    }

    if (!googleClicked) {
      console.log('   ⚠️ Google 버튼 미발견 - 로그인 없이 진행');
      
      return false;
    }

    await page.waitForTimeout(5000);

    // Google 페이지 찾기
    let googlePage = page;
    const allPages = browser.pages();
    for (const p of allPages) {
      if (p.url().includes('accounts.google.com')) {
        googlePage = p;
        break;
      }
    }

    if (!googlePage.url().includes('accounts.google.com')) {
      console.log('   ⚠️ Google 페이지 미발견 - 로그인 없이 진행');
      
      return false;
    }

    await googlePage.waitForTimeout(2000);

    // 이메일 입력 또는 계정 선택
    const emailInput = await googlePage.$('input[type="email"]');
    if (emailInput && await emailInput.isVisible()) {
      console.log('   📧 이메일 입력...');
      await emailInput.fill(GOOGLE_EMAIL);
      await googlePage.waitForTimeout(1000);
      const nextBtn = await googlePage.$('#identifierNext');
      if (nextBtn) { await nextBtn.click(); await googlePage.waitForTimeout(4000); }
    } else {
      // 계정 선택
      const selectors = [
        'div[data-email="' + GOOGLE_EMAIL + '"]',
        'div[data-identifier="' + GOOGLE_EMAIL + '"]',
        'text="' + GOOGLE_EMAIL + '"',
      ];
      for (const sel of selectors) {
        try {
          const el = await googlePage.$(sel);
          if (el && await el.isVisible()) {
            console.log('   ✅ 계정 선택');
            await el.click();
            await googlePage.waitForTimeout(4000);
            break;
          }
        } catch { continue; }
      }
    }

    // 동의 화면 체크 (비밀번호 불필요 케이스)
    await googlePage.waitForTimeout(2000);
    let consentDone = false;
    try {
      const consentBtns = ['button:has-text("계속")', 'button:has-text("Continue")'];
      for (const sel of consentBtns) {
        const btn = await googlePage.$(sel);
        if (btn && await btn.isVisible()) {
          console.log('   ✅ OAuth 동의 버튼 클릭');
          await btn.click();
          consentDone = true;
          await page.waitForTimeout(5000);
          break;
        }
      }
    } catch {}

    if (!consentDone) {
      // 비밀번호 입력
      try {
        await googlePage.waitForSelector('input[type="password"]', { timeout: 10000 });
        const pwInput = await googlePage.$('input[type="password"]');
        if (pwInput && await pwInput.isVisible()) {
          console.log('   🔑 비밀번호 입력...');
          await pwInput.fill(GOOGLE_PASSWORD);
          await googlePage.waitForTimeout(1000);
          const pwNext = await googlePage.$('#passwordNext');
          if (pwNext) { await pwNext.click(); await googlePage.waitForTimeout(5000); }
        }
      } catch {
        console.log('   ⚠️ 비밀번호 필드 미발견');
      }

      // 2단계 인증 대기
      try {
        if (googlePage.url().includes('accounts.google.com')) {
          console.log('   📱 2단계 인증 대기 중... (최대 120초)');
          await sendTelegram('📱 <b>TikTok 로그인 - 2FA 인증 필요</b>\n\n120초 내에 폰에서 Google 로그인을 승인해주세요!');
          const maxWait = 120000;
          let waited = 0;
          while (waited < maxWait) {
            await googlePage.waitForTimeout(3000);
            waited += 3000;

            let curUrl;
            try { curUrl = googlePage.url(); } catch { break; }
            if (!curUrl.includes('accounts.google.com')) break;

            const mainUrl = page.url();
            if (mainUrl.includes('tiktok.com') && !mainUrl.includes('login')) break;

            // 동의 화면 체크
            try {
              const cb = await googlePage.$('button:has-text("계속")') || await googlePage.$('button:has-text("Continue")');
              if (cb && await cb.isVisible()) {
                console.log('   ✅ OAuth 동의 버튼 클릭');
                await cb.click();
                await page.waitForTimeout(5000);
                break;
              }
            } catch {}

            console.log('   ⏳ 대기 중... (' + (waited / 1000) + '초)');
          }
        }
      } catch {}
    }

    // 최종 확인
    await page.waitForTimeout(3000);
    try {
      if (!page.url().includes('tiktok.com')) {
        await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(3000);
      }
    } catch {}

    let finalUrl;
    try { finalUrl = page.url(); } catch { finalUrl = 'unknown'; }

    const success = finalUrl.includes('tiktok.com') && !finalUrl.includes('login');
    console.log(success ? '✅ 로그인 성공!' : '⚠️ 로그인 실패 - 스크래핑은 진행합니다.');
    
    return success;

  } catch (err) {
    console.log('⚠️ 로그인 체크 오류: ' + err.message);
    try {  } catch {}
    return false;
  }
}

// 이전 검색 결과와 비교 분석 (전일 마지막 데이터 기준)
async function analyzeChanges(keyword, currentVideos, searchId) {
  try {
    // 현재 검색의 날짜(KST) 구하기
    const currentSearch = await pool.query(
      `SELECT TO_CHAR(COALESCE(completed_at, NOW()) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') as today
       FROM tiktok_searches WHERE id = $1`,
      [searchId]
    );
    const today = currentSearch.rows.length > 0 ? currentSearch.rows[0].today : null;

    // 전일(KST 기준)의 마지막 완료 검색과 비교
    const prevSearch = await pool.query(
      `SELECT id FROM tiktok_searches 
       WHERE keyword = $1 AND status = 'completed' AND video_count > 0
         AND TO_CHAR(completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') < $2
       ORDER BY completed_at DESC LIMIT 1`,
      [keyword, today || new Date().toISOString().split('T')[0]]
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

    const newEntries = [];
    const exited = [];
    const rankChanges = [];
    const statChanges = [];

    currentVideos.forEach(curr => {
      const prev = prevMap[curr.videoUrl];
      if (!prev) {
        newEntries.push({ rank: curr.rank, creatorId: curr.creatorId, url: curr.videoUrl });
      } else {
        const rankDiff = prev.rank - curr.rank;
        if (rankDiff !== 0) {
          rankChanges.push({
            creatorId: curr.creatorId,
            oldRank: prev.rank,
            newRank: curr.rank,
            diff: rankDiff
          });
        }

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

    prevVideos.rows.forEach(prev => {
      if (!currentMap[prev.video_url]) {
        exited.push({ rank: prev.rank, creatorId: prev.creator_id, url: prev.video_url });
      }
    });

    const analysis = { isFirst: false, newEntries, exited, rankChanges, statChanges };

    const summary = [];
    if (newEntries.length > 0) summary.push('🆕 신규 ' + newEntries.length + '건');
    if (exited.length > 0) summary.push('📤 이탈 ' + exited.length + '건');
    if (rankChanges.length > 0) summary.push('📊 순위변동 ' + rankChanges.length + '건');
    if (statChanges.length > 0) summary.push('📈 지표급등 ' + statChanges.length + '건');

    analysis.summary = summary.length > 0 ? summary.join(' | ') : '변동 없음';

    await pool.query(
      `ALTER TABLE tiktok_searches ADD COLUMN IF NOT EXISTS analysis JSONB`,
      []
    ).catch(function() {});

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
    console.log('\n' + '='.repeat(60));
    console.log('🚀 TikTok 전체 키워드 자동 스크래핑');
    console.log('📅 ' + startTime.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
    console.log('📌 키워드당 상위 ' + topN + '개 수집');
    console.log('='.repeat(60) + '\n');

    // 기존 스크래핑 프로필 Chrome 종료 (프로필 충돌 방지)
    try {
      console.log('🔄 스크래핑 프로필 Chrome 정리...');
      // 1단계: 스크래핑 프로필 Chrome 프로세스만 종료
      try {
        execSync('powershell -Command "Get-WmiObject Win32_Process -Filter \\"name=\'chrome.exe\'\\" | Where-Object { $_.CommandLine -match \'chrome-tiktok-profile-real\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"', { stdio: 'ignore', timeout: 10000 });
        console.log('   ✅ 스크래핑 프로필 Chrome 종료');
      } catch(e) {
        console.log('   ℹ️ 스크래핑 프로필 Chrome 미실행');
      }
      await new Promise(r => setTimeout(r, 3000));
      
      // 2단계: Lock 파일 삭제 (안전장치)
      const fs = require('fs');
      ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach(function(f) {
        try { fs.unlinkSync('C:\\EV-System\\chrome-tiktok-profile-real\\' + f); } catch(e) {}
      });
      console.log('   🔓 Lock 파일 정리 완료');
    } catch (e) {
      console.log('   ℹ️ Chrome 정리 스킵');
    }

    // 스크래퍼 브라우저 초기화 (한 번만!)
    await scraper.initBrowser();

    // 같은 브라우저에서 로그인 체크
    await checkAndLogin(scraper.browser);

    // analysis 컬럼 추가 (없으면)
    await pool.query(
      `ALTER TABLE tiktok_searches ADD COLUMN IF NOT EXISTS analysis JSONB`
    ).catch(function() {});

    // DB에서 활성 키워드 조회
    const kwResult = await pool.query(
      `SELECT id, keyword FROM tiktok_keywords WHERE is_active = true ORDER BY id`
    );

    if (kwResult.rows.length === 0) {
      console.log('⚠️ 등록된 활성 키워드가 없습니다.');
      return;
    }

    console.log('📋 활성 키워드 ' + kwResult.rows.length + '개: ' + kwResult.rows.map(function(r) { return r.keyword; }).join(', ') + '\n');

    // 각 키워드별 스크래핑
    for (const kw of kwResult.rows) {
      const kwStart = Date.now();
      console.log('\n' + '─'.repeat(50));
      console.log('🔍 [' + kw.keyword + '] 스크래핑 시작...');

      let searchId = null;
      try {
        const searchResult = await pool.query(
          `INSERT INTO tiktok_searches (keyword_id, keyword, status, source) 
           VALUES ($1, $2, 'running', 'scheduled') RETURNING id`,
          [kw.id, kw.keyword]
        );
        searchId = searchResult.rows[0].id;

        // 스크래핑 실행 (이미 열려있는 브라우저 사용)
        let videos;
        try {
          videos = await scraper.searchKeyword(kw.keyword, topN, function(status, percent, msg) {
            process.stdout.write('\r   [' + percent + '%] ' + msg + '          ');
          });
        } catch (retryErr) {
          if (retryErr.message === 'CAPTCHA_RESOLVED_RETRY') {
            console.log('\n   🔄 캡차 해결 후 재시도...');
            videos = await scraper.searchKeyword(kw.keyword, topN, function(status, percent, msg) {
              process.stdout.write('\r   [' + percent + '%] ' + msg + '          ');
            });
          } else {
            throw retryErr;
          }
        }
        console.log('');

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

        await pool.query(
          `UPDATE tiktok_searches SET status = 'completed', video_count = $1, completed_at = NOW() WHERE id = $2`,
          [videos.length, searchId]
        );

        const analysis = await analyzeChanges(kw.keyword, videos, searchId);

        const elapsed = ((Date.now() - kwStart) / 1000).toFixed(1);
        console.log('   ✅ ' + videos.length + '개 수집 완료 (' + elapsed + '초)');
        console.log('   📊 분석: ' + analysis.summary);

        results.push({
          keyword: kw.keyword,
          count: videos.length,
          status: 'success',
          analysis: analysis.summary,
          elapsed: elapsed
        });

        await pool.query(
          `UPDATE tiktok_keywords SET updated_at = NOW() WHERE id = $1`,
          [kw.id]
        );

        // 목표 미달 시 즉시 로그인 체크
        if (videos.length < topN) {
          console.log('   ⚠️ 목표 미달 (' + videos.length + '/' + topN + ') - 로그인 상태 확인...');
          const loginOk = await checkAndLogin(scraper.browser);
          if (!loginOk) {
            console.log('   🔓 로그인 복구 시도 후 진행합니다.');
          }
        }

        // 키워드 간 랜덤 딜레이 (15~30초)
        if (kwResult.rows.indexOf(kw) < kwResult.rows.length - 1) {
          var kwDelay = Math.floor(Math.random() * 15000) + 15000;
          console.log('   ⏳ 다음 키워드까지 ' + (kwDelay / 1000).toFixed(1) + '초 대기...');
          await new Promise(function(r) { setTimeout(r, kwDelay); });
        }

      } catch (err) {
        console.log('\n   ❌ 실패: ' + err.message);
        if (searchId) {
          await pool.query(
            `UPDATE tiktok_searches SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
            [err.message, searchId]
          ).catch(function() {});
        }
        results.push({ keyword: kw.keyword, count: 0, status: 'failed', error: err.message });
      }
    }

    // 최종 리포트
    const totalSeconds = (Date.now() - startTime.getTime()) / 1000;
    const formatTime = function(sec) {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      if (h > 0) return h + '시간 ' + m + '분 ' + s + '초';
      if (m > 0) return m + '분 ' + s + '초';
      return s + '초';
    };
    const totalTimeStr = formatTime(totalSeconds);
    const successCount = results.filter(function(r) { return r.status === 'success'; }).length;
    const failCount = results.filter(function(r) { return r.status === 'failed'; }).length;
    const incompleteResults = results.filter(function(r) { return (r.status === 'success' && r.count < topN) || r.status === 'failed'; });

    console.log('\n' + '='.repeat(60));
    console.log('📊 1차 실행 결과');
    console.log('='.repeat(60));
    results.forEach(function(r) {
      const icon = r.status === 'success' ? (r.count < topN ? '⚠️' : '✅') : '❌';
      const detail = r.status === 'success' ? '(' + r.elapsed + '초) - ' + r.analysis : '- ' + r.error;
      console.log(icon + ' ' + r.keyword + ': ' + r.count + '/' + topN + '개 ' + detail);
    });
    console.log('\n⏱️ 총 소요시간: ' + totalTimeStr + ' | 성공: ' + successCount + ' | 실패: ' + failCount);

    // 1차 텔레그램 알림
    let teleMsg = '🚀 <b>TikTok 1차 스크래핑 완료</b>\n';
    teleMsg += '📅 ' + startTime.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + '\n\n';
    results.forEach(function(r) {
      const icon = r.status === 'success' ? (r.count < topN ? '⚠️' : '✅') : '❌';
      teleMsg += icon + ' <b>' + r.keyword + '</b>: ' + r.count + '/' + topN + '개';
      if (r.analysis) teleMsg += ' | ' + r.analysis;
      if (r.error) teleMsg += ' | ' + r.error;
      teleMsg += '\n';
    });
    teleMsg += '\n⏱️ ' + totalTimeStr + ' | 성공 ' + successCount + ' | 실패 ' + failCount;

    // 미완료 키워드 재시도
    if (incompleteResults.length > 0) {
      teleMsg += '\n\n🔄 <b>미완료 ' + incompleteResults.length + '개 키워드 재시도 시작</b>';
      await sendTelegram(teleMsg);

      console.log('\n' + '='.repeat(60));
      console.log('🔄 미완료 키워드 재시도 (' + incompleteResults.length + '개)');
      console.log('='.repeat(60));

      // 재시도 전 로그인 상태 재확인
      console.log('\n🔑 재시도 전 로그인 상태 확인...');
      const retryLoginOk = await checkAndLogin(scraper.browser);
      if (!retryLoginOk) {
        console.log('⚠️ 로그인 복구 실패 - 로그인 없이 재시도합니다.');
      }

      const retryResults = [];
      for (const incomplete of incompleteResults) {
        const retryKw = kwResult.rows.find(function(k) { return k.keyword === incomplete.keyword; });
        if (!retryKw) continue;

        const retryStart = Date.now();
        console.log('\n🔁 [' + retryKw.keyword + '] 재시도 (1차: ' + incomplete.count + '/' + topN + '개)');

        let retrySearchId = null;
        try {
          const retrySearchResult = await pool.query(
            `INSERT INTO tiktok_searches (keyword_id, keyword, status, source) 
             VALUES ($1, $2, 'running', 'scheduled') RETURNING id`,
            [retryKw.id, retryKw.keyword]
          );
          retrySearchId = retrySearchResult.rows[0].id;

          let retryVideos;
          try {
            retryVideos = await scraper.searchKeyword(retryKw.keyword, topN, function(status, percent, msg) {
              process.stdout.write('\r   [' + percent + '%] ' + msg + '          ');
            });
          } catch (retryErr2) {
            if (retryErr2.message === 'CAPTCHA_RESOLVED_RETRY') {
              retryVideos = await scraper.searchKeyword(retryKw.keyword, topN, function(status, percent, msg) {
                process.stdout.write('\r   [' + percent + '%] ' + msg + '          ');
              });
            } else {
              throw retryErr2;
            }
          }
          console.log('');

          for (const video of retryVideos) {
            await pool.query(
              `INSERT INTO tiktok_videos 
               (search_id, rank, video_url, creator_id, creator_name, description, posted_date, likes, comments, bookmarks, shares, views)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
              [retrySearchId, video.rank, video.videoUrl, video.creatorId, video.creatorName,
               video.description, video.postedDate, video.likes, video.comments,
               video.bookmarks, video.shares, video.views]
            );
          }

          await pool.query(
            `UPDATE tiktok_searches SET status = 'completed', video_count = $1, completed_at = NOW() WHERE id = $2`,
            [retryVideos.length, retrySearchId]
          );

          await analyzeChanges(retryKw.keyword, retryVideos, retrySearchId);

          const retryElapsed = ((Date.now() - retryStart) / 1000).toFixed(1);
          const improved = retryVideos.length > incomplete.count;
          console.log('   ' + (retryVideos.length >= topN ? '✅' : '⚠️') + ' 재시도: ' + retryVideos.length + '/' + topN + '개 (' + retryElapsed + '초)' + (improved ? ' 📈 개선' : ''));

          retryResults.push({
            keyword: retryKw.keyword,
            firstCount: incomplete.count,
            retryCount: retryVideos.length,
            improved: improved,
            status: 'success'
          });

          await pool.query(`UPDATE tiktok_keywords SET updated_at = NOW() WHERE id = $1`, [retryKw.id]);

          if (incompleteResults.indexOf(incomplete) < incompleteResults.length - 1) {
            var retryDelay = Math.floor(Math.random() * 15000) + 15000;
            console.log('   ⏳ 다음 재시도까지 ' + (retryDelay / 1000).toFixed(1) + '초 대기...');
            await new Promise(function(r) { setTimeout(r, retryDelay); });
          }

        } catch (retryErr) {
          console.log('\n   ❌ 재시도 실패: ' + retryErr.message);
          if (retrySearchId) {
            await pool.query(
              `UPDATE tiktok_searches SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
              [retryErr.message, retrySearchId]
            ).catch(function() {});
          }
          retryResults.push({ keyword: retryKw.keyword, firstCount: incomplete.count, retryCount: 0, status: 'failed', error: retryErr.message });
        }
      }

      // 최종 텔레그램 리포트
      const finalTotalSeconds = (Date.now() - startTime.getTime()) / 1000;
      let finalMsg = '📋 <b>TikTok 최종 스크래핑 리포트</b>\n';
      finalMsg += '📅 ' + startTime.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + '\n\n';

      // 정상 완료 키워드
      const fullResults = results.filter(function(r) { return r.status === 'success' && r.count >= topN; });
      if (fullResults.length > 0) {
        finalMsg += '✅ <b>정상 완료 (' + fullResults.length + '개)</b>\n';
        fullResults.forEach(function(r) { finalMsg += '  · ' + r.keyword + ': ' + r.count + '개\n'; });
        finalMsg += '\n';
      }

      // 재시도 결과
      finalMsg += '🔄 <b>재시도 결과 (' + retryResults.length + '개)</b>\n';
      retryResults.forEach(function(r) {
        if (r.status === 'success') {
          const icon = r.retryCount >= topN ? '✅' : '⚠️';
          finalMsg += icon + ' ' + r.keyword + ': ' + r.firstCount + '→' + r.retryCount + '/' + topN + '개';
          if (r.improved) finalMsg += ' 📈';
          finalMsg += '\n';
        } else {
          finalMsg += '❌ ' + r.keyword + ': 재시도 실패\n';
        }
      });

      // 실패 키워드
      const failedResults = results.filter(function(r) { return r.status === 'failed'; });
      if (failedResults.length > 0) {
        finalMsg += '\n❌ <b>실패 (' + failedResults.length + '개)</b>\n';
        failedResults.forEach(function(r) { finalMsg += '  · ' + r.keyword + ': ' + r.error + '\n'; });
      }

      finalMsg += '\n⏱️ 총 소요: ' + formatTime(finalTotalSeconds);
      await sendTelegram(finalMsg);

    } else {
      // 모두 정상 완료
      await sendTelegram(teleMsg);
    }

  } catch (err) {
    console.error('\n❌ 전체 오류: ' + err.message);
    await sendTelegram('❌ TikTok 자동 스크래핑 오류: ' + err.message);
  } finally {
    await scraper.close();
    await pool.end();
    console.log('\n🔚 종료');

    // 스크래핑 완료 후 Chrome 프로필 복구 (확장 프로그램 세션 유지용)
    try {
      const { exec } = require('child_process');
      exec('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir="C:\\EV-System\\chrome-tiktok-profile-real" --no-first-run');
      console.log('🔄 Chrome 프로필 복구 완료');
    } catch(e) {}
  }
}

run();
