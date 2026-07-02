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
  // "data:<mime>[;params];base64,<data>" を安全に分解（mimeに ;codecs=... 等が付く場合に対応）
  const s = String(dataUrl || '');
  const marker = ';base64,';
  const i = s.indexOf(marker);
  if (s.slice(0, 5) === 'data:' && i >= 0) {
    let mime = s.slice(5, i);
    mime = mime.split(';')[0].trim() || (fallbackMime || 'application/octet-stream'); // パラメータ除去
    return { mime: mime, data: s.slice(i + marker.length) };
  }
  return { mime: fallbackMime || 'application/octet-stream', data: s };
}
// 入力サイズ・MIME検証（コストDoS/過大送信の防止）
var MAX_B64 = 14 * 1024 * 1024; // 約10MBデコード相当
function checkMedia(p, allowPrefix) {
  if (!p.data) throw new Error('データが空です');
  if (p.data.length > MAX_B64) throw new Error('ファイルが大きすぎます（約10MBまで）');
  if (allowPrefix && String(p.mime || '').indexOf(allowPrefix) !== 0) throw new Error('対応していない形式です: ' + p.mime);
}

// 整形スタイル指定（自動判断がデフォルト）
function styleLine(style) {
  switch (style) {
    case 'bullet': return '・構成は必ず ● を使った箇条書きにする（各項目は簡潔に）。';
    case 'number': return '・構成は必ず ①②③… の番号付き手順にする。';
    case 'heading': return '・内容を【原因】【作業内容】【結果】などの見出しで区分する（該当する見出しのみ使用。各見出しの下は簡潔に）。';
    case 'plain': return '・箇条書きや見出しは使わず、自然な文章（1〜数文）にする。';
    default: return '・内容に応じて最適な構成を自動で選ぶ（単純→自然文／手順が複数→①②③／並列項目→●／原因・作業・結果が混在→【見出し】で区分）。';
  }
}
// 「処置」欄向けの共通整形指示（音声・テキスト共用）
function instruction(style) {
  return [
    'あなたは製造設備の保守報告の校正者です。入力内容を、作業報告書の「処置」欄に載せる読みやすい文章へ整えてください。',
    'この報告書は最終的にお客様がお読みになります。',
    '【文体・トーン（ハイブリッド）】',
    '・丁寧さ：お客様が読んで失礼のない、丁寧で分かりやすい敬体（です・ます調）にする。ただし過度な謙譲表現や定型の挨拶文（お世話になっております等）は入れず、本文として簡潔に。',
    '・専門性：専門用語・部品名・型式・製番・数値・寸法・単位は正確にそのまま用い、平易化しすぎない。技術的な正確さを損なわない。',
    '【厳守事項】',
    '・事実のみ。推測・誇張・入力に無い情報の追加は禁止（専門用語の補足も、入力から明らかな範囲に限る）。',
    '・言い淀み（えー/あの/なんか 等）・重複・不要な前置きは除去。',
    '・簡潔にまとめ、全体で概ね600字以内（最大でも800字）に収める。冗長な言い換えはしない。',
    '・使用してよい記号は ●（箇条書き）／ ①②③（番号）／ 【見出し】 のみ。Markdown(#,*,**)や表は使わない。',
    '・出力は整形後の本文のみ（説明・思考・前置きは一切書かない）。',
    styleLine(style),
    '',
    '【出力例】',
    '入力「ブレーキ交換して動作確認オッケー」→ 「ブレーキを交換し、動作確認を実施しました。異常はありませんでした。」',
    '入力「まず分解して清掃、その後グリス入れて組み立て、最後に試運転」→ 「①分解し清掃を実施しました。\n②規定グリスを充填しました。\n③組み立て後、試運転を行い正常を確認しました。」',
    '入力「異音の原因は軸受摩耗。軸受交換して芯出しした。試運転で異音消えた」→ 「【原因】\n軸受の摩耗により異音が発生していました。\n【作業内容】\n軸受を交換し、芯出しを実施しました。\n【結果】\n試運転にて異音の解消を確認しました。」'
  ].join('\n');
}

async function formatShori(textInput, style) {
  const input = String(textInput || '').trim();
  if (!input) throw new Error('整形するテキストが空です');
  if (input.length > 20000) throw new Error('テキストが長すぎます');
  const prompt = instruction(style) + '\n\n【入力】\n' + input;
  const out = await callGemini({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } });
  return String(out).trim();
}

async function transcribe(audio, mime, style) {
  const p = dataUrlParts(audio, mime || 'audio/webm');
  checkMedia(p, 'audio/');
  const prompt = 'まず音声を日本語で文字起こしし、その内容を次の方針で整えてください。\n\n' + instruction(style);
  const out = await callGemini({
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: p.mime, data: p.data } }] }],
    generationConfig: { temperature: 0.2 }
  });
  return String(out).trim();
}

async function readPlate(image) {
  const p = dataUrlParts(image, 'image/jpeg');
  checkMedia(p, 'image/');
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
