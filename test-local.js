/**
 * ============================================================
 * EV2 TikTok Scraper - 로컬 테스트 스크립트
 * ============================================================
 * 
 * DB 없이 순수 스크래핑만 테스트합니다.
 * 로컬 PC에서 먼저 실행하여 TikTok 스크래핑이 정상 작동하는지 확인하세요.
 * 
 * 실행 방법:
 *   cd C:\EV-System\EV2-Boosting\ev2-tiktok-analyzer
 *   npm install playwright
 *   npx playwright install chromium
 *   node test-local.js "메디큐브 PDRN"
 * 
 * ============================================================
 */

const { chromium } = require('playwright');

// ============================================================
// 설정
// ============================================================
const KEYWORD = process.argv[2] || '메디큐브 PDRN';
const TOP_N = 5;
const HEADLESS = false;  // false = 브라우저 화면 보이게 (디버깅용)

// ============================================================
// TikTok 봇 감지 우회 (올리브영보다 훨씬 강력)
// ============================================================

/**
 * TikTok 스텔스 설정
 * 
 * 올리브영 vs TikTok 보안 차이:
 * - 올리브영: 기본적인 webdriver 체크 + 간단한 봇 감지
 * - TikTok: 다층 방어 시스템
 *   1) Browser fingerprinting (Canvas, WebGL, AudioContext)
 *   2) 행동 패턴 분석 (마우스 움직임, 스크롤 패턴)
 *   3) TLS fingerprinting
 *   4) CAPTCHA (슬라이드 퍼즐)
 *   5) Rate limiting (IP당 요청 제한)
 * 
 * 전략:
 * - headless: false로 시작 (headless 감지 우회)
 * - 실제 사람처럼 행동 시뮬레이션
 * - 충분한 랜덤 딜레이
 * - Firefox 사용 고려 (Chromium보다 감지 어려움)
 */
async function createStealthBrowser() {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1920,1080',
      '--lang=ko-KR',
      // TikTok 추가 우회
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-web-security',
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    // TikTok은 permissions, geolocation 등도 체크
    permissions: ['geolocation'],
    geolocation: { latitude: 37.5665, longitude: 126.9780 }, // 서울
    extraHTTPHeaders: {
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="131", "Google Chrome";v="131"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    }
  });

  const page = await context.newPage();

  // 스텔스 스크립트 주입
  await page.addInitScript(() => {
    // 1. webdriver 숨기기
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    delete navigator.__proto__.webdriver;

    // 2. chrome 객체
    window.chrome = {
      runtime: {},
      loadTimes: function() {},
      csi: function() {},
      app: { isInstalled: false },
    };

    // 3. plugins (빈 배열이면 봇으로 의심)
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ];
        plugins.length = 3;
        return plugins;
      }
    });

    // 4. languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['ko-KR', 'ko', 'en-US', 'en']
    });

    // 5. permissions 쿼리
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);

    // 6. Canvas fingerprint 노이즈 추가 (TikTok 전용)
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type) {
      if (type === 'image/png' && this.width > 16 && this.height > 16) {
        const ctx = this.getContext('2d');
        if (ctx) {
          const imgData = ctx.getImageData(0, 0, 1, 1);
          imgData.data[0] = imgData.data[0] ^ 1; // 1비트만 변경
          ctx.putImageData(imgData, 0, 0);
        }
      }
      return origToDataURL.apply(this, arguments);
    };

    // 7. WebGL vendor/renderer 위장
    const getParameterProxyHandler = {
      apply: function(target, thisArg, args) {
        const param = args[0];
        const gl = thisArg;
        // UNMASKED_VENDOR_WEBGL
        if (param === 0x9245) return 'Google Inc. (NVIDIA)';
        // UNMASKED_RENDERER_WEBGL
        if (param === 0x9246) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
        return target.apply(thisArg, args);
      }
    };
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          WebGLRenderingContext.prototype.getParameter = new Proxy(
            WebGLRenderingContext.prototype.getParameter, getParameterProxyHandler
          );
        }
      }
    } catch(e) {}

    // 8. connection 속성 (봇은 보통 이것이 없음)
    Object.defineProperty(navigator, 'connection', {
      get: () => ({
        effectiveType: '4g',
        rtt: 50,
        downlink: 10,
        saveData: false,
      })
    });
  });

  return { browser, context, page };
}

// ============================================================
// 사람처럼 행동 시뮬레이션
// ============================================================
async function randomDelay(min = 1000, max = 3000) {
  const delay = Math.floor(Math.random() * (max - min)) + min;
  await new Promise(resolve => setTimeout(resolve, delay));
}

async function humanLikeMouseMove(page) {
  // 마우스를 랜덤 위치로 이동 (TikTok 행동 패턴 분석 우회)
  const x = Math.floor(Math.random() * 800) + 200;
  const y = Math.floor(Math.random() * 400) + 200;
  await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
}

async function humanLikeScroll(page) {
  // 자연스러운 스크롤
  const scrollAmount = Math.floor(Math.random() * 300) + 100;
  await page.evaluate((amount) => {
    window.scrollBy({ top: amount, behavior: 'smooth' });
  }, scrollAmount);
  await randomDelay(500, 1500);
}

// ============================================================
// CAPTCHA 감지
// ============================================================
async function checkForCaptcha(page) {
  const captchaSelectors = [
    '[class*="captcha"]',
    '[id*="captcha"]',
    'div[class*="verify"]',
    '.tiktok-verify',
    '#verify-bar-close',
  ];

  for (const sel of captchaSelectors) {
    const el = await page.$(sel);
    if (el) {
      console.log('⚠️  CAPTCHA 감지됨! 수동으로 해결해주세요...');
      console.log('   (headless: false 모드에서 브라우저에서 직접 CAPTCHA를 풀어주세요)');
      // headless: false일 때 사용자가 수동으로 풀 수 있도록 30초 대기
      await new Promise(resolve => setTimeout(resolve, 30000));
      return true;
    }
  }
  return false;
}

// ============================================================
// 메인: 검색 실행
// ============================================================
async function searchTikTok(keyword, topN) {
  console.log('');
  console.log('='.repeat(60));
  console.log(`🎵 EV2 TikTok Scraper - 로컬 테스트`);
  console.log(`🔍 키워드: "${keyword}"`);
  console.log(`📊 수집 목표: 상위 ${topN}개`);
  console.log(`👁️  Headless: ${HEADLESS}`);
  console.log('='.repeat(60));
  console.log('');

  const { browser, context, page } = await createStealthBrowser();
  const results = [];

  try {
    // === Step 1: TikTok 검색 페이지 이동 ===
    const searchUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`;
    console.log(`[1/5] 🌐 TikTok 검색 페이지 이동...`);
    console.log(`      URL: ${searchUrl}`);

    await page.goto(searchUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });

    // 초기 로딩 대기
    await randomDelay(3000, 5000);
    await humanLikeMouseMove(page);

    // CAPTCHA 체크
    await checkForCaptcha(page);

    // === Step 2: 검색 결과 대기 ===
    console.log(`[2/5] ⏳ 검색 결과 로딩 대기...`);

    // 여러 셀렉터 시도
    const containerSelectors = [
      'div[data-e2e="search_top-item-list"]',
      'div[id^="column-item-video-container"]',
      'a[href*="/video/"]',
    ];

    let found = false;
    for (const sel of containerSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 10000 });
        console.log(`      ✅ 발견: ${sel}`);
        found = true;
        break;
      } catch {
        console.log(`      ❌ 미발견: ${sel}`);
      }
    }

    if (!found) {
      // 스크롤해서 로딩 시도
      console.log('      🔄 스크롤로 콘텐츠 로딩 시도...');
      await humanLikeScroll(page);
      await randomDelay(3000, 5000);
      await humanLikeScroll(page);
      await randomDelay(2000, 3000);
    }

    // CAPTCHA 재체크
    await checkForCaptcha(page);

    // === Step 3: 비디오 URL 수집 ===
    console.log(`[3/5] 📋 비디오 목록 수집...`);

    // 스크린샷 저장 (디버깅용)
    await page.screenshot({ path: 'debug-search-results.png', fullPage: false });
    console.log('      📸 스크린샷: debug-search-results.png');

    // 방법 1: embedded JSON에서 추출
    let videoUrls = await page.evaluate(() => {
      const script = document.querySelector('script#__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (!script) return [];
      try {
        const json = JSON.parse(script.textContent);
        const scope = json['__DEFAULT_SCOPE__'] || {};
        const searchData = scope['webapp.search-detail'] || {};
        const itemList = searchData.itemList || [];
        return itemList.map(item => ({
          url: `https://www.tiktok.com/@${item.author?.uniqueId}/video/${item.id}`,
          creatorId: item.author?.uniqueId || null,
          creatorName: item.author?.nickname || null,
          desc: item.desc || null,
          date: item.createTime ? new Date(item.createTime * 1000).toISOString().split('T')[0] : null,
          likes: item.stats?.diggCount?.toString() || null,
          comments: item.stats?.commentCount?.toString() || null,
          bookmarks: item.stats?.collectCount?.toString() || null,
          shares: item.stats?.shareCount?.toString() || null,
          views: item.stats?.playCount?.toString() || null,
        }));
      } catch { return []; }
    });

    if (videoUrls.length > 0) {
      console.log(`      ✅ JSON에서 ${videoUrls.length}개 비디오 발견 (빠른 경로)`);
      
      // JSON에서 바로 결과 구성
      for (let i = 0; i < Math.min(videoUrls.length, topN); i++) {
        const v = videoUrls[i];
        results.push({
          rank: i + 1,
          videoUrl: v.url,
          creatorId: v.creatorId || 'N/A',
          creatorName: v.creatorName || 'N/A',
          description: v.desc || 'N/A',
          postedDate: v.date || 'N/A',
          likes: v.likes || 'N/A',
          comments: v.comments || 'N/A',
          bookmarks: v.bookmarks || 'N/A',
          shares: v.shares || 'N/A',
          views: v.views || 'N/A',
        });
      }

    } else {
      // 방법 2: DOM에서 비디오 링크 수집
      console.log('      🔄 DOM에서 비디오 링크 수집...');
      
      const videoCards = await page.evaluate((limit) => {
        const links = [];
        const seen = new Set();
        
        // video URL 패턴으로 찾기
        const allAnchors = document.querySelectorAll('a[href*="/video/"]');
        for (const a of allAnchors) {
          if (links.length >= limit) break;
          const href = a.href;
          if (seen.has(href)) continue;
          seen.add(href);

          const container = a.closest('div[id^="column-item-video-container"]') 
            || a.closest('div[class*="DivItemContainer"]')
            || a.parentElement?.parentElement;
          
          const username = container?.querySelector('p[data-e2e="search-card-user-unique-id"]')?.textContent?.trim()
            || container?.querySelector('[class*="SpanUniqueId"]')?.textContent?.trim();

          links.push({ url: href, username: username || null });
        }
        return links;
      }, topN);

      console.log(`      📋 DOM에서 ${videoCards.length}개 비디오 링크 발견`);

      if (videoCards.length === 0) {
        // 페이지 HTML 일부 저장 (디버깅)
        const html = await page.content();
        const fs = require('fs');
        fs.writeFileSync('debug-page.html', html.substring(0, 50000));
        console.log('      📝 페이지 HTML 저장: debug-page.html (상위 50KB)');
        console.log('');
        console.log('❌ 비디오를 찾을 수 없습니다. 가능한 원인:');
        console.log('   1) TikTok 봇 감지 (CAPTCHA 표시 중일 수 있음)');
        console.log('   2) 검색 결과가 없는 키워드');
        console.log('   3) 지역 제한');
        console.log('   → headless: false로 실행하여 브라우저 화면을 확인해보세요');
        return;
      }

      // === Step 4: 각 비디오 상세 페이지 방문 ===
      console.log(`[4/5] 🎬 각 비디오 상세 정보 수집...`);

      for (let i = 0; i < Math.min(videoCards.length, topN); i++) {
        const card = videoCards[i];
        console.log(`      [${i + 1}/${topN}] ${card.url}`);

        try {
          await page.goto(card.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await randomDelay(2000, 4000);
          await humanLikeMouseMove(page);

          // JSON에서 추출 시도
          let detail = await page.evaluate(() => {
            const script = document.querySelector('script#__UNIVERSAL_DATA_FOR_REHYDRATION__');
            if (!script) return null;
            try {
              const json = JSON.parse(script.textContent);
              const scope = json['__DEFAULT_SCOPE__'] || {};
              const videoDetail = scope['webapp.video-detail'] || {};
              const item = videoDetail.itemInfo?.itemStruct || {};
              return {
                creatorId: item.author?.uniqueId || null,
                creatorName: item.author?.nickname || null,
                description: item.desc || null,
                postedDate: item.createTime 
                  ? new Date(item.createTime * 1000).toISOString().split('T')[0]
                  : null,
                likes: item.stats?.diggCount?.toString() || null,
                comments: item.stats?.commentCount?.toString() || null,
                bookmarks: item.stats?.collectCount?.toString() || null,
                shares: item.stats?.shareCount?.toString() || null,
                views: item.stats?.playCount?.toString() || null,
              };
            } catch { return null; }
          });

          // DOM fallback
          if (!detail || !detail.creatorId) {
            detail = await page.evaluate(() => {
              const getText = (sels) => {
                for (const s of sels) {
                  const el = document.querySelector(s);
                  if (el?.textContent?.trim()) return el.textContent.trim();
                }
                return null;
              };
              return {
                creatorId: getText(['[data-e2e="video-author-uniqueid"]', 'h3[data-e2e="video-author-uniqueid"]']),
                creatorName: getText(['[data-e2e="video-author-nickname"]', 'span[data-e2e="video-author-nickname"]']),
                description: getText(['[data-e2e="video-desc"]']),
                postedDate: getText(['span[data-e2e="browser-nickname"] span:last-child']),
                likes: getText(['[data-e2e="like-count"]', 'strong[data-e2e="like-count"]']),
                comments: getText(['[data-e2e="comment-count"]', 'strong[data-e2e="comment-count"]']),
                bookmarks: getText(['[data-e2e="undefined-count"]', '[data-e2e="bookmark-count"]']),
                shares: getText(['[data-e2e="share-count"]']),
                views: getText(['[data-e2e="video-views"]', 'strong[data-e2e="video-views"]']),
              };
            });
          }

          results.push({
            rank: i + 1,
            videoUrl: card.url,
            creatorId: detail?.creatorId || card.username || 'N/A',
            creatorName: detail?.creatorName || 'N/A',
            description: detail?.description || 'N/A',
            postedDate: detail?.postedDate || 'N/A',
            likes: detail?.likes || 'N/A',
            comments: detail?.comments || 'N/A',
            bookmarks: detail?.bookmarks || 'N/A',
            shares: detail?.shares || 'N/A',
            views: detail?.views || 'N/A',
          });

          console.log(`         ✅ @${detail?.creatorId || 'unknown'} | ❤️${detail?.likes || '?'} 💬${detail?.comments || '?'} 🔖${detail?.bookmarks || '?'}`);

        } catch (err) {
          console.log(`         ❌ 실패: ${err.message}`);
          results.push({
            rank: i + 1,
            videoUrl: card.url,
            creatorId: card.username || 'N/A',
            creatorName: 'N/A',
            description: 'N/A',
            postedDate: 'N/A',
            likes: 'N/A', comments: 'N/A', bookmarks: 'N/A', shares: 'N/A', views: 'N/A',
            error: err.message,
          });
        }
      }
    }

    // === Step 5: 결과 출력 ===
    console.log('');
    console.log(`[5/5] 📊 결과 출력`);
    console.log('='.repeat(60));
    console.log(`🎵 "${keyword}" TikTok 인기 Top ${results.length}`);
    console.log('='.repeat(60));

    for (const v of results) {
      console.log('');
      console.log(`  #${v.rank} ─────────────────────────────`);
      console.log(`  👤 크리에이터: ${v.creatorName} (@${v.creatorId})`);
      console.log(`  📝 설명: ${(v.description || '').substring(0, 80)}${(v.description || '').length > 80 ? '...' : ''}`);
      console.log(`  📅 게시일: ${v.postedDate}`);
      console.log(`  ❤️ 좋아요: ${v.likes}  💬 댓글: ${v.comments}  🔖 북마크: ${v.bookmarks}  🔗 공유: ${v.shares}  👁️ 조회: ${v.views}`);
      console.log(`  🔗 ${v.videoUrl}`);
      if (v.error) console.log(`  ⚠️ 에러: ${v.error}`);
    }

    // JSON 파일로도 저장
    const fs = require('fs');
    const outputFile = `tiktok-results-${keyword.replace(/\s/g, '_')}-${Date.now()}.json`;
    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2), 'utf8');
    console.log('');
    console.log(`💾 결과 저장: ${outputFile}`);
    console.log('='.repeat(60));

  } catch (err) {
    console.error('');
    console.error('❌ 치명적 오류:', err.message);
    console.error('');
    console.error('트러블슈팅:');
    console.error('  1) headless: false로 변경하여 브라우저 상태 확인');
    console.error('  2) CAPTCHA가 표시되면 수동으로 풀기');
    console.error('  3) VPN 사용 시 한국 IP로 변경');
    console.error('  4) debug-search-results.png 스크린샷 확인');

    // 에러 시 스크린샷
    try {
      await page.screenshot({ path: 'debug-error.png', fullPage: false });
      console.error('  📸 에러 스크린샷: debug-error.png');
    } catch {}

  } finally {
    await context.close();
    await browser.close();
    console.log('');
    console.log('🔒 브라우저 종료');
  }
}

// ============================================================
// 실행
// ============================================================
searchTikTok(KEYWORD, TOP_N);
