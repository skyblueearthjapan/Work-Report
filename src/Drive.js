/**
 * Drive 保管（案件ごと1フォルダ方式）
 *
 * 構成（総務部等と共有しやすい形）:
 *   [作業報告書アプリ_保管フォルダ]           ← 1アプリ1つ・共有ポイント
 *     ├─ [LW25004_住友建機株式会社_2026-05-30]  ← 案件フォルダ（工番_お客様名_作業日）
 *     │    ├─ 作業報告書_住友建機株式会社_LN-2400_LW25004_2026-05-30.pdf  ← PDFバックアップ
 *     │    └─ サイン_LW25004_2026-05-30.png                                ← サイン画像
 *     └─ …
 *
 * 1案件＝1フォルダに「作業報告書PDF」と「対応するサイン」を1式でまとめ、
 * どのサインがどの報告書に紐づくか一目で分かるようにする。
 */

/**
 * 案件専用フォルダを取得（無ければ作成）。driveFolderId をシートに保持。
 * 工番・お客様名の変更に追従して名前も更新する。
 */
function getCaseFolder_(c) {
  var app = getAppFolder_();
  var wantName = caseFolderName_(c);
  var folder = null;
  if (c.driveFolderId) {
    try {
      var f = DriveApp.getFolderById(c.driveFolderId);
      if (!f.isTrashed()) folder = f;
    } catch (err) { folder = null; }
  }
  if (!folder) {
    folder = app.createFolder(wantName);
    updateCaseFields_(c.id, function (x) { x.driveFolderId = folder.getId(); });
    c.driveFolderId = folder.getId();
  } else if (folder.getName() !== wantName) {
    try { folder.setName(wantName); } catch (err) {}
  }
  return folder;
}

/** data URL(先頭 data:mime;base64,) を Blob に変換。 */
function dataUrlToBlob_(dataUrl, filename) {
  var m = String(dataUrl || '').match(/^data:([^;]+);base64,(.*)$/);
  if (!m) throw new Error('画像データの形式が不正です。');
  var bytes = Utilities.base64Decode(m[2]);
  return Utilities.newBlob(bytes, m[1], filename);
}

/** フォルダ内の同名ファイルをゴミ箱へ（上書き運用）。 */
function trashExisting_(folder, name) {
  var it = folder.getFilesByName(name);
  while (it.hasNext()) { it.next().setTrashed(true); }
}

/**
 * お客様サインを案件フォルダへ保存し、signatureFileId を更新。
 * @return {fileId, url(dataURL)}
 */
function saveSignature(id, dataUrl) {
  var found = findCaseRow_(id);
  if (!found) throw new Error('案件が見つかりません: ' + id);
  var c = found.data;
  var folder = getCaseFolder_(c);
  var name = 'サイン_' + (sanitizeName_(c.koban) || 'no-koban') + '_' + sanitizeName_(c.yoteibi || c.closedAt || todayStr_()) + '.png';
  trashExisting_(folder, name);
  var file = folder.createFile(dataUrlToBlob_(dataUrl, name));
  updateCaseFields_(id, function (x) { x.signatureFileId = file.getId(); });
  return { fileId: file.getId(), url: getSignatureDataUrl_(file.getId()) };
}

/**
 * 作業報告書PDF（クライアントで生成）を案件フォルダへバックアップ保存し、pdfFileId 更新。
 * @param pdfBase64 base64（data URL 接頭辞なし）
 * @return {fileId, name}
 */
function saveReportPdf(id, pdfBase64) {
  var found = findCaseRow_(id);
  if (!found) throw new Error('案件が見つかりません: ' + id);
  var c = found.data;
  var folder = getCaseFolder_(c);
  var name = pdfBaseName_(c) + '.pdf';
  trashExisting_(folder, name);
  var blob = Utilities.newBlob(Utilities.base64Decode(pdfBase64), 'application/pdf', name);
  var file = folder.createFile(blob);
  updateCaseFields_(id, function (x) { x.pdfFileId = file.getId(); });
  return { fileId: file.getId(), name: name };
}

/** PDF ファイル名（拡張子なし）＝ 作業報告書_お客様名_装置名_工番_日付。 */
function pdfBaseName_(c) {
  var d = c.yoteibi || c.closedAt || todayStr_();
  return ['作業報告書', sanitizeName_(c.nohinSaki), sanitizeName_(c.kishu), sanitizeName_(c.koban), sanitizeName_(d)]
    .filter(Boolean).join('_');
}

/** 署名画像(fileId) → 表示用 dataURL（プレビュー描画に使用）。 */
function getSignatureDataUrl_(fileId) {
  if (!fileId) return '';
  var file = DriveApp.getFileById(fileId);
  var blob = file.getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/** 保管フォルダのURL（設定画面等から共有導線に使える）。 */
function getAppFolderUrl() {
  return getAppFolder_().getUrl();
}
