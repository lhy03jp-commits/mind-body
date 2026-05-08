'use strict';

/**
 * PNG を Slack にアップロードしてチャンネルに共有する。
 *
 * 環境変数:
 *   SLACK_BOT_TOKEN — Bot User OAuth Token (xoxb-...)
 *   SLACK_CHANNEL   — チャンネル ID (C...) または名前（#なし）
 *
 * 任意:
 *   SCREENSHOT_PATH — 画像パス（既定: /tmp/health-dashboard.png）
 *   DASHBOARD_URL   — メッセージ内リンク用（未設定時は SCREENSHOT_URL または SURGE_DOMAIN から推定）
 *   SLACK_TITLE     — アップロードファイルのタイトル
 *
 * コマンドライン:
 *   node scripts/post-to-slack.js [画像パス]
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL;

const imagePath =
  (process.argv[2] && process.argv[2].trim()) ||
  (process.env.SCREENSHOT_PATH && String(process.env.SCREENSHOT_PATH).trim()) ||
  path.join('/tmp', 'health-dashboard.png');

function resolveDashboardUrl() {
  if (process.env.DASHBOARD_URL && String(process.env.DASHBOARD_URL).trim()) {
    return String(process.env.DASHBOARD_URL).trim();
  }
  if (process.env.SCREENSHOT_URL && String(process.env.SCREENSHOT_URL).trim()) {
    return String(process.env.SCREENSHOT_URL).trim();
  }
  const d = process.env.SURGE_DOMAIN;
  if (d && String(d).trim()) {
    const clean = String(d).trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    return 'https://' + clean + '/health-status.html';
  }
  return '';
}

if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL) {
  console.error('エラー: SLACK_BOT_TOKEN と SLACK_CHANNEL を .env に設定してください。');
  process.exit(1);
}

if (!fs.existsSync(imagePath)) {
  console.error('エラー: 画像が見つかりません: ' + imagePath);
  process.exit(1);
}

async function resolveChannelId(nameOrId) {
  if (/^C[A-Z0-9]+$/.test(nameOrId)) return nameOrId;

  const channelName = nameOrId.replace(/^#/, '');
  let cursor;

  do {
    const params = new URLSearchParams({ limit: 200, exclude_archived: true });
    if (cursor) params.set('cursor', cursor);

    const res = await axios.get('https://slack.com/api/conversations.list?' + params, {
      headers: { Authorization: 'Bearer ' + SLACK_BOT_TOKEN },
    });
    if (!res.data.ok) throw new Error('Slack API: ' + res.data.error);

    const found = res.data.channels.find((ch) => ch.name === channelName);
    if (found) return found.id;

    cursor = res.data.response_metadata && res.data.response_metadata.next_cursor;
  } while (cursor);

  throw new Error('チャンネルが見つかりません: ' + nameOrId);
}

async function sendToSlack() {
  const dashboardUrl = resolveDashboardUrl();
  const now = new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const fileBuffer = fs.readFileSync(imagePath);
  const fileSize = fs.statSync(imagePath).size;
  const filename = path.basename(imagePath) || 'dashboard.png';
  const title =
    process.env.SLACK_TITLE && String(process.env.SLACK_TITLE).trim()
      ? String(process.env.SLACK_TITLE).trim()
      : '心身健康ダッシュボード (' + now + ')';

  console.log('チャンネル ID を解決中…');
  const channelId = await resolveChannelId(SLACK_CHANNEL);
  console.log('チャンネル: ' + channelId);

  const linkLine = dashboardUrl
    ? '<' + dashboardUrl + '|ダッシュボードを開く>'
    : '（公開 URL 未設定）';

  console.log('Slack へアップロード 1/3 …');
  const urlRes = await axios.post(
    'https://slack.com/api/files.getUploadURLExternal',
    new URLSearchParams({ filename, length: String(fileSize) }),
    { headers: { Authorization: 'Bearer ' + SLACK_BOT_TOKEN } }
  );
  if (!urlRes.data.ok) throw new Error('Slack API: ' + urlRes.data.error);
  const uploadUrl = urlRes.data.upload_url;
  const fileId = urlRes.data.file_id;

  console.log('Slack へアップロード 2/3 …');
  await axios.post(uploadUrl, fileBuffer, {
    headers: { 'Content-Type': 'image/png' },
  });

  console.log('Slack へアップロード 3/3 …');
  const completeRes = await axios.post(
    'https://slack.com/api/files.completeUploadExternal',
    {
      files: [{ id: fileId, title }],
      channel_id: channelId,
      initial_comment: '📊 *ダッシュボード更新* — ' + now + '\n' + linkLine,
    },
    { headers: { Authorization: 'Bearer ' + SLACK_BOT_TOKEN, 'Content-Type': 'application/json' } }
  );
  if (!completeRes.data.ok) throw new Error('Slack API: ' + completeRes.data.error);

  console.log('✅ Slack に送信しました。');
}

sendToSlack().catch((err) => {
  console.error('エラー:', err.message);
  process.exit(1);
});
