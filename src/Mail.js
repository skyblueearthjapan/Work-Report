/**
 * メール送信（GmailApp）
 * 設定の宛先へ、定型文（{工番}{お客様名}{作業日}差込）＋保管PDFを添付して実送信。
 */

/** 「a@x, b@y; c@z 改行区切り」等 → カンマ区切りの正規化文字列。 */
function normalizeRecipients_(str) {
  return String(str || '')
    .split(/[,;\s]+/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s && s.indexOf('@') !== -1; })
    .join(',');
}

/**
 * 作業報告書を設定の宛先（TO/CC 複数可）へメール送信する。
 * 送信するPDFは Drive に保管済みのバックアップ（pdfFileId）を添付する。
 * @return {to, cc, fileName}
 */
function sendReportMail(id) {
  var found = findCaseRow_(id);
  if (!found) throw new Error('案件が見つかりません: ' + id);
  var c = found.data;

  if (!c.pdfFileId) {
    throw new Error('添付するPDFがまだ生成されていません。プレビュー画面から送信するとPDFが用意されます。');
  }
  var settings = getSettings();
  var to = normalizeRecipients_(settings.email);
  var cc = normalizeRecipients_(settings.cc);
  if (!to) throw new Error('送信先(TO)メールアドレスが未設定です。設定画面で指定してください。');

  var fileName = pdfBaseName_(c) + '.pdf';
  var pdf = DriveApp.getFileById(c.pdfFileId).getBlob().setName(fileName);
  var subject = fillTemplate_(settings.subject, c) || ('作業報告書 ' + (c.koban || ''));
  var body = fillTemplate_(settings.body, c);

  var options = { attachments: [pdf], name: '作業報告書アプリ' };
  if (cc) options.cc = cc;

  GmailApp.sendEmail(to, subject, body, options);

  // 送信済み → ステータスを「完了」に（クローズ済みは変更しない）
  updateCaseFields_(id, function (x) { if (x.status !== 'クローズ') x.status = '完了'; });

  return { to: to, cc: cc, fileName: fileName };
}
