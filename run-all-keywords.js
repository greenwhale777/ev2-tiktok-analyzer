/**
 * ?„ì²´ ?¤ì›Œ???ë™ ?¤í¬?˜í•‘ ?¤í¬ë¦½íŠ¸
 * 
 * DB???±ë¡??ëª¨ë“  ?œì„± ?¤ì›Œ?œë? ?œì°¨?ìœ¼ë¡??¤í¬?˜í•‘?˜ê³  ê²°ê³¼ë¥?DB???€?? * Windows ?‘ì—… ?¤ì?ì¤„ëŸ¬?ì„œ ë§¤ì¼ ?¤ì „ 10?œì— ?¤í–‰
 * 
 * ?¬ìš©ë²?
 *   node run-all-keywords.js
 *   node run-all-keywords.js 10    (?¤ì›Œ?œë‹¹ ?ìœ„ 10ê°? ê¸°ë³¸ê°?
 */

require('dotenv').config();
const { Pool } = require('pg');
const TikTokScraper = require('./services/scraper');

const topN = parseInt(process.argv[2]) || 30;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('??DATABASE_URL ?˜ê²½ë³€?˜ê? ?¤ì •?˜ì? ?Šì•˜?µë‹ˆ??');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false
});

// ?”ë ˆê·¸ë¨ ?Œë¦¼ (? íƒ)
async function sendTelegram(message) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
    });
  } catch {}
}

// ?´ì „ ê²€??ê²°ê³¼?€ ë¹„êµ ë¶„ì„
async function analyzeChanges(keyword, currentVideos, searchId) {
  try {
    // ì§ì „ ?±ê³µ??ê²€??ì°¾ê¸°
    const prevSearch = await pool.query(
      `SELECT id FROM tiktok_searches 
       WHERE keyword = $1 AND status = 'completed' AND id < $2
       ORDER BY id DESC LIMIT 1`,
      [keyword, searchId]
    );

    if (prevSearch.rows.length === 0) {
      return { isFirst: true, summary: 'ì²?ë²ˆì§¸ ê²€??- ë¹„êµ ?°ì´???†ìŒ' };
    }

    const prevId = prevSearch.rows[0].id;
    const prevVideos = await pool.query(
      `SELECT * FROM tiktok_videos WHERE search_id = $1 ORDER BY rank`,
      [prevId]
    );

    const prevMap = {};
    prevVideos.rows.forEach(v => { prevMap[v.video_url] = v; });

    const currentMap = {};
    currentVideos.forEach(v => { currentMap[v.videoUrl] = v; });

    // ë¶„ì„
    const newEntries = []; // ? ê·œ ì§„ì…
    const exited = [];     // ?´íƒˆ
    const rankChanges = []; // ?œìœ„ ë³€??    const statChanges = []; // ì§€??ê¸‰ë?

    // ? ê·œ ì§„ì… & ?œìœ„/ì§€??ë³€??    currentVideos.forEach(curr => {
      const prev = prevMap[curr.videoUrl];
      if (!prev) {
        newEntries.push({ rank: curr.rank, creatorId: curr.creatorId, url: curr.videoUrl });
      } else {
        // ?œìœ„ ë³€??        const rankDiff = prev.rank - curr.rank;
        if (rankDiff !== 0) {
          rankChanges.push({
            creatorId: curr.creatorId,
            oldRank: prev.rank,
            newRank: curr.rank,
            diff: rankDiff
          });
        }

        // ì¢‹ì•„??ë³€??        const prevLikes = parseInt(prev.likes) || 0;
        const currLikes = parseInt(curr.likes) || 0;
        if (prevLikes > 0 && currLikes > prevLikes * 1.5) {
          statChanges.push({
            creatorId: curr.creatorId,
            metric: 'ì¢‹ì•„??,
            old: prevLikes,
            new: currLikes,
            changePercent: Math.round((currLikes - prevLikes) / prevLikes * 100)
          });
        }

        // ì¡°íšŒ??ë³€??        const prevViews = parseInt(prev.views) || 0;
        const currViews = parseInt(curr.views) || 0;
        if (prevViews > 0 && currViews > prevViews * 1.5) {
          statChanges.push({
            creatorId: curr.creatorId,
            metric: 'ì¡°íšŒ??,
            old: prevViews,
            new: currViews,
            changePercent: Math.round((currViews - prevViews) / prevViews * 100)
          });
        }
      }
    });

    // ?´íƒˆ (?´ì „???ˆì—ˆ?”ë° ?„ì¬ ?†ëŠ” ê²?
    prevVideos.rows.forEach(prev => {
      if (!currentMap[prev.video_url]) {
        exited.push({ rank: prev.rank, creatorId: prev.creator_id, url: prev.video_url });
      }
    });

    const analysis = { isFirst: false, newEntries, exited, rankChanges, statChanges };

    // ë¶„ì„ ê²°ê³¼ë¥?DB???€??    const summary = [];
    if (newEntries.length > 0) summary.push(`?†• ? ê·œ ${newEntries.length}ê±?);
    if (exited.length > 0) summary.push(`?“¤ ?´íƒˆ ${exited.length}ê±?);
    if (rankChanges.length > 0) summary.push(`?“Š ?œìœ„ë³€??${rankChanges.length}ê±?);
    if (statChanges.length > 0) summary.push(`?”¥ ì§€?œê¸‰??${statChanges.length}ê±?);

    analysis.summary = summary.length > 0 ? summary.join(' | ') : 'ë³€???†ìŒ';

    // analysis JSON??searches ?Œì´ë¸”ì— ?€??    await pool.query(
      `ALTER TABLE tiktok_searches ADD COLUMN IF NOT EXISTS analysis JSONB`,
      []
    ).catch(() => {});

    await pool.query(
      `UPDATE tiktok_searches SET analysis = $1 WHERE id = $2`,
      [JSON.stringify(analysis), searchId]
    );

    return analysis;

  } catch (err) {
    console.error('ë¶„ì„ ?¤ë¥˜:', err.message);
    return { isFirst: true, summary: 'ë¶„ì„ ?¤íŒ¨' };
  }
}

async function run() {
  const scraper = new TikTokScraper();
  const startTime = new Date();
  const results = [];

  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`?µ TikTok ?„ì²´ ?¤ì›Œ???ë™ ?¤í¬?˜í•‘`);
    console.log(`?“… ${startTime.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
    console.log(`?“Œ ?¤ì›Œ?œë‹¹ ?ìœ„ ${topN}ê°??˜ì§‘`);
    console.log(`${'='.repeat(60)}\n`);

    // analysis ì»¬ëŸ¼ ì¶”ê? (?†ìœ¼ë©?
    await pool.query(
      `ALTER TABLE tiktok_searches ADD COLUMN IF NOT EXISTS analysis JSONB`
    ).catch(() => {});

    // DB?ì„œ ?œì„± ?¤ì›Œ??ì¡°íšŒ
    const kwResult = await pool.query(
      `SELECT id, keyword FROM tiktok_keywords WHERE is_active = true ORDER BY id`
    );

    if (kwResult.rows.length === 0) {
      console.log('? ï¸ ?±ë¡???œì„± ?¤ì›Œ?œê? ?†ìŠµ?ˆë‹¤.');
      return;
    }

    console.log(`?“‹ ?œì„± ?¤ì›Œ??${kwResult.rows.length}ê°? ${kwResult.rows.map(r => r.keyword).join(', ')}\n`);

    // ê°??¤ì›Œ?œë³„ ?¤í¬?˜í•‘
    for (const kw of kwResult.rows) {
      const kwStart = Date.now();
      console.log(`\n${'?€'.repeat(50)}`);
      console.log(`?” [${kw.keyword}] ?¤í¬?˜í•‘ ?œì‘...`);

      let searchId = null;
      try {
        // ê²€??ê¸°ë¡ ?ì„±
        const searchResult = await pool.query(
          `INSERT INTO tiktok_searches (keyword_id, keyword, status) 
           VALUES ($1, $2, 'running') RETURNING id`,
          [kw.id, kw.keyword]
        );
        searchId = searchResult.rows[0].id;

        // ?¤í¬?˜í•‘ ?¤í–‰
        const videos = await scraper.searchKeyword(kw.keyword, topN, (status, percent, msg) => {
          process.stdout.write(`\r   [${percent}%] ${msg}          `);
        });
        console.log('');

        // DB??ë¹„ë””???€??        for (const video of videos) {
          await pool.query(
            `INSERT INTO tiktok_videos 
             (search_id, rank, video_url, creator_id, creator_name, description, posted_date, likes, comments, bookmarks, shares, views)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [searchId, video.rank, video.videoUrl, video.creatorId, video.creatorName,
             video.description, video.postedDate, video.likes, video.comments,
             video.bookmarks, video.shares, video.views]
          );
        }

        // ê²€???íƒœ ?…ë°?´íŠ¸
        await pool.query(
          `UPDATE tiktok_searches SET status = 'completed', video_count = $1, completed_at = NOW() WHERE id = $2`,
          [videos.length, searchId]
        );

        // ë³€??ë¶„ì„
        const analysis = await analyzeChanges(kw.keyword, videos, searchId);

        const elapsed = ((Date.now() - kwStart) / 1000).toFixed(1);
        console.log(`   ??${videos.length}ê°??˜ì§‘ ?„ë£Œ (${elapsed}ì´?`);
        console.log(`   ?“Š ë¶„ì„: ${analysis.summary}`);

        results.push({
          keyword: kw.keyword,
          count: videos.length,
          status: 'success',
          analysis: analysis.summary,
          elapsed
        });

        // ?¤ì›Œ???…ë°?´íŠ¸ ?œê°„ ê°±ì‹ 
        await pool.query(
          `UPDATE tiktok_keywords SET updated_at = NOW() WHERE id = $1`,
          [kw.id]
        );

        // ?¤ì›Œ??ê°??œë ˆ??(ë´?ê°ì? ë°©ì?)
        if (kwResult.rows.indexOf(kw) < kwResult.rows.length - 1) {
          console.log('   ???¤ìŒ ?¤ì›Œ?œê¹Œì§€ 10ì´??€ê¸?..');
          await new Promise(r => setTimeout(r, 10000));
        }

      } catch (err) {
        console.log(`\n   ???¤íŒ¨: ${err.message}`);
        if (searchId) {
          await pool.query(
            `UPDATE tiktok_searches SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
            [err.message, searchId]
          ).catch(() => {});
        }
        results.push({ keyword: kw.keyword, count: 0, status: 'failed', error: err.message });
      }
    }

    // === ìµœì¢… ë¦¬í¬??===
    const totalTime = ((Date.now() - startTime.getTime()) / 1000).toFixed(1);
    const successCount = results.filter(r => r.status === 'success').length;
    const failCount = results.filter(r => r.status === 'failed').length;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`?“Š ?¤í–‰ ê²°ê³¼ ë¦¬í¬??);
    console.log(`${'='.repeat(60)}`);
    results.forEach(r => {
      const icon = r.status === 'success' ? '?? : '??;
      console.log(`${icon} ${r.keyword}: ${r.count}ê°?${r.status === 'success' ? `(${r.elapsed}ì´? - ${r.analysis}` : `- ${r.error}`}`);
    });
    console.log(`\n?±ï¸ ì´??Œìš”?œê°„: ${totalTime}ì´?| ?±ê³µ: ${successCount} | ?¤íŒ¨: ${failCount}`);

    // ?”ë ˆê·¸ë¨ ?Œë¦¼
    let teleMsg = `?µ <b>TikTok ?ë™ ?¤í¬?˜í•‘ ?„ë£Œ</b>\n`;
    teleMsg += `?“… ${startTime.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n\n`;
    results.forEach(r => {
      const icon = r.status === 'success' ? '?? : '??;
      teleMsg += `${icon} <b>${r.keyword}</b>: ${r.count}ê°?;
      if (r.analysis) teleMsg += ` | ${r.analysis}`;
      if (r.error) teleMsg += ` | ${r.error}`;
      teleMsg += '\n';
    });
    teleMsg += `\n?±ï¸ ${totalTime}ì´?| ?±ê³µ ${successCount} | ?¤íŒ¨ ${failCount}`;
    await sendTelegram(teleMsg);

  } catch (err) {
    console.error(`\n???„ì²´ ?¤ë¥˜: ${err.message}`);
    await sendTelegram(`??TikTok ?ë™ ?¤í¬?˜í•‘ ?¤ë¥˜: ${err.message}`);
  } finally {
    await scraper.close();
    await pool.end();
    console.log('\n?”š ì¢…ë£Œ');
  }
}

run();
