const { chromium } = require('playwright');

/**
 * TikTok ê²€??ê²°ê³¼ ?¤í¬?˜í¼
 * 
 * ?ë¦„:
 * 1. TikTok ê²€??URLë¡??´ë™ (https://www.tiktok.com/search/video?q=?¤ì›Œ??
 * 2. ?™ì˜????ê²°ê³¼ ë¡œë”© ?€ê¸? * 3. ?ìœ„ Nê°?ë¹„ë””??ì¹´ë“œ?ì„œ ê¸°ë³¸ ?•ë³´ ?˜ì§‘
 * 4. ê°?ë¹„ë””???˜ì´ì§€ ë°©ë¬¸?˜ì—¬ ?ì„¸ ?•ë³´ ?˜ì§‘
 */

class TikTokScraper {
  constructor() {
    this.browser = null;
    this.USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }

  /**
   * ë¸Œë¼?°ì? ì´ˆê¸°??(Chrome ?„ë¡œ??ë³µì‚¬ë³??¬ìš©?¼ë¡œ ìº¡ì°¨ ?°íšŒ)
   */
  async initBrowser() {
    this.browser = await chromium.launchPersistentContext(
      'C:\\EV-System\\chrome-tiktok-profile-real',
      {
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--window-size=1920,1080',
          '--lang=ko-KR',
        ],
        viewport: { width: 1920, height: 1080 },
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
      }
    );
    return this.browser;
  }

  /**
   * ë´?ê°ì? ?°íšŒ ?¤í¬ë¦½íŠ¸ ì£¼ì…
   */
  async applyStealthScripts(page) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['ko-KR', 'ko', 'en-US', 'en']
      });
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    });
  }

  /**
   * ???˜ì´ì§€ ?ì„± (?¤í…”???¤ì • ?ìš©)
   */
  async createPage() {
    const page = await this.browser.newPage();
    await this.applyStealthScripts(page);
    return page;
  }

  /**
   * ?œë¤ ?œë ˆ??(?¸ê°„?ì¸ ?‰ë™ ?œë??ˆì´??
   */
  async randomDelay(min = 1000, max = 3000) {
    const delay = Math.floor(Math.random() * (max - min)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * ë©”ì¸: ?¤ì›Œ??ê²€?????ìœ„ Nê°?ë¹„ë””???•ë³´ ?˜ì§‘
   */
  async searchKeyword(keyword, topN = 5, progressCallback = null) {
    let page = null;
    const results = [];

    try {
      if (!this.browser) await this.initBrowser();
      try {
        page = await this.createPage();
      } catch (e) {
        console.log('? ï¸ ë¸Œë¼?°ì? ?¬ì‹œ??..');
        try { await this.browser.close(); } catch {}
        this.browser = null;
        await this.initBrowser();
        page = await this.createPage();
      }

      // === Step 1: TikTok ê²€???˜ì´ì§€ ?´ë™ (?™ì˜???? ===
      if (progressCallback) progressCallback('searching', 10, 'ê²€???˜ì´ì§€ ë¡œë”© ì¤?..');
      
      const searchUrl = `https://www.tiktok.com/search/video?q=${encodeURIComponent(keyword)}`;
      console.log(`?” Searching TikTok: ${keyword}`);
      console.log(`?“ URL: ${searchUrl}`);

      await page.goto(searchUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // ?˜ì´ì§€ ë¡œë”© ?€ê¸?      await this.randomDelay(3000, 5000);
      if (progressCallback) progressCallback('searching', 20, 'ê²€??ê²°ê³¼ ë¡œë”© ì¤?..');

      // === Step 2: ?¤í¬ë¡?+ ê²€??ê²°ê³¼ ì»¨í…Œ?´ë„ˆ ?€ê¸?===
      // ë¨¼ì? ë¹„ë””??ë§í¬ê°€ ?˜ì˜¬ ?Œê¹Œì§€ ?€ê¸?      try {
        await page.waitForSelector('a[href*="/video/"]', { timeout: 10000 });
        console.log('??Initial videos loaded');
      } catch {
        console.log('? ï¸ Waiting for initial load...');
        await this.randomDelay(3000, 5000);
      }

      // 30ê°??´ìƒ ?˜ì§‘?˜ë ¤ë©??¤í¬ë¡¤í•´????ë§ì? ì½˜í…ì¸?ë¡œë”©
      if (topN > 10) {
        console.log('?“œ Scrolling to load more results...');
        // ?˜ì´ì§€ ?´ë¦­?˜ì—¬ ?¬ì»¤??ë¶€??        await page.mouse.click(960, 500);
        await this.randomDelay(500, 1000);
        for (let i = 0; i < 10; i++) {
          await page.keyboard.press('End');
          await this.randomDelay(2000, 3000);
          const count = await page.evaluate(() => document.querySelectorAll('a[href*="/video/"]').length);
          console.log(`   ?¤í¬ë¡?${i + 1}/10 - ?„ì¬ ${count}ê°?);
          if (count >= topN) break;
        }
      }
      // ?™ì˜????+ ?¸ê¸° ??ëª¨ë‘ ì§€?í•˜???€?‰í„°
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
          console.log(`??Found container: ${selector}`);
          break;
        } catch {
          continue;
        }
      }

      if (!containerFound) {
        // ìµœí›„ ?˜ë‹¨: ë¹„ë””??ë§í¬ê°€ ?ˆëŠ”ì§€ ì§ì ‘ ?•ì¸
        await this.randomDelay(3000, 5000);
        const videoLinks = await page.$$('a[href*="/video/"]');
        if (videoLinks.length === 0) {
          console.log('? ï¸ No search results container found, trying scroll...');
          await page.evaluate(() => window.scrollBy(0, 500));
          await this.randomDelay(2000, 3000);
        }
      }

      // === Step 3: ë¹„ë””??ì¹´ë“œ?ì„œ URL ë°?ê¸°ë³¸ ?•ë³´ ?˜ì§‘ ===
      if (progressCallback) progressCallback('collecting', 30, 'ë¹„ë””??ëª©ë¡ ?˜ì§‘ ì¤?..');

      const videoCards = await page.evaluate((limit) => {
        const cards = [];
        
        // ë°©ë²• 1: video container ID ?¨í„´
        let containers = document.querySelectorAll('div[id^="column-item-video-container"]');
        
        // ë°©ë²• 2: ë¹„ë””??ë§í¬ ê¸°ë°˜
        if (containers.length === 0) {
          const allLinks = document.querySelectorAll('a[href*="/video/"]');
          const seen = new Set();
          allLinks.forEach(link => {
            const href = link.href;
            if (!seen.has(href) && cards.length < limit) {
              seen.add(href);
              // ê°€??ê°€ê¹Œìš´ ì»¨í…Œ?´ë„ˆ ì°¾ê¸°
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

        // container ë°©ì‹?¼ë¡œ ?˜ì§‘
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

      console.log(`?“‹ Found ${videoCards.length} video cards`);

      if (videoCards.length === 0) {
        // __UNIVERSAL_DATA_FOR_REHYDRATION__?ì„œ ?°ì´??ì¶”ì¶œ ?œë„
        console.log('?”„ Trying embedded JSON extraction...');
        const embeddedData = await this.extractFromEmbeddedJSON(page, topN);
        if (embeddedData.length > 0) {
          return embeddedData;
        }
        
        throw new Error('ê²€??ê²°ê³¼ë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤. TikTok??ë´‡ì„ ê°ì??ˆì„ ???ˆìŠµ?ˆë‹¤.');
      }

      // === Step 4: ê°?ë¹„ë””???˜ì´ì§€ ë°©ë¬¸?˜ì—¬ ?ì„¸ ?•ë³´ ?˜ì§‘ ===
      for (let i = 0; i < Math.min(videoCards.length, topN); i++) {
        const card = videoCards[i];
        if (progressCallback) {
          const percent = 40 + Math.floor((i / topN) * 50);
          progressCallback('analyzing', percent, `ë¹„ë””??${i + 1}/${topN} ë¶„ì„ ì¤?..`);
        }

        try {
          console.log(`?¬ [${i + 1}/${topN}] Visiting: ${card.videoUrl}`);
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
          console.error(`??Error scraping video ${i + 1}:`, err.message);
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

      if (progressCallback) progressCallback('completed', 100, '?„ë£Œ');
      return results;

    } catch (err) {
      console.error('??Search error:', err.message);
      throw err;
    } finally {
      if (page) {
        try { await page.close(); } catch {}
      }
    }
  }

  /**
   * ê°œë³„ ë¹„ë””???˜ì´ì§€?ì„œ ?ì„¸ ?•ë³´ ?¤í¬?˜í•‘
   */
  async scrapeVideoDetail(page, videoUrl) {
    await page.goto(videoUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 20000 
    });
    await this.randomDelay(2000, 4000);

    // ë¨¼ì? embedded JSON?ì„œ ?œë„
    const jsonData = await this.extractVideoFromJSON(page);
    if (jsonData) return jsonData;

    // DOM?ì„œ ì§ì ‘ ì¶”ì¶œ
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
   * __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON?ì„œ ë¹„ë””???°ì´??ì¶”ì¶œ
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
        console.log(`  ??Extracted from JSON: @${data.creatorId}`);
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * ê²€??ê²°ê³¼ ?˜ì´ì§€??embedded JSON?ì„œ ?°ì´??ì¶”ì¶œ (fallback)
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
        console.log(`??Extracted ${results.length} videos from embedded JSON`);
      }
      return results;
    } catch {
      return [];
    }
  }

  /**
   * ë¸Œë¼?°ì? ì¢…ë£Œ
   */
  async close() {
    if (this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
    }
  }
}

module.exports = TikTokScraper;
