/**
 * doPost トークンAPI（VPS からサーバー間で呼ぶ Google 操作の窓口）
 * VPS がデータ(SQLite)を持ち、Drive保管・メール送信・マスター取込だけを会社アカウントのGASへ委譲する。
 * 認証は Script Properties の API_TOKEN による共有トークン方式（Hermesと同方式）。
 *
 * メニュー「APIトークンを発行/表示」で発行 → VPS の環境変数 GAS_API_TOKEN に設定。
 */

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function getApiToken_() {
  return PropertiesService.getScriptProperties().getProperty('API_TOKEN') || '';
}

/** VPS からの JSON POST を受ける。{action, token, params} でディスパッチ。 */
function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var expected = getApiToken_();
    if (!expected || req.token !== expected) throw new Error('unauthorized');
    var p = req.params || {};
    var out;
    switch (req.action) {
      case 'ping': out = { pong: true, time: nowStamp_() }; break;
      case 'saveSignature': out = apiSaveSignature_(p.meta || {}, p.dataUrl || ''); break;
      case 'saveReportPdf': out = apiSaveReportPdf_(p.meta || {}, p.pdfBase64 || ''); break;
      case 'sendMail': out = apiSendMail_(p); break;
      case 'refreshMaster': out = apiRefreshMaster_(); break;
      default: throw new Error('unknown action: ' + req.action);
    }
    return json_({ ok: true, result: out });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/* ---------- 案件フォルダ（ステートレス：シート行を持たない） ---------- */
// meta: { koban, nohinSaki, yoteibi, closedAt, kishu, driveFolderId? }
function apiGetCaseFolder_(meta) {
  var app = getAppFolder_();
  if (meta.driveFolderId) {
    try { var f = DriveApp.getFolderById(meta.driveFolderId); if (!f.isTrashed()) return f; } catch (e) {}
  }
  var name = caseFolderName_(meta);
  var it = app.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return app.createFolder(name);
}

function apiSaveSignature_(meta, dataUrl) {
  if (!dataUrl) throw new Error('署名データが空です');
  var folder = apiGetCaseFolder_(meta);
  var name = 'サイン_' + (sanitizeName_(meta.koban) || 'no-koban') + '_' + sanitizeName_(meta.yoteibi || meta.closedAt || todayStr_()) + '.png';
  trashExisting_(folder, name);
  var file = folder.createFile(dataUrlToBlob_(dataUrl, name));
  return { fileId: file.getId(), folderId: folder.getId(), url: getSignatureDataUrl_(file.getId()) };
}

function apiSaveReportPdf_(meta, pdfBase64) {
  if (!pdfBase64) throw new Error('PDFデータが空です');
  var folder = apiGetCaseFolder_(meta);
  var name = pdfBaseName_(meta) + '.pdf';
  trashExisting_(folder, name);
  var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(pdfBase64), 'application/pdf', name));
  return { fileId: file.getId(), folderId: folder.getId(), name: name };
}

// p: { to, cc, subject, body, pdfFileId, fileName }
function apiSendMail_(p) {
  var to = String(p.to || '').trim();
  if (!to) throw new Error('送信先(TO)が未設定です');
  var options = { name: '作業報告書アプリ' };
  if (p.cc) options.cc = String(p.cc);
  if (p.pdfFileId) {
    var blob = DriveApp.getFileById(p.pdfFileId).getBlob().setName(p.fileName || '作業報告書.pdf');
    options.attachments = [blob];
  }
  GmailApp.sendEmail(to, p.subject || '作業報告書', p.body || '', options);
  return { sent: true };
}

/** 外部マスターを取り込み、最新データを返す（VPSがSQLiteにミラー）。 */
function apiRefreshMaster_() {
  importMasters_();
  return getMasterData();
}

/** メニュー：APIトークンを発行/表示（無ければ生成）。VPSのGAS_API_TOKENに設定する。 */
function setupApiTokenPrompt() {
  var props = PropertiesService.getScriptProperties();
  var t = props.getProperty('API_TOKEN');
  if (!t) {
    t = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('API_TOKEN', t);
  }
  SpreadsheetApp.getUi().alert('VPS連携 APIトークン（GAS_API_TOKEN に設定）:\n\n' + t + '\n\n※このトークンを担当に共有してください。漏洩時はこの関数を消して再発行します。');
}

/** APIトークンを再発行（漏洩時など）。 */
function regenerateApiToken() {
  var t = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_TOKEN', t);
  return t;
}
