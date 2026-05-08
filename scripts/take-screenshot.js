'use strict';

/**
 * 公開済みダッシュボードを開き、PNG に保存する。
 *
 * 次のいずれかを設定:
 *   SCREENSHOT_URL — フル URL（例: https://xxx.surge.sh/health-status.html）
 *   または SURGE_DOMAIN — 例: xxx.surge.sh（既定パス /health-status.html を連結）
 *
 *   SCREENSHOT_PATH — 出力ファイルの基準パス（既定: /tmp/health-dashboard.png）
 *                    実際には -status / -details の2枚を出力
 */

require('dotenv').config();

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

function resolveTargetUrl() {
  if (process.env.SCREENSHOT_URL && String(process.env.SCREENSHOT_URL).trim()) {
    return String(process.env.SCREENSHOT_URL).trim();
  }
  const d = process.env.SURGE_DOMAIN;
  if (!d || !String(d).trim()) return null;
  const clean = String(d).trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const suffix = process.env.SCREENSHOT_PATH_SUFFIX || '/health-status.html';
  const pathPart = suffix.startsWith('/') ? suffix : '/' + suffix;
  return 'https://' + clean + pathPart;
}

const targetUrl = resolveTargetUrl();
if (!targetUrl) {
  console.error('エラー: SCREENSHOT_URL または SURGE_DOMAIN を .env に設定してください。');
  process.exit(1);
}

const outPath =
  process.env.SCREENSHOT_PATH && String(process.env.SCREENSHOT_PATH).trim()
    ? String(process.env.SCREENSHOT_PATH).trim()
    : path.join('/tmp', 'health-dashboard.png');

function splitOutputPaths(basePath) {
  const dir = path.dirname(basePath);
  const ext = path.extname(basePath) || '.png';
  const base = path.basename(basePath, ext);
  return {
    status: path.join(dir, base + '-status' + ext),
    details: path.join(dir, base + '-details' + ext),
  };
}

async function main() {
  console.log('ブラウザ起動…');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 900 });

  console.log('読み込み: ' + targetUrl);
  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });

  try {
    await page.waitForFunction(
      () => !document.body.innerText.includes('読み込み中...'),
      { timeout: 20000 }
    );
  } catch {
    console.warn('警告: 読み込み待ちがタイムアウトしました。撮影を続行します。');
  }

  await new Promise((r) => setTimeout(r, 2500));

  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1200, height: Math.min(pageHeight, 16000) });

  const dir = path.dirname(outPath);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const outputPaths = splitOutputPaths(outPath);

  // Slackでは1枚の縦長画像が折りたたまれやすいため、2つの画面を別々に撮影する。
  await page.addStyleTag({ content: '#dual-dashboard-nav{display:none!important;}' });

  const statusSection = page.locator('#health-page-1');
  const detailsSection = page.locator('#page-2-dashboard');
  await statusSection.waitFor({ state: 'visible', timeout: 10000 });
  await detailsSection.waitFor({ state: 'visible', timeout: 10000 });

  await statusSection.screenshot({ path: outputPaths.status });
  await detailsSection.screenshot({ path: outputPaths.details });
  await browser.close();

  console.log('✅ スクリーンショット保存: ' + outputPaths.status);
  console.log('✅ スクリーンショット保存: ' + outputPaths.details);
}

main().catch((err) => {
  console.error('エラー:', err.message);
  process.exit(1);
});
