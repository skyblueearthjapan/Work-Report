/**
 * 後続セクションで実装予定の API の暫定スタブ置き場。
 * 各セクションで正式ファイルへ移動し、ここからは削除していく。
 *
 *  - saveSignature  … Section 4（業務ルール）
 *  - stampKanin     … Section 4（業務ルール）
 *  - generatePdf    … Section 5（PDF/メール）
 *  - sendReportMail … Section 5（PDF/メール）
 *  - aiFormatShori  … Section 6（Gemini）
 *  - aiReadPlate    … Section 6（Gemini）
 */

/** 署名画像(fileId) → 表示用 dataURL。読み出しは Section 1 で実装済み。 */
function getSignatureDataUrl_(fileId) {
  if (!fileId) return '';
  var file = DriveApp.getFileById(fileId);
  var blob = file.getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

function saveSignature(id, dataUrl) { throw new Error('未実装（Section 4 で実装）'); }
function stampKanin(id, name) { throw new Error('未実装（Section 4 で実装）'); }
function generatePdf(id) { throw new Error('未実装（Section 5 で実装）'); }
function sendReportMail(id) { throw new Error('未実装（Section 5 で実装）'); }
function aiFormatShori(text) { throw new Error('未実装（Section 6 で実装）'); }
function aiReadPlate(imageBase64) { throw new Error('未実装（Section 6 で実装）'); }
