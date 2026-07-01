/**
 * デジタル作業報告書アプリ — GAS 実装
 * エントリポイント / 共通ユーティリティ
 *
 * 参照: design/untitled/project/GAS実装_引き継ぎ仕様書.dc.html
 *       design/untitled/project/作業報告書アプリ.dc.html（UI/ロジックの正）
 */

/** Web アプリのエントリ。index.html を返す。 */
function doGet(e) {
  ensureSetup_(); // 初回アクセス時にシート・フォルダを用意
  var tmpl = HtmlService.createTemplateFromFile('index');
  tmpl.boot = getBootData_(); // 初期表示に必要なデータを埋め込む
  return tmpl
    .evaluate()
    .setTitle('デジタル作業報告書')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** HTML から他ファイルを取り込む（<?!= include('css') ?>）。 */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** 起動時の初期データ（一覧・履歴件数・設定・種別ラベル）をまとめて返す。 */
function getBootData_() {
  var state = getAppState();
  return {
    cases: state.cases,
    historyCount: state.historyCount,
    settings: getSettings(),
    company: getCompany(),
    today: todayStr_()
  };
}

/** 会社ブランド名（設定シートで上書き可、なければ既定値）。 */
function getCompany() {
  var st = getSettings();
  return {
    companyLW: st.companyLW || 'LINE W',
    companyTS: st.companyTS || 'テクノサービス'
  };
}

/* ================= 共通ユーティリティ ================= */

/** Asia/Tokyo の今日を 'YYYY-MM-DD' で返す。 */
function todayStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

/** 現在時刻を ISO 風タイムスタンプで返す。 */
function nowStamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss");
}

/** ランダム ID（衝突しにくい案件キー）。 */
function newId_(prefix) {
  return (prefix || 'c') + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

/** JSON 安全パース。失敗時は既定値。 */
function parseJson_(str, fallback) {
  if (str === '' || str === null || str === undefined) return fallback;
  try {
    return JSON.parse(str);
  } catch (err) {
    return fallback;
  }
}

/** 真偽値をシート格納向けに正規化。 */
function toBool_(v) {
  if (v === true) return true;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return !!v;
}
