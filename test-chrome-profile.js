/**
 * Chrome 프로필 재사용 테스트
 * 실제 Chrome 쿠키/세션으로 TikTok 동영상 탭 접근
 * 
 * ⚠️ 실행 전 Chrome 브라우저를 완전히 종료해주세요!
 */
require('dotenv').config();
const { chromium } = require('playwright');

async function testWithChromeProfile() {
  const keyword = 'ABIB';
  const chromeUserDataDir = 'C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\User Data';

  console.log('⚠️  Chrome 브라우저가 완전히 종료되어 있어야 합니다!');
  console.log('');

  // 실제 Chrome 프로필로 브라우저 실행
  const browser = await chromium.launchPersistentContext(chromeUserDataDir, {
    headless: false,
    channel: 'chrome',
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
    viewport: { width: 1920, height: 1080 },
  });

  const page = await browser.newPage();

  // === 인기 탭 먼저 ===
  console.log('📌 Step 1: 인기 탭 로딩...');
  await page.goto(`https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 5000));

  const topResult = await page.evaluate(() => ({
    videoLinks: document.querySelectorAll('a[href*="/video/"]').length,
    url: window.location.href,
  }));
  console.log(`✅ 인기 탭: ${topResult.videoLinks}개 비디오 링크`);

  // === 동영상 탭 클릭 ===
  console.log('\n📌 Step 2: 동영상 탭 클릭...');
  const clicked = await page.evaluate(() => {
    const links = document.querySelectorAll('a');
    for (const link of links) {
      if (link.textContent?.trim() === '동영상' || link.href?.includes('/search/video')) {
        link.click();
        return { success: true, href: link.href };
      }
    }
    return { success: false };
  });
  console.log('클릭:', JSON.stringify(clicked));

  await new Promise(r => setTimeout(r, 8000));
  await page.evaluate(() => window.scrollBy(0, 800));
  await new Promise(r => setTimeout(r, 3000));

  const videoResult = await page.evaluate(() => ({
    url: window.location.href,
    videoLinks: document.querySelectorAll('a[href*="/video/"]').length,
    itemContainers: document.querySelectorAll('[class*="DivItemContainerV2"]').length,
    searchCardDesc: document.querySelectorAll('[data-e2e="search-card-desc"]').length,
    userId: document.querySelectorAll('[data-e2e="search-card-user-unique-id"]').length,
    firstVideos: Array.from(document.querySelectorAll('a[href*="/video/"]')).slice(0, 5).map(a => a.href),
    dataE2e: [...new Set(Array.from(document.querySelectorAll('[data-e2e]')).map(el => el.getAttribute('data-e2e')))],
    hasCaptcha: !!document.querySelector('[class*="captcha"], [class*="Captcha"], [id*="captcha"]'),
  }));

  console.log('\n📊 동영상 탭 결과:');
  console.log('URL:', videoResult.url);
  console.log('비디오 링크:', videoResult.videoLinks);
  console.log('ItemContainerV2:', videoResult.itemContainers);
  console.log('search-card-desc:', videoResult.searchCardDesc);
  console.log('CAPTCHA 감지:', videoResult.hasCaptcha);
  console.log('첫 5개:', videoResult.firstVideos);
  console.log('data-e2e:', videoResult.dataE2e.join(', '));

  // === 직접 URL 접근 테스트 ===
  console.log('\n📌 Step 3: /search/video 직접 접근...');
  await page.goto(`https://www.tiktok.com/search/video?q=${encodeURIComponent(keyword)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 8000));
  await page.evaluate(() => window.scrollBy(0, 800));
  await new Promise(r => setTimeout(r, 3000));

  const directResult = await page.evaluate(() => ({
    url: window.location.href,
    videoLinks: document.querySelectorAll('a[href*="/video/"]').length,
    itemContainers: document.querySelectorAll('[class*="DivItemContainerV2"]').length,
    firstVideos: Array.from(document.querySelectorAll('a[href*="/video/"]')).slice(0, 5).map(a => a.href),
    hasCaptcha: !!document.querySelector('[class*="captcha"], [class*="Captcha"], [id*="captcha"]'),
  }));

  console.log('\n📊 직접 접근 결과:');
  console.log('URL:', directResult.url);
  console.log('비디오 링크:', directResult.videoLinks);
  console.log('ItemContainerV2:', directResult.itemContainers);
  console.log('CAPTCHA 감지:', directResult.hasCaptcha);
  console.log('첫 5개:', directResult.firstVideos);

  await page.screenshot({ path: 'chrome-profile-test.png', fullPage: false });
  console.log('\n📸 스크린샷 저장됨');

  await browser.close();
}

testWithChromeProfile().catch(console.error);
