/**
 * TikTok 로그인 세션 저장 스크립트
 * 
 * 1. Chrome 프로필 복사본으로 브라우저 열기
 * 2. TikTok 로그인 페이지로 이동
 * 3. 수동으로 구글 계정 로그인
 * 4. 로그인 완료 후 Enter 누르면 세션 저장 & 종료
 */
const { chromium } = require('playwright');
const readline = require('readline');

async function loginAndSave() {
  console.log('🚀 TikTok 로그인 세션 저장을 시작합니다...');
  console.log('');

  const browser = await chromium.launchPersistentContext(
    'C:\\EV-System\\chrome-tiktok-profile',
    {
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
      ],
      viewport: { width: 1280, height: 900 },
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    }
  );

  const page = browser.pages()[0] || await browser.newPage();

  // TikTok 로그인 페이지로 이동
  await page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded' });

  console.log('');
  console.log('='.repeat(50));
  console.log('📋 브라우저에서 다음 단계를 수행하세요:');
  console.log('');
  console.log('  1. "Google로 계속하기" 클릭');
  console.log('  2. jitae1028@gmail.com 계정으로 로그인');
  console.log('  3. 로그인 완료 후 TikTok 홈으로 돌아오면');
  console.log('  4. 이 터미널에서 Enter 키를 누르세요');
  console.log('='.repeat(50));
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  await new Promise(resolve => {
    rl.question('✅ 로그인 완료 후 Enter 키를 누르세요... ', () => {
      rl.close();
      resolve();
    });
  });

  // 로그인 확인
  const url = page.url();
  console.log(`현재 URL: ${url}`);

  // 동영상 탭 테스트
  console.log('\n🔍 동영상 탭 테스트...');
  await page.goto('https://www.tiktok.com/search/video?q=ABIB', {
    waitUntil: 'domcontentloaded',
  });
  await new Promise(r => setTimeout(r, 5000));

  const videoCount = await page.evaluate(() => {
    return document.querySelectorAll('a[href*="/video/"]').length;
  });
  console.log(`📊 비디오 링크 수: ${videoCount}`);

  // 스크롤 테스트
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 1000));
    await new Promise(r => setTimeout(r, 2000));
  }

  const videoCountAfterScroll = await page.evaluate(() => {
    return document.querySelectorAll('a[href*="/video/"]').length;
  });
  console.log(`📊 스크롤 후 비디오 링크 수: ${videoCountAfterScroll}`);

  console.log('\n✅ 세션이 Chrome 프로필에 저장되었습니다!');
  console.log('이제 스크래퍼가 로그인된 상태로 동작합니다.');

  await browser.close();
}

loginAndSave().catch(console.error);
