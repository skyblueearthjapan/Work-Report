/**
 * プロビジョニング（シート・列・Drive フォルダの用意）
 * 仕様書「2. データモデル」「5. 推奨アーキテクチャ」準拠。
 */

var SHEET_CASES = '案件';
var SHEET_SETTINGS = '設定';
var IMAGE_FOLDER_NAME = '作業報告書_画像';
var PROP_IMAGE_FOLDER_ID = 'IMAGE_FOLDER_ID';

/** 案件シートの列順（仕様書 sheetCols を踏襲。1案件=1行）。 */
var CASE_COLUMNS = [
  'id', 'type', 'status', 'koban', 'motoKoban', 'nohinNo', 'kobanName',
  'nohinSaki', 'okyakuSub', 'basho', 'tantou', 'tel',
  'kishu', 'katashiki', 'seiban', 'nenGappi',
  'yoteibi', 'shijiNaiyou', 'paid', 'genin', 'shori',
  'oshaName', 'tantoushaName', 'signatureFileId',
  'kaninStamped', 'kaninName',
  'workTypesJson', 'confirmItemsJson', 'staffJson', 'commonWorkJson', 'commonTravelJson',
  'archived', 'closedAt', 'createdAt', 'updatedAt'
];

/** 設定シートの既定値（仕様書「別途支給」の暫定値）。 */
function defaultSettings_() {
  return {
    email: 'genba-report@line-works.co.jp',
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
  ensureImageFolder_();
}

/** 案件シートを保証し、ヘッダーを整える。 */
function ensureCasesSheet_(ss) {
  var sh = ss.getSheetByName(SHEET_CASES);
  if (!sh) sh = ss.insertSheet(SHEET_CASES);
  var firstRow = sh.getRange(1, 1, 1, CASE_COLUMNS.length).getValues()[0];
  var needsHeader = firstRow.join('') === '' || firstRow[0] !== 'id';
  if (needsHeader) {
    sh.getRange(1, 1, 1, CASE_COLUMNS.length).setValues([CASE_COLUMNS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, CASE_COLUMNS.length).setFontWeight('bold');
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

/** 画像保存用 Drive フォルダを保証し、ID を Script Properties に保持。 */
function ensureImageFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_IMAGE_FOLDER_ID);
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (err) {
      // フォルダが消えている等 → 作り直す
    }
  }
  var folder = DriveApp.createFolder(IMAGE_FOLDER_NAME);
  props.setProperty(PROP_IMAGE_FOLDER_ID, folder.getId());
  return folder;
}

function getCasesSheet_() { return ensureCasesSheet_(getBook_()); }
function getSettingsSheet_() { return ensureSettingsSheet_(getBook_()); }
function getImageFolder_() { return ensureImageFolder_(); }

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
      .addToUi();
  } catch (err) {
    // UI 非対応コンテキストでは無視
  }
}
