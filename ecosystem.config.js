module.exports = {
  apps: [{
    name: 'tiktok-worker',
    script: 'task-worker.js',
    cwd: 'C:\\EV-System\\EV2-Boosting\\ev2-tiktok-analyzer',
    env: {
      DATABASE_URL: 'postgresql://postgres:xZbLSkVneQpofOAVQxSrGgrBAJlZKjeL@caboose.proxy.rlwy.net:21087/railway',
      TELEGRAM_BOT_TOKEN: '8336098140:AAELT3_riGUGMXE3w2nDid-8FHX_vOuXzKk',
      TELEGRAM_CHAT_ID: '35391597',
      DEFAULT_TOP_N: '30'
    }
  }]
}
