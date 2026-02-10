/**
 * TikTok 동영상 탭 접근 테스트 2
 * 방법: 인기 탭 먼저 로딩 → 동영상 탭 클릭 → DOM 확인
 */
require('dotenv').config();
const { chromium } = require('playwright');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function testVideoTab() {
  const keyword = 'ABIB';
  
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1920, height: 1080 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  // === 방법 1: 인기 탭 먼저 로딩 후 동영상 탭 클릭 ===
  console.log('=== 방법 1: 인기 탭 → 동영상 탭 클릭 ===');
  
  await page.goto(`https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 5000));

  // 탭 목록 확인
  const tabs = await page.evaluate(() => {
    const tabElements = document.querySelectorAll('[data-e2e*="search"] a, [class*="TabBar"] a, [class*="tab"] a');
    return Array.from(tabElements).map(el => ({
      text: el.textContent?.trim(),
      href: el.href,
      dataE2e: el.getAttribute('data-e2e'),
    }));
  });
  console.log('탭 목록:', JSON.stringify(tabs, null, 2));

  // "동영상" 탭 클릭 시도
  const videoTabClicked = await page.evaluate(() => {
    // 방법 1: 텍스트로 찾기
    const allLinks = document.querySelectorAll('a');
    for (const link of allLinks) {
      const text = link.textContent?.trim();
      if (text === '동영상' || text === 'Videos' || text === '视频') {
        link.click();
        return { clicked: true, text, href: link.href };
      }
    }
    
    // 방법 2: href에 /search/video 포함
    for (const link of allLinks) {
      if (link.href?.includes('/search/video')) {
        link.click();
        return { clicked: true, text: link.textContent?.trim(), href: link.href };
      }
    }
    
    return { clicked: false };
  });
  
  console.log('동영상 탭 클릭:', JSON.stringify(videoTabClicked));

  if (videoTabClicked.clicked) {
    // 클릭 후 로딩 대기
    await new Promise(r => setTimeout(r, 8000));

    // 스크롤
    await page.evaluate(() => window.scrollBy(0, 800));
    await new Promise(r => setTimeout(r, 3000));

    const result = await page.evaluate(() => {
      return {
        url: window.location.href,
        videoLinks: document.querySelectorAll('a[href*="/video/"]').length,
        itemContainers: document.querySelectorAll('[class*="DivItemContainerV2"]').length,
        searchCardDesc: document.querySelectorAll('[data-e2e="search-card-desc"]').length,
        searchCardUserId: document.querySelectorAll('[data-e2e="search-card-user-unique-id"]').length,
        dataE2eList: [...new Set(Array.from(document.querySelectorAll('[data-e2e]')).map(el => el.getAttribute('data-e2e')))],
        firstVideoUrls: Array.from(document.querySelectorAll('a[href*="/video/"]')).slice(0, 5).map(a => a.href),
        // 동영상 탭 전용 셀렉터 추가 탐색
        searchVideoList: document.querySelectorAll('[data-e2e="search_video-item-list"]').length,
        searchVideoItem: document.querySelectorAll('[data-e2e="search_video-item"]').length,
        allClassesWithVideo: [...new Set(Array.from(document.querySelectorAll('div[class*="Video"], div[class*="video"], div[class*="Item"]')).map(el => el.className.split(' ')[0]))].slice(0, 20),
      };
    });
    
    console.log('\n📊 동영상 탭 클릭 후 결과:');
    console.log('현재 URL:', result.url);
    console.log('비디오 링크 수:', result.videoLinks);
    console.log('ItemContainerV2:', result.itemContainers);
    console.log('search-card-desc:', result.searchCardDesc);
    console.log('search-card-user-unique-id:', result.searchCardUserId);
    console.log('search_video-item-list:', result.searchVideoList);
    console.log('search_video-item:', result.searchVideoItem);
    console.log('\ndata-e2e 속성:', result.dataE2eList.join(', '));
    console.log('\n첫 5개 비디오:', result.firstVideoUrls);
    console.log('\n비디오 관련 클래스:', result.allClassesWithVideo);
  }

  // === 방법 2: /search/video URL 직접 접근 + 더 긴 대기 ===
  console.log('\n\n=== 방법 2: /search/video 직접 접근 (15초 대기) ===');
  
  await page.goto(`https://www.tiktok.com/search/video?q=${encodeURIComponent(keyword)}`, {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 15000));

  await page.evaluate(() => window.scrollBy(0, 800));
  await new Promise(r => setTimeout(r, 3000));

  const result2 = await page.evaluate(() => {
    return {
      url: window.location.href,
      videoLinks: document.querySelectorAll('a[href*="/video/"]').length,
      itemContainers: document.querySelectorAll('[class*="DivItemContainerV2"]').length,
      searchCardDesc: document.querySelectorAll('[data-e2e="search-card-desc"]').length,
      firstVideoUrls: Array.from(document.querySelectorAll('a[href*="/video/"]')).slice(0, 5).map(a => a.href),
      dataE2eList: [...new Set(Array.from(document.querySelectorAll('[data-e2e]')).map(el => el.getAttribute('data-e2e')))],
    };
  });

  console.log('\n📊 직접 접근 (15초 대기) 결과:');
  console.log('현재 URL:', result2.url);
  console.log('비디오 링크 수:', result2.videoLinks);
  console.log('ItemContainerV2:', result2.itemContainers);
  console.log('search-card-desc:', result2.searchCardDesc);
  console.log('첫 5개 비디오:', result2.firstVideoUrls);
  console.log('data-e2e 속성:', result2.dataE2eList.join(', '));

  // 스크린샷 저장
  await page.screenshot({ path: 'tiktok-video-tab.png', fullPage: false });
  console.log('\n📸 스크린샷 저장: tiktok-video-tab.png');

  await browser.close();
}

testVideoTab().catch(console.error);
