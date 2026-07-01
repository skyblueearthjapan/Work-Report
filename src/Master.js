/**
 * 外部マスター（「全従業員作業日報マスター」）の連携。
 * まずは構造確認（inspect）用の読み取りから。取り込み仕様は構造確認後に実装する。
 */

var PROP_MASTER_ID = 'MASTER_SPREADSHEET_ID';
var DEFAULT_MASTER_ID = '1iu5HoaknlW1W1HheeYv0jqcRq-aY0SyEE2seQd2pHkQ';
var PROP_MASTER_IMPORT_AT = 'MASTER_IMPORT_AT';

// 外部マスターのタブ名 → 本アプリ側ミラーシート名／取り込む列
var MASTER_SRC = {
  koban: { src: '工番マスタ', cols: ['工番', '受注先', '納入先', '納入先住所', '品名'], dest: 'マスタ_工番' },
  staff: { src: '作業員マスタ', cols: ['作業員コード', '氏名', '部署'], dest: 'マスタ_作業員' },
  dept: { src: '部署マスタ', cols: ['部署'], dest: 'マスタ_部署' }
};

function getMasterSpreadsheetId_() {
  return PropertiesService.getScriptProperties().getProperty(PROP_MASTER_ID) || DEFAULT_MASTER_ID;
}

/** セル値を文字列化（日付は yyyy-MM-dd。取り込み用で丸めない）。 */
function normCell_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  return String(v).trim();
}

/* ============ 取り込み（外部マスター → ミラーシート） ============ */

/**
 * 3つのマスターをミラーシートへ取り込む（列は名前で対応付け）。
 * 時間主導トリガー／手動ボタンの両方から呼ぶ。
 */
function importMasters_() {
  var src = SpreadsheetApp.openById(getMasterSpreadsheetId_());
  var dest = getBook_();
  var result = {};
  Object.keys(MASTER_SRC).forEach(function (key) {
    var def = MASTER_SRC[key];
    result[key] = importTab_(src, def.src, def.cols, def.dest, dest);
  });
  PropertiesService.getScriptProperties().setProperty(PROP_MASTER_IMPORT_AT, nowStamp_());
  return result;
}

/** 1タブを取り込み、指定列だけをミラーシートへ書き出す。取り込み件数を返す。 */
function importTab_(src, srcName, wantCols, destName, destSs) {
  var sh = src.getSheetByName(srcName);
  if (!sh) throw new Error('マスターにタブが見つかりません: ' + srcName);
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var out = [wantCols.slice()];
  if (lastRow >= 2 && lastCol >= 1) {
    var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    var header = values[0].map(function (x) { return String(x).trim(); });
    var idx = wantCols.map(function (w) { return header.indexOf(w); });
    for (var i = 1; i < values.length; i++) {
      var rec = idx.map(function (ci) { return ci >= 0 ? normCell_(values[i][ci]) : ''; });
      if (rec.join('') === '') continue; // 空行スキップ
      out.push(rec);
    }
  }
  writeMirror_(destSs, destName, out);
  return out.length - 1;
}

/** ミラーシートを全書き換え。 */
function writeMirror_(ss, name, matrix) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clear();
  if (matrix.length && matrix[0].length) {
    sh.getRange(1, 1, matrix.length, matrix[0].length).setValues(matrix);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, matrix[0].length).setFontWeight('bold');
  }
}

/* ============ フロントへ渡すマスターデータ ============ */

/** ミラーシートを [{header:value}] で読む。 */
function readMirrorObjects_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) return [];
  var last = sh.getLastRow(), lastc = sh.getLastColumn();
  if (last < 2) return [];
  var values = sh.getRange(1, 1, last, lastc).getValues();
  var header = values[0].map(function (x) { return String(x).trim(); });
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var o = {};
    for (var c = 0; c < header.length; c++) o[header[c]] = normCell_(values[i][c]);
    out.push(o);
  }
  return out;
}

/**
 * フロント用マスター：工番・作業員・部署をアプリ項目キーへ整形して返す。
 */
function getMasterData() {
  var ss = getBook_();
  var kobanRows = readMirrorObjects_(ss, MASTER_SRC.koban.dest);
  var staffRows = readMirrorObjects_(ss, MASTER_SRC.staff.dest);
  var deptRows = readMirrorObjects_(ss, MASTER_SRC.dept.dest);
  return {
    kobans: kobanRows.map(function (r) {
      return {
        koban: r['工番'] || '',
        uketsuke: r['受注先'] || '',
        nohinSaki: r['納入先'] || '',
        basho: r['納入先住所'] || '',
        kishu: r['品名'] || '' // 品名 → 装置名（機種）
      };
    }).filter(function (x) { return x.koban; }),
    staff: staffRows.map(function (r) {
      return { code: r['作業員コード'] || '', name: r['氏名'] || '', dept: r['部署'] || '' };
    }).filter(function (x) { return x.name; }),
    depts: deptRows.map(function (r) { return r['部署'] || ''; }).filter(Boolean),
    importedAt: PropertiesService.getScriptProperties().getProperty(PROP_MASTER_IMPORT_AT) || ''
  };
}

/* ============ 手動実行・トリガー（管理者向け） ============ */

/** 手動取り込み（メニュー／ボタンから）。件数サマリを返す。 */
function importMastersNow() {
  var r = importMasters_();
  return '取り込み完了：工番 ' + r.koban + ' 件 / 作業員 ' + r.staff + ' 件 / 部署 ' + r.dept + ' 件';
}

/** 1日1回（早朝6時台）の自動取り込みトリガーを設定（重複作成しない）。 */
function createMasterDailyTrigger() {
  deleteMasterTriggers_();
  ScriptApp.newTrigger('importMasters_').timeBased().atHour(6).everyDays(1).create();
  return '毎日6時台の自動取り込みを設定しました。';
}

function deleteMasterTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'importMasters_') ScriptApp.deleteTrigger(t);
  });
}

/** セル値を確認しやすい文字列に（長すぎる場合は丸める）。 */
function cellPreview_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var s = (v instanceof Date) ? Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd') : String(v);
  return s.length > 120 ? s.slice(0, 120) + '…' : s;
}

/**
 * 外部マスターの構造を読み取り、JSON文字列で返す。
 * 各タブ： name / gid / rows / cols / header(1行目) / sample(最大3行)。
 * アクセス不可などのエラーはメッセージで返す。
 */
function inspectMaster_() {
  var id = getMasterSpreadsheetId_();
  var out = { spreadsheetId: id, ok: false };
  try {
    var ss = SpreadsheetApp.openById(id);
    out.ok = true;
    out.name = ss.getName();
    out.sheets = ss.getSheets().map(function (sh) {
      var lastRow = sh.getLastRow();
      var lastCol = sh.getLastColumn();
      var header = [];
      var sample = [];
      if (lastRow >= 1 && lastCol >= 1) {
        header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(cellPreview_);
        var n = Math.min(3, Math.max(0, lastRow - 1));
        if (n > 0) {
          var vals = sh.getRange(2, 1, n, lastCol).getValues();
          sample = vals.map(function (row) { return row.map(cellPreview_); });
        }
      }
      return {
        name: sh.getName(),
        gid: sh.getSheetId(),
        rows: lastRow,
        cols: lastCol,
        header: header,
        sample: sample
      };
    });
  } catch (err) {
    out.ok = false;
    out.error = String(err && err.message ? err.message : err);
  }
  return JSON.stringify(out, null, 2);
}
