// 帳票型入力の E2E テスト（手順は同フォルダの README.md）。
// 前提: テスト用サーバーが http://localhost:5199 、Chrome が --remote-debugging-port=9333 で起動済み、
//       DB は seed-master.js で初期化したばかり（同じDBで2回流すと前回の入力が残り結果がずれる）。
const puppeteer = require('puppeteer-core');
const OUT = __dirname + '/shots/';
require('fs').mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, info) { results.push((ok ? 'PASS ' : 'FAIL ') + name + (info ? ' :: ' + info : '')); }

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333' });
  const page = await browser.newPage();
  const errors = global.__errs = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('response', r => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.request().method() + ' ' + r.url()); });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 1000 });
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle0' });
  const click = async sel => {
    await page.waitForSelector(sel, { timeout: 5000 });
    // 帳票内の枠は、人がスクロールするのと同じく画面中央に寄せてから押す（上下の固定バーに隠れないように）
    await page.$eval(sel, e => { if (e.closest('.fs-paper')) e.scrollIntoView({ block: 'center' }); });
    await sleep(80);
    await page.click(sel); await sleep(300);
  };
  const txt = sel => page.$eval(sel, e => e.innerText);
  const sheetOpen = () => page.$('.fs-sheet').then(Boolean);
  const h3 = () => page.$eval('.fs-shd h3', e => e.textContent);
  const closeSheet = () => click('.fs-acts button[data-act="fsClose"]');

  // ---- 新規（管理者）LW ----
  await click('[data-act="goNewType"]');
  await click('[data-act="pickLW"]');
  await page.screenshot({ path: OUT + '01_new_pc.png' });
  check('新規: 帳票が表示', !!(await page.$('.fs-paper')));
  check('新規: 次の未入力件数', /次の未入力へ/.test(await txt('.fs-next')), await txt('.fs-next'));

  await click('[data-fsid="koban"]');
  check('工番パネルが開く', await sheetOpen());
  await page.type('#fs-in-koban', 'LW231');
  await sleep(150);
  const sug = await page.$$eval('.fs-sugg button b', b => b.map(x => x.textContent));
  check('工番候補が出る', sug.length > 0, JSON.stringify(sug));
  await click('[data-act="fsPickKoban"]');
  const ok1 = await txt('[data-fsid="okyaku"]');
  check('工番選択でお客様名が入る', /住友建機/.test(ok1), ok1.replace(/\n/g, ' '));
  check('機種も入る', /ポジショナー/.test(await txt('[data-fsid="kishu"]')));
  check('住所も入る', /長沼原町/.test(await txt('[data-fsid="customer"]')));

  // 工番の手入力（完全一致）→閉じるで補完
  await click('[data-fsid="koban"]');
  await page.$eval('#fs-in-koban', e => { e.value = ''; });
  await page.type('#fs-in-koban', 'LW25083');
  await closeSheet();
  check('工番手入力→閉じるで補完', /三星重工業/.test(await txt('[data-fsid="okyaku"]')));

  // 作業者名
  await click('[data-fsid="staff"]');
  await page.type('#fs-in-staff-0', '小林 椿');
  await page.select('select[data-chg="addStaffFromMaster"]', '1010');
  await sleep(200);
  check('名簿から追加しても入力パネルが開いたまま', await sheetOpen());
  const names = await page.$$eval('.fs-srow input', a => a.map(x => x.value));
  check('作業者2名', names.length === 2 && names[0] === '小林 椿' && names[1] === '今泉', JSON.stringify(names));
  await closeSheet();
  check('作業者名が帳票に出る', /小林 椿・今泉/.test(await txt('[data-fsid="staff"]')));

  // 次の未入力へで巡回
  await click('.fs-bar [data-act="fsNext"]');
  const firstNext = await h3();
  check('次の未入力へ→最初は作業の種類', firstNext === '作業の種類', firstNext);
  await click('.fs-sheet [data-act="toggleWorkType"][data-key="据付"]');
  await click('.fs-acts [data-act="fsNext"]');
  const t2 = await h3();
  check('次へ→作業日', t2 === '作業日', t2);
  await page.$eval('#fs-in-yoteibi', e => { e.value = '2026-10-01'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('.fs-acts [data-act="fsNext"]');
  const t3 = await h3();
  check('次へ→作業内容', t3 === '【作業内容】', t3);
  await page.type('#fs-in-genin', '13m切断走行台車 搬入据付SV作業');
  await click('.fs-acts [data-act="fsNext"]');
  check('新規: 管理者欄が全部埋まると入力済み', /入力済み/.test(await txt('.fs-next')), await txt('.fs-next'));
  check('作業種別の丸', !!(await page.$('.fs-wt.on')));
  check('作業日表示', /2026\/10\/01/.test(await txt('[data-fsid="date"]')));
  // 作業日の期間（開始日〜終了日）。開始日以前の終了日は消える
  await click('[data-fsid="date"]');
  check('作業日: 終了日の欄がある', !!(await page.$('#fs-in-yoteibiEnd')));
  const setEnd = v => page.$eval('#fs-in-yoteibiEnd', (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  await setEnd('2026-09-30');
  check('作業日: 開始日より前の終了日は消える', (await page.$eval('#fs-in-yoteibiEnd', e => e.value)) === '');
  await setEnd('2026-10-03');
  await closeSheet();
  const dr = await txt('[data-fsid="date"]');
  check('作業日: 期間表示 2026/10/01〜10/03', /2026\/10\/01\s*〜10\/03/.test(dr), dr.replace(/\n/g, ' '));
  // 帳票に載らない項目
  await click('.fs-meta');
  await page.type('#fs-in-kobanName', '13m切断走行 据付');
  await page.type('#fs-in-nohinNo', 'D-1180');
  await closeSheet();
  check('工番名が表示', /13m切断走行 据付/.test(await txt('.fs-meta')));
  check('新規: 作業者の欄は入力不可', !!(await page.$('.fs-off[data-fsid="shori"]')));
  await page.screenshot({ path: OUT + '02_new_filled_pc.png', fullPage: true });
  await click('[data-act="saveCase"]');
  await sleep(800);
  const home = await txt('.scr');
  check('保存して案件ストックへ', /LW25083/.test(home) && /13m切断走行 据付/.test(home));
  check('案件ストック: 予定が期間表示', /予定 ： 2026\/10\/01〜10\/03/.test(home));

  // ---- 作業者：報告書入力 ----
  const cards = await page.$$eval('[data-act="openCase"]', a => a.map(x => ({ id: x.getAttribute('data-id'), t: x.innerText })));
  const mine = cards.filter(c => /13m切断走行 据付/.test(c.t))[0];
  await click('[data-act="openCase"][data-id="' + mine.id + '"]');
  await sleep(400);
  check('報告書: 帳票表示', !!(await page.$('.fs-paper')));
  check('報告書: 実施内容が入力可', !!(await page.$('.fs-f[data-fsid="shori"]')));
  const tan = await txt('[data-fsid="tantousha"]');
  check('報告書: 御担当者名に作業者名が入らない（未入力のまま）', !/小林|今泉/.test(tan) && await page.$eval('[data-fsid="tantousha"]', e => e.classList.contains('empty')), tan.replace(/\n/g, ' '));

  // 作業時間の行 → ドラム
  await click('[data-fsid="row:commonWork:0"]');
  check('時刻パネルが開く', await sheetOpen());
  await sleep(3000); // 回さずに放置 → 閉じないこと（元のバグ）
  check('ドラム: 放置しても閉じない', await sheetOpen());
  const before = await page.$eval('#fs-tab-start', e => e.textContent);
  check('ドラム: 開いただけでは値が入らない', before === '--:--', before);
  await page.$eval('#fs-drum-h', e => { e.scrollTop = 9 * 40; e.dispatchEvent(new Event('scroll')); });
  await page.$eval('#fs-drum-m', e => { e.scrollTop = 7 * 40; e.dispatchEvent(new Event('scroll')); });
  await sleep(400);
  const st = await page.$eval('#fs-tab-start', e => e.textContent);
  check('ドラム: 開始 09:07（1分単位）', st === '09:07', st);
  await sleep(2000);
  check('ドラム: 回した後に止めても閉じない', await sheetOpen());
  await click('.fs-tabs [data-w="end"]');
  await sleep(400);
  await page.$eval('#fs-drum-h', e => { e.scrollTop = 17 * 40; e.dispatchEvent(new Event('scroll')); });
  await page.$eval('#fs-drum-m', e => { e.scrollTop = 42 * 40; e.dispatchEvent(new Event('scroll')); });
  await sleep(400);
  const en = await page.$eval('#fs-tab-end', e => e.textContent);
  check('ドラム: 終了 17:42', en === '17:42', en);
  await closeSheet();
  const row = await txt('[data-fsid="row:commonWork:0"]');
  check('帳票の行に時刻と計', /09:07/.test(row) && /17:42/.test(row) && /8時間 35分/.test(row), row.replace(/\n/g, ' '));

  // 移動時間
  await click('[data-fsid="row:commonTravel:0"]');
  await click('.fs-sheet [data-act="fsDir"][data-val="復路"]');
  check('移動: 区分切替後もパネル維持', await sheetOpen());
  await page.type('#fs-in-rkm', '45');
  await page.$eval('#fs-drum-h', e => { e.scrollTop = 7 * 40; e.dispatchEvent(new Event('scroll')); });
  await sleep(400);
  await closeSheet();
  const trow = await txt('[data-fsid="row:commonTravel:0"]');
  check('移動: 復路・45Km', /復路/.test(trow) && /45 Km/.test(trow), trow.replace(/\n/g, ' '));
  check('移動: 途中入力は未入力扱い', await page.$eval('[data-fsid="row:commonTravel:0"]', e => e.classList.contains('empty')));

  // 行の追加・削除
  await click('[data-act="fsAddRow"][data-kind="work"]');
  check('行追加→その行のパネルが開く', /作業時間/.test(await h3()));
  const nd = await page.$eval('#fs-in-rdate', e => e.value);
  check('行追加: 日付は前の行の翌日', nd === '2026-10-02', nd);
  await click('.fs-rowacts .del');
  check('行削除', !(await page.$('[data-fsid="row:commonWork:1"]')));

  // 確認事項タップで切替
  await click('[data-fsid="cf:brake"]');
  check('確認事項タップで✓', /✓/.test(await txt('[data-fsid="cf:brake"]')));

  // 実施内容 → 音声ボタンで音声モーダル（下書き引継ぎ）
  await click('[data-fsid="shori"]');
  await page.type('#fs-in-shori', 'スライダー高さを20mm上げた');
  await click('.fs-sheet [data-act="fsVoice"]');
  check('音声モーダルに今の文章を引継ぎ', (await page.$eval('textarea[data-chg="voiceText"]', e => e.value)) === 'スライダー高さを20mm上げた');
  await click('[data-act="aiFormatVoice"]');
  await sleep(1200);
  await click('[data-act="applyVoice"]');
  check('音声→実施内容に反映', /スライダー高さを20mm上げた/.test(await txt('[data-fsid="shori"]')));

  // 別行動
  await click('[data-fsid="staff"]');
  await click('.fs-srow:nth-child(2) [data-act="setSeparate"][data-val="true"]');
  await closeSheet();
  check('別行動の行が出る', !!(await page.$('[data-fsid="row:work:0:1"]')));
  await click('[data-act="fsAddRow"][data-kind="work"]');
  check('別行動あり→誰の行か聞く', /誰の行/.test(await txt('.fs-shd')));
  await closeSheet();

  // 確認印
  await click('[data-fsid="kanin"]');
  await click('.fs-sheet [data-act="toggleStamp"]');
  check('確認印パネル維持＋押印', (await sheetOpen()) && !!(await page.$('.fs-sheet .fs-stamp')));
  await closeSheet();
  check('帳票に押印', !!(await page.$('[data-fsid="kanin"] .fs-stamp')));
  await page.screenshot({ path: OUT + '03_report_pc.png', fullPage: true });

  // プレビューに反映
  await click('[data-act="goPreview"]');
  await sleep(600);
  const pv = await txt('#pdf-print');
  check('PDFプレビューに時刻', /09:07/.test(pv) && /17:42/.test(pv));
  check('PDFプレビューに実施内容', /スライダー/.test(pv));
  check('PDF: 作業日が期間', /2026\/10\/01\s*〜10\/03/.test(pv));
  check('LW PDF: 住所は千種町69-1', /千種町69-1/.test(pv) && !/千種町53/.test(pv));
  check('LW PDF: 紙どおりの連絡先', /株式会社 ラインワークス\s*殿/.test(pv) && /043-250-1481/.test(pv) && /043-257-9488/.test(pv) && !/0165/.test(pv));
  await click('[data-act="goBack"]');
  await sleep(300);

  // サイン欄 → サイン画面
  await click('[data-fsid="sign"]');
  await sleep(300);
  check('サイン枠→サイン画面', !!(await page.$('#sigpad')));
  await click('[data-act="goBack"]');
  await sleep(300);

  // 一時保存 → 再度開いて値が残る
  await click('[data-act="goHome"]');
  await sleep(900);
  await click('[data-act="openCase"][data-id="' + mine.id + '"]');
  await sleep(500);
  check('保存後も時刻が残る', /09:07/.test(await txt('[data-fsid="row:commonWork:0"]')));

  // ---- TS 案件 ----
  await click('[data-act="goHome"]'); await sleep(900);
  const ts = (await page.$$eval('[data-act="openCase"]', a => a.map(x => ({ id: x.getAttribute('data-id'), t: x.innerText })))).filter(c => /^TS2/.test(c.t.trim()))[0];
  await click('[data-act="openCase"][data-id="' + ts.id + '"]');
  await sleep(500);
  check('TS: バッジ', /TS工番/.test(await txt('.fs-bar')));
  check('TS: 確認印欄はTSC', /TSC/.test(await txt('[data-fsid="kanin"]')));
  const tsTxt = await txt('.fs-paper');
  check('TS: 宛先はテクノサービスカンパニー 殿', /テクノサービスカンパニー\s*殿/.test(tsTxt));
  check('TS: 紙どおりの連絡先', /043-250-1481/.test(tsTxt) && /043-301-2465/.test(tsTxt) && /株式会社 ラインワークス＞/.test(tsTxt));
  await click('[data-act="goPreview"]'); await sleep(500);
  const tsPv = await txt('#pdf-print');
  check('TS PDF: 宛先・連絡先も紙どおり', /テクノサービスカンパニー\s*殿/.test(tsPv) && /043-301-2465/.test(tsPv));
  check('TS PDF: ロゴTSC・住所69-1', /(^|\n)TSC(\n|$)/.test(tsPv) && /千種町69-1/.test(tsPv));
  await click('[data-act="goBack"]'); await sleep(300);
  check('TS: TS用の確認事項', /動作確認/.test(tsTxt) && /清掃・片付け/.test(tsTxt));
  check('TS: LWロゴではない', !(await page.$('.fs-paper img.fs-logo')));
  check('TS 帳票: ロゴTSC・住所69-1', (await txt('.fs-tslogo')) === 'TSC' && /千種町69-1/.test(tsTxt));
  await click('[data-fsid="koban"]');
  await page.type('#fs-in-koban', ''); // 既存の工番は消さない
  const tsSug = await page.$$eval('.fs-sugg button b', b => b.map(x => x.textContent));
  check('TS: 工番候補はTS', tsSug.length > 0 && tsSug.every(x => /^TS/.test(x)), JSON.stringify(tsSug));
  await page.keyboard.press('Escape');
  await sleep(200);
  check('Escで閉じる', !(await sheetOpen()));
  await page.screenshot({ path: OUT + '04_ts_pc.png', fullPage: true });

  // ---- 新規 TS ----
  await click('[data-act="goHome"]'); await sleep(900);
  await click('[data-act="goNewType"]'); await click('[data-act="pickTS"]');
  await click('[data-fsid="koban"]');
  await page.type('#fs-in-koban', '君津');
  await sleep(150);
  const s2 = await page.$$eval('.fs-sugg button b', b => b.map(x => x.textContent));
  check('納入先名でも工番を検索', s2.indexOf('TS25201') >= 0, JSON.stringify(s2));
  await page.$eval('#fs-in-koban', e => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await closeSheet();
  await click('.fs-meta');
  check('TS新規: 納品番号の欄なし', !(await page.$('#fs-in-nohinNo')));
  await closeSheet();
  await click('[data-act="saveCase"]');
  check('必須未入力で保存→工番欄が開く', (await h3()) === '工番 №');
  await closeSheet();

  // ---- タブレット（実機サイズ）とスマホ ----
  await page.setViewport({ width: 820, height: 1180 });
  await sleep(400);
  await page.screenshot({ path: OUT + '05_tablet_new_ts.png' });
  const zt = await page.$eval('.fs-paper', e => getComputedStyle(e).zoom);
  check('タブレット: 等倍(縮小なし)', zt === '1', zt);
  await click('[data-act="goBack"]'); await sleep(300);
  await click('[data-act="goBack"]'); await sleep(300);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await sleep(400);
  await click('[data-act="openCase"][data-id="' + mine.id + '"]');
  await sleep(500);
  await page.screenshot({ path: OUT + '06_mobile_report.png' });
  const zm = await page.$eval('.fs-paper', e => getComputedStyle(e).zoom);
  const ow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('スマホ: 画面幅に縮小・横はみ出しなし', parseFloat(zm) < 1 && ow, 'zoom=' + zm);
  await page.tap('[data-fsid="row:commonWork:0"]');
  await sleep(500);
  await page.screenshot({ path: OUT + '07_mobile_drum.png' });
  check('スマホ: 時刻パネル', await sheetOpen());
  await sleep(2500);
  check('スマホ: 放置しても閉じない', await sheetOpen());
  await page.tap('.fs-acts button[data-act="fsClose"]');
  await sleep(200);
  await page.tap('[data-act="fsZoom"]');
  await sleep(300);
  await page.screenshot({ path: OUT + '08_mobile_zoom.png' });
  const zz = await page.$eval('.fs-paper', e => getComputedStyle(e).zoom);
  const ow2 = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('スマホ: 拡大は等倍で帳票内だけ横スクロール', zz === '1' && ow2, 'zoom=' + zz);

  check('JSエラーなし', errors.length === 0, errors.join(' | '));
  console.log(results.join('\n'));
  browser.disconnect();
})().catch(e => { console.log(results.join('\n')); console.log('ERRORS', JSON.stringify(global.__errs || [])); console.error('ABORT', e.message); process.exit(1); });
