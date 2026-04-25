'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

const DASHBOARD_URL = 'https://thunderous-sundae-fc5e45.netlify.app';
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL;

if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL) {
  console.error('Error: SLACK_BOT_TOKEN and SLACK_CHANNEL environment variables are required.');
  process.exit(1);
}

async function takeScreenshot() {
  console.log('Launching browser...');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // max-w-6xl (1152px) + スクロールバー分を考慮したビューポート幅
  await page.setViewportSize({ width: 1200, height: 900 });

  console.log(`Navigating to ${DASHBOARD_URL} ...`);
  await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // スプレッドシートからのデータ読み込み完了を待つ
  // "読み込み中..." のテキストが消えるまで待機（最大15秒）
  try {
    await page.waitForFunction(
      () => !document.body.innerText.includes('読み込み中...'),
      { timeout: 15000 }
    );
  } catch {
    console.warn('Warning: Some data may still be loading, proceeding with screenshot.');
  }

  // Chart.js のアニメーション完了を待つ
  await page.waitForTimeout(2000);

  const screenshotPath = path.join('/tmp', 'dashboard.png');

  // ページ全体の高さに合わせてビューポートを拡張してから撮影
  const pageHeight = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: 1200, height: pageHeight });

  // main 要素の x 位置・幅を基準に横方向をクリップ（背景余白を除外）
  const mainBox = await page.locator('main').boundingBox();
  await page.screenshot({
    path: screenshotPath,
    clip: mainBox
      ? { x: mainBox.x, y: 0, width: mainBox.width, height: pageHeight }
      : undefined,
  });
  await browser.close();

  console.log(`Screenshot saved: ${screenshotPath}`);
  return screenshotPath;
}

async function resolveChannelId(nameOrId) {
  // すでに ID 形式（C から始まる）なら変換不要
  if (/^C[A-Z0-9]+$/.test(nameOrId)) return nameOrId;

  const channelName = nameOrId.replace(/^#/, '');
  let cursor;

  do {
    const params = new URLSearchParams({ limit: 200, exclude_archived: true });
    if (cursor) params.set('cursor', cursor);

    const res = await axios.get(`https://slack.com/api/conversations.list?${params}`, {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    });
    if (!res.data.ok) throw new Error(`Slack API error: ${res.data.error}`);

    const found = res.data.channels.find((ch) => ch.name === channelName);
    if (found) return found.id;

    cursor = res.data.response_metadata?.next_cursor;
  } while (cursor);

  throw new Error(`Channel not found: ${nameOrId}`);
}

async function sendToSlack(imagePath) {
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
  const filename = 'dashboard.png';
  const title = `健康・メンタル ダッシュボード (${now})`;

  console.log('Resolving channel ID...');
  const channelId = await resolveChannelId(SLACK_CHANNEL);
  console.log(`Channel ID: ${channelId}`);

  console.log('Step 1/3: Getting upload URL...');
  const urlRes = await axios.post(
    'https://slack.com/api/files.getUploadURLExternal',
    new URLSearchParams({ filename, length: fileSize }),
    { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
  );
  if (!urlRes.data.ok) throw new Error(`Slack API error: ${urlRes.data.error}`);
  const { upload_url, file_id } = urlRes.data;

  console.log('Step 2/3: Uploading file...');
  await axios.post(upload_url, fileBuffer, {
    headers: { 'Content-Type': 'image/png' },
  });

  console.log('Step 3/3: Completing upload and sharing to channel...');
  const completeRes = await axios.post(
    'https://slack.com/api/files.completeUploadExternal',
    {
      files: [{ id: file_id, title }],
      channel_id: channelId,
      initial_comment: `📊 *定時レポート* — ${now}\n<${DASHBOARD_URL}|ダッシュボードを開く>`,
    },
    { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' } }
  );
  if (!completeRes.data.ok) throw new Error(`Slack API error: ${completeRes.data.error}`);

  console.log('Successfully sent to Slack!');
}

(async () => {
  try {
    const imagePath = await takeScreenshot();
    await sendToSlack(imagePath);
  } catch (err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
})();
