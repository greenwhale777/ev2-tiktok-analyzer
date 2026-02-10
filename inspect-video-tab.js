/**
 * TikTok 동영상 탭 DOM 구조 조사 스크립트
 * 인기 탭과 동영상 탭의 셀렉터 차이를 파악
 */
require('dotenv').config();
const { chromium } = require('playwright');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function inspectPage(url, label) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔍 ${label}`);
  console.log(`🌐 ${url}`);
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
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

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  // 스크롤하여 더 많은 콘텐츠 로딩
  await page.evaluate(() => window.scrollBy(0, 1000));
  await new Promise(r => setTimeout(r, 2000));

  const result = await page.evaluate(() => {
    const info = {};

    // 1. data-e2e 속성이 있는 모든 요소 수집
    const dataE2eElements = document.querySelectorAll('[data-e2e]');
    info.dataE2eAttributes = [...new Set(Array.from(dataE2eElements).map(el => el.getAttribute('data-e2e')))];

    // 2. 비디오 관련 컨테이너 확인
    info.selectors = {
      'search_top-item-list': document.querySelectorAll('[data-e2e="search_top-item-list"]').length,
      'search-common-link': document.querySelectorAll('[data-e2e="search-common-link"]').length,
      'search_video-item-list': document.querySelectorAll('[data-e2e="search_video-item-list"]').length,
      'search-card': document.querySelectorAll('[data-e2e="search-card"]').length,
      'search-card-video': document.querySelectorAll('[data-e2e="search-card-video"]').length,
      'video-container-id': document.querySelectorAll('div[id^="column-item-video-container"]').length,
      'video-links': document.querySelectorAll('a[href*="/video/"]').length,
      'user-card': document.querySelectorAll('[data-e2e="search-user-card"]').length,
      'DivItemContainerV2': document.querySelectorAll('[class*="DivItemContainerV2"]').length,
      'DivVideoItemContainer': document.querySelectorAll('[class*="DivVideoItemContainer"]').length,
      'search-card-desc': document.querySelectorAll('[data-e2e="search-card-desc"]').length,
      'search-card-user-unique-id': document.querySelectorAll('[data-e2e="search-card-user-unique-id"]').length,
    };

    // 3. 비디오 링크 처음 5개 URL
    const videoLinks = document.querySelectorAll('a[href*="/video/"]');
    info.firstVideoUrls = Array.from(videoLinks).slice(0, 5).map(a => a.href);

    // 4. 주요 클래스명 패턴 조사 (비디오 관련)
    const allDivs = document.querySelectorAll('div[class]');
    const videoClasses = new Set();
    allDivs.forEach(div => {
      const cls = div.className;
      if (cls && (cls.includes('Video') || cls.includes('video') || cls.includes('Item') || cls.includes('Card') || cls.includes('Search'))) {
        // 첫 번째 클래스만 추출
        const first = cls.split(' ')[0];
        if (first.length < 80) videoClasses.add(first);
      }
    });
    info.videoRelatedClasses = [...videoClasses].slice(0, 30);

    // 5. __UNIVERSAL_DATA_FOR_REHYDRATION__ 존재 여부 및 키 확인
    const script = document.querySelector('script#__UNIVERSAL_DATA_FOR_REHYDRATION__');
    if (script) {
      try {
        const json = JSON.parse(script.textContent);
        const scope = json['__DEFAULT_SCOPE__'] || {};
        info.universalDataKeys = Object.keys(scope);
        
        // search-detail 데이터 확인
        const searchData = scope['webapp.search-detail'] || {};
        info.searchDetailKeys = Object.keys(searchData);
        
        // itemList 확인
        if (searchData.itemList) {
          info.itemListCount = searchData.itemList.length;
          if (searchData.itemList[0]) {
            info.firstItemKeys = Object.keys(searchData.itemList[0]);
          }
        }
        if (searchData.data) {
          info.dataCount = searchData.data.length;
        }
      } catch(e) {
        info.jsonParseError = e.message;
      }
    } else {
      info.universalData = 'NOT FOUND';
    }

    return info;
  });

  console.log('\n📊 data-e2e 속성 목록:');
  console.log(result.dataE2eAttributes.join(', '));

  console.log('\n📋 셀렉터별 매칭 수:');
  Object.entries(result.selectors).forEach(([k, v]) => {
    console.log(`  ${v > 0 ? '✅' : '❌'} ${k}: ${v}`);
  });

  console.log('\n🎬 첫 5개 비디오 URL:');
  result.firstVideoUrls.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));

  console.log('\n🏷️ 비디오 관련 클래스명:');
  console.log(result.videoRelatedClasses.join('\n  '));

  console.log('\n📦 __UNIVERSAL_DATA__ 정보:');
  if (result.universalDataKeys) {
    console.log('  Keys:', result.universalDataKeys.join(', '));
    console.log('  Search Detail Keys:', result.searchDetailKeys?.join(', '));
    console.log('  itemList Count:', result.itemListCount || 0);
    console.log('  data Count:', result.dataCount || 0);
    if (result.firstItemKeys) console.log('  First Item Keys:', result.firstItemKeys.join(', '));
  } else {
    console.log('  ', result.universalData || result.jsonParseError);
  }

  await browser.close();
  return result;
}

async function main() {
  const keyword = 'ABIB';

  // 인기 탭
  const topResult = await inspectPage(
    `https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`,
    '인기 탭 (현재)'
  );

  // 동영상 탭
  const videoResult = await inspectPage(
    `https://www.tiktok.com/search/video?q=${encodeURIComponent(keyword)}`,
    '동영상 탭 (변경 예정)'
  );

  // 비교
  console.log('\n' + '='.repeat(60));
  console.log('📊 인기 vs 동영상 탭 비교');
  console.log('='.repeat(60));
  
  const allSelectors = new Set([
    ...Object.keys(topResult.selectors),
    ...Object.keys(videoResult.selectors)
  ]);
  
  console.log('\n셀렉터         | 인기 | 동영상');
  console.log('-'.repeat(50));
  allSelectors.forEach(sel => {
    const top = topResult.selectors[sel] || 0;
    const vid = videoResult.selectors[sel] || 0;
    const diff = top !== vid ? ' ⚠️' : '';
    console.log(`${sel.padEnd(35)} | ${String(top).padStart(4)} | ${String(vid).padStart(4)}${diff}`);
  });
}

main().catch(console.error);
