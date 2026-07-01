/**
 * Gemini 連携（UrlFetchApp）
 *  - aiFormatShori(text)        : 口述メモ→「処置」欄向けに整形（テキスト生成）
 *  - aiReadPlate(imageDataUrl)  : 銘板写真→{kishu,katashiki,seiban,nenGappi}（Vision/JSON強制）
 *
 * APIキーは Script Properties の GEMINI_API_KEY に格納。
 * 未設定・失敗時は明確なエラーを投げ、フロントは手入力/モックへフォールバックする。
 */

var PROP_GEMINI_KEY = 'GEMINI_API_KEY';
var PROP_GEMINI_MODEL = 'GEMINI_MODEL';
var DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

function getGeminiKey_() {
  var k = PropertiesService.getScriptProperties().getProperty(PROP_GEMINI_KEY);
  if (!k) throw new Error('NO_API_KEY');
  return k;
}
function getGeminiModel_() {
  return PropertiesService.getScriptProperties().getProperty(PROP_GEMINI_MODEL) || DEFAULT_GEMINI_MODEL;
}

/** Gemini API が使えるか（フロントのUI出し分け用）。 */
function isGeminiEnabled() {
  return !!PropertiesService.getScriptProperties().getProperty(PROP_GEMINI_KEY);
}

/** generateContent を叩いて JSON を返す（低レベル）。 */
function callGemini_(payload) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(getGeminiModel_()) + ':generateContent?key=' + encodeURIComponent(getGeminiKey_());
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Gemini APIエラー(' + code + '): ' + body.slice(0, 300));
  }
  var json = JSON.parse(body);
  var cand = json.candidates && json.candidates[0];
  if (!cand || !cand.content || !cand.content.parts || !cand.content.parts[0]) {
    throw new Error('Geminiから有効な応答が得られませんでした。');
  }
  return cand.content.parts[0].text || '';
}

/** 処置の整形（テキスト生成）。整形済みプレーンテキストを返す。 */
function aiFormatShori(text) {
  var input = String(text || '').trim();
  if (!input) throw new Error('整形するテキストが空です。');
  var prompt =
    'あなたは製造設備の保守報告の校正者です。次の口述メモを、作業報告書の「処置」欄向けに、' +
    '事実のみ・敬体（です・ます調）・簡潔な文章へ整えてください。推測や誇張はせず、' +
    '箇条書きにはせず自然な文章にし、整形後の本文のみを出力してください。\n\n' +
    '【口述メモ】\n' + input;
  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2 }
  };
  var out = callGemini_(payload);
  return String(out).trim();
}

/** 銘板OCR（画像→構造化JSON）。{kishu,katashiki,seiban,nenGappi} を返す。 */
function aiReadPlate(imageDataUrl) {
  var m = String(imageDataUrl || '').match(/^data:([^;]+);base64,(.*)$/);
  var mime, data;
  if (m) { mime = m[1]; data = m[2]; }
  else { mime = 'image/jpeg'; data = String(imageDataUrl || ''); }
  if (!data) throw new Error('画像データが空です。');

  var prompt =
    'これはアルミ銘板（ネームプレート）の写真です。機種・型式・製番・製造年月を読み取り、JSONで返してください。' +
    '対応の目安：機種=MODEL/機種/型式名の主要名, 型式=TYPE/型式, 製番=No./SERIAL/製造番号, 製造年月=製造年月/DATE。' +
    '製造年月は可能なら YYYY-MM 形式（不明なら読めた表記のまま）。読み取れない項目は空文字にしてください。';
  var payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mime, data: data } }
      ]
    }],
    generationConfig: {
      temperature: 0,
      response_mime_type: 'application/json',
      response_schema: {
        type: 'OBJECT',
        properties: {
          kishu: { type: 'STRING' },
          katashiki: { type: 'STRING' },
          seiban: { type: 'STRING' },
          nenGappi: { type: 'STRING' }
        },
        required: ['kishu', 'katashiki', 'seiban', 'nenGappi']
      }
    }
  };
  var out = callGemini_(payload);
  var obj;
  try { obj = JSON.parse(out); } catch (e) { throw new Error('銘板の解析結果を解釈できませんでした。'); }
  return {
    kishu: String(obj.kishu || ''),
    katashiki: String(obj.katashiki || ''),
    seiban: String(obj.seiban || ''),
    nenGappi: String(obj.nenGappi || '')
  };
}

/* ---------- APIキー設定（管理者向け・エディタ/メニューから実行） ---------- */

/** スプレッドシートのメニューからキーを入力して設定。 */
function setGeminiApiKeyPrompt() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Gemini APIキー設定', 'Gemini(Generative Language API)のAPIキーを貼り付けてください：', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var key = String(resp.getResponseText() || '').trim();
  if (!key) { ui.alert('キーが空のため設定しませんでした。'); return; }
  PropertiesService.getScriptProperties().setProperty(PROP_GEMINI_KEY, key);
  ui.alert('Gemini APIキーを設定しました。音声整形・銘板OCRが有効になります。');
}
