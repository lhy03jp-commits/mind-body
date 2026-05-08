'use strict';

const axios = require('axios');

const GEMINI_MODEL = 'gemini-2.0-flash';

/**
 * Gemini API を呼び出して、健康状態に応じた提案を生成する。
 *
 * @param {{
 *   totalScore: number,
 *   status: string,
 *   statusLabel: string,
 *   items: Array<{key,label,icon,score,detail,adviceLabel}>
 * }} health  - calculateHealth() の戻り値
 * @param {Object} record  - GAS の最新レコード（追加コンテキスト用）
 * @returns {Promise<Array<{
 *   priority: 'high'|'medium'|'low',
 *   priorityLabel: string,
 *   title: string,
 *   body: string,
 *   actions: string[]
 * }>>}
 */
async function generateSuggestions(health, record) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[Gemini] GEMINI_API_KEY が未設定です。フォールバック提案を使用します。');
    return buildFallback(health);
  }

  const prompt = buildPrompt(health, record);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const res = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    }, { timeout: 30000 });

    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const parsed = JSON.parse(text);

    if (!Array.isArray(parsed?.suggestions)) {
      throw new Error('Gemini レスポンスが想定フォーマットではありません');
    }

    return parsed.suggestions.map(s => ({
      priority: s.priority ?? 'low',
      priorityLabel: labelOf(s.priority),
      title: s.title ?? '',
      body: s.body ?? '',
      actions: Array.isArray(s.actions) ? s.actions : [],
    }));
  } catch (err) {
    console.error('[Gemini] API エラー:', err.message);
    return buildFallback(health);
  }
}

// ─── プロンプト生成 ───────────────────────────────────────────────

function buildPrompt(health, record) {
  const date = record['日付'] || new Date().toISOString().split('T')[0];
  const redItems  = health.items.filter(i => i.score === 0).map(i => i.label);
  const goodItems = health.items.filter(i => i.score === 1).map(i => i.label);

  const itemLines = health.items.map(i =>
    `  - ${i.icon} ${i.label}: ${i.score === 1 ? '✅ OK' : '❌ 要改善'} (${i.detail})`
  ).join('\n');

  return `あなたは健康管理のプロフェッショナルです。以下の心身健康データを分析し、JSON形式で改善提案を生成してください。

【対象日】${date}
【総合スコア】${health.totalScore}/6（${health.statusEmoji} ${health.statusLabel}）
【各項目】
${itemLines}

【追加情報】
  - 気分メモ: ${record['気分メモ'] || 'なし'}
  - 仕事メモ: ${record['仕事メモ'] || 'なし'}
  - 運動内容: ${record['運動内容'] || 'なし'}
  - AI学習内容: ${record['AI学習内容'] || 'なし'}

【指示】
- 要改善項目（❌）を中心に、具体的で実行可能な提案を 2〜3 件生成してください。
- 総合スコアが 3 以下（🔴危険）の場合、少なくとも 1 件は「最低でも半日は有給休暇を取って休む」「今日は早退する」などの休養を最優先した提案を含めてください。
- 各提案には優先度（high/medium/low）を設定し、優先度が高いものを先にしてください。
- actions は 3 件以内の箇条書きで、今日中に実行できる具体的なアクションにしてください。
- 文章はすべて日本語で、優しく励ますトーンにしてください。

【出力フォーマット（JSON）】
{
  "suggestions": [
    {
      "priority": "high",
      "title": "提案タイトル",
      "body": "提案の説明文（2〜3文）",
      "actions": ["アクション1", "アクション2", "アクション3"]
    }
  ]
}`;
}

// ─── フォールバック（API キーなし・エラー時） ────────────────────

function buildFallback(health) {
  const suggestions = [];

  if (health.totalScore < 4) {
    suggestions.push({
      priority: 'high',
      priorityLabel: '緊急',
      title: '心身の疲弊が見られます — 今日は休息を最優先に',
      body: '複数の項目でスコアが低くなっています。無理を続けると回復に時間がかかります。今日は思い切って半日以上の有給休暇を取り、しっかり休養しましょう。',
      actions: [
        '上長または同僚に今日の半休・全休を相談する',
        'スマートフォンを 2 時間以上触らない「デジタルデトックス」を実施する',
        '15 分以上の昼寝または横になる時間を確保する',
      ],
    });
  }

  health.items.filter(i => i.score === 0).slice(0, 2).forEach(item => {
    suggestions.push({
      priority: 'medium',
      priorityLabel: '中',
      title: `${item.icon} ${item.label}の改善が必要です`,
      body: item.adviceLabel,
      actions: [],
    });
  });

  if (suggestions.length === 0) {
    suggestions.push({
      priority: 'low',
      priorityLabel: '低',
      title: '好調を維持しましょう！',
      body: '今日はすべての項目が良好です。この調子を続けるために、今の生活リズムを大切にしてください。',
      actions: ['今日の良かった点を3つ日記に書き留める'],
    });
  }

  return suggestions;
}

function labelOf(priority) {
  return { high: '緊急', medium: '中', low: '低' }[priority] ?? '低';
}

module.exports = { generateSuggestions };
