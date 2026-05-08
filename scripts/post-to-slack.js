'use strict';

/**
 * PNG を Slack にアップロードしてチャンネルに共有する。
 *
 * 環境変数:
 *   SLACK_BOT_TOKEN — Bot User OAuth Token (xoxb-...)
 *   SLACK_CHANNEL   — チャンネル ID (C...) または名前（#なし）
 *
 * 任意:
 *   SCREENSHOT_PATH — 画像パスの基準値（既定: /tmp/health-dashboard.png）
 *                    -status / -details の2枚があれば両方投稿
 *   SCREENSHOT_PATHS — カンマ区切りで明示した画像パス（任意）
 *   DASHBOARD_URL   — メッセージ内リンク用（未設定時は SCREENSHOT_URL または SURGE_DOMAIN から推定）
 *   SLACK_TITLE     — アップロードファイルのタイトル
 *
 * コマンドライン:
 *   node scripts/post-to-slack.js [画像パス...]
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL;

const defaultImagePath =
  (process.env.SCREENSHOT_PATH && String(process.env.SCREENSHOT_PATH).trim()) ||
  path.join('/tmp', 'health-dashboard.png');

function splitOutputPaths(basePath) {
  const dir = path.dirname(basePath);
  const ext = path.extname(basePath) || '.png';
  const base = path.basename(basePath, ext);
  return [
    path.join(dir, base + '-status' + ext),
    path.join(dir, base + '-details' + ext),
  ];
}

function resolveImagePaths() {
  const args = process.argv.slice(2).map((p) => p.trim()).filter(Boolean);
  if (args.length > 0) return args;

  if (process.env.SCREENSHOT_PATHS && String(process.env.SCREENSHOT_PATHS).trim()) {
    return String(process.env.SCREENSHOT_PATHS)
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  }

  const splitPaths = splitOutputPaths(defaultImagePath);
  if (splitPaths.every((p) => fs.existsSync(p))) return splitPaths;
  return [defaultImagePath];
}

const imagePaths = resolveImagePaths();

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

const missingImagePath = imagePaths.find((imagePath) => !fs.existsSync(imagePath));
if (missingImagePath) {
  console.error('エラー: 画像が見つかりません: ' + missingImagePath);
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

  const baseTitle =
    process.env.SLACK_TITLE && String(process.env.SLACK_TITLE).trim()
      ? String(process.env.SLACK_TITLE).trim()
      : '心身健康ダッシュボード (' + now + ')';

  console.log('チャンネル ID を解決中…');
  const channelId = await resolveChannelId(SLACK_CHANNEL);
  console.log('チャンネル: ' + channelId);

  const linkLine = dashboardUrl
    ? '<' + dashboardUrl + '|ダッシュボードを開く>'
    : '（公開 URL 未設定）';

  const uploadedFiles = [];
  for (const [index, imagePath] of imagePaths.entries()) {
    const fileBuffer = fs.readFileSync(imagePath);
    const fileSize = fs.statSync(imagePath).size;
    const filename = path.basename(imagePath) || 'dashboard.png';
    const titleSuffix = imagePaths.length === 1
      ? ''
      : index === 0
        ? ' 1/2 心身ステータス'
        : ' 2/2 詳細ダッシュボード';

    console.log('Slack へアップロード URL 取得: ' + filename);
    const urlRes = await axios.post(
      'https://slack.com/api/files.getUploadURLExternal',
      new URLSearchParams({ filename, length: String(fileSize) }),
      { headers: { Authorization: 'Bearer ' + SLACK_BOT_TOKEN } }
    );
    if (!urlRes.data.ok) throw new Error('Slack API: ' + urlRes.data.error);

    console.log('Slack へ画像アップロード: ' + filename);
    await axios.post(urlRes.data.upload_url, fileBuffer, {
      headers: { 'Content-Type': 'image/png' },
    });

    uploadedFiles.push({ id: urlRes.data.file_id, title: baseTitle + titleSuffix });
  }

  console.log('Slack へ共有 …');
  const completeRes = await axios.post(
    'https://slack.com/api/files.completeUploadExternal',
    {
      files: uploadedFiles,
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
