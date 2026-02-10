/**
 * Chrome 프로필 복사본으로 TikTok 동영상 탭 접근 테스트
 */
require('dotenv').config();
const { chromium } = require('playwright');

async function testWithChromeProfile() {
  const keyword = 'ABIB';

  console.log('🚀 Chrome 프로필 복사본으로 테스트 시작...');

  const browser = await chromium.launchPersistentContext(
    'C:\\EV-System\\chrome-tiktok-profile',
    {
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
      ],
      viewport: { width: 1920, height: 1080 },
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    }
  );

  const page = browser.pages()[0] || await browser.newPage();

  // Step 1: 인기 탭
  console.log('\n📌 Step 1: 인기 탭 로딩...');
  await page.goto(`https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 5000));

  const topResult = await page.evaluate(() => ({
    videoLinks: document.querySelectorAll('a[href*="/video/"]').length,
  }));
  console.log(`✅ 인기 탭: ${topResult.videoLinks}개 비디오 링크`);

  // Step 2: 동영상 탭 클릭
  console.log('\n📌 Step 2: 동영상 탭 클릭...');
  const clicked = await page.evaluate(() => {
    const links = document.querySelectorAll('a');
    for (const link of links) {
      if (link.textContent?.trim() === '동영상' || link.href?.includes('/search/video')) {
        link.click();
        return { success: true, href: link.href, text: link.textContent?.trim() };
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
    firstVideos: Array.from(document.querySelectorAll('a[href*="/video/"]')).slice(0, 5).map(a => a.href),
    hasCaptcha: document.body.innerHTML.includes('captcha') || document.body.innerHTML.includes('퍼즐'),
  }));

  console.log('\n📊 동영상 탭 결과:');
  console.log('URL:', videoResult.url);
  console.log('비디오 링크:', videoResult.videoLinks);
  console.log('CAPTCHA:', videoResult.hasCaptcha);
  console.log('첫 5개:', videoResult.firstVideos);

  // Step 3: 직접 접근
  console.log('\n📌 Step 3: /search/video 직접 접근...');
  await page.goto(`https://www.tiktok.com/search/video?q=${encodeURIComponent(keyword)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 10000));
  await page.evaluate(() => window.scrollBy(0, 800));
  await new Promise(r => setTimeout(r, 3000));

  const directResult = await page.evaluate(() => ({
    url: window.location.href,
    videoLinks: document.querySelectorAll('a[href*="/video/"]').length,
    firstVideos: Array.from(document.querySelectorAll('a[href*="/video/"]')).slice(0, 5).map(a => a.href),
    hasCaptcha: document.body.innerHTML.includes('captcha') || document.body.innerHTML.includes('퍼즐'),
  }));

  console.log('\n📊 직접 접근 결과:');
  console.log('URL:', directResult.url);
  console.log('비디오 링크:', directResult.videoLinks);
  console.log('CAPTCHA:', directResult.hasCaptcha);
  console.log('첫 5개:', directResult.firstVideos);

  await page.screenshot({ path: 'chrome-profile-test.png' });
  console.log('\n📸 스크린샷 저장됨');

  await browser.close();
  console.log('\n✅ 테스트 완료!');
}

testWithChromeProfile().catch(console.error);
