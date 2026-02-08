const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramMessage(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('⚠️ Telegram not configured, skipping notification');
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      })
    });
    const data = await response.json();
    if (!data.ok) console.error('Telegram error:', data.description);
  } catch (err) {
    console.error('Telegram send error:', err.message);
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
