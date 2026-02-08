const { chromium } = require('playwright');

/**
 * TikTok 검색 결과 스크래퍼
 * 
 * 흐름:
 * 1. TikTok 검색 URL로 이동 (https://www.tiktok.com/search?q=키워드)
 * 2. 인기 탭 결과 로딩 대기
 * 3. 상위 N개 비디오 카드에서 기본 정보 수집
 * 4. 각 비디오 페이지 방문하여 상세 정보 수집
 */

class TikTokScraper {
  constructor() {
    this.browser = null;
    this.USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }

  /**
   * 브라우저 초기화 (봇 감지 우회 설정 포함)
   */
  async initBrowser() {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1920,1080',
        '--lang=ko-KR',
      ]
    });
    return this.browser;
  }

  /**
   * 봇 감지 우회 스크립트 주입
   */
  async applyStealthScripts(page) {
    await page.addInitScript(() => {
      // webdriver 속성 숨기기
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // chrome 객체 추가
      window.chrome = { runtime: {} };

      // plugins 설정
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });

      // languages 설정
      Object.defineProperty(navigator, 'languages', {
        get: () => ['ko-KR', 'ko', 'en-US', 'en']
      });

      // permissions 쿼리 오버라이드
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    });
  }

  /**
   * 새 페이지 생성 (스텔스 설정 적용)
   */
  async createPage() {
    const context = await this.browser.newContext({
      userAgent: this.USER_AGENT,
      viewport: { width: 1920, height: 1080 },
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      extraHTTPHeaders: {
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="131", "Google Chrome";v="131"',
        'sec-ch-ua-platform': '"Windows"',
      }
    });
    const page = await context.newPage();
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
  async searchKeyword(keyword, topN = 5, progressCallback = null) {
    let page = null;
    const results = [];

    try {
      if (!this.browser) await this.initBrowser();
      page = await this.createPage();

      // === Step 1: TikTok 검색 페이지 이동 ===
      if (progressCallback) progressCallback('searching', 10, '검색 페이지 로딩 중...');
      
      const searchUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`;
      console.log(`🔍 Searching TikTok: ${keyword}`);
      console.log(`📎 URL: ${searchUrl}`);

      await page.goto(searchUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // 페이지 로딩 대기
      await this.randomDelay(3000, 5000);
      if (progressCallback) progressCallback('searching', 20, '검색 결과 로딩 중...');

      // === Step 2: 검색 결과 컨테이너 대기 ===
      // TikTok 검색 결과는 여러 셀렉터 패턴이 가능
      const containerSelectors = [
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
      if (progressCallback) progressCallback('collecting', 30, '비디오 목록 수집 중...');

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
          progressCallback('analyzing', percent, `비디오 ${i + 1}/${topN} 분석 중...`);
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
      if (page) {
        try { await page.context().close(); } catch {}
      }
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

      // 크리에이터 ID
      const creatorId = getText([
        '[data-e2e="video-author-uniqueid"]',
        'h3[data-e2e="video-author-uniqueid"]',
        'span[data-e2e="video-author-uniqueid"]',
        'a[data-e2e="video-author-avatar"] + * span',
      ]);

      // 크리에이터 이름
      const creatorName = getText([
        '[data-e2e="video-author-nickname"]',
        'span[data-e2e="video-author-nickname"]',
      ]);

      // 게시 날짜
      const postedDate = getText([
        'span[data-e2e="browser-nickname"] span:last-child',
        '[class*="SpanOtherInfos"] span:last-child',
      ]);

      // 설명
      const descSpans = getAll('[data-e2e="video-desc"] span');
      const description = descSpans.join(' ') || getText(['[data-e2e="video-desc"]']);

      // 좋아요
      const likes = getText([
        '[data-e2e="like-count"]',
        '[data-e2e="browse-like-count"]',
        'strong[data-e2e="like-count"]',
      ]);

      // 댓글
      const comments = getText([
        '[data-e2e="comment-count"]',
        '[data-e2e="browse-comment-count"]',
        'strong[data-e2e="comment-count"]',
      ]);

      // 즐겨찾기 (북마크)
      const bookmarks = getText([
        '[data-e2e="undefined-count"]',
        '[data-e2e="bookmark-count"]',
      ]);

      // 공유
      const shares = getText([
        '[data-e2e="share-count"]',
      ]);

      // 조회수
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
          
          // 검색 결과 데이터 경로 탐색
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
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = TikTokScraper;
