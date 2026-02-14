const { chromium } = require('playwright');

/**
 * TikTok 검색 결과 스크래퍼
 *
 * 흐름:
 * 1. TikTok 검색 URL로 이동 (https://www.tiktok.com/search/video?q=키워드)
 * 2. 동영상 탭 검색 결과 로딩 대기
 * 3. 상위 N개 비디오 카드에서 기본 정보 수집
 * 4. 각 비디오 페이지 방문하여 상세 정보 수집
 */

class TikTokScraper {
  constructor() {
    this.browser = null;
    this.USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }

  /**
   * 캡차 감지
   */
  async detectCaptcha(page) {
    try {
      const hasCaptcha = await page.evaluate(() => {
        const selectors = [
          '#tiktok-verify-ele',
          '.captcha_verify_container',
          '.captcha-verify-container',
          '[class*="captcha_verify"]',
          '[class*="captcha-verify"]',
          '[class*="CaptchaVerify"]',
          '[id*="captcha"]',
          '[class*="secsdk-captcha"]',
          '.verify-wrap',
          '[data-testid="captcha_container"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetHeight > 0) return sel;
        }
        // 텍스트 기반 감지
        const bodyText = document.body.innerText || '';
        if (bodyText.includes('슬라이더를 드래그') || bodyText.includes('퍼즐을 맞추세요')) return 'text:slider';
        if (bodyText.includes('Verify to continue') || bodyText.includes('Please wait')) return 'text:verify';
        if (bodyText.includes('Drag the slider') || bodyText.includes('Rotate')) return 'text:rotate';
        return null;
      });
      return hasCaptcha;
    } catch {
      return null;
    }
  }

  /**
   * 캡차 감지 시 텔레그램 알림 + 수동 해결 대기 (최대 180초)
   */
  async waitForCaptcha(page, keyword) {
    const captchaType = await this.detectCaptcha(page);
    if (!captchaType) return false;

    console.log('🔒 캡차 감지됨! (' + captchaType + ')');
    console.log('   ⏳ 수동 해결 대기 중... (최대 180초)');

    // 텔레그램 알림
    await this.sendTelegramAlert(
      '🔒 TikTok 캡차 발생!\n' +
      '📌 키워드: ' + keyword + '\n' +
      '🔍 감지: ' + captchaType + '\n' +
      '⏳ 180초 내에 PC에서 캡차를 해결해주세요!'
    );

    // 최대 180초 대기
    const maxWait = 180000;
    let waited = 0;
    while (waited < maxWait) {
      await new Promise(r => setTimeout(r, 5000));
      waited += 5000;

      const stillCaptcha = await this.detectCaptcha(page);
      if (!stillCaptcha) {
        console.log('   ✅ 캡차 해결됨! 스크래핑 계속...');
        await this.sendTelegramAlert('✅ 캡차 해결됨! [' + keyword + '] 스크래핑 재개');
        await new Promise(r => setTimeout(r, 2000));
        return true;
      }

      console.log('   ⏳ 캡차 대기 중... (' + (waited / 1000) + '초)');
    }

    console.log('   ❌ 캡차 타임아웃 - 이 키워드 스킵');
    await this.sendTelegramAlert('❌ 캡차 타임아웃! [' + keyword + '] 스킵됨');
    return false;
  }

  /**
   * 텔레그램 알림 전송
   */
  async sendTelegramAlert(message) {
    try {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (!token || !chatId) return;

      await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message })
      });
    } catch {}
  }

  /**
   * 브라우저 초기화 (일반 Chrome 사용으로 캡차 우회)
   */
  async initBrowser() {
    this.browser = await chromium.launchPersistentContext(
      'C:\\EV-System\\chrome-tiktok-profile-real',
      {
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: false,
        ignoreDefaultArgs: [
          '--enable-automation',
          '--disable-extensions',
          '--disable-default-apps',
          '--disable-component-update',
          '--disable-component-extensions-with-background-pages',
          '--no-first-run',
          '--disable-background-networking',
          '--disable-client-side-phishing-detection',
          '--metrics-recording-only',
          '--disable-popup-blocking',
          '--enable-unsafe-swiftshader',
        ],
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--window-size=1920,1080',
          '--lang=ko-KR',
          '--start-maximized',
        ],
        viewport: null,
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
      }
    );
    return this.browser;
  }

  /**
   * 봇 감지 우회 스크립트 주입
   */
  async applyStealthScripts(page) {
    await page.addInitScript(() => {
      // webdriver 속성 제거
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      delete navigator.__proto__.webdriver;

      // chrome 객체 위장
      window.chrome = {
        runtime: {
          onConnect: { addListener: function() {} },
          onMessage: { addListener: function() {} },
        },
        loadTimes: function() { return {}; },
        csi: function() { return {}; },
      };

      // plugins 위장
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

      // languages 위장
      Object.defineProperty(navigator, 'languages', {
        get: () => ['ko-KR', 'ko', 'en-US', 'en']
      });

      // permissions 위장
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);

      // WebGL vendor/renderer 위장
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter.call(this, parameter);
      };

      // connection rtt 위장 (자동화 도구는 보통 0)
      if (navigator.connection) {
        Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 });
      }

      // Automation-related properties 제거
      ['__webdriver_evaluate', '__selenium_evaluate', '__fxdriver_evaluate',
       '__driver_evaluate', '__webdriver_unwrap', '__selenium_unwrap',
       '__fxdriver_unwrap', '__driver_unwrap', '_Selenium_IDE_Recorder',
       '_selenium', 'calledSelenium', '__nightmare', '__phantomas',
       'domAutomation', 'domAutomationController',
      ].forEach(prop => {
        try { delete window[prop]; } catch {}
        try { delete document[prop]; } catch {}
      });
    });
  }

  /**
   * 페이지 가져오기 (기존 탭 재사용, 없으면 생성)
   */
  async createPage() {
    const pages = this.browser.pages();
    let page;
    if (pages.length > 0) {
      // 기존 탭 재사용
      page = pages[0];
    } else {
      page = await this.browser.newPage();
    }
    await this.applyStealthScripts(page);
    return page;
  }

  /**
   * 랜덤 딜레이 (인간적인 행동 시뮬레이션)
   */
  async randomDelay(min = 1000, max = 3000) {
    const delay = Math.floor(Math.random() * (max - min)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * 메인: 키워드 검색 후 상위 N개 비디오 정보 수집
   */
  async searchKeyword(keyword, topN = parseInt(process.env.DEFAULT_TOP_N) || 30, progressCallback = null) {
    let page = null;
    const results = [];

    try {
      if (!this.browser) await this.initBrowser();
      try {
        page = await this.createPage();
      } catch (e) {
        console.log('⚠️ 브라우저 재시작...');
        try { await this.browser.close(); } catch {}
        this.browser = null;
        await this.initBrowser();
        page = await this.createPage();
      }

      // === Step 1: TikTok 검색 페이지 이동 (동영상 탭) ===
      if (progressCallback) progressCallback('searching', 10, '검색 페이지 로딩 중..');

      const searchUrl = `https://www.tiktok.com/search/video?q=${encodeURIComponent(keyword)}`;
      console.log(`🔍 Searching TikTok: ${keyword}`);
      console.log(`📎 URL: ${searchUrl}`);

      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // 페이지 로딩 대기
      await this.randomDelay(3000, 5000);

      // === 캡차 감지 ===
      const captchaResolved = await this.waitForCaptcha(page, keyword);
      if (captchaResolved) {
        // 캡차 해결 후 페이지 새로고침
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.randomDelay(3000, 5000);
      }

      if (progressCallback) progressCallback('searching', 20, '검색 결과 로딩 중..');

      // === Step 2: 스크롤 + 검색 결과 컨테이너 대기 ===
      // 먼저 비디오 링크가 나올 때까지 대기
      try {
        await page.waitForSelector('a[href*="/video/"]', { timeout: 10000 });
        console.log('✅ Initial videos loaded');
      } catch {
        console.log('⚠️ Waiting for initial load...');
        await this.randomDelay(3000, 5000);
      }

      // 30개 이상 수집하려면 스크롤해서 더 많은 콘텐츠 로딩
      if (topN > 10) {
        console.log('📜 Scrolling to load more results...');
        // 페이지 클릭하여 포커스 부여
        await page.mouse.click(960, 500);
        await this.randomDelay(500, 1000);
        for (let i = 0; i < 10; i++) {
          await page.keyboard.press('End');
          await this.randomDelay(2000, 3000);
          const count = await page.evaluate(() => document.querySelectorAll('a[href*="/video/"]').length);
          console.log(`   스크롤 ${i + 1}/10 - 현재 ${count}개`);
          if (count >= topN) break;
        }
      }

      // 동영상 탭 + 일반 탭 모두 지원하는 셀렉터
      const containerSelectors = [
        'a[href*="/video/"]',
        'div[data-e2e="search_top-item-list"]',
        'div[data-e2e="search-common-link"]',
        'div[id^="column-item-video-container"]',
        'div[class*="DivItemContainerV2"]',
        'div[class*="search-card"]',
      ];
      let containerFound = false;
      for (const selector of containerSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 8000 });
          containerFound = true;
          console.log(`✅ Found container: ${selector}`);
          break;
        } catch {
          continue;
        }
      }

      if (!containerFound) {
        // 최후 수단: 비디오 링크가 있는지 직접 확인
        await this.randomDelay(3000, 5000);
        const videoLinks = await page.$$('a[href*="/video/"]');
        if (videoLinks.length === 0) {
          console.log('⚠️ No search results container found, trying scroll...');
          await page.evaluate(() => window.scrollBy(0, 500));
          await this.randomDelay(2000, 3000);
        }
      }

      // === Step 3: 비디오 카드에서 URL 및 기본 정보 수집 ===
      if (progressCallback) progressCallback('collecting', 30, '비디오 목록 수집 중..');

      const videoCards = await page.evaluate((limit) => {
        const cards = [];

        // 방법 1: video container ID 패턴
        let containers = document.querySelectorAll('div[id^="column-item-video-container"]');

        // 방법 2: 비디오 링크 기반
        if (containers.length === 0) {
          const allLinks = document.querySelectorAll('a[href*="/video/"]');
          const seen = new Set();
          allLinks.forEach(link => {
            const href = link.href;
            if (!seen.has(href) && cards.length < limit) {
              seen.add(href);
              // 가장 가까운 컨테이너 찾기
              const container = link.closest('div[class*="Container"]') || link.parentElement;

              const usernameEl = container?.querySelector('p[data-e2e="search-card-user-unique-id"]')
                || container?.querySelector('[class*="uniqueId"]')
                || container?.querySelector('[class*="UserName"]');

              const descSpans = container?.querySelectorAll('span[data-e2e="new-desc-span"]');
              const desc = descSpans
                ? Array.from(descSpans).map(s => s.textContent).join(' ').trim()
                : '';

              cards.push({
                videoUrl: href,
                username: usernameEl?.textContent?.trim() || null,
                description: desc || null,
              });
            }
          });
          return cards;
        }

        // container 방식으로 수집
        for (let i = 0; i < Math.min(containers.length, limit); i++) {
          const node = containers[i];
          const anchor = node.querySelector('a[href*="/video/"]');
          const usernameEl = node.querySelector('p[data-e2e="search-card-user-unique-id"]');
          const descSpans = node.querySelectorAll('span[data-e2e="new-desc-span"]');
          const desc = Array.from(descSpans).map(s => s.textContent).join(' ').trim();

          if (anchor?.href) {
            cards.push({
              videoUrl: anchor.href,
              username: usernameEl?.textContent?.trim() || null,
              description: desc || null,
            });
          }
        }
        return cards;
      }, topN);

      console.log(`📋 Found ${videoCards.length} video cards`);

      if (videoCards.length === 0) {
        // 캡차 때문에 결과가 없을 수 있음
        const captchaFound = await this.waitForCaptcha(page, keyword);
        if (captchaFound) {
          // 캡차 해결됨 - 페이지 새로고침 후 재시도
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await this.randomDelay(3000, 5000);
          // 재시도는 throw로 넘겨서 run-all-keywords에서 처리
          throw new Error('CAPTCHA_RESOLVED_RETRY');
        }

        // __UNIVERSAL_DATA_FOR_REHYDRATION__에서 데이터 추출 시도
        console.log('🔄 Trying embedded JSON extraction...');
        const embeddedData = await this.extractFromEmbeddedJSON(page, topN);
        if (embeddedData.length > 0) {
          return embeddedData;
        }

        throw new Error('검색 결과를 찾을 수 없습니다. TikTok이 봇을 감지했을 수 있습니다.');
      }

      // === Step 4: 각 비디오 페이지 방문하여 상세 정보 수집 ===
      for (let i = 0; i < Math.min(videoCards.length, topN); i++) {
        const card = videoCards[i];
        if (progressCallback) {
          const percent = 40 + Math.floor((i / topN) * 50);
          progressCallback('analyzing', percent, `비디오 ${i + 1}/${topN} 분석 중..`);
        }

        try {
          console.log(`🎬 [${i + 1}/${topN}] Visiting: ${card.videoUrl}`);
          const videoDetail = await this.scrapeVideoDetail(page, card.videoUrl);

          results.push({
            rank: i + 1,
            videoUrl: card.videoUrl,
            creatorId: videoDetail.creatorId || card.username || 'N/A',
            creatorName: videoDetail.creatorName || 'N/A',
            description: videoDetail.description || card.description || 'N/A',
            postedDate: videoDetail.postedDate || 'N/A',
            likes: videoDetail.likes || 'N/A',
            comments: videoDetail.comments || 'N/A',
            bookmarks: videoDetail.bookmarks || 'N/A',
            shares: videoDetail.shares || 'N/A',
            views: videoDetail.views || 'N/A',
          });

          await this.randomDelay(2000, 4000);
        } catch (err) {
          console.error(`❌ Error scraping video ${i + 1}:`, err.message);
          results.push({
            rank: i + 1,
            videoUrl: card.videoUrl,
            creatorId: card.username || 'N/A',
            creatorName: 'N/A',
            description: card.description || 'N/A',
            postedDate: 'N/A',
            likes: 'N/A',
            comments: 'N/A',
            bookmarks: 'N/A',
            shares: 'N/A',
            views: 'N/A',
            error: err.message,
          });
        }
      }

      if (progressCallback) progressCallback('completed', 100, '완료');
      return results;

    } catch (err) {
      console.error('❌ Search error:', err.message);
      throw err;
    } finally {
      // 페이지를 닫지 않음 (다음 키워드에서 재사용)
    }
  }

  /**
   * 개별 비디오 페이지에서 상세 정보 스크래핑
   */
  async scrapeVideoDetail(page, videoUrl) {
    await page.goto(videoUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });
    await this.randomDelay(2000, 4000);

    // 먼저 embedded JSON에서 시도
    const jsonData = await this.extractVideoFromJSON(page);
    if (jsonData) return jsonData;

    // DOM에서 직접 추출
    const videoInfo = await page.evaluate(() => {
      const getText = (selectors) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent?.trim()) return el.textContent.trim();
        }
        return null;
      };

      const getAll = (selector) => {
        return Array.from(document.querySelectorAll(selector))
          .map(el => el.textContent?.trim())
          .filter(Boolean);
      };

      const creatorId = getText([
        '[data-e2e="video-author-uniqueid"]',
        'h3[data-e2e="video-author-uniqueid"]',
        'span[data-e2e="video-author-uniqueid"]',
        'a[data-e2e="video-author-avatar"] + * span',
      ]);

      const creatorName = getText([
        '[data-e2e="video-author-nickname"]',
        'span[data-e2e="video-author-nickname"]',
      ]);

      const postedDate = getText([
        'span[data-e2e="browser-nickname"] span:last-child',
        '[class*="SpanOtherInfos"] span:last-child',
      ]);

      const descSpans = getAll('[data-e2e="video-desc"] span');
      const description = descSpans.join(' ') || getText(['[data-e2e="video-desc"]']);

      const likes = getText([
        '[data-e2e="like-count"]',
        '[data-e2e="browse-like-count"]',
        'strong[data-e2e="like-count"]',
      ]);

      const comments = getText([
        '[data-e2e="comment-count"]',
        '[data-e2e="browse-comment-count"]',
        'strong[data-e2e="comment-count"]',
      ]);

      const bookmarks = getText([
        '[data-e2e="undefined-count"]',
        '[data-e2e="bookmark-count"]',
      ]);

      const shares = getText([
        '[data-e2e="share-count"]',
      ]);

      const views = getText([
        '[data-e2e="video-views"]',
        'strong[data-e2e="video-views"]',
      ]);

      return { creatorId, creatorName, description, postedDate, likes, comments, bookmarks, shares, views };
    });

    return videoInfo;
  }

  /**
   * __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON에서 비디오 데이터 추출
   */
  async extractVideoFromJSON(page) {
    try {
      const data = await page.evaluate(() => {
        const script = document.querySelector('script#__UNIVERSAL_DATA_FOR_REHYDRATION__');
        if (!script) return null;
        try {
          const json = JSON.parse(script.textContent);
          const scope = json['__DEFAULT_SCOPE__'] || {};
          const videoDetail = scope['webapp.video-detail'] || {};
          const itemInfo = videoDetail.itemInfo || {};
          const itemStruct = itemInfo.itemStruct || {};

          return {
            creatorId: itemStruct.author?.uniqueId || null,
            creatorName: itemStruct.author?.nickname || null,
            description: itemStruct.desc || null,
            postedDate: itemStruct.createTime
              ? new Date(itemStruct.createTime * 1000).toISOString().split('T')[0]
              : null,
            likes: itemStruct.stats?.diggCount?.toString() || null,
            comments: itemStruct.stats?.commentCount?.toString() || null,
            bookmarks: itemStruct.stats?.collectCount?.toString() || null,
            shares: itemStruct.stats?.shareCount?.toString() || null,
            views: itemStruct.stats?.playCount?.toString() || null,
          };
        } catch { return null; }
      });

      if (data && data.creatorId) {
        console.log(`  ✅ Extracted from JSON: @${data.creatorId}`);
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 검색 결과 페이지의 embedded JSON에서 데이터 추출 (fallback)
   */
  async extractFromEmbeddedJSON(page, topN) {
    try {
      const results = await page.evaluate((limit) => {
        const script = document.querySelector('script#__UNIVERSAL_DATA_FOR_REHYDRATION__');
        if (!script) return [];
        try {
          const json = JSON.parse(script.textContent);
          const scope = json['__DEFAULT_SCOPE__'] || {};

          const searchData = scope['webapp.search-detail'] || {};
          const itemList = searchData.itemList || searchData.data || [];

          return itemList.slice(0, limit).map((item, idx) => ({
            rank: idx + 1,
            videoUrl: `https://www.tiktok.com/@${item.author?.uniqueId}/video/${item.id}`,
            creatorId: item.author?.uniqueId || 'N/A',
            creatorName: item.author?.nickname || 'N/A',
            description: item.desc || 'N/A',
            postedDate: item.createTime
              ? new Date(item.createTime * 1000).toISOString().split('T')[0]
              : 'N/A',
            likes: item.stats?.diggCount?.toString() || 'N/A',
            comments: item.stats?.commentCount?.toString() || 'N/A',
            bookmarks: item.stats?.collectCount?.toString() || 'N/A',
            shares: item.stats?.shareCount?.toString() || 'N/A',
            views: item.stats?.playCount?.toString() || 'N/A',
          }));
        } catch { return []; }
      }, topN);

      if (results.length > 0) {
        console.log(`✅ Extracted ${results.length} videos from embedded JSON`);
      }
      return results;
    } catch {
      return [];
    }
  }

  /**
   * 브라우저 종료
   */
  async close() {
    if (this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
    }
  }
}

module.exports = TikTokScraper;
