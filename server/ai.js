'use strict';
/**
 * Gemini 連携（VPSから直接 UrlFetch）。
 *  - transcribe(audio)  : 録音音声 → 文字起こし＋「処置」欄向け整形（アプリ内マイク録音の本命）
 *  - formatShori(text)  : 口述/手入力テキスト → 整形
 *  - readPlate(image)   : 銘板写真 → {kishu,katashiki,seiban,nenGappi}（JSON強制）
 * キーは環境変数 GEMINI_API_KEY、モデルは GEMINI_MODEL（既定 gemini-2.5-flash）。
 */
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
function key() { const k = process.env.GEMINI_API_KEY; if (!k) throw new Error('NO_API_KEY'); return k; }
function enabled() { return !!process.env.GEMINI_API_KEY; }

async function callGemini(payload) {
  // 2.5系の思考(thinking)を無効化。有効だと推論文が出力に混ざるため。
  payload.generationConfig = payload.generationConfig || {};
  if (payload.generationConfig.thinkingConfig === undefined) payload.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(MODEL) + ':generateContent?key=' + encodeURIComponent(key());
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await res.text();
  if (!res.ok) throw new Error('Gemini APIエラー(' + res.status + '): ' + text.slice(0, 300));
  const json = JSON.parse(text);
  const cand = json.candidates && json.candidates[0];
  if (!cand || !cand.content || !cand.content.parts || !cand.content.parts[0]) throw new Error('Geminiから有効な応答がありません');
  return cand.content.parts[0].text || '';
}

function dataUrlParts(dataUrl, fallbackMime) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.*)$/);
  if (m) return { mime: m[1], data: m[2] };
  return { mime: fallbackMime || 'application/octet-stream', data: String(dataUrl || '') };
}

async function formatShori(textInput) {
  const input = String(textInput || '').trim();
  if (!input) throw new Error('整形するテキストが空です');
  const prompt = 'あなたは製造設備の保守報告の校正者です。次の口述メモを、作業報告書の「処置」欄向けに、' +
    '事実のみ・敬体（です・ます調）・簡潔な文章へ整えてください。推測や誇張はせず、箇条書きにはせず自然な文章にし、整形後の本文のみを出力してください。\n\n【口述メモ】\n' + input;
  const out = await callGemini({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } });
  return String(out).trim();
}

async function transcribe(audio, mime) {
  const p = dataUrlParts(audio, mime || 'audio/webm');
  if (!p.data) throw new Error('音声データが空です');
  const prompt = 'この音声を日本語で文字起こしし、現場作業報告書の「処置」欄に入れる文章へ整えてください。' +
    '事実のみ・敬体・簡潔に。言い淀み・重複・不要な前置きは除去し、整形後の本文のみを出力してください。';
  const out = await callGemini({
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: p.mime, data: p.data } }] }],
    generationConfig: { temperature: 0.2 }
  });
  return String(out).trim();
}

async function readPlate(image) {
  const p = dataUrlParts(image, 'image/jpeg');
  if (!p.data) throw new Error('画像データが空です');
  const prompt = 'これはアルミ銘板（ネームプレート）の写真です。機種・型式・製番・製造年月を読み取りJSONで返してください。' +
    '対応の目安：機種=MODEL/機種, 型式=TYPE/型式, 製番=No./SERIAL/製造番号, 製造年月=製造年月/DATE。製造年月は可能なら YYYY-MM。読めない項目は空文字。';
  const out = await callGemini({
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: p.mime, data: p.data } }] }],
    generationConfig: {
      temperature: 0,
      response_mime_type: 'application/json',
      response_schema: {
        type: 'OBJECT',
        properties: { kishu: { type: 'STRING' }, katashiki: { type: 'STRING' }, seiban: { type: 'STRING' }, nenGappi: { type: 'STRING' } },
        required: ['kishu', 'katashiki', 'seiban', 'nenGappi']
      }
    }
  });
  let obj; try { obj = JSON.parse(out); } catch (e) { throw new Error('銘板の解析結果を解釈できませんでした'); }
  return { kishu: String(obj.kishu || ''), katashiki: String(obj.katashiki || ''), seiban: String(obj.seiban || ''), nenGappi: String(obj.nenGappi || '') };
}

module.exports = { enabled, formatShori, transcribe, readPlate };
