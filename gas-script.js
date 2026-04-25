/**
 * Mind & Body Dashboard — Google Apps Script
 *
 * 【セットアップ手順】
 * 1. Google スプレッドシートを新規作成する
 * 2. メニュー「拡張機能」→「Apps Script」を開く
 * 3. このファイルの内容を貼り付けて保存（Ctrl+S）
 * 4. 「実行」→ setupHeaders を実行してヘッダー行を作成
 * 5. 「デプロイ」→「新しいデプロイ」→ 種類:「ウェブアプリ」
 *    - 実行するユーザー: 自分
 *    - アクセスできるユーザー: 全員
 *    → 「デプロイ」ボタンを押して表示された URL をコピー
 * 6. dist/record.html の SCRIPT_URL にその URL を貼り付ける
 */

const SHEET_NAME = 'シート1'; // シート名（必要に応じて変更）

// ── ヘッダー行を1行目に作成（初回のみ実行） ────────────────
function setupHeaders() {
  const sheet = getSheet();
  if (sheet.getLastRow() > 0) {
    Logger.log('ヘッダー行はすでに存在します');
    return;
  }
  sheet.appendRow([
    '日付',
    '気分スコア', '気分絵文字', '気分タグ', '気分メモ',
    '睡眠時間(h)', '就寝時刻', '睡眠の質', '睡眠タグ',
    '仕事スコア', '会議数', 'タスク数', '仕事タグ', '仕事メモ',
    '体重(kg)', '体脂肪率(%)', '身長(cm)', '体重メモ',
    '運動内容', '運動合計時間(分)', '運動メモ',
    'AI学習内容', 'AI学習メモ',
    'Good & New',
    '感謝日記',
    '記録日時',
  ]);
  // ヘッダー行を太字・背景色で装飾
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn());
  header.setFontWeight('bold').setBackground('#e8f0fe');
  Logger.log('ヘッダー行を作成しました');
}

// ── POST リクエストを受け取ってスプレッドシートに保存 ────────
function doPost(e) {
  try {
    // hidden フォーム送信（e.parameter.data）と JSON fetch（e.postData.contents）の両対応
    const raw = (e.parameter && e.parameter.data)
      ? e.parameter.data
      : e.postData.contents;
    const data = JSON.parse(raw);
    const sheet = getSheet();

    // 運動: チェックされた種目と時間を文字列化
    const exerciseActivities = (data.exercise?.activities || [])
      .map(a => `${a.label}${a.minutes != null ? `(${a.minutes}分)` : ''}`)
      .join('、');
    const exerciseTotalMin = (data.exercise?.activities || [])
      .reduce((sum, a) => sum + (a.minutes || 0), 0);

    // AI学習: チェックされた種目と時間/レッスンを文字列化
    const aiActivities = (data.ai?.activities || [])
      .map(a => {
        if (a.id === 'drill') return `${a.label}(${a.lessons != null ? a.lessons : 0}レッスン)`;
        return `${a.label}${a.minutes != null ? `(${a.minutes}分)` : ''}`;
      })
      .join('、');

    // Good & New
    const goodAndNew = (data.goodAndNew || [])
      .map(g => `[${g.type}] ${g.text}`)
      .join(' / ');

    // 感謝日記
    const gratitude = (data.gratitude || []).join(' / ');

    sheet.appendRow([
      data.date,
      data.mood?.score   ?? '',
      data.mood?.emoji   ?? '',
      (data.mood?.tags   || []).join(', '),
      data.mood?.note    ?? '',
      data.sleep?.hours  ?? '',
      data.sleep?.bedtime ?? '',
      data.sleep?.quality ?? '',
      (data.sleep?.tags  || []).join(', '),
      data.work?.score   ?? '',
      data.work?.meetings ?? '',
      data.work?.tasks   ?? '',
      (data.work?.tags   || []).join(', '),
      data.work?.note    ?? '',
      data.body?.weight  ?? '',
      data.body?.fat     ?? '',
      data.body?.height  ?? '',
      data.body?.note    ?? '',
      exerciseActivities,
      exerciseTotalMin || '',
      data.exercise?.note ?? '',
      aiActivities,
      data.ai?.note      ?? '',
      goodAndNew,
      gratitude,
      new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
    ]);

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ── GET: スプレッドシートの全レコード＋カレンダー予定を JSON で返す ──
function doGet(e) {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  let records = [];
  if (rows.length >= 2) {
    const headers = rows[0];
    records = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] instanceof Date
          ? Utilities.formatDate(row[i], 'Asia/Tokyo', 'yyyy-MM-dd')
          : row[i];
      });
      return obj;
    });
  }

  let calendarEvents = [];
  let calendarError = null;
  try {
    calendarEvents = getCalendarEvents();
  } catch (err) {
    calendarError = err.toString();
    Logger.log('カレンダー取得失敗: ' + err);
  }

  return jsonResponse({ records, calendarEvents, calendarError });
}

// ── Googleカレンダーから今日〜7日後の予定を取得 ──────────────
// ★ カレンダー名はここで変更してください（ひらがな/カタカナ両方試す）
const CALENDAR_TARGETS = [
  { name: '李',      color: '#0b7dee' },
  { name: 'ゴミの日', color: '#10b981' },  // カタカナ
  { name: 'ごみの日', color: '#10b981' },  // ひらがな（どちらかがヒットする）
];

function getCalendarEvents() {
  const TZ = 'Asia/Tokyo';

  // 今日の 00:00:00 から開始（終日イベントも確実に取得するため）
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);

  const seen = new Set(); // 重複排除用（ひらがな/カタカナ両方ヒットしても1件のみ）
  const events = [];

  CALENDAR_TARGETS.forEach(({ name, color }) => {
    try {
      const cals = CalendarApp.getCalendarsByName(name);
      Logger.log('カレンダー「' + name + '」件数: ' + cals.length);
      cals.forEach(cal => {
        cal.getEvents(start, end).forEach(ev => {
          const allDay = ev.isAllDayEvent();
          const startStr = allDay
            ? Utilities.formatDate(ev.getAllDayStartDate(), TZ, 'yyyy-MM-dd')
            : Utilities.formatDate(ev.getStartTime(), TZ, "yyyy-MM-dd'T'HH:mm:ss");
          const key = name + '|' + ev.getTitle() + '|' + startStr;
          if (seen.has(key)) return;
          seen.add(key);
          events.push({
            title:    ev.getTitle(),
            start:    startStr,
            end:      allDay
              ? Utilities.formatDate(ev.getAllDayEndDate(), TZ, 'yyyy-MM-dd')
              : Utilities.formatDate(ev.getEndTime(), TZ, "yyyy-MM-dd'T'HH:mm:ss"),
            isAllDay: allDay,
            calendar: name === 'ごみの日' ? 'ゴミの日' : name, // 表示名を統一
            color:    color,
          });
        });
      });
    } catch (err) {
      Logger.log('カレンダー取得エラー [' + name + ']: ' + err);
    }
  });

  // 開始日時でソート
  events.sort((a, b) => (a.start > b.start ? 1 : -1));
  return events;
}

// ── ユーティリティ ──────────────────────────────────────────
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  return sheet;
}

// ── デバッグ用：GASエディタから直接実行してログを確認 ──────────
// 「実行」→「testCalendar」を選択して実行 → 「ログ」で結果を確認
function testCalendar() {
  const events = getCalendarEvents();
  Logger.log('取得件数: ' + events.length);
  events.forEach(ev => Logger.log(JSON.stringify(ev)));

  // 全カレンダー名を一覧表示（名前の確認用）
  Logger.log('--- マイカレンダー一覧 ---');
  CalendarApp.getAllCalendars().forEach(cal => {
    Logger.log('名前: [' + cal.getName() + '] ID: ' + cal.getId());
  });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
