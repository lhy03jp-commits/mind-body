'use strict';

/**
 * dist/ を Surge.sh に公開する。
 *
 * 必要な環境変数（.env）:
 *   SURGE_DOMAIN  — 例: my-dashboard.surge.sh
 *   SURGE_LOGIN   — Surge アカウントのメール（初回・CI 用）
 *   SURGE_TOKEN   — `npx surge token` で発行したトークン（非対話デプロイ用）
 */

require('dotenv').config();

const { spawnSync } = require('child_process');
const path = require('path');

const domainRaw = process.env.SURGE_DOMAIN;
if (!domainRaw || !String(domainRaw).trim()) {
  console.error('エラー: SURGE_DOMAIN を .env に設定してください（例: my-dashboard.surge.sh）');
  process.exit(1);
}

const domain = String(domainRaw)
  .trim()
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');

const distDir = path.join(__dirname, '..', 'dist');
const surgeBin = path.join(__dirname, '..', 'node_modules', '.bin', 'surge');

const result = spawnSync(surgeBin, [distDir, domain], {
  stdio: 'inherit',
  env: process.env,
});

if (result.status !== 0) {
  console.error('Surge デプロイが終了コード ' + result.status + ' で失敗しました。');
  process.exit(result.status || 1);
}

const base = 'https://' + domain;
console.log('\n✅ 公開完了');
console.log('   トップ:     ' + base + '/');
console.log('   ダッシュボード: ' + base + '/health-status.html');
