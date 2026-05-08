'use strict';

/**
 * generate-dashboard.js
 *
 * 使い方:
 *   node scripts/generate-dashboard.js
 *   GEMINI_API_KEY=xxxx node scripts/generate-dashboard.js
 *
 * 処理フロー:
 *   1. GAS から最新レコードを取得
 *   2. calculate-health.js でスコア計算
 *   3. generate-ai-suggestions.js で Gemini 提案生成
 *   4. dist/health-status.html を出力（ページ1: 心身ステータス、ページ2: リポジトリ直下の index-g.html を埋め込み）
 */

require('dotenv').config();

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');

const { calculateHealth }    = require('./calculate-health');
const { generateSuggestions } = require('./generate-ai-suggestions');

// ── GAS エンドポイント ──────────────────────────────────────────
const GAS_URL = process.env.GAS_URL ||
  'https://script.google.com/macros/s/AKfycby8hUANBC74ds35UDnRsmGJZPCGWgsQWjpCCT1g6elexPqu7zgyXTvUZYtvHnjhuANnDA/exec';

const OUTPUT = path.join(__dirname, '..', 'dist', 'health-status.html');
const INDEX_G_PATH = path.join(__dirname, '..', 'index-g.html');

/**
 * index-g.html からページ2用の head アセット・マークアップ・スクリプトを取り出す。
 * @returns {{ headAssets: string, bodyMarkup: string, bodyScript: string } | null}
 */
function loadIndexGParts() {
  if (!fs.existsSync(INDEX_G_PATH)) {
    console.warn('⚠️  index-g.html が見つかりません。ページ2は省略します。');
    return null;
  }
  const raw = fs.readFileSync(INDEX_G_PATH, 'utf8');

  const headAssetsMatch = raw.match(
    /(<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>[\s\S]*?<\/style>\s*)/i
  );
  const headAssets = headAssetsMatch ? headAssetsMatch[1].trim() : '';

  const bodyOpen = raw.match(/<body[^>]*>/i);
  const jsMarker = '<!-- ===== JavaScript ===== -->';
  const markerIdx = raw.indexOf(jsMarker);
  if (!bodyOpen || markerIdx === -1) {
    console.warn('⚠️  index-g.html の構造が想定と異なります。ページ2は省略します。');
    return null;
  }
  const bodyStart = bodyOpen.index + bodyOpen[0].length;
  const bodyMarkup = raw.slice(bodyStart, markerIdx).trim();

  const afterMarker = raw.slice(markerIdx + jsMarker.length);
  const scriptMatch = afterMarker.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/i);
  const bodyScript = scriptMatch ? scriptMatch[1] : '';

  if (!headAssets || !bodyMarkup || !bodyScript) {
    console.warn('⚠️  index-g.html の解析に失敗しました。ページ2は省略します。');
    return null;
  }
  return { headAssets, bodyMarkup, bodyScript };
}

// ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('📡 GAS からデータ取得中…');
  let records = [];
  try {
    const res = await axios.get(GAS_URL, { timeout: 30000 });
    records = res.data?.records ?? [];
  } catch (err) {
    console.warn('⚠️  GAS 取得失敗 (サンプルデータで代替):', err.message);
    records = [SAMPLE_RECORD];
  }

  if (records.length === 0) {
    console.warn('⚠️  レコードが 0 件です。サンプルデータで代替します。');
    records = [SAMPLE_RECORD];
  }

  // 最新レコードを使用
  const latest = records[records.length - 1];
  console.log(`📅 対象日: ${latest['日付'] || '(不明)'}`);

  console.log('🧮 健康スコア計算中…');
  const health = calculateHealth(latest);
  console.log(`   ${health.statusEmoji} ${health.statusLabel}（${health.totalScore}/6）`);
  health.items.forEach(i => console.log(`   ${i.icon} ${i.label}: ${i.score ? '✅' : '❌'} ${i.detail}`));

  console.log('🤖 Gemini で提案生成中…');
  const suggestions = await generateSuggestions(health, latest);
  console.log(`   ${suggestions.length} 件の提案を生成しました`);

  console.log('🏗️  HTML 生成中…');
  const indexGParts = loadIndexGParts();
  const html = buildHtml(health, suggestions, latest, indexGParts);
  fs.writeFileSync(OUTPUT, html, 'utf8');
  console.log(`✅ 出力: ${OUTPUT}`);
}

// ─── HTML 生成 ──────────────────────────────────────────────────

function buildHtml(health, suggestions, record, indexGParts) {
  const date      = record['日付'] || new Date().toISOString().split('T')[0];
  const now       = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const geminiTag = process.env.GEMINI_API_KEY
    ? 'Gemini (model/gemini-2.0-flash) で生成'
    : 'フォールバック提案（Gemini API キー未設定）';

  const statusBg = { green: '#dcfce7', yellow: '#fef9c3', red: '#fee2e2' }[health.status];
  const statusBorder = { green: '#86efac', yellow: '#fde047', red: '#fca5a5' }[health.status];
  const statusColor  = { green: '#16a34a', yellow: '#ca8a04', red: '#dc2626' }[health.status];
  const statusCircleBg = { green: '#22c55e', yellow: '#eab308', red: '#ef4444' }[health.status];

  const itemCardsHtml = health.items.map(item => {
    const bg     = item.score ? '#f0fdf4' : '#fff1f2';
    const border = item.score ? '#86efac' : '#fca5a5';
    const dotClr = item.score ? '#22c55e' : '#ef4444';
    const stLbl  = item.score ? '好調' : '要改善';
    return `
      <div style="
        background:${bg};border:1.5px solid ${border};border-radius:16px;
        padding:20px 18px;display:flex;flex-direction:column;gap:8px;
        transition:transform .15s,box-shadow .15s;
      " onmouseover="this.style.transform='translateY(-3px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,.08)'"
         onmouseout="this.style.transform='';this.style.boxShadow=''">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:1.6rem;line-height:1;">${item.icon}</span>
          <div>
            <div style="font-size:.75rem;color:#64748b;font-weight:500;">${item.label}</div>
            <div style="display:flex;align-items:center;gap:5px;margin-top:2px;">
              <span style="width:10px;height:10px;border-radius:50%;background:${dotClr};display:inline-block;"></span>
              <span style="font-size:.78rem;font-weight:700;color:${dotClr};">${stLbl}</span>
            </div>
          </div>
        </div>
        <div style="font-size:.78rem;color:#475569;margin-top:4px;line-height:1.5;">${escapeHtml(item.detail)}</div>
      </div>`;
  }).join('\n');

  const suggestionsHtml = suggestions.map(s => {
    const pBg   = { high: '#fee2e2', medium: '#fef3c7', low: '#dbeafe' }[s.priority] ?? '#f1f5f9';
    const pClr  = { high: '#dc2626', medium: '#d97706', low: '#2563eb' }[s.priority] ?? '#64748b';
    const pIcon = { high: '🔥', medium: '⚡', low: '💡' }[s.priority] ?? '💡';
    const actionsHtml = s.actions.length > 0
      ? `<ul style="margin:10px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;">
          ${s.actions.map(a => `
            <li style="display:flex;gap:8px;font-size:.82rem;color:#475569;line-height:1.5;">
              <span style="color:#94a3b8;flex-shrink:0;">•</span>
              <span>${escapeHtml(a)}</span>
            </li>`).join('')}
         </ul>`
      : '';
    return `
      <div style="background:#fff;border:1.5px solid #e2e8f0;border-radius:16px;padding:20px 22px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <span style="
            background:${pBg};color:${pClr};
            font-size:.7rem;font-weight:700;
            padding:3px 10px;border-radius:9999px;
          ">${pIcon} 優先度：${s.priorityLabel}</span>
        </div>
        <p style="font-size:.95rem;font-weight:700;color:#1e293b;margin:0 0 8px;">${escapeHtml(s.title)}</p>
        <p style="font-size:.85rem;color:#475569;line-height:1.7;margin:0;">${escapeHtml(s.body)}</p>
        ${actionsHtml}
      </div>`;
  }).join('');

  const page1Block = `
  <div id="health-page-1" class="health-page-1-shell">
  <div class="container">

    <!-- 戻るリンク -->
    <a class="back-link" href="index.html">
      ← メインダッシュボードへ戻る
    </a>

    <!-- ① トータルスコア -->
    <div class="card" style="text-align:center;">
      <div style="
        width:96px;height:96px;border-radius:50%;
        background:${statusCircleBg};
        display:flex;align-items:center;justify-content:center;
        margin:0 auto 16px;
        box-shadow:0 0 0 12px ${statusBg},0 0 0 14px ${statusBorder};
      ">
        <span style="font-size:2rem;font-weight:900;color:#fff;letter-spacing:-.02em;">
          ${{ green: '✓', yellow: '!', red: '✕' }[health.status]}
        </span>
      </div>
      <div style="
        font-size:1.6rem;font-weight:800;
        color:${statusColor};letter-spacing:.04em;margin-bottom:4px;
      ">${health.statusLabel}</div>
      <div style="font-size:.85rem;color:#94a3b8;margin-bottom:16px;">${date} の心身状態</div>
      <div style="
        display:inline-flex;align-items:center;gap:6px;
        background:${statusBg};border:1.5px solid ${statusBorder};
        border-radius:9999px;padding:6px 20px;
      ">
        <span style="font-size:1.15rem;">${health.statusEmoji}</span>
        <span style="font-size:.95rem;font-weight:700;color:${statusColor};">
          トータルスコア ${health.totalScore} / 6
        </span>
      </div>
      <div style="display:flex;justify-content:center;gap:16px;margin-top:16px;font-size:.72rem;color:#94a3b8;">
        <span>🟢 ≥6 好調</span>
        <span>🟡 4〜5 注意</span>
        <span>🔴 ＜4 危険</span>
      </div>
    </div>

    <!-- ② 6項目カード -->
    <div class="card">
      <div style="font-size:.78rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px;">
        各項目のステータス
      </div>
      <div class="grid-6">
        ${itemCardsHtml}
      </div>
    </div>

    <!-- ③ AI からの提案 -->
    <div class="card">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="font-size:1.3rem;">🤖</span>
        <span style="font-size:1rem;font-weight:700;color:#1e293b;">AIからの提案</span>
      </div>
      <div style="font-size:.72rem;color:#94a3b8;margin-bottom:18px;">${geminiTag}</div>
      ${suggestionsHtml}
    </div>

    <!-- フッター -->
    <div style="text-align:center;font-size:.72rem;color:rgba(255,255,255,.55);">
      生成日時: ${now}
    </div>

  </div>
  </div>`;

  if (!indexGParts) {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>心身健康ステータス — ${escapeHtml(date)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Sans+JP:wght@300;400;500;700&display=swap" rel="stylesheet" />
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    body{
      font-family:'Inter','Noto Sans JP',sans-serif;
      background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);
      min-height:100vh;padding:24px 16px 48px;
    }
    .container{max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:20px;}
    .card{background:#fff;border-radius:24px;padding:28px 24px;box-shadow:0 4px 24px rgba(0,0,0,.12);}
    .grid-6{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;}
    @media(min-width:520px){.grid-6{grid-template-columns:repeat(3,1fr);}}
    a.back-link{
      display:inline-flex;align-items:center;gap:6px;
      color:rgba(255,255,255,.85);font-size:.82rem;text-decoration:none;
      margin-bottom:4px;
    }
    a.back-link:hover{color:#fff;}
  </style>
</head>
<body>
${page1Block}
</body>
</html>`;
  }

  const navHtml = `
  <nav id="dual-dashboard-nav" class="dual-dashboard-nav" aria-label="ダッシュボード内ページ">
    <a href="#health-page-1" class="dual-dashboard-nav__link dual-dashboard-nav__link--active">1 心身ステータス</a>
    <a href="#page-2-dashboard" class="dual-dashboard-nav__link">2 詳細ダッシュボード</a>
    <a href="index.html" class="dual-dashboard-nav__link dual-dashboard-nav__link--subtle">← メインへ</a>
  </nav>`;

  const page2Section = `
  <div id="page-2-dashboard" class="page-2-dashboard scroll-mt-14">
    <p class="sr-only" id="page-2-heading">詳細ダッシュボード（index-g 相当）</p>
    ${indexGParts.bodyMarkup}
  </div>`;

  const pageShellCss = `
    *,*::before,*::after{box-sizing:border-box;}
    body{margin:0;font-family:'Inter','Noto Sans JP',sans-serif;background:#f8fafc;}
    .health-page-1-shell{
      background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);
      padding:24px 16px 40px;
      min-height:auto;
    }
    .health-page-1-shell .container{max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:20px;}
    .health-page-1-shell .card{background:#fff;border-radius:24px;padding:28px 24px;box-shadow:0 4px 24px rgba(0,0,0,.12);}
    .health-page-1-shell .grid-6{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;}
    @media(min-width:520px){.health-page-1-shell .grid-6{grid-template-columns:repeat(3,1fr);}}
    .health-page-1-shell a.back-link{
      display:inline-flex;align-items:center;gap:6px;
      color:rgba(255,255,255,.85);font-size:.82rem;text-decoration:none;margin-bottom:4px;
    }
    .health-page-1-shell a.back-link:hover{color:#fff;}
    .dual-dashboard-nav{
      position:sticky;top:0;z-index:40;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;
      padding:10px 12px;background:rgba(255,255,255,.96);border-bottom:1px solid #e2e8f0;backdrop-filter:blur(8px);
    }
    .dual-dashboard-nav__link{
      font-size:.8rem;font-weight:600;color:#0b7dee;text-decoration:none;padding:6px 12px;border-radius:9999px;border:1px solid transparent;
    }
    .dual-dashboard-nav__link:hover{background:#e0efff;}
    .dual-dashboard-nav__link--active{background:#e0efff;border-color:#b9daff;}
    .dual-dashboard-nav__link--subtle{color:#64748b;font-weight:500;}
    .page-2-dashboard{border-top:3px solid #e2e8f8;}
  `;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>心身健康ステータス &amp; 詳細 — ${escapeHtml(date)}</title>
  ${indexGParts.headAssets}
  <style>${pageShellCss}</style>
</head>
<body>
${navHtml}
${page1Block}
${page2Section}
<script>
${indexGParts.bodyScript}
</script>
</body>
</html>`;
}

// ─── ユーティリティ ──────────────────────────────────────────────

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── サンプルデータ（GAS 取得失敗時のフォールバック） ───────────

const SAMPLE_RECORD = {
  '日付': new Date().toISOString().split('T')[0],
  '気分スコア': '2',
  '気分絵文字': '😞',
  '気分タグ': '疲れ, やる気なし',
  '気分メモ': '今日は特に疲れを感じた',
  '睡眠時間(h)': '4.5',
  '就寝時刻': '01:30',
  '睡眠の質': '2',
  '睡眠タグ': '途中覚醒',
  '仕事スコア': '3',
  '会議数': '4',
  'タスク数': '8',
  '仕事タグ': '多忙',
  '仕事メモ': '締め切りが近くてプレッシャー',
  '体重(kg)': '65.2',
  '体脂肪率(%)': '18.5',
  '身長(cm)': '170',
  '体重メモ': '',
  '運動内容': '',
  '運動合計時間(分)': '0',
  '運動メモ': '',
  'AI学習内容': '',
  'AI学習メモ': '',
  'Good & New': '',
  '感謝日記': '',
  '記録日時': new Date().toLocaleString('ja-JP'),
};

main().catch(err => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
