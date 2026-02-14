/**
 * TikTok 로그인 세션 저장 스크립트
 * - 일반 Chrome 사용 (봇 감지 회피)
 * - 자동 구글 로그인 (이메일/비밀번호 직접 입력)
 * - 2단계 인증 대기 (최대 120초)
 * - Google OAuth 동의 화면 자동 클릭
 * - One Tap 로그인 지원
 * - 로그인 실패해도 exit(0)으로 종료
 */
require('dotenv').config();
const { chromium } = require('playwright');

const GOOGLE_EMAIL = 'jitae1028@gmail.com';
const GOOGLE_PASSWORD = process.env.GOOGLE_PASSWORD || 'Bqmdq6913!^';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE_PATH = 'C:\\EV-System\\chrome-tiktok-profile-real';

// Google 페이지에서 "계속" 동의 버튼 클릭 시도
async function tryClickConsent(gp) {
  const consentBtns = [
    'button:has-text("계속")',
    'button:has-text("Continue")',
    'button:has-text("Allow")',
    'button:has-text("허용")',
    '#submit_approve_access',
  ];
  for (const sel of consentBtns) {
    try {
      const btn = await gp.$(sel);
      if (btn && await btn.isVisible()) {
        console.log('   ✅ OAuth 동의 버튼 클릭: ' + sel);
        await btn.click();
        return true;
      }
    } catch { continue; }
  }
  return false;
}

async function loginAndSave() {
  console.log('🚀 TikTok 로그인 체크 시작...');

  let browser;
  try {
    browser = await chromium.launchPersistentContext(PROFILE_PATH, {
      executablePath: CHROME_PATH,
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
      ],
      viewport: { width: 1280, height: 900 },
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
  } catch (err) {
    console.log('⚠️ 브라우저 실행 실패: ' + err.message);
    console.log('   로그인 없이 스크래핑을 진행합니다.');
    process.exit(0);
  }

  const page = browser.pages()[0] || await browser.newPage();

  try {
    // === 1. 로그인 상태 확인 ===
    console.log('📌 TikTok 로그인 상태 확인...');
    await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    console.log('   📍 현재 URL: ' + currentUrl);

    // One Tap 로그인 팝업 확인 ("상우 계정으로 계속")
    try {
      const oneTapBtns = [
        'button:has-text("계정으로 계속")',
        'button:has-text("Continue as")',
        '[id*="credential_picker"] button',
      ];
      for (const sel of oneTapBtns) {
        const btn = await page.$(sel);
        if (btn && await btn.isVisible()) {
          console.log('   ✅ One Tap 로그인 발견 - 클릭!');
          await btn.click();
          await page.waitForTimeout(5000);
          console.log('✅ One Tap 로그인 성공!');
          await browser.close();
          process.exit(0);
        }
      }
    } catch {}

    const loginBtnVisible = await page.$('a[href*="/login"], button:has-text("로그인")');
    const isLoggedIn = currentUrl.includes('foryou') && !loginBtnVisible;

    if (isLoggedIn) {
      console.log('✅ 이미 로그인되어 있습니다!');
      await browser.close();
      process.exit(0);
    }

    console.log('🔓 로그인 필요 - 자동 구글 로그인 시도...');

    // === 2. TikTok 로그인 페이지 이동 ===
    await page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);
    console.log('   📍 로그인 페이지 URL: ' + page.url());

    // === 3. Google 로그인 버튼 클릭 ===
    console.log('   1️⃣ Google 로그인 버튼 찾는 중...');

    let googleClicked = false;

    const googleTexts = ['Google로 계속 진행', 'Google로 계속하기', 'Continue with Google', 'Google'];
    for (const text of googleTexts) {
      try {
        const elements = await page.$$('text="' + text + '"');
        for (const el of elements) {
          if (await el.isVisible()) {
            console.log('   ✅ Google 버튼 발견 (텍스트: "' + text + '")');
            await el.click();
            googleClicked = true;
            break;
          }
        }
        if (googleClicked) break;
      } catch { continue; }
    }

    if (!googleClicked) {
      const selectors = [
        'div[class*="channel-item"]:has-text("Google")',
        'a:has-text("Google")',
        'button:has-text("Google")',
      ];
      for (const selector of selectors) {
        try {
          const btn = await page.$(selector);
          if (btn && await btn.isVisible()) {
            console.log('   ✅ Google 버튼 발견 (셀렉터: ' + selector + ')');
            await btn.click();
            googleClicked = true;
            break;
          }
        } catch { continue; }
      }
    }

    if (!googleClicked) {
      console.log('   ❌ Google 버튼을 찾지 못했습니다.');
      console.log('   로그인 없이 스크래핑을 진행합니다.');
      await browser.close();
      process.exit(0);
    }

    // Google 페이지 로딩 대기
    console.log('   ⏳ Google 로그인 페이지 대기...');
    await page.waitForTimeout(5000);

    // === 4. Google 계정 선택 / 이메일 입력 ===
    let googlePage = page;
    const allPages = browser.pages();
    for (const p of allPages) {
      if (p.url().includes('accounts.google.com')) {
        googlePage = p;
        break;
      }
    }

    const gUrl = googlePage.url();
    console.log('   2️⃣ Google 계정 페이지 처리 중...');
    console.log('   📍 URL: ' + gUrl.substring(0, 80) + '...');

    if (gUrl.includes('accounts.google.com')) {
      await googlePage.waitForTimeout(2000);

      // 이메일 입력 필드 확인
      const emailInput = await googlePage.$('input[type="email"]');

      if (emailInput && await emailInput.isVisible()) {
        console.log('   📧 이메일 입력 필드 발견 - 직접 입력...');
        await emailInput.fill(GOOGLE_EMAIL);
        await googlePage.waitForTimeout(1000);

        const nextBtns = ['#identifierNext', 'button:has-text("다음")', 'button:has-text("Next")'];
        for (const sel of nextBtns) {
          try {
            const btn = await googlePage.$(sel);
            if (btn && await btn.isVisible()) {
              console.log('   ✅ 다음 버튼 클릭: ' + sel);
              await btn.click();
              await googlePage.waitForTimeout(4000);
              break;
            }
          } catch { continue; }
        }
      } else {
        // 계정 선택 화면
        console.log('   👤 계정 선택 화면...');
        let selected = false;

        const accountSelectors = [
          'div[data-email="' + GOOGLE_EMAIL + '"]',
          'div[data-identifier="' + GOOGLE_EMAIL + '"]',
        ];
        for (const sel of accountSelectors) {
          try {
            const el = await googlePage.$(sel);
            if (el && await el.isVisible()) {
              console.log('   ✅ 계정 선택: ' + GOOGLE_EMAIL);
              await el.click();
              await googlePage.waitForTimeout(4000);
              selected = true;
              break;
            }
          } catch { continue; }
        }

        if (!selected) {
          try {
            const emailEl = await googlePage.$('text="' + GOOGLE_EMAIL + '"');
            if (emailEl && await emailEl.isVisible()) {
              console.log('   ✅ 이메일 텍스트로 계정 선택');
              await emailEl.click();
              await googlePage.waitForTimeout(4000);
              selected = true;
            }
          } catch {}
        }

        if (!selected) {
          console.log('   ⚠️ 계정 목록에 없음 - "다른 계정 사용" 시도...');
          try {
            const useAnother = await googlePage.$('text="다른 계정 사용"') || await googlePage.$('text="Use another account"');
            if (useAnother && await useAnother.isVisible()) {
              await useAnother.click();
              await googlePage.waitForTimeout(3000);
            }
          } catch {}

          const emailInput2 = await googlePage.$('input[type="email"]');
          if (emailInput2 && await emailInput2.isVisible()) {
            console.log('   📧 이메일 입력...');
            await emailInput2.fill(GOOGLE_EMAIL);
            await googlePage.waitForTimeout(1000);
            const nextBtns = ['#identifierNext', 'button:has-text("다음")', 'button:has-text("Next")'];
            for (const sel of nextBtns) {
              try {
                const btn = await googlePage.$(sel);
                if (btn && await btn.isVisible()) {
                  await btn.click();
                  await googlePage.waitForTimeout(4000);
                  break;
                }
              } catch { continue; }
            }
          }
        }
      }

      // === 5. 동의 화면 또는 비밀번호 판별 ===
      await googlePage.waitForTimeout(2000);

      console.log('   3️⃣ 다음 단계 확인...');
      const consentClicked = await tryClickConsent(googlePage);

      if (consentClicked) {
        console.log('   ✅ 동의 화면 처리 완료! (비밀번호 불필요)');
        await page.waitForTimeout(5000);
      } else {
        // 비밀번호 입력 시도
        console.log('   🔑 비밀번호 입력 시도...');
        const pwUrl = googlePage.url();
        console.log('   📍 현재 URL: ' + pwUrl.substring(0, 80) + '...');

        if (pwUrl.includes('accounts.google.com')) {
          const pwSelectors = [
            'input[type="password"]',
            'input[name="Passwd"]',
            'input[aria-label="비밀번호 입력"]',
            'input[aria-label="Enter your password"]',
          ];

          let pwEntered = false;
          for (const sel of pwSelectors) {
            try {
              await googlePage.waitForSelector(sel, { timeout: 10000 });
              const pwInput = await googlePage.$(sel);
              if (pwInput && await pwInput.isVisible()) {
                console.log('   ✅ 비밀번호 입력 필드 발견: ' + sel);
                await pwInput.fill(GOOGLE_PASSWORD);
                await googlePage.waitForTimeout(1000);

                const nextBtns = ['#passwordNext', 'button:has-text("다음")', 'button:has-text("Next")', 'button[type="submit"]'];
                for (const btnSel of nextBtns) {
                  try {
                    const btn = await googlePage.$(btnSel);
                    if (btn && await btn.isVisible()) {
                      console.log('   ✅ 비밀번호 다음 버튼 클릭: ' + btnSel);
                      await btn.click();
                      await googlePage.waitForTimeout(5000);
                      break;
                    }
                  } catch { continue; }
                }
                pwEntered = true;
                break;
              }
            } catch { continue; }
          }

          if (!pwEntered) {
            console.log('   ⚠️ 비밀번호 입력 필드를 찾지 못했습니다.');
          }

          // === 6. 2단계 인증 대기 ===
          try {
            const afterPwUrl = googlePage.url();
            if (afterPwUrl.includes('accounts.google.com')) {
              console.log('   4️⃣ 2단계 인증 대기 중... (최대 120초)');
              console.log('   📱 모바일에서 인증을 완료해주세요!');

              const maxWait = 120000;
              let waited = 0;
              while (waited < maxWait) {
                await googlePage.waitForTimeout(3000);
                waited += 3000;

                let curUrl;
                try {
                  curUrl = googlePage.url();
                } catch {
                  console.log('   ✅ Google 팝업 닫힘 - 로그인 완료!');
                  break;
                }

                if (!curUrl.includes('accounts.google.com')) {
                  console.log('   ✅ 2단계 인증 완료!');
                  break;
                }

                const mainUrl = page.url();
                if (mainUrl.includes('tiktok.com') && !mainUrl.includes('login')) {
                  console.log('   ✅ TikTok으로 리다이렉트 완료!');
                  break;
                }

                const consent = await tryClickConsent(googlePage);
                if (consent) {
                  console.log('   ⏳ 동의 후 리다이렉트 대기...');
                  await page.waitForTimeout(5000);
                  break;
                }

                console.log('   ⏳ 대기 중... (' + (waited / 1000) + '초)');
              }
            }
          } catch {
            console.log('   ✅ Google 팝업 닫힘 - 인증 완료로 추정');
          }
        }
      }
    }

    // === 7. 남은 Google 페이지 동의 버튼 클릭 ===
    try {
      const remainingPages = browser.pages();
      for (const gp of remainingPages) {
        try {
          if (gp.url().includes('accounts.google.com')) {
            await gp.waitForTimeout(2000);
            console.log('   5️⃣ 남은 Google 페이지에서 동의 버튼 확인...');
            await tryClickConsent(gp);
            await page.waitForTimeout(5000);
          }
        } catch {}
      }
    } catch {}

    // === 8. 최종 로그인 확인 ===
    await page.waitForTimeout(3000);

    try {
      if (!page.url().includes('tiktok.com')) {
        await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(3000);
      }
    } catch {}

    let finalUrl;
    try {
      finalUrl = page.url();
    } catch {
      finalUrl = 'unknown';
    }
    console.log('   📍 최종 URL: ' + finalUrl);

    if (finalUrl.includes('tiktok.com') && !finalUrl.includes('login')) {
      console.log('✅ TikTok 로그인 성공! 세션 저장됨.');
    } else {
      console.log('⚠️ 로그인 실패했지만, 로그인 없이 스크래핑을 진행합니다.');
    }

  } catch (err) {
    console.log('⚠️ 로그인 과정 오류: ' + err.message);
    console.log('   로그인 없이 스크래핑을 진행합니다.');
  } finally {
    try { await browser.close(); } catch {}
  }
}

loginAndSave().then(function() {
  process.exit(0);
}).catch(function(err) {
  console.error('⚠️ 로그인 스크립트 오류: ' + err.message);
  console.log('   로그인 없이 스크래핑을 진행합니다.');
  process.exit(0);
});
