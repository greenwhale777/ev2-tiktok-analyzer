const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_TEAM_CHAT_ID = process.env.TELEGRAM_TEAM_CHAT_ID;

async function sendTelegramMessage(message, { teamOnly = false } = {}) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log('⚠️ Telegram not configured, skipping notification');
    return;
  }

  const chatIds = [];
  if (!teamOnly && TELEGRAM_CHAT_ID) chatIds.push(TELEGRAM_CHAT_ID);
  if (TELEGRAM_TEAM_CHAT_ID) chatIds.push(TELEGRAM_TEAM_CHAT_ID);

  for (const chatId of chatIds) {
    try {
      const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
        })
      });
      const data = await response.json();
      if (!data.ok) console.error(`Telegram error (${chatId}):`, data.description);
    } catch (err) {
      console.error(`Telegram send error (${chatId}):`, err.message);
    }
  }
}

/**
 * TikTok 검색 완료 알림
 */
async function notifySearchComplete(keyword, videoCount, searchId) {
  const msg = `🎵 <b>EV2 TikTok 분석 완료</b>

🔍 키워드: <b>${keyword}</b>
📊 수집 영상: ${videoCount}개
🆔 Search ID: ${searchId}

📎 대시보드에서 확인하세요`;

  await sendTelegramMessage(msg);
}

async function notifySearchFailed(keyword, error) {
  const msg = `❌ <b>EV2 TikTok 분석 실패</b>

🔍 키워드: <b>${keyword}</b>
💥 오류: ${error}`;

  await sendTelegramMessage(msg);
}

module.exports = { sendTelegramMessage, notifySearchComplete, notifySearchFailed };
