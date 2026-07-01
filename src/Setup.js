/**
 * プロビジョニング（シート・列・Drive フォルダの用意）
 * 仕様書「2. データモデル」「5. 推奨アーキテクチャ」準拠。
 */

var SHEET_CASES = '案件';
var SHEET_SETTINGS = '設定';
// 保管フォルダ（1アプリ1つ。総務部等と共有する親フォルダ）
var APP_FOLDER_NAME = '作業報告書アプリ_保管フォルダ';
var PROP_APP_FOLDER_ID = 'APP_FOLDER_ID';

/**
 * 案件シートの列順（仕様書 sheetCols を踏襲＋Drive管理列を追記。1案件=1行）。
 * 末尾2列 pdfFileId/driveFolderId は本アプリで追加（案件フォルダとPDFバックアップの紐付け）。
 */
var CASE_COLUMNS = [
  'id', 'type', 'status', 'koban', 'motoKoban', 'nohinNo', 'kobanName',
  'nohinSaki', 'okyakuSub', 'basho', 'tantou', 'tel',
  'kishu', 'katashiki', 'seiban', 'nenGappi',
  'yoteibi', 'shijiNaiyou', 'paid', 'genin', 'shori',
  'oshaName', 'tantoushaName', 'signatureFileId',
  'kaninStamped', 'kaninName',
  'workTypesJson', 'confirmItemsJson', 'staffJson', 'commonWorkJson', 'commonTravelJson',
  'archived', 'closedAt', 'createdAt', 'updatedAt',
  'pdfFileId', 'driveFolderId'
];

/** 設定シートの既定値（仕様書「別途支給」の暫定値）。 */
function defaultSettings_() {
  return {
    email: 'genba-report@line-works.co.jp',
    cc: '',
    subject: '【作業報告書】{工番} {お客様名}',
    body: 'お疲れ様です。\n下記案件の作業報告書をお送りいたします。\n\n' +
          '■工番：{工番}\n■お客様：{お客様名} 様\n■作業日：{作業日}\n\n' +
          'PDFを添付いたしますのでご確認をお願いいたします。\n\n何卒よろしくお願い申し上げます。',
    companyLW: 'LINE W',
    companyTS: 'テクノサービス'
  };
}

/** バインド先スプレッドシート（＝アプリDB）を返す。 */
function getBook_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('バインド先スプレッドシートが取得できません。コンテナバインド型として実行してください。');
  }
  return ss;
}

/** 初回アクセス時にシート・ヘッダー・フォルダを保証する（冪等）。 */
function ensureSetup_() {
  var ss = getBook_();
  ensureCasesSheet_(ss);
  ensureSettingsSheet_(ss);
  ensureAppFolder_();
}

/** 案件シートを保証し、ヘッダーを CASE_COLUMNS に整える（列追加のマイグレーション込み）。 */
function ensureCasesSheet_(ss) {
  var sh = ss.getSheetByName(SHEET_CASES);
  if (!sh) sh = ss.insertSheet(SHEET_CASES);
  // 必要列数を確保（既存シートに新列を安全に追加）
  var need = CASE_COLUMNS.length;
  if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
  var header = sh.getRange(1, 1, 1, need).getValues()[0];
  var same = header.length === need && header.every(function (v, i) { return v === CASE_COLUMNS[i]; });
  if (!same) {
    sh.getRange(1, 1, 1, need).setValues([CASE_COLUMNS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, need).setFontWeight('bold');
  }
  return sh;
}

/** 設定シートを保証し、無ければ既定値を1行書く。key/value 縦持ち。 */
function ensureSettingsSheet_(ss) {
  var sh = ss.getSheetByName(SHEET_SETTINGS);
  if (!sh) sh = ss.insertSheet(SHEET_SETTINGS);
  var header = sh.getRange(1, 1, 1, 2).getValues()[0];
  if (header[0] !== 'key') {
    sh.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 2).setFontWeight('bold');
  }
  // 既存キーが無いものだけ既定値で補完
  var existing = readSettingsMap_(sh);
  var def = defaultSettings_();
  Object.keys(def).forEach(function (k) {
    if (!(k in existing)) {
      sh.appendRow([k, def[k]]);
    }
  });
  return sh;
}

/**
 * 保管の親フォルダ（1アプリ1つ）を保証し、ID を Script Properties に保持。
 * この1フォルダを総務部等と共有すれば、全案件のPDF・サインを閲覧できる。
 */
function ensureAppFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_APP_FOLDER_ID);
  if (id) {
    try {
      var f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (err) {
      // フォルダが消えている等 → 作り直す
    }
  }
  var folder = DriveApp.createFolder(APP_FOLDER_NAME);
  props.setProperty(PROP_APP_FOLDER_ID, folder.getId());
  return folder;
}

function getCasesSheet_() { return ensureCasesSheet_(getBook_()); }
function getSettingsSheet_() { return ensureSettingsSheet_(getBook_()); }
function getAppFolder_() { return ensureAppFolder_(); }

/** Drive/ファイル名に使えない文字を除去。 */
function sanitizeName_(x) {
  return String(x || '').replace(/[\\/:*?"<>|\r\n\t]/g, '').replace(/\s+/g, ' ').trim();
}

/** 案件フォルダ名： 工番_お客様名_作業日（人が見て判別しやすい）。 */
function caseFolderName_(c) {
  var d = c.yoteibi || c.closedAt || todayStr_();
  return [sanitizeName_(c.koban) || 'no-koban', sanitizeName_(c.nohinSaki), sanitizeName_(d)]
    .filter(Boolean).join('_');
}

/** 設定シート(縦持ち)を {key:value} に読み出す（内部）。 */
function readSettingsMap_(sh) {
  var last = sh.getLastRow();
  var map = {};
  if (last < 2) return map;
  var values = sh.getRange(2, 1, last - 1, 2).getValues();
  values.forEach(function (row) {
    if (row[0] !== '' && row[0] !== null) map[String(row[0])] = row[1];
  });
  return map;
}

/**
 * 手動実行用：メニューやエディタから初期化＋サンプル投入を行う。
 * 空の案件シートのときだけプロトのサンプル6件を投入する。
 */
function setupWithSampleData() {
  ensureSetup_();
  var sh = getCasesSheet_();
  if (sh.getLastRow() > 1) {
    return '既に ' + (sh.getLastRow() - 1) + ' 件あります。サンプル投入はスキップしました。';
  }
  var samples = sampleCases_();
  samples.forEach(function (c) { insertCaseRow_(sh, c); });
  return samples.length + ' 件のサンプルを投入しました。';
}

/** スプレッドシートを開いたときのカスタムメニュー。 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('作業報告書アプリ')
      .addItem('初期化＋サンプル投入', 'setupWithSampleData')
      .addItem('初期化のみ', 'ensureSetup_')
      .addSeparator()
      .addItem('マスターを今すぐ取り込み', 'importMastersNow')
      .addItem('1日1回の自動取込を設定', 'createMasterDailyTrigger')
      .addSeparator()
      .addItem('Gemini APIキーを設定', 'setGeminiApiKeyPrompt')
      .addToUi();
  } catch (err) {
    // UI 非対応コンテキストでは無視
  }
}
