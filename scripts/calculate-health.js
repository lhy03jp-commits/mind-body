'use strict';

/**
 * 6項目それぞれのスコアを 0 or 1 で算出し、合計を返す。
 *
 * 判定基準：
 *   🟢 totalScore >= 6
 *   🟡 4 <= totalScore < 6
 *   🔴 totalScore < 4
 */

const ITEMS = [
  {
    key: 'mood',
    label: '気分',
    icon: '😊',
    calc(r) {
      const score = parseFloat(r['気分スコア']);
      return {
        score: !isNaN(score) && score >= 3 ? 1 : 0,
        detail: !isNaN(score) ? `スコア ${score}/5` : '未記録',
        raw: score,
      };
    },
    adviceLabel: '気分スコアが低い状態です。無理せず気持ちをリセットする時間を取りましょう。',
  },
  {
    key: 'sleep',
    label: '睡眠',
    icon: '😴',
    calc(r) {
      const hours   = parseFloat(r['睡眠時間(h)']);
      const quality = parseFloat(r['睡眠の質']);
      const ok = !isNaN(hours) && hours >= 6;
      return {
        score: ok ? 1 : 0,
        detail: !isNaN(hours)
          ? `${hours}h / 質 ${!isNaN(quality) ? quality + '/5' : '未記録'}`
          : '未記録',
        raw: hours,
      };
    },
    adviceLabel: '睡眠が不足しています。今夜は早めに就寝するか、昼寝を取ることをお勧めします。',
  },
  {
    key: 'work',
    label: '仕事',
    icon: '💼',
    calc(r) {
      const score = parseFloat(r['仕事スコア']);
      return {
        score: !isNaN(score) && score >= 3 ? 1 : 0,
        detail: !isNaN(score) ? `スコア ${score}/5` : '未記録',
        raw: score,
      };
    },
    adviceLabel: '仕事負荷が高い状態です。タスクの優先度を整理し、必要なら上長に相談しましょう。',
  },
  {
    key: 'body',
    label: '体重',
    icon: '⚖️',
    calc(r) {
      const weight = parseFloat(r['体重(kg)']);
      const fat    = parseFloat(r['体脂肪率(%)']);
      return {
        score: !isNaN(weight) ? 1 : 0,
        detail: !isNaN(weight)
          ? `${weight}kg${!isNaN(fat) ? ` / 体脂肪 ${fat}%` : ''}`
          : '未記録',
        raw: weight,
      };
    },
    adviceLabel: '体重が未記録です。毎朝の計測習慣を続けましょう。',
  },
  {
    key: 'exercise',
    label: '運動',
    icon: '🏃',
    calc(r) {
      const mins = parseFloat(r['運動合計時間(分)']);
      return {
        score: !isNaN(mins) && mins >= 30 ? 1 : 0,
        detail: !isNaN(mins) && mins > 0 ? `${mins}分` : '未記録 / 0分',
        raw: mins,
      };
    },
    adviceLabel: '運動が不足しています。軽いウォーキング30分でも効果的です。',
  },
  {
    key: 'ai',
    label: 'AI学習',
    icon: '🤖',
    calc(r) {
      const content = r['AI学習内容'];
      const done = typeof content === 'string' && content.trim().length > 0;
      return {
        score: done ? 1 : 0,
        detail: done ? content.slice(0, 40) + (content.length > 40 ? '…' : '') : '未記録',
        raw: done ? 1 : 0,
      };
    },
    adviceLabel: 'AI学習の記録がありません。5分でもよいのでインプットの時間を作りましょう。',
  },
];

/**
 * @param {Object} record  - GAS から取得した最新の1行データ
 * @returns {{
 *   totalScore: number,
 *   status: 'green'|'yellow'|'red',
 *   statusEmoji: string,
 *   statusLabel: string,
 *   items: Array<{key,label,icon,score,detail,adviceLabel}>
 * }}
 */
function calculateHealth(record) {
  const items = ITEMS.map(item => {
    const result = item.calc(record);
    return {
      key: item.key,
      label: item.label,
      icon: item.icon,
      score: result.score,
      detail: result.detail,
      adviceLabel: item.adviceLabel,
    };
  });

  const totalScore = items.reduce((sum, i) => sum + i.score, 0);

  let status, statusEmoji, statusLabel;
  if (totalScore >= 6) {
    status = 'green';  statusEmoji = '🟢'; statusLabel = '好調';
  } else if (totalScore >= 4) {
    status = 'yellow'; statusEmoji = '🟡'; statusLabel = '注意';
  } else {
    status = 'red';    statusEmoji = '🔴'; statusLabel = '危険';
  }

  return { totalScore, status, statusEmoji, statusLabel, items };
}

module.exports = { calculateHealth, ITEMS };
