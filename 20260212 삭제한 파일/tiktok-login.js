/**
 * TikTok ë¡œê·¸???¸ì…˜ ?€???¤í¬ë¦½íŠ¸
 * - ?ë™ êµ¬ê? ë¡œê·¸??(?´ë©”??ë¹„ë?ë²ˆí˜¸ ì§ì ‘ ?…ë ¥)
 * - 2?¨ê³„ ?¸ì¦ ?€ê¸?(ìµœë? 120ì´?
 * - ë¡œê·¸???¤íŒ¨?´ë„ exit(0)?¼ë¡œ ì¢…ë£Œ ???¤í¬?˜í•‘?€ ì§„í–‰
 */
require('dotenv').config();
const { chromium } = require('playwright');

const GOOGLE_EMAIL = 'jitae1028@gmail.com';
const GOOGLE_PASSWORD = process.env.GOOGLE_PASSWORD || 'Bqmdq6913!^';

async function loginAndSave() {
  console.log('?? TikTok ë¡œê·¸??ì²´í¬ ?œì‘...');

  let browser;
  try {
    browser = await chromium.launchPersistentContext(
      'C:\\EV-System\\chrome-tiktok-profile-real',
      {
       executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
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
  } catch (err) {
    console.log('? ï¸ ë¸Œë¼?°ì? ?¤í–‰ ?¤íŒ¨:', err.message);
    console.log('   ë¡œê·¸???†ì´ ?¤í¬?˜í•‘??ì§„í–‰?©ë‹ˆ??');
    process.exit(0);
  }

  const page = browser.pages()[0] || await browser.newPage();

  try {
    // === 1. ë¡œê·¸???íƒœ ?•ì¸ ===
    console.log('?“Œ TikTok ë¡œê·¸???íƒœ ?•ì¸...');
    await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    console.log(`   ?“ ?„ì¬ URL: ${currentUrl}`);

    // ë¡œê·¸??ë²„íŠ¼ ì¡´ì¬ ?¬ë?ë¡??ë‹¨
    const loginBtnVisible = await page.$('a[href*="/login"], button:has-text("ë¡œê·¸??)');
    const isLoggedIn = currentUrl.includes('foryou') && !loginBtnVisible;

    if (isLoggedIn) {
      console.log('???´ë? ë¡œê·¸?¸ë˜???ˆìŠµ?ˆë‹¤!');
      await browser.close();
      process.exit(0);
    }

    console.log('?”“ ë¡œê·¸???„ìš” - ?ë™ êµ¬ê? ë¡œê·¸???œë„...\n');

    // === 2. TikTok ë¡œê·¸???˜ì´ì§€ ?´ë™ ===
    await page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);
    console.log(`   ?“ ë¡œê·¸???˜ì´ì§€ URL: ${page.url()}`);

    // === 3. Google ë¡œê·¸??ë²„íŠ¼ ?´ë¦­ ===
    console.log('   1ï¸âƒ£ Google ë¡œê·¸??ë²„íŠ¼ ì°¾ëŠ” ì¤?..');
    
    // ëª¨ë“  ì±„ë„ ?„ì´???ìŠ¤??ì¶œë ¥ (?”ë²„ê¹?
    const channelTexts = await page.evaluate(() => {
      const items = document.querySelectorAll('[class*="channel"], [class*="login"] a, [class*="login"] div[role="link"], [class*="login"] button');
      return Array.from(items).map(el => el.textContent.trim()).filter(t => t.length > 0 && t.length < 50);
    });
    console.log(`   ?“‹ ë¡œê·¸???µì…˜?? ${JSON.stringify(channelTexts)}`);

    let googleClicked = false;

    // ë°©ë²•1: ?ìŠ¤?¸ë¡œ ì°¾ê¸°
    const googleTexts = ['Googleë¡?ê³„ì† ì§„í–‰', 'Googleë¡?ê³„ì†?˜ê¸°', 'Continue with Google', 'Google'];
    for (const text of googleTexts) {
      try {
        const elements = await page.$$(`text="${text}"`);
        for (const el of elements) {
          if (await el.isVisible()) {
            console.log(`   ??Google ë²„íŠ¼ ë°œê²¬ (?ìŠ¤?? "${text}")`);
            await el.click();
            googleClicked = true;
            break;
          }
        }
        if (googleClicked) break;
      } catch { continue; }
    }

    // ë°©ë²•2: ?€?‰í„°ë¡?ì°¾ê¸°
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
            console.log(`   ??Google ë²„íŠ¼ ë°œê²¬ (?€?‰í„°: ${selector})`);
            await btn.click();
            googleClicked = true;
            break;
          }
        } catch { continue; }
      }
    }

    if (!googleClicked) {
      console.log('   ??Google ë²„íŠ¼??ì°¾ì? ëª»í–ˆ?µë‹ˆ??');
      console.log('   ë¡œê·¸???†ì´ ?¤í¬?˜í•‘??ì§„í–‰?©ë‹ˆ??');
      await browser.close();
      process.exit(0);
    }

    // Google ?˜ì´ì§€ ë¡œë”© ?€ê¸?    console.log('   ??Google ë¡œê·¸???˜ì´ì§€ ?€ê¸?..');
    await page.waitForTimeout(5000);

    const googleUrl = page.url();
    console.log(`   ?“ Google URL: ${googleUrl}`);

    if (!googleUrl.includes('accounts.google.com')) {
      // ?ì—… ì°½ìœ¼ë¡??´ë ¸?????ˆìŒ
      const pages = browser.pages();
      console.log(`   ?“‹ ?´ë¦° ?˜ì´ì§€ ?? ${pages.length}`);
      for (let i = 0; i < pages.length; i++) {
        const pUrl = pages[i].url();
        console.log(`   ?“ ?˜ì´ì§€ ${i}: ${pUrl}`);
      }
    }

    // === 4. Google ê³„ì • ? íƒ / ?´ë©”???…ë ¥ ===
    // ?„ì¬ ?˜ì´ì§€ ?ëŠ” ?ì—…?ì„œ Google ë¡œê·¸??ì§„í–‰
    let googlePage = page;
    const allPages = browser.pages();
    for (const p of allPages) {
      if (p.url().includes('accounts.google.com')) {
        googlePage = p;
        break;
      }
    }

    const gUrl = googlePage.url();
    console.log(`\n   2ï¸âƒ£ Google ê³„ì • ?˜ì´ì§€ ì²˜ë¦¬ ì¤?..`);
    console.log(`   ?“ Google ?˜ì´ì§€ URL: ${gUrl}`);

    if (gUrl.includes('accounts.google.com')) {
      await googlePage.waitForTimeout(2000);

      // ?´ë©”???…ë ¥ ?„ë“œ ?•ì¸
      const emailInput = await googlePage.$('input[type="email"]');
      
      if (emailInput && await emailInput.isVisible()) {
        // ?´ë©”??ì§ì ‘ ?…ë ¥
        console.log('   ?“§ ?´ë©”???…ë ¥ ?„ë“œ ë°œê²¬ - ì§ì ‘ ?…ë ¥...');
        await emailInput.fill(GOOGLE_EMAIL);
        await googlePage.waitForTimeout(1000);

        // ?¤ìŒ ë²„íŠ¼
        const nextBtns = ['#identifierNext', 'button:has-text("?¤ìŒ")', 'button:has-text("Next")'];
        for (const sel of nextBtns) {
          try {
            const btn = await googlePage.$(sel);
            if (btn && await btn.isVisible()) {
              console.log(`   ???¤ìŒ ë²„íŠ¼ ?´ë¦­: ${sel}`);
              await btn.click();
              await googlePage.waitForTimeout(4000);
              break;
            }
          } catch { continue; }
        }
      } else {
        // ê³„ì • ? íƒ ?”ë©´
        console.log('   ?‘¤ ê³„ì • ? íƒ ?”ë©´...');
        const accountSelectors = [
          `div[data-email="${GOOGLE_EMAIL}"]`,
          `div[data-identifier="${GOOGLE_EMAIL}"]`,
        ];

        let selected = false;
        for (const sel of accountSelectors) {
          try {
            const el = await googlePage.$(sel);
            if (el && await el.isVisible()) {
              console.log(`   ??ê³„ì • ? íƒ: ${GOOGLE_EMAIL}`);
              await el.click();
              await googlePage.waitForTimeout(4000);
              selected = true;
              break;
            }
          } catch { continue; }
        }

        if (!selected) {
          // ?´ë©”???ìŠ¤?¸ë¡œ ì°¾ê¸°
          try {
            const emailEl = await googlePage.$(`text="${GOOGLE_EMAIL}"`);
            if (emailEl && await emailEl.isVisible()) {
              console.log(`   ???´ë©”???ìŠ¤?¸ë¡œ ê³„ì • ? íƒ`);
              await emailEl.click();
              await googlePage.waitForTimeout(4000);
              selected = true;
            }
          } catch {}
        }

        if (!selected) {
          // "?¤ë¥¸ ê³„ì • ?¬ìš©" ?´ë¦­ ???´ë©”???…ë ¥
          console.log('   ? ï¸ ê³„ì • ëª©ë¡???†ìŒ - "?¤ë¥¸ ê³„ì • ?¬ìš©" ?œë„...');
          try {
            const useAnother = await googlePage.$('text="?¤ë¥¸ ê³„ì • ?¬ìš©"') || await googlePage.$('text="Use another account"');
            if (useAnother && await useAnother.isVisible()) {
              await useAnother.click();
              await googlePage.waitForTimeout(3000);
            }
          } catch {}

          // ?´ë©”???…ë ¥
          const emailInput2 = await googlePage.$('input[type="email"]');
          if (emailInput2 && await emailInput2.isVisible()) {
            console.log('   ?“§ ?´ë©”???…ë ¥...');
            await emailInput2.fill(GOOGLE_EMAIL);
            await googlePage.waitForTimeout(1000);

            const nextBtns = ['#identifierNext', 'button:has-text("?¤ìŒ")', 'button:has-text("Next")'];
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

      // === 5. ë¹„ë?ë²ˆí˜¸ ?…ë ¥ ===
      console.log('\n   3ï¸âƒ£ ë¹„ë?ë²ˆí˜¸ ?…ë ¥ ?œë„...');
      await googlePage.waitForTimeout(2000);

      const pwUrl = googlePage.url();
      console.log(`   ?“ ?„ì¬ URL: ${pwUrl}`);

      if (pwUrl.includes('accounts.google.com')) {
        const pwSelectors = [
          'input[type="password"]',
          'input[name="Passwd"]',
          'input[aria-label="ë¹„ë?ë²ˆí˜¸ ?…ë ¥"]',
          'input[aria-label="Enter your password"]',
        ];

        let pwEntered = false;
        for (const sel of pwSelectors) {
          try {
            // ë¹„ë?ë²ˆí˜¸ ?„ë“œê°€ ?˜í????Œê¹Œì§€ ?€ê¸?            await googlePage.waitForSelector(sel, { timeout: 10000 });
            const pwInput = await googlePage.$(sel);
            if (pwInput && await pwInput.isVisible()) {
              console.log(`   ??ë¹„ë?ë²ˆí˜¸ ?…ë ¥ ?„ë“œ ë°œê²¬: ${sel}`);
              await pwInput.fill(GOOGLE_PASSWORD);
              await googlePage.waitForTimeout(1000);

              // ?¤ìŒ ë²„íŠ¼
              const nextBtns = ['#passwordNext', 'button:has-text("?¤ìŒ")', 'button:has-text("Next")', 'button[type="submit"]'];
              for (const btnSel of nextBtns) {
                try {
                  const btn = await googlePage.$(btnSel);
                  if (btn && await btn.isVisible()) {
                    console.log(`   ??ë¹„ë?ë²ˆí˜¸ ?¤ìŒ ë²„íŠ¼ ?´ë¦­: ${btnSel}`);
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
          console.log('   ? ï¸ ë¹„ë?ë²ˆí˜¸ ?…ë ¥ ?„ë“œë¥?ì°¾ì? ëª»í–ˆ?µë‹ˆ??');
        }

        // === 6. 2?¨ê³„ ?¸ì¦ ?€ê¸?===
        const afterPwUrl = googlePage.url();
        if (afterPwUrl.includes('accounts.google.com')) {
          console.log('\n   4ï¸âƒ£ 2?¨ê³„ ?¸ì¦ ?€ê¸?ì¤?.. (ìµœë? 120ì´?');
          console.log('   ?“± ëª¨ë°”?¼ì—???¸ì¦???„ë£Œ?´ì£¼?¸ìš”!');

          const maxWait = 120000;
          let waited = 0;
          while (waited < maxWait) {
            await googlePage.waitForTimeout(3000);
            waited += 3000;

            // Google ?˜ì´ì§€ë¥?ë²—ì–´?¬ëŠ”ì§€ ?•ì¸
            const curUrl = googlePage.url();
            if (!curUrl.includes('accounts.google.com')) {
              console.log('   ??2?¨ê³„ ?¸ì¦ ?„ë£Œ!');
              break;
            }

            // ë©”ì¸ ?˜ì´ì§€???•ì¸ (ë¦¬ë‹¤?´ë ‰?¸ë  ???ˆìŒ)
            const mainUrl = page.url();
            if (mainUrl.includes('tiktok.com') && !mainUrl.includes('login')) {
              console.log('   ??TikTok?¼ë¡œ ë¦¬ë‹¤?´ë ‰???„ë£Œ!');
              break;
            }

            console.log(`   ???€ê¸?ì¤?.. (${waited / 1000}ì´?`);
          }
        }
      }
    }
    // === 6. Google OAuth ?™ì˜ ?”ë©´ ("ê³„ì†" ë²„íŠ¼ ?´ë¦­) ===
    const allPagesAfterAuth = browser.pages();
    for (const gp of allPagesAfterAuth) {
      if (gp.url().includes('accounts.google.com')) {
        await gp.waitForTimeout(3000);
        console.log('\n   5ï¸âƒ£ Google OAuth ?™ì˜ ?”ë©´ ?•ì¸...');
        console.log(`   ?“ URL: ${gp.url()}`);
        const consentBtns = [
          'button:has-text("ê³„ì†")',
          'button:has-text("Continue")',
          'button:has-text("Allow")',
          'button:has-text("?ˆìš©")',
          '#submit_approve_access',
        ];
        for (const sel of consentBtns) {
          try {
            const btn = await gp.$(sel);
            if (btn && await btn.isVisible()) {
              console.log(`   ???™ì˜ ë²„íŠ¼ ?´ë¦­: ${sel}`);
              await btn.click();
              await gp.waitForTimeout(5000);
              break;
            }
          } catch { continue; }
        }
        break;
      }
    }
    // === 7. ìµœì¢… ë¡œê·¸???•ì¸ ===
    await page.waitForTimeout(3000);
    
    // TikTok?¼ë¡œ ?Œì•„ê°€ê¸?    if (!page.url().includes('tiktok.com')) {
      await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);
    }

    const finalUrl = page.url();
    console.log(`\n   ?“ ìµœì¢… URL: ${finalUrl}`);

    if (finalUrl.includes('tiktok.com') && !finalUrl.includes('login')) {
      console.log('??TikTok ë¡œê·¸???±ê³µ! ?¸ì…˜ ?€?¥ë¨.\n');
    } else {
      console.log('? ï¸ ë¡œê·¸???¤íŒ¨?ˆì?ë§? ë¡œê·¸???†ì´ ?¤í¬?˜í•‘??ì§„í–‰?©ë‹ˆ??\n');
    }

  } catch (err) {
    console.log(`? ï¸ ë¡œê·¸??ê³¼ì • ?¤ë¥˜: ${err.message}`);
    console.log('   ë¡œê·¸???†ì´ ?¤í¬?˜í•‘??ì§„í–‰?©ë‹ˆ??\n');
  } finally {
    await browser.close();
  }
}

loginAndSave().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('? ï¸ ë¡œê·¸???¤í¬ë¦½íŠ¸ ?¤ë¥˜:', err.message);
  console.log('   ë¡œê·¸???†ì´ ?¤í¬?˜í•‘??ì§„í–‰?©ë‹ˆ??');
  process.exit(0);
});
