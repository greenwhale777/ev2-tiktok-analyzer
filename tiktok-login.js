/**
 * TikTok 로그인 세션 저장 스크립트 (자동 구글 로그인)
 */
require('dotenv').config();
const { chromium } = require('playwright');

const GOOGLE_EMAIL = 'jitae1028@gmail.com';
const GOOGLE_PASSWORD = process.env.GOOGLE_PASSWORD || 'Bqmdq6913!^';

async function loginAndSave() {
  console.log('🚀 TikTok 자동 로그인 시작...');

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
  console.log('📌 TikTok 로그인 페이지 이동...');
  await page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // 이미 로그인되어 있는지 확인
  const currentUrl = page.url();
  if (currentUrl.includes('foryou') || currentUrl.includes('explore')) {
    console.log('✅ 이미 로그인되어 있습니다!');
  } else {
    console.log('🔓 로그인 필요 - 자동 구글 로그인 시도...');

    // 1단계: "Google로 계속하기" 버튼 클릭
    console.log('   1️⃣ Google 로그인 버튼 찾는 중...');
    const googleSelectors = [
      'div[class*="channel-item"]:has-text("Google")',
      ':has-text("Google로 계속하기")',
      'button:has-text("Google")',
      'a:has-text("Google")',
      '[class*="google"]',
    ];

    let googleClicked = false;
    for (const selector of googleSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn && await btn.isVisible()) {
          console.log(`   ✅ Google 버튼 발견: ${selector}`);
          await btn.click();
          await page.waitForTimeout(3000);
          googleClicked = true;
          break;
        }
      } catch { continue; }
    }

    if (!googleClicked) {
      console.log('   ⚠️ Google 버튼 못 찾음. 수동으로 클릭해주세요.');
      await page.waitForTimeout(15000);
    }

    // 2단계: Google 계정 선택 또는 이메일 입력
    const afterClickUrl = page.url();
    console.log(`   📍 URL: ${afterClickUrl}`);

    if (afterClickUrl.includes('accounts.google.com')) {
      console.log('   2️⃣ Google 계정 페이지 감지...');
      await page.waitForTimeout(2000);

      // 기존 계정 선택 시도
      const accountSelectors = [
        `div[data-email="${GOOGLE_EMAIL}"]`,
        `div[data-identifier="${GOOGLE_EMAIL}"]`,
        `:has-text("${GOOGLE_EMAIL}")`,
      ];

      let accountSelected = false;
      for (const selector of accountSelectors) {
        try {
          const account = await page.$(selector);
          if (account && await account.isVisible()) {
            console.log(`   ✅ 계정 발견: ${GOOGLE_EMAIL}`);
            await account.click();
            await page.waitForTimeout(3000);
            accountSelected = true;
            break;
          }
        } catch { continue; }
      }

      // 계정이 목록에 없으면 이메일 직접 입력
      if (!accountSelected) {
        console.log('   📧 계정 목록에 없음 - 이메일 직접 입력...');
        
        // "다른 계정 사용" 클릭 시도
        try {
          const useAnother = await page.$(':has-text("다른 계정 사용")') || await page.$(':has-text("Use another account")');
          if (useAnother && await useAnother.isVisible()) {
            await useAnother.click();
            await page.waitForTimeout(2000);
          }
        } catch {}

        const emailSelectors = [
          'input[type="email"]',
          'input[name="identifier"]',
          'input[id="identifierId"]',
        ];

        for (const selector of emailSelectors) {
          try {
            const emailInput = await page.$(selector);
            if (emailInput && await emailInput.isVisible()) {
              console.log(`   ✅ 이메일 입력 필드 발견`);
              await emailInput.fill(GOOGLE_EMAIL);
              await page.waitForTimeout(1000);

              // "다음" 버튼 클릭
              const nextBtn = await page.$('#identifierNext') || await page.$('button:has-text("다음")') || await page.$('button:has-text("Next")');
              if (nextBtn) {
                await nextBtn.click();
                await page.waitForTimeout(3000);
              }
              break;
            }
          } catch { continue; }
        }
      }

      // 3단계: 비밀번호 입력
      const passwordPageUrl = page.url();
      if (passwordPageUrl.includes('accounts.google.com')) {
        console.log('   3️⃣ 비밀번호 입력 페이지 감지...');
        await page.waitForTimeout(2000);

        const passwordSelectors = [
          'input[type="password"]',
          'input[name="Passwd"]',
          'input[aria-label="비밀번호 입력"]',
        ];

        for (const selector of passwordSelectors) {
          try {
            const pwInput = await page.$(selector);
            if (pwInput && await pwInput.isVisible()) {
              console.log('   ✅ 비밀번호 입력');
              await pwInput.fill(GOOGLE_PASSWORD);
              await page.waitForTimeout(1000);

              const nextBtnSelectors = [
                '#passwordNext',
                'button:has-text("다음")',
                'button:has-text("Next")',
                'button[type="submit"]',
              ];

              for (const btnSel of nextBtnSelectors) {
                try {
                  const btn = await page.$(btnSel);
                  if (btn && await btn.isVisible()) {
                    await btn.click();
                    await page.waitForTimeout(5000);
                    break;
                  }
                } catch { continue; }
              }
              break;
            }
          } catch { continue; }
        }

        // 4단계: 2단계 인증 대기
        const afterPwUrl = page.url();
        if (afterPwUrl.includes('accounts.google.com')) {
          console.log('   4️⃣ 2단계 인증 대기 중... (최대 60초)');
          console.log('   📱 모바일에서 인증을 완료해주세요!');

          const maxWait = 60000;
          let waited = 0;
          while (waited < maxWait) {
            await page.waitForTimeout(3000);
            waited += 3000;
            const url = page.url();
            if (!url.includes('accounts.google.com')) {
              console.log('   ✅ 2단계 인증 완료!');
              break;
            }
            console.log(`   ⏳ 대기 중... (${waited / 1000}초)`);
          }
        }
      }
    }

    // 로그인 결과 확인
    await page.waitForTimeout(3000);
    const finalUrl = page.url();
    if (finalUrl.includes('tiktok.com') && !finalUrl.includes('login')) {
      console.log('✅ TikTok 로그인 성공!');
    } else {
      console.log('⚠️ 로그인 확인 필요. 현재 URL:', finalUrl);
    }
  }

  // 동영상 탭 테스트
  console.log('\n🔍 동영상 탭 테스트...');
  await page.goto('https://www.tiktok.com/search/video?q=ABIB', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(5000);

  const videoCount = await page.evaluate(() => {
    return document.querySelectorAll('a[href*="/video/"]').length;
  });
  console.log(`📊 비디오 링크 수: ${videoCount}`);

  console.log('\n✅ 세션이 Chrome 프로필에 저장되었습니다!');
  await browser.close();
}

loginAndSave().catch(console.error);
