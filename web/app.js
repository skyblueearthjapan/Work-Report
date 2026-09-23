/* =========================================================================
 * デジタル作業報告書アプリ — フロント（HtmlService / vanilla JS）
 * 参照実装 作業報告書アプリ.dc.html を移植。
 * S2: 全9画面＋モーダルのUI/操作（メモリ内state）。永続化/AI/PDF/メールは後続S。
 * ======================================================================= */
(function () {
  'use strict';

  var BOOT = window.BOOT || {};
  var COMPANY = BOOT.company || { companyLW: 'LINE W', companyTS: 'テクノサービス' };
  // 帳票（PDF）に印字する宛先・社名・連絡先。紙の作業書（Sampledata の LW25083 / TS26052）を正とする。
  var PAPER_CO = {
    LW: { name: '株式会社 ラインワークス', parent: '', tel: '043-250-1481', fax: '043-257-9488' },
    TS: { name: 'テクノサービスカンパニー', parent: '＜株式会社 ラインワークス＞', tel: '043-250-1481', fax: '043-301-2465' }
  };
  var PAPER_ADDR = '〒262-0012　千葉県千葉市花見川区千種町53';
  function paperCo(type) { return PAPER_CO[type === 'TS' ? 'TS' : 'LW']; }
  // フッターの社名・住所・連絡先（帳票画面とPDFプレビューで共通）
  function paperFootText(type) { var p = paperCo(type); return esc(PAPER_ADDR) + (p.parent ? '<br>' + esc(p.parent) : '') + '<br>Tel ' + esc(p.tel) + ' ／ Fax ' + esc(p.fax); }
  var TODAY = BOOT.today || '2026-06-30';
  var WT = ['据付', '移設', '納品', '点検', '改造', '修理', '調査'];
  var MASTER = BOOT.master || { kobans: [], staff: [], depts: [], importedAt: '' };
  // 社内ポータル(GAS)。出図管理／在庫管理／残業・休日出勤申請アプリと同一の遷移先。
  var PORTAL_URL = 'https://script.google.com/a/macros/lineworks-local.info/s/AKfycbx2eyJMOYP9o--GPBuhY-pj071IIR6Kqb_0xALwwNzdLQZux0dIAlL3P9EoCucnzXA/exec';
  // 文字数上限（PDFレイアウト崩れ防止・延々入力の抑止）
  // ボリューム上限（改行も加算＝空行の連発でPDFが伸びるのを抑止）
  var LIMIT = { genin: 300, shori: 500 };
  var NL_WEIGHT = 20; // 改行1つ ≒ 20文字分（1行分の高さに相当）
  function volume(s) { var str = String(s || ''); var nl = (str.match(/\n/g) || []).length; return str.length + nl * NL_WEIGHT; }
  // volume(prefix) <= max となる最長prefixを返す（超過分を末尾から切り詰め）
  function capVolume(str, max) {
    if (volume(str) <= max) return str;
    var lo = 0, hi = str.length;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (volume(str.slice(0, mid)) <= max) lo = mid; else hi = mid - 1; }
    return str.slice(0, lo);
  }
  // ボリューム・カウンタ（改行込みの実質量／上限）。live更新は下部の input リスナ
  function taCounter(id, val, max) {
    var v = volume(val); var over = v >= max;
    return '<div id="' + id + '" data-cmax="' + max + '" style="text-align:right;font:600 10.5px \'Noto Sans JP\',sans-serif;color:' + (over ? '#c0392b' : 'var(--muted)') + ';margin-top:3px">' + v + ' / ' + max + '</div>';
  }

  // 工番マスタから該当工番を検索（前後空白無視）
  function masterKoban(koban) {
    var k = String(koban || '').trim();
    if (!k) return null;
    var list = MASTER.kobans || [];
    for (var i = 0; i < list.length; i++) if (String(list[i].koban).trim() === k) return list[i];
    return null;
  }
  // 設定の出張部署を配列で
  function getTravelDepts() {
    var raw = (S.settings && S.settings.travelDepts) || '';
    return String(raw).split(/[,、\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  // 部署の全一覧（部署マスタ ∪ 作業員マスタの部署）を出張部署→その他の順で
  function allDepts() {
    var set = {}, order = [];
    (MASTER.depts || []).forEach(function (d) { if (d && !set[d]) { set[d] = 1; order.push(d); } });
    (MASTER.staff || []).forEach(function (s) { if (s.dept && !set[s.dept]) { set[s.dept] = 1; order.push(s.dept); } });
    return order;
  }
  // 既定は出張部署のみ。S.pickAllDepts=true のときだけ全部署（出張部署を上位）を表示。
  function pickerDepts() {
    var all = allDepts();
    var travel = getTravelDepts().filter(function (d) { return all.indexOf(d) >= 0; });
    if (S.pickAllDepts) {
      var tset = {}; travel.forEach(function (d) { tset[d] = 1; });
      return travel.concat(all.filter(function (d) { return !tset[d]; }));
    }
    return travel.length ? travel : all; // 出張部署が未設定なら全部署
  }

  /* ---------------- state ---------------- */
  var S = {
    screen: 'home', history: [], filter: 'all', activeId: null,
    draftType: 'LW', sent: false, settingsSaved: false, nfError: false, menuId: null, editId: null,
    voiceOpen: false, vTarget: 'shori', vListening: false, vRaw: '', vInterim: '', vProcessing: false, vResult: '', vError: '',
    plateOpen: false, plateImg: '', plateProcessing: false, plateResult: null,
    histQuery: '', histType: 'all', closingId: null,
    historyList: [], historyLoading: false,
    archivedCount: BOOT.historyCount || 0,
    busy: false, toastMsg: '', toastErr: false,
    mode: 'tablet',
    newForm: blankForm('LW'),
    settings: BOOT.settings || {},
    cases: (BOOT.cases || [])
  };

  /* ---------------- server bridge (VPS REST) ---------------- */
  // 旧GASの server(fn,...args) を、VPSのREST API呼び出しに写像。UI側は無改修で流用。
  function _http(method, url, body) {
    var opt = { method: method, headers: {} };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(url, opt).then(function (r) {
      return r.text().then(function (t) {
        var j = t ? JSON.parse(t) : {};
        if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
        return j;
      });
    });
  }
  var _api = {
    getAppState: function () { return _http('GET', '/api/state'); },
    getCase: function (id) { return _http('GET', '/api/cases/' + encodeURIComponent(id)); },
    saveCase: function (c) { return _http('POST', '/api/cases', c).then(function (r) { return r.id; }); },
    duplicateCase: function (id) { return _http('POST', '/api/cases/' + encodeURIComponent(id) + '/duplicate').then(function (r) { return r.id; }); },
    deleteCase: function (id) { return _http('DELETE', '/api/cases/' + encodeURIComponent(id)).then(function (r) { return r.ok; }); },
    closeCase: function (id) { return _http('POST', '/api/cases/' + encodeURIComponent(id) + '/close').then(function (r) { return r.ok; }); },
    stampKanin: function (id, name) { return _http('POST', '/api/cases/' + encodeURIComponent(id) + '/stamp', { name: name }).then(function (r) { return r.ok; }); },
    getHistory: function (q, type) { return _http('GET', '/api/history?q=' + encodeURIComponent(q || '') + '&type=' + encodeURIComponent(type || 'all')); },
    getSettings: function () { return _http('GET', '/api/settings'); },
    saveSettings: function (o) { return _http('POST', '/api/settings', o); },
    saveSignature: function (id, dataUrl) { return _http('POST', '/api/cases/' + encodeURIComponent(id) + '/signature', { dataUrl: dataUrl }); },
    saveReportPdf: function (id, b64) { return _http('POST', '/api/cases/' + encodeURIComponent(id) + '/pdf', { pdfBase64: b64 }); },
    sendReportMail: function (id) { return _http('POST', '/api/cases/' + encodeURIComponent(id) + '/mail'); },
    aiFormatShori: function (text, style) { return _http('POST', '/api/ai/format', { text: text, style: style }).then(function (r) { return r.text; }); },
    aiReadPlate: function (image) { return _http('POST', '/api/ai/plate', { image: image }); },
    aiTranscribe: function (audio, mime, style) { return _http('POST', '/api/ai/transcribe', { audio: audio, mime: mime, style: style }).then(function (r) { return r.text; }); },
    refreshMaster: function () { return _http('POST', '/api/master/refresh'); }
  };
  function server(fn) {
    var args = [].slice.call(arguments, 1);
    var f = _api[fn];
    if (!f) return Promise.reject(new Error('unknown api: ' + fn));
    return f.apply(null, args);
  }
  function errMsg(e) { return (e && e.message) ? e.message : String(e || 'エラーが発生しました'); }
  var _toastTimer = null;
  function toast(msg, isErr) {
    S.toastMsg = msg; S.toastErr = !!isErr; paintOverlays();
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { S.toastMsg = ''; paintOverlays(); }, isErr ? 5000 : 2200);
  }
  function setBusy(v) { S.busy = v; paintOverlays(); }
  // 案件一覧＋履歴件数をサーバーから再取得して state を同期
  function reloadState(then) {
    setBusy(true);
    return server('getAppState').then(function (st) {
      setState({ cases: st.cases, archivedCount: st.historyCount, busy: false });
      if (then) then();
    }).catch(function (e) { setBusy(false); toast(errMsg(e), true); });
  }
  // アクティブ案件をサーバーへ保存（署名dataURLはサーバー側で無視＝S4でDrive化）
  function persistActive() {
    var c = findCase(S.activeId);
    if (!c) return Promise.resolve();
    return server('saveCase', c);
  }
  // 履歴をサーバー検索して state に格納
  function loadHistory() {
    setState({ historyLoading: true });
    server('getHistory', S.histQuery, S.histType).then(function (rows) {
      setState({ historyList: rows || [], historyLoading: false });
    }).catch(function (e) { setState({ historyLoading: false }); toast(errMsg(e), true); });
  }

  function setState(patch) {
    var next = (typeof patch === 'function') ? patch(S) : patch;
    for (var k in next) if (Object.prototype.hasOwnProperty.call(next, k)) S[k] = next[k];
    render();
  }

  /* ---------------- helpers ---------------- */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid(p) { return (p || 'id') + Math.random().toString(36).slice(2, 8); }
  function defaultConfirm(type) {
    if (type === 'LW') return [
      { key: 'brake', label: 'ブレーキ調整スイッチOFF', value: '' },
      { key: 'rbpos', label: 'R/B+POSの作業原点復帰', value: '' },
      { key: 'force', label: '強制運転時からの復帰', value: '' }];
    return [
      { key: 'doukou', label: '動作確認', value: '' },
      { key: 'anzen', label: '安全確認', value: '' },
      { key: 'souji', label: '清掃・片付け', value: '' }];
  }
  function blankForm(type) {
    return {
      type: type, status: '未着手', koban: '', motoKoban: '', nohinNo: '', kobanName: '',
      nohinSaki: '', okyakuSub: '', basho: '', tantou: '', tel: '', kishu: '', katashiki: '',
      seiban: '', nenGappi: '', saidaiSekisai: '', hontaiJuryo: '', yoteibi: '', shijiNaiyou: '', workTypes: {}, paid: '有償',
      genin: '', shori: '', confirmItems: defaultConfirm(type),
      staff: [{ id: 's1', name: '', separate: false }],
      commonWork: [{ date: '', start: '', end: '' }],
      commonTravel: [{ dir: '往路', date: '', start: '', end: '', km: '' }],
      oshaName: '', tantoushaName: '', signature: '',
      kanin: { stamped: false, name: type === 'LW' ? '製造部 田中' : 'TSC 木下' }
    };
  }
  function fmtDate(d) { if (!d) return '　'; var p = String(d).split('-'); if (p.length === 3) return p[0] + '/' + p[1] + '/' + p[2]; if (p.length === 2) return p[0] + '/' + p[1]; return d; }
  function diffM(a, b) { if (!a || !b) return null; var x = a.split(':').map(Number), y = b.split(':').map(Number); var m = (y[0] * 60 + y[1]) - (x[0] * 60 + x[1]); if (m < 0) m += 1440; return m; }
  function fmtHM(m) { if (m == null || m <= 0) return '—'; return Math.floor(m / 60) + '時間' + (m % 60 ? (' ' + (m % 60) + '分') : ''); }
  function fillTemplate(str, c) { if (!str) return ''; return str.replace(/\{工番\}/g, c ? c.koban : '').replace(/\{お客様名\}/g, c ? c.nohinSaki : '').replace(/\{作業日\}/g, c ? fmtDate(c.yoteibi) : ''); }
  function pdfName(c) { if (!c) return '作業報告書'; var safe = function (x) { return String(x || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim(); }; var d = c.yoteibi || TODAY; return ['作業報告書', safe(c.nohinSaki), safe(c.kishu), safe(c.koban), safe(d)].filter(Boolean).join('_'); }
  function staffNamesOf(c) { var ns = (c.staff || []).map(function (x) { return x.name; }).filter(Boolean); return ns.length ? ns.join('・') : '—'; }
  function findCase(id) {
    var i;
    for (i = 0; i < S.cases.length; i++) if (S.cases[i].id === id) return S.cases[i];
    var h = S.historyList || [];
    for (i = 0; i < h.length; i++) if (h[i].id === id) return h[i];
    return null;
  }
  // サイン画像(dataURL)は一覧取得に含めないため、案件を開いたとき個別に読み込んで反映
  function patchCaseSignature(id) {
    server('getCase', id).then(function (full) {
      if (!full) return;
      setState(function (s) {
        var patch = function (c) { return c.id === id ? Object.assign({}, c, { signature: full.signature || '', signatureFileId: full.signatureFileId || c.signatureFileId }) : c; };
        return { cases: s.cases.map(patch), historyList: (s.historyList || []).map(patch) };
      });
    }).catch(function () {});
  }

  /* ---------------- style tokens (プロト renderVals と一致) ---------------- */
  var navy = { '--primary': '#1d3b63', '--primary-deep': '#13284a', '--primary-soft': '#eef2f8', '--primary-tint': '#cfdaea', '--primary-shadow': 'rgba(29,59,99,.28)' };
  var base = { '--bg': '#f3f4f6', '--surface': '#ffffff', '--text': '#1b2330', '--muted': '#6b7480', '--border': '#e3e6ec', '--line': '#c9ced8' };
  var FONT = "'Noto Sans JP',system-ui,sans-serif";
  var labStyle = "display:block;font:700 12.5px 'Noto Sans JP',sans-serif;color:var(--text);margin-bottom:7px";
  var inpStyle = "width:100%;height:52px;border:1.5px solid var(--border);border-radius:13px;padding:0 15px;font:600 15px 'Noto Sans JP',sans-serif;color:var(--text);background:var(--surface)";
  var miniLab = "font:700 12px 'Noto Sans JP',sans-serif;color:var(--muted);margin-bottom:7px";
  var pvLab = "font:700 8px 'Noto Sans JP',sans-serif;color:#555";
  var selStyle = "height:44px;border:1.5px solid var(--border);border-radius:11px;padding:0 10px;font:600 13.5px 'Noto Sans JP',sans-serif;color:var(--text);background:var(--surface);min-width:0";

  // 名簿からスタッフを追加するピッカー（部署で絞り込み）
  function staffPicker(scope) {
    if (!(MASTER.staff || []).length) return ''; // マスター未取込なら非表示
    var depts = pickerDepts();
    var cur = S.pickDept || depts[0] || '';
    if (depts.indexOf(cur) < 0) cur = depts[0] || '';
    var deptOpts = depts.map(function (d) { return '<option value="' + esc(d) + '"' + (d === cur ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('');
    var members = (MASTER.staff || []).filter(function (s) { return s.dept === cur; });
    var staffOpts = '<option value="">名簿から追加…</option>' + members.map(function (s) { return '<option value="' + esc(s.code) + '">' + esc(s.name) + '</option>'; }).join('');
    var allCount = allDepts().length;
    var toggle = (allCount > depts.length || S.pickAllDepts)
      ? '<button' + act('togglePickAll') + ' style="margin-top:8px;height:32px;padding:0 12px;border:1px solid var(--border);background:var(--surface);color:var(--muted);border-radius:8px;font:600 11.5px \'Noto Sans JP\',sans-serif;cursor:pointer">' + (S.pickAllDepts ? '出張部署のみ表示に戻す' : '他部署も表示（応援要員など）') + '</button>'
      : '';
    return '<div style="margin-top:6px;padding-top:12px;border-top:1px dashed var(--border)">' +
      '<div style="' + miniLab + '">名簿から追加（' + (S.pickAllDepts ? '全部署' : '出張部署') + 'で絞り込み）</div>' +
      '<div style="display:flex;gap:8px"><select' + chg('pickDept') + ' style="' + selStyle + ';flex:1">' + deptOpts + '</select>' +
      '<select' + chg('addStaffFromMaster', { scope: scope }) + ' style="' + selStyle + ';flex:1">' + staffOpts + '</select></div>' +
      toggle + '</div>';
  }

  /* data-act helper: 属性文字列を生成 */
  function act(name, params) {
    var s = ' data-act="' + name + '"';
    if (params) for (var k in params) s += ' data-' + k + '="' + esc(params[k]) + '"';
    return s;
  }
  function chg(name, params) {
    var s = ' data-chg="' + name + '"';
    if (params) for (var k in params) s += ' data-' + k + '="' + esc(params[k]) + '"';
    return s;
  }

  /* ==================================================================
   * RENDER
   * ================================================================== */
  function computeMode() { var w = window.innerWidth; return w < 700 ? 'mobile' : (w < 1180 ? 'tablet' : 'pc'); }

  function render() {
    var root = document.getElementById('root');
    // スクロール位置を保持
    var prevScroll = 0; var scr = root.querySelector('.scr'); if (scr) prevScroll = scr.scrollTop;

    var mode = S.mode;
    var isPC = mode === 'pc';
    var vars = Object.assign({}, base, navy);
    var varStr = Object.keys(vars).map(function (k) { return k + ':' + vars[k]; }).join(';');

    var rootStyle, bezelStyle, frameStyle;
    // タブレット実機でも画面いっぱいに表示する（旧プロトタイプの端末枠＝800×1160固定は実機で右端・下端が切れていた）
    if (mode === 'mobile' || mode === 'tablet') {
      rootStyle = varStr + ';min-height:100vh;background:var(--bg);font-family:' + FONT;
      bezelStyle = "background:none;padding:0;border-radius:0;box-shadow:none";
      frameStyle = "width:100vw;height:100vh;background:var(--bg);border-radius:0;overflow:hidden;display:flex;flex-direction:column;position:relative";
    } else {
      rootStyle = varStr + ';min-height:100vh;background:#e6e8ee;font-family:' + FONT + ';display:flex;justify-content:center';
      bezelStyle = "background:none;padding:0;border-radius:0;box-shadow:none;width:100%;max-width:1280px";
      frameStyle = "width:100%;height:100vh;background:var(--bg);border-radius:0;overflow:hidden;display:flex;flex-direction:column;position:relative;box-shadow:0 0 0 1px var(--border)";
    }

    var titleMap = { home: ['作業報告書', ''], newType: ['新規案件の登録', '工番の種類を選択'], newForm: ['新規案件の登録', '管理者：内容を登録'], report: ['作業報告書', ''], sign: ['サイン取得', ''], preview: ['PDFプレビュー', ''], send: ['メール送信', ''], settings: ['設定', ''], history: ['履歴管理', 'クローズ済みの作業報告書'] };
    var tm = (S.screen === 'newForm' && S.editId) ? ['案件情報の編集', '管理者：内容を修正'] : (titleMap[S.screen] || ['', '']);
    var showBack = S.screen !== 'home';

    // 社内ポータルへ移動（出図管理/在庫管理アプリと同一仕様の緑ピル・外部リンク）。狭い画面では「ポータル」に短縮。
    var portalLabel = (mode === 'mobile') ? 'ポータル' : '社内ポータルへ移動';
    var portalBtn =
      '<a href="' + PORTAL_URL + '" target="_top" data-act="goPortal" class="portal-btn" title="社内ポータルへ移動" aria-label="社内ポータルへ移動" style="display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 14px;border-radius:9999px;background:#1f9d55;color:#fff;font:600 13px \'Noto Sans JP\',sans-serif;text-decoration:none;flex:none;white-space:nowrap;transition:background .15s">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>' +
      '<span>' + portalLabel + '</span></a>';

    var header =
      '<div style="height:70px;flex:none;display:flex;align-items:center;gap:14px;padding:0 20px;background:var(--primary);color:#fff">' +
      (showBack ? '<button' + act('goBack') + ' style="width:44px;height:44px;border:none;background:rgba(255,255,255,.16);color:#fff;border-radius:12px;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none">←</button>' : '') +
      '<div style="flex:1;min-width:0"><div style="font:700 19px/1.2 \'Noto Sans JP\',sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(tm[0]) + '</div>' +
      '<div style="font:500 12px/1.3 \'Noto Sans JP\',sans-serif;opacity:.72">' + esc(tm[1]) + '</div></div>' +
      portalBtn +
      '<button' + act('goSettings') + ' style="height:40px;padding:0 14px;border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;border-radius:10px;font:600 13px \'Noto Sans JP\',sans-serif;cursor:pointer;flex:none">設定</button>' +
      '</div>';

    var body = screenBody(isPC);
    var modals = renderModals();

    var frame = '<div style="' + bezelStyle + '"><div style="' + frameStyle + '">' + header +
      // overflow-y:auto を指定すると overflow-x が auto に格上げされ横スクロールが出るため明示的に塞ぐ
      '<div class="scr" style="flex:1;overflow-y:auto;overflow-x:hidden;position:relative">' + body + '</div>' +
      modals + '</div></div>';

    // 入力中の欄を覚えておき、描き直した後も同じ欄にフォーカスを戻す（入力パネルでの打鍵を途切れさせない）
    var ae = document.activeElement, focusId = (ae && ae.id && root.contains(ae)) ? ae.id : '', selS = null, selE = null;
    if (focusId) { try { selS = ae.selectionStart; selE = ae.selectionEnd; } catch (e) {} }

    root.setAttribute('style', rootStyle);
    root.innerHTML = frame + '<div id="ovl">' + overlaysHtml() + '</div>';

    var scr2 = root.querySelector('.scr'); if (scr2) scr2.scrollTop = prevScroll;
    if (S.screen === 'sign') attachSig();
    if (S.screen === 'newForm' || S.screen === 'report') {
      fitPaper(); wireDrum();
      if (S.fsScrollTo) { scrollToField(S.fsScrollTo); S.fsScrollTo = null; }
    }
    if (focusId) { var fe = document.getElementById(focusId); if (fe) { try { fe.focus({ preventScroll: true }); if (selS !== null) fe.setSelectionRange(selS, selE); } catch (e) {} } }
  }

  // 処理中・トースト表示（画面全体を描き直さずにこの部分だけ差し替える）
  function overlaysHtml() {
    var overlays = '';
    if (S.busy) overlays += '<div style="position:fixed;top:0;left:0;right:0;z-index:200;display:flex;justify-content:center;pointer-events:none"><div style="margin-top:12px;background:rgba(15,23,42,.86);color:#fff;padding:8px 16px;border-radius:20px;font:700 12.5px \'Noto Sans JP\',sans-serif;display:flex;align-items:center;gap:8px"><span style="width:14px;height:14px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;display:inline-block;animation:spin .8s linear infinite"></span>処理中…</div></div>';
    if (S.toastMsg) overlays += '<div style="position:fixed;bottom:24px;left:0;right:0;z-index:200;display:flex;justify-content:center;pointer-events:none"><div style="background:' + (S.toastErr ? '#b03a2e' : 'rgba(15,23,42,.9)') + ';color:#fff;padding:11px 20px;border-radius:12px;font:700 13px \'Noto Sans JP\',sans-serif;max-width:80%;box-shadow:0 8px 24px rgba(0,0,0,.24)">' + esc(S.toastMsg) + '</div></div>';
    return overlays;
  }
  function paintOverlays() { var o = document.getElementById('ovl'); if (o) o.innerHTML = overlaysHtml(); else render(); }

  function screenBody(isPC) {
    switch (S.screen) {
      case 'home': return viewHome(isPC);
      case 'newType': return viewNewType();
      case 'newForm': return viewNewForm();
      case 'report': return viewReport();
      case 'sign': return viewSign();
      case 'preview': return viewPreview();
      case 'send': return viewSend();
      case 'settings': return viewSettings();
      case 'history': return viewHistory();
      default: return '';
    }
  }

  /* ---------------- HOME ---------------- */
  var statusStyleMap = { '完了': 'background:#e7f4ec;color:#1c7a45', '作業中': 'background:#fdf0dd;color:#b5760e', '未着手': 'background:#eef0f3;color:#6b7480', 'クローズ': 'background:#eef0f3;color:#6b7480' };
  function caseCardMobile(c) {
    return '<div style="position:relative;background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:0 1px 2px rgba(16,24,40,.04)">' +
      '<button' + act('openMenu', { id: c.id }) + ' style="position:absolute;top:12px;right:12px;width:38px;height:38px;border:none;background:var(--bg);color:var(--muted);border-radius:10px;font-size:20px;line-height:1;cursor:pointer;z-index:2;display:flex;align-items:center;justify-content:center">⋯</button>' +
      '<button' + act('openCase', { id: c.id }) + ' style="width:100%;text-align:left;background:none;border:none;border-radius:16px;padding:16px 18px;cursor:pointer;display:block">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-right:46px">' +
      (c.type === 'LW' ? '<span style="font:800 12px \'Noto Sans JP\',sans-serif;color:#fff;background:var(--primary);padding:4px 10px;border-radius:8px;letter-spacing:.04em">LW工番</span>'
        : '<span style="font:800 12px \'Noto Sans JP\',sans-serif;color:var(--primary);background:var(--primary-soft);border:1.5px solid var(--primary);padding:3px 10px;border-radius:8px;letter-spacing:.04em">TS工番</span>') +
      '<span style="font:800 16px \'Noto Sans JP\',sans-serif;color:var(--text);letter-spacing:.02em">' + esc(c.koban) + '</span></div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span style="flex:1;font:700 15.5px/1.4 \'Noto Sans JP\',sans-serif;color:var(--text)">' + esc(c.kobanName) + '</span>' +
      '<span style="flex:none;font:700 11.5px \'Noto Sans JP\',sans-serif;padding:5px 11px;border-radius:20px;' + (statusStyleMap[c.status] || statusStyleMap['未着手']) + '">' + esc(c.status) + '</span></div>' +
      '<div style="display:flex;flex-wrap:wrap;column-gap:18px;row-gap:5px;font:500 13px/1.4 \'Noto Sans JP\',sans-serif;color:var(--muted)">' +
      '<span>納品先 ： ' + esc(c.nohinSaki) + '</span><span>担当 ： ' + esc(staffNamesOf(c)) + '</span><span>予定 ： ' + esc(fmtDate(c.yoteibi)) + '</span></div>' +
      '</button></div>';
  }
  function caseCardPC(c) {
    return '<div style="position:relative;background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:0 1px 2px rgba(16,24,40,.04)">' +
      '<button' + act('openMenu', { id: c.id }) + ' style="position:absolute;top:12px;right:12px;width:38px;height:38px;border:none;background:var(--bg);color:var(--muted);border-radius:10px;font-size:20px;line-height:1;cursor:pointer;z-index:2;display:flex;align-items:center;justify-content:center">⋯</button>' +
      '<button' + act('openCase', { id: c.id }) + ' style="width:100%;text-align:left;background:none;border:none;border-radius:16px;padding:16px 18px;cursor:pointer;display:block">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;padding-right:46px"><span style="font:800 16px \'Noto Sans JP\',sans-serif;color:var(--text);letter-spacing:.02em">' + esc(c.koban) + '</span>' +
      '<span style="margin-left:auto;font:700 11.5px \'Noto Sans JP\',sans-serif;padding:5px 11px;border-radius:20px;' + (statusStyleMap[c.status] || statusStyleMap['未着手']) + '">' + esc(c.status) + '</span></div>' +
      '<div style="font:700 15px/1.4 \'Noto Sans JP\',sans-serif;color:var(--text);margin-bottom:8px">' + esc(c.kobanName) + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;column-gap:16px;row-gap:4px;font:500 12.5px/1.4 \'Noto Sans JP\',sans-serif;color:var(--muted)"><span>納品先 ： ' + esc(c.nohinSaki) + '</span><span>担当 ： ' + esc(staffNamesOf(c)) + '</span><span>予定 ： ' + esc(fmtDate(c.yoteibi)) + '</span></div>' +
      '</button></div>';
  }
  function viewHome(isPC) {
    var visible = S.cases.filter(function (c) { return !c.archived; });
    var filtered = visible.filter(function (c) { return S.filter === 'all' || c.type === S.filter; });
    var archivedCount = S.archivedCount;
    var mkChip = function (key, label) { var on = S.filter === key; return '<button' + act('setFilter', { val: key }) + ' style="height:42px;padding:0 18px;border-radius:21px;cursor:pointer;font:700 13.5px \'Noto Sans JP\',sans-serif;border:1.5px solid ' + (on ? 'var(--primary)' : 'var(--border)') + ';background:' + (on ? 'var(--primary)' : 'var(--surface)') + ';color:' + (on ? '#fff' : 'var(--muted)') + '">' + label + '</button>'; };

    var head = '<div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:16px">' +
      '<div><div style="font:900 22px/1.2 \'Noto Sans JP\',sans-serif;color:var(--text)">案件ストック</div>' +
      '<div style="font:500 13px/1.4 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-top:4px">出張前に登録した案件 ・ 全 ' + visible.length + ' 件</div></div>' +
      '<button' + act('goHistory') + ' style="flex:none;height:42px;padding:0 16px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:11px;font:700 13px \'Noto Sans JP\',sans-serif;cursor:pointer">履歴 ' + archivedCount + '</button></div>' +
      '<button' + act('goNewType') + ' style="width:100%;height:62px;border:none;border-radius:16px;background:var(--primary);color:#fff;font:700 17px \'Noto Sans JP\',sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 6px 18px var(--primary-shadow)"><span style="font-size:24px;line-height:1">＋</span> 新規案件を登録</button>';

    var body;
    if (!isPC) {
      var chips = '<div style="display:flex;gap:8px;margin:18px 0 14px">' + mkChip('all', 'すべて') + mkChip('LW', 'LW工番') + mkChip('TS', 'TS工番') + '</div>';
      var list = '<div style="display:flex;flex-direction:column;gap:12px">' + filtered.map(caseCardMobile).join('') + '</div>';
      body = chips + list;
    } else {
      var lw = filtered.filter(function (c) { return c.type === 'LW'; });
      var ts = filtered.filter(function (c) { return c.type === 'TS'; });
      var col = function (label, chipStyle, cnt, rows, empty) {
        return '<div><div style="display:flex;align-items:center;gap:9px;margin-bottom:12px">' + chipStyle +
          '<span style="font:700 13px \'Noto Sans JP\',sans-serif;color:var(--muted)">' + cnt + ' 件</span></div>' +
          '<div style="display:flex;flex-direction:column;gap:12px">' + (rows.length ? rows.map(caseCardPC).join('') : '<div style="text-align:center;padding:30px 0;font:600 13px \'Noto Sans JP\',sans-serif;color:var(--muted);border:1.5px dashed var(--border);border-radius:14px">' + empty + '</div>') + '</div></div>';
      };
      var lwChip = '<span style="font:800 13px \'Noto Sans JP\',sans-serif;color:#fff;background:var(--primary);padding:5px 12px;border-radius:8px;letter-spacing:.04em">LW工番</span>';
      var tsChip = '<span style="font:800 13px \'Noto Sans JP\',sans-serif;color:var(--primary);background:var(--primary-soft);border:1.5px solid var(--primary);padding:4px 12px;border-radius:8px;letter-spacing:.04em">TS工番</span>';
      body = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px;align-items:start">' +
        col('LW', lwChip, lw.length, lw, 'LW工番の案件はありません') + col('TS', tsChip, ts.length, ts, 'TS工番の案件はありません') + '</div>';
    }
    return '<div style="padding:22px 22px 40px;animation:scin .28s ease both">' + head + body + '</div>';
  }

  /* ---------------- NEW TYPE ---------------- */
  function viewNewType() {
    return '<div style="padding:26px 22px 40px;animation:scin .28s ease both">' +
      '<div style="font:900 21px/1.3 \'Noto Sans JP\',sans-serif;color:var(--text);margin-bottom:6px">どちらの工番を登録しますか？</div>' +
      '<div style="font:500 13.5px/1.6 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:22px">工番の種類によって作業報告書のフォーマットが切り替わります。</div>' +
      '<button' + act('pickLW') + ' style="width:100%;text-align:left;background:var(--surface);border:2px solid var(--primary);border-radius:20px;padding:24px;cursor:pointer;display:block;margin-bottom:16px;box-shadow:0 8px 24px var(--primary-shadow)">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px"><span style="font:900 13px \'Noto Sans JP\',sans-serif;color:#fff;background:var(--primary);padding:6px 14px;border-radius:10px;letter-spacing:.06em">LW工番</span><span style="font:900 16px \'Noto Sans JP\',sans-serif;color:var(--primary);letter-spacing:.06em">' + esc(COMPANY.companyLW) + '</span></div>' +
      '<div style="font:800 18px/1.4 \'Noto Sans JP\',sans-serif;color:var(--text);margin-bottom:6px">製品・本工番</div>' +
      '<div style="font:500 13.5px/1.6 \'Noto Sans JP\',sans-serif;color:var(--muted)">製品の納入時に使用する工番です。機種・銘板情報や納品番号とあわせて登録します。</div>' +
      '<div style="margin-top:14px;font:700 13px \'Noto Sans JP\',sans-serif;color:var(--primary)">この種別で登録する →</div></button>' +
      '<button' + act('pickTS') + ' style="width:100%;text-align:left;background:var(--surface);border:2px solid var(--border);border-radius:20px;padding:24px;cursor:pointer;display:block;box-shadow:0 2px 8px rgba(16,24,40,.05)">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px"><span style="font:900 13px \'Noto Sans JP\',sans-serif;color:var(--primary);background:var(--primary-soft);border:1.5px solid var(--primary);padding:5px 13px;border-radius:10px;letter-spacing:.06em">TS工番</span><span style="font:900 16px \'Noto Sans JP\',sans-serif;color:var(--text);letter-spacing:.04em">' + esc(COMPANY.companyTS) + '</span></div>' +
      '<div style="font:800 18px/1.4 \'Noto Sans JP\',sans-serif;color:var(--text);margin-bottom:6px">サービス工番</div>' +
      '<div style="font:500 13.5px/1.6 \'Noto Sans JP\',sans-serif;color:var(--muted)">メンテナンスや点検などの作業に使用する工番です。</div>' +
      '<div style="margin-top:14px;font:700 13px \'Noto Sans JP\',sans-serif;color:var(--primary)">この種別で登録する →</div></button></div>';
  }

  /* ==================================================================
   * 帳票型入力（新規・編集／作業報告書）
   * 仕上がりのPDFと同じ枠を画面に出し、枠をタップすると入力パネル（S.edit）が開く。
   * 入力パネル内の文字入力は再描画せずに値だけ書き換え（silentSet）、閉じたときに描画する。
   * ================================================================== */
  var FS_WHO = { adm: '管理者', wk: '作業者', cu: 'お客様', st: '責任者' };
  var PAPER_W = 760;
  function fsScope() { return S.screen === 'newForm' ? 'new' : 'case'; }
  function fsObj(scope) { return scope === 'new' ? S.newForm : (findCase(S.activeId) || blankForm('LW')); }
  // 再描画せずに対象（新規フォーム or アクティブ案件）を書き換える
  function silentSet(scope, fn) {
    if (scope === 'new') { S.newForm = fn(Object.assign({}, S.newForm)); return; }
    S.cases = S.cases.map(function (c) { return c.id === S.activeId ? fn(Object.assign({}, c)) : c; });
  }
  function commonStaff(o) { return (o.staff || []).filter(function (st) { return !st.separate; }); }
  function rowDone(r) { return !!(r && r.date && r.start && r.end); }
  function rowTouched(r) { return !!(r && (r.start || r.end || r.km)); }
  function workDate(o) { var d = o.yoteibi || ''; (o.commonWork || []).forEach(function (e) { if (!d && e.date) d = e.date; }); return d; }
  function kaninParts(o) {
    var name = (o.kanin && o.kanin.name) || (o.type === 'LW' ? '製造部 田中' : 'TSC 木下');
    var p = name.split(/\s+/);
    return { name: name, dept: p.length > 1 ? p[0] : '', person: p.length > 1 ? p.slice(1).join(' ') : name };
  }
  // 'row:list:i[:si]' → 行の参照
  function fsRowRef(id) { var p = String(id).split(':'); return { list: p[1], i: +p[2], si: p.length > 3 ? p[3] : undefined }; }
  function fsRowArr(o, ref) { return ref.si !== undefined ? (((o.staff || [])[+ref.si] || {})[ref.list] || []) : (o[ref.list] || []); }
  function fsRow(o, ref) { return fsRowArr(o, ref)[ref.i]; }
  function isTravelList(list) { return list === 'commonTravel' || list === 'travel'; }
  function fsRowNames(o, ref) {
    if (ref.si !== undefined) { var st = (o.staff || [])[+ref.si] || {}; return st.name || ('作業者' + (+ref.si + 1)); }
    return commonStaff(o).map(function (st) { return st.name; }).filter(Boolean).join('・') || '（全員）';
  }

  // 未入力の枠（「次の未入力へ」の巡回順＝帳票の上から下）。新規登録は管理者が書く欄だけ。
  function fsEmpties(scope, o) {
    var L = [], wt = o.workTypes || {}, staff = o.staff || [];
    if (!WT.some(function (k) { return wt[k]; })) L.push('wt');
    if (!String(o.koban || '').trim()) L.push('koban');
    if (!String(o.nohinSaki || '').trim()) L.push('okyaku');
    if (!o.kishu) L.push('kishu');
    if (!workDate(o)) L.push('date');
    if (!staff.some(function (st) { return String(st.name || '').trim(); })) L.push('staff');
    if (!o.genin) L.push('genin');
    if (scope === 'new') return L;
    if (!o.shori) L.push('shori');
    (o.confirmItems || []).forEach(function (it) { if (!it.value) L.push('cf:' + it.key); });
    if (commonStaff(o).length) (o.commonWork || []).forEach(function (r, i) { if (!rowDone(r)) L.push('row:commonWork:' + i); });
    staff.forEach(function (st, si) { if (st.separate) (st.work || []).forEach(function (r, i) { if (!rowDone(r)) L.push('row:work:' + i + ':' + si); }); });
    (o.commonTravel || []).forEach(function (r, i) { if (rowTouched(r) && !rowDone(r)) L.push('row:commonTravel:' + i); });
    staff.forEach(function (st, si) { if (st.separate) (st.travel || []).forEach(function (r, i) { if (rowTouched(r) && !rowDone(r)) L.push('row:travel:' + i + ':' + si); }); });
    if (!o.oshaName) L.push('osha');
    if (!o.tantoushaName) L.push('tantousha');
    if (!o.signature) L.push('sign');
    if (!(o.kanin && o.kanin.stamped)) L.push('kanin');
    return L;
  }

  /* ---------------- 帳票本体 ---------------- */
  function viewFormSheet(scope) {
    var o = fsObj(scope), isNew = scope === 'new', isLW = o.type === 'LW';
    var E = {}; fsEmpties(scope, o).forEach(function (k) { E[k] = 1; });
    var sel = S.edit ? S.edit.id : '';
    var cell = function (id, who, inner, cls, off) {
      if (off) return '<div class="fs-off' + (cls ? ' ' + cls : '') + '" data-fsid="' + esc(id) + '">' + inner + '</div>';
      return '<div' + act('fsOpen', { id: id }) + ' data-fsid="' + esc(id) + '" role="button" tabindex="0" class="fs-f' + (E[id] ? ' empty' : '') + (sel === id ? ' sel' : '') + (cls ? ' ' + cls : '') + '">' +
        (who ? '<i class="fs-who ' + who + '">' + FS_WHO[who] + '</i>' : '') + inner + '</div>';
    };
    var V = function (v, ph) { return '<span class="fs-val">' + (v ? esc(v) : '<span class="fs-ph">' + (ph || 'タップして入力') + '</span>') + '</span>'; };
    var L = function (t) { return '<span class="fs-lbl">' + t + '</span>'; };

    var wt = o.workTypes || {};
    var title = '<div class="fs-ttl' + (E.wt ? ' empty' : '') + '" data-fsid="wt">' + WT.map(function (w, i) {
      return (i ? '<span class="fs-dot">・</span>' : '') + '<span' + act('fsWT', { key: w }) + ' role="button" tabindex="0" class="fs-wt' + (wt[w] ? ' on' : '') + '">' + w + '</span>';
    }).join('') + '<span class="fs-tail">作業書</span></div>';

    var okyaku = V(o.nohinSaki) + (o.okyakuSub ? '<span class="fs-sub">' + esc(o.okyakuSub) + '</span>' : '') + (o.nohinSaki ? '<span class="fs-sama">様</span>' : '');
    var staffNames = (o.staff || []).map(function (x) { return x.name; }).filter(Boolean).join('・');
    var kubun = '<div class="fs-kubun">' + ['有償', '無償', '調整中'].map(function (p) { return '<span class="' + (o.paid === p ? 'on' : '') + '">' + p + '</span>'; }).join('') + '</div>';
    var kp = kaninParts(o), stamped = !!(o.kanin && o.kanin.stamped);
    var kaninInner = '<span class="fs-lbl">' + (isLW ? '製造' : 'TSC') + '</span>' + (stamped
      ? '<div class="fs-stamp"><small>' + esc(kp.dept) + '</small><span>' + esc(kp.person) + '</span></div>'
      : '<span class="fs-val"><span class="fs-ph">' + (isNew ? '現場から戻った後に押印' : '確認印を押す') + '</span></span>');

    var head =
      '<div class="fs-row" style="grid-template-columns:130px 1fr 150px 130px">' +
      cell('koban', 'adm', L('工番 №') + V(o.koban), 'fs-c') +
      cell('okyaku', 'adm', L('お客様名') + okyaku, 'fs-c') +
      cell('kishu', 'adm', L('機種') + V(o.kishu), 'fs-c') +
      cell('date', 'adm', L('作業日') + V(fmtDate(workDate(o)).trim()), 'fs-c') + '</div>' +
      '<div class="fs-row fs-thick" style="grid-template-columns:130px 1fr 150px 130px">' +
      cell('motoKoban', 'adm', L('元工番') + V(o.motoKoban, '（あれば）'), 'fs-c') +
      cell('staff', 'adm', L('作業者名') + V(staffNames), 'fs-c') +
      cell('paid', 'adm', L('区分') + kubun, 'fs-c') +
      cell('kanin', 'st', kaninInner, 'fs-c fs-kanin', isNew) + '</div>';

    var cf = (o.confirmItems || []).map(function (it) {
      return '<div' + act('fsCf', { key: it.key }) + ' data-fsid="cf:' + esc(it.key) + '" role="button" tabindex="0" class="fs-cfr fs-f' + (E['cf:' + it.key] ? ' empty' : '') + (sel === 'cf:' + it.key ? ' sel' : '') + '"><div>' + esc(it.label) + '</div><div>' + (it.value ? esc(it.value) : '<span class="fs-ph">タップ</span>') + '</div></div>';
    }).join('');
    var content = '<div class="fs-row fs-thick fs-naiyou"><div class="fs-vlabel">作業内容</div><div class="fs-nbody">' +
      cell('genin', 'adm', '<h4>【作業内容】</h4><div class="fs-txt">' + (o.genin ? esc(o.genin) : '<span class="fs-ph">タップして入力（管理者が事前に記入）</span>') + '</div>', 'fs-sec fs-a') +
      cell('shori', 'wk', '<h4>【実施内容】</h4><div class="fs-txt">' + (o.shori ? esc(o.shori) : '<span class="fs-ph">' + (isNew ? '現場で作業者が記入します' : 'タップして入力 ／ 🎤 音声でも入力できます') + '</span>') + '</div>', 'fs-sec fs-b', isNew) +
      '<div class="fs-confirm"><div class="fs-cfh"><div>作業終了時の確認事項</div><div>確認</div></div>' + cf + '<div class="fs-cff">※完了は「✓」 該当なしは「－」（枠をタップで切替）</div></div>' +
      '</div></div>';

    var table = function (kind) {
      var travel = kind === 'travel';
      var cl = travel ? 'commonTravel' : 'commonWork', sl = travel ? 'travel' : 'work';
      var rows = [];
      if (commonStaff(o).length || (o[cl] || []).some(rowTouched)) (o[cl] || []).forEach(function (r, i) { rows.push({ id: 'row:' + cl + ':' + i, r: r, ref: { list: cl, i: i } }); });
      (o.staff || []).forEach(function (st, si) { if (st.separate) (st[sl] || []).forEach(function (r, i) { rows.push({ id: 'row:' + sl + ':' + i + ':' + si, r: r, ref: { list: sl, i: i, si: String(si) } }); }); });
      var tot = 0;
      var html = rows.map(function (x) {
        var r = x.r || {}, m = diffM(r.start, r.end); if (m) tot += m;
        var tm = (esc(r.start) || '<span class="fs-ph">--:--</span>') + ' 〜 ' + (esc(r.end) || '<span class="fs-ph">--:--</span>');
        var inner = travel
          ? '<div>' + esc(fsRowNames(o, x.ref)) + '</div><div>' + esc(r.dir || '往路') + '</div><div>' + (esc(fmtDate(r.date).trim()) || '<span class="fs-ph">日付</span>') + '</div><div>' + tm + '</div><div>' + (r.km ? esc(r.km) + ' Km' : '') + '</div>'
          : '<div>' + esc(fsRowNames(o, x.ref)) + '</div><div>' + (esc(fmtDate(r.date).trim()) || '<span class="fs-ph">日付</span>') + '</div><div>' + tm + '</div><div class="fs-tot">' + (m ? '計 ' + fmtHM(m) : '') + '</div>';
        return cell(x.id, 'wk', inner, 'fs-tr ' + (travel ? 'fs-trv' : 'fs-wrk'), isNew);
      }).join('');
      // 合計はPDFと同じ算出（共通行＋別行動の行）
      var all = sumWork(o[cl]); (o.staff || []).forEach(function (st) { if (st.separate) all += sumWork(st[sl]); });
      var add = isNew ? '' : '<div class="fs-addrow"><button' + act('fsAddRow', { kind: kind }) + ' type="button">＋ ' + (travel ? '移動時間' : '作業時間') + 'の行を追加</button></div>';
      var note = isNew ? '<div class="fs-note">' + (travel ? '移動時間' : '作業時間') + 'は現場で作業者が入力します</div>' : '';
      return '<div class="fs-row fs-tbl"><div class="fs-tl">' + (travel ? '移動時間' : '作業時間') + '</div><div class="fs-trows">' + html + note + add +
        '<div class="fs-sum"><div>' + (travel ? '移動時間' : '作業時間') + ' 合計</div><div>' + fmtHM(all) + '</div></div></div></div>';
    };
    var allW = sumWork(o.commonWork), allT = sumWork(o.commonTravel);
    (o.staff || []).forEach(function (st) { if (st.separate) { allW += sumWork(st.work); allT += sumWork(st.travel); } });

    var recipient = paperCo(o.type).name;
    var approve = '<div class="fs-row fs-thick fs-appr"><div class="fs-al">上記作業が終了したことを承認します。<br><b>' + esc(recipient) + '　殿</b></div><div class="fs-ar">' +
      cell('osha', 'cu', '<span class="fs-lbl">御社名</span><span class="fs-u">' + (o.oshaName ? esc(o.oshaName) : '<span class="fs-ph">タップ</span>') + '</span>', 'fs-ln', isNew) +
      cell('tantousha', 'cu', '<span class="fs-lbl">御担当者名</span><span class="fs-u">' + (o.tantoushaName ? esc(o.tantoushaName) : '<span class="fs-ph">タップ</span>') + '</span>', 'fs-ln', isNew) +
      cell('sign', 'cu', o.signature ? '<img alt="サイン" src="' + esc(o.signature) + '">' : '<span class="fs-ph fs-signph">' + (isNew ? 'お客様サイン（現場で取得）' : '✍ ここをタップしてお客様にサインをいただく') + '</span>', 'fs-sig', isNew) +
      '</div></div>';

    var info = '<div class="fs-row fs-thick fs-info">' +
      cell('customer', 'adm', '<h5>お客様情報</h5>納品先：' + esc(o.nohinSaki || '—') + '<br>住所：' + esc(o.basho || '—') + '<br>ＴＥＬ：' + esc(o.tel || '—') + '　担当者：' + esc(o.tantou || '—')) +
      cell('plate', 'wk', '<h5>銘板情報 <span class="fs-hint">📷 写真から読み取れます</span></h5>型式；' + esc(o.katashiki || '—') + '<br>製番；' + esc(o.seiban || '—') + '<br>年月日；' + esc(o.nenGappi || '—') + '<br>最大積載重量；' + esc(o.saidaiSekisai || '—') + '<br>本体重量；' + esc(o.hontaiJuryo || '—')) + '</div>';

    var logo = isLW ? '<img src="' + esc(window.LW_LOGO || '') + '" alt="LINE W" class="fs-logo">' : '<span class="fs-tslogo">TS</span>';
    var foot = '<div class="fs-co">' + logo + '<div><b>' + esc(paperCo(o.type).name) + '</b><br>' + paperFootText(o.type) + '</div></div>';

    return '<div class="fs-wrap' + (S.fsZoom ? ' zoomed' : '') + '"><div class="fs-paper' + (S.fsGuide === false ? '' : ' guide') + '">' + title +
      '<div class="fs-frame">' + head + content + table('work') + table('travel') +
      '<div class="fs-gtotal fs-thick">総時間：' + fmtHM(allW + allT) + '</div>' + approve + info + foot + '</div></div></div>';
  }

  // 帳票の上：種別・工番・「次の未入力へ」・帳票に載らない項目
  function viewFormTop(scope) {
    var o = fsObj(scope), isNew = scope === 'new', isLW = o.type === 'LW';
    var n = fsEmpties(scope, o).length;
    var badge = isLW ? '<span class="fs-badge lw">LW工番</span>' : '<span class="fs-badge ts">TS工番</span>';
    var guideOn = S.fsGuide !== false;
    var bar = '<div class="fs-bar">' + badge + '<span class="fs-bk">' + esc(o.koban || (isNew ? '新規' : '')) + '</span>' +
      '<span class="fs-bsp"></span>' +
      (S.mode === 'mobile' ? '<button' + act('fsZoom') + ' type="button" class="fs-chip' + (S.fsZoom ? ' on' : '') + '">🔍 ' + (S.fsZoom ? '全体表示' : '拡大') + '</button>' : '') +
      '<button' + act('fsGuide') + ' type="button" class="fs-chip' + (guideOn ? ' on' : '') + '">入力ガイド</button>' +
      '<button' + act('fsNext') + ' type="button" class="fs-next' + (n ? '' : ' done') + '">' + (n ? '次の未入力へ <span>' + n + '</span>' : '✓ 入力済み') + '</button></div>';
    var meta;
    if (isNew) {
      var chip = function (label, v) { return '<span class="fs-mchip"><b>' + label + '</b>' + (v ? esc(v) : '<i>未入力</i>') + '</span>'; };
      meta = '<div' + act('fsOpen', { id: 'meta' }) + ' role="button" tabindex="0" class="fs-meta"><div class="fs-mh">帳票に載らない項目（タップで編集）</div><div class="fs-mrow">' +
        (S.editId ? chip('ステータス', o.status) : '') + chip('工番名', o.kobanName) + (isLW ? chip('納品番号', o.nohinNo) : '') + chip('指示書メモ', o.shijiNaiyou) + '</div></div>';
    } else {
      meta = (o.shijiNaiyou || o.kobanName) ? '<div class="fs-meta ro">' + (o.kobanName ? '<div><b>工番名：</b>' + esc(o.kobanName) + '</div>' : '') + (o.shijiNaiyou ? '<div><b>指示メモ：</b>' + esc(o.shijiNaiyou) + '</div>' : '') + '</div>' : '';
    }
    var guide = isNew ? '<div class="fs-lead">管理者が分かる範囲で記入し「保存して作業者に渡す」を押すと、案件ストックに入り現場の作業者が続きを記入します。</div>'
      : '<div class="fs-lead">帳票の枠をタップすると入力できます。黄色の枠が未入力です。</div>';
    return bar + '<div class="fs-top">' + guide + meta + (isNew && S.nfError ? '<div class="fs-err">工番№・お客様名は必須項目です。</div>' : '') + '</div>';
  }

  /* ---------------- NEW / EDIT FORM ---------------- */
  function viewNewForm() {
    var isEditing = !!S.editId;
    var footer = '<div style="position:sticky;bottom:0;padding:14px 18px;background:linear-gradient(transparent,var(--bg) 55%);display:flex;gap:12px;z-index:5;pointer-events:none" class="fs-foot">' +
      '<button' + act('goBack') + ' style="flex:none;width:120px;height:56px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:14px;font:700 16px \'Noto Sans JP\',sans-serif;cursor:pointer">キャンセル</button>' +
      '<button' + act('saveCase') + ' style="flex:1;height:56px;border:none;background:var(--primary);color:#fff;border-radius:14px;font:700 16px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">' + (isEditing ? '変更を保存' : '保存して作業者に渡す') + '</button></div>';
    return viewFormTop('new') + viewFormSheet('new') + footer;
  }

  /* ---------------- REPORT ---------------- */
  function viewReport() {
    var footer = '<div style="position:sticky;bottom:0;padding:14px 18px;background:linear-gradient(transparent,var(--bg) 55%);display:flex;gap:12px;z-index:5;pointer-events:none" class="fs-foot">' +
      '<button' + act('goHome') + ' style="flex:none;width:90px;height:56px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:14px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer">一時保存</button>' +
      '<button' + act('goPreview') + ' style="flex:1;height:56px;border:none;background:var(--primary);color:#fff;border-radius:14px;font:700 16px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">PDFで内容を確認 →</button></div>';
    return viewFormTop('case') + viewFormSheet('case') + footer;
  }
  function sumWork(arr) { var t = 0; (arr || []).forEach(function (row) { var m = diffM(row.start, row.end); if (m) t += m; }); return t; }

  /* ---------------- 入力パネル（ボトムシート） ---------------- */
  // 工番の候補：その案件の種別（LW/TS）で始まる工番を先に。工番・納入先・受注先・品名で絞り込み。
  function kobanSuggestHtml(q, type) {
    var s = String(q || '').trim(), su = s.toUpperCase();
    var list = (MASTER.kobans || []).filter(function (k) {
      if (!s) return String(k.koban).toUpperCase().indexOf(type) === 0;
      return String(k.koban).toUpperCase().indexOf(su) >= 0 || [k.nohinSaki, k.uketsuke, k.kishu].some(function (x) { return x && String(x).indexOf(s) >= 0; });
    });
    list.sort(function (a, b) { var ai = String(a.koban).toUpperCase().indexOf(type) === 0 ? 0 : 1, bi = String(b.koban).toUpperCase().indexOf(type) === 0 ? 0 : 1; return ai - bi; });
    if (!s) list = list.slice(-8).reverse(); else list = list.slice(0, 8);
    if (!(MASTER.kobans || []).length) return '<div class="fs-none">工番マスターが未取込です（設定画面から取り込めます）。工番は手入力できます。</div>';
    if (!list.length) return '<div class="fs-none">マスターに該当する工番がありません。そのまま閉じると、工番だけ入ります。</div>';
    return (s ? '' : '<div class="fs-none">最近の' + type + '工番</div>') + list.map(function (k) {
      return '<button' + act('fsPickKoban', { k: k.koban }) + ' type="button"><b>' + esc(k.koban) + '</b>' + esc(k.nohinSaki || k.uketsuke || '') + '<br><span>' + esc([k.kishu, k.basho].filter(Boolean).join(' ／ ')) + '</span></button>';
    }).join('');
  }
  function applyMasterKoban(scope, code) {
    var mk = masterKoban(code); if (!mk) return false;
    silentSet(scope, function (o) {
      o.koban = mk.koban;
      if (mk.nohinSaki) o.nohinSaki = mk.nohinSaki;
      if (mk.basho) o.basho = mk.basho;
      if (mk.kishu) o.kishu = mk.kishu;
      return o;
    });
    return true;
  }
  var DRUM_H = 40;
  function drumHtml() {
    var col = function (n) { var s = '<div class="pad"></div><div class="pad"></div>'; for (var i = 0; i < n; i++) s += '<div data-v="' + i + '">' + ('0' + i).slice(-2) + '</div>'; return s + '<div class="pad"></div><div class="pad"></div>'; };
    return '<div class="fs-drum"><div class="fs-col" id="fs-drum-h">' + col(24) + '</div><span class="fs-colon">:</span><div class="fs-col" id="fs-drum-m">' + col(60) + '</div></div>';
  }
  function fsDrumDefault(o, ref, which) {
    var r = fsRow(o, ref) || {};
    if (r[which]) return r[which];
    if (which === 'end' && r.start) return r.start;
    return which === 'end' ? '17:00' : '08:00';
  }
  // ドラムを開いた時刻に合わせ、以降は回したときだけ値を書き込む（開いただけでは入らない）
  function wireDrum() {
    var ed = S.edit; if (!ed || String(ed.id).indexOf('row:') !== 0) return;
    var hc = document.getElementById('fs-drum-h'), mc = document.getElementById('fs-drum-m'); if (!hc || !mc) return;
    var o = fsObj(ed.scope), ref = fsRowRef(ed.id);
    var p = fsDrumDefault(o, ref, ed.which || 'start').split(':');
    var mark = function (c) { var i = Math.round(c.scrollTop / DRUM_H); [].forEach.call(c.querySelectorAll('div[data-v]'), function (x, j) { x.classList.toggle('cur', j === i); }); };
    hc.scrollTop = (+p[0] || 0) * DRUM_H; mc.scrollTop = (+p[1] || 0) * DRUM_H; mark(hc); mark(mc);
    var t0 = Date.now();
    [hc, mc].forEach(function (c) {
      c.addEventListener('scroll', function () { mark(c); if (Date.now() - t0 < 300) return; commitDrum(); }, { passive: true });
      c.addEventListener('click', function (e) { var d = e.target.closest('div[data-v]'); if (!d) return; t0 = 0; c.scrollTo({ top: (+d.getAttribute('data-v')) * DRUM_H, behavior: 'smooth' }); });
    });
  }
  function commitDrum() {
    var ed = S.edit; if (!ed || String(ed.id).indexOf('row:') !== 0) return;
    var hc = document.getElementById('fs-drum-h'), mc = document.getElementById('fs-drum-m'); if (!hc || !mc) return;
    var h = Math.max(0, Math.min(23, Math.round(hc.scrollTop / DRUM_H))), m = Math.max(0, Math.min(59, Math.round(mc.scrollTop / DRUM_H)));
    var v = ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2);
    fsSetRowField(ed.scope, fsRowRef(ed.id), ed.which || 'start', v);
    var lab = document.getElementById('fs-tab-' + (ed.which || 'start')); if (lab) lab.textContent = v;
  }
  function fsSetRowField(scope, ref, field, val) {
    silentSet(scope, function (o) {
      var set = function (arr) { return (arr || []).map(function (row, y) { return y === ref.i ? Object.assign({}, row, wrapKey(field, val)) : row; }); };
      if (ref.si !== undefined) { var si = +ref.si; o.staff = o.staff.map(function (st, x) { return x === si ? Object.assign({}, st, wrapKey(ref.list, set(st[ref.list]))) : st; }); }
      else o[ref.list] = set(o[ref.list]);
      return o;
    });
  }
  // パネル内の入力（data-ed）→ 再描画せずに値を反映
  function fsInput(el, evType) {
    var ed = S.edit; if (!ed) return;
    var f = el.getAttribute('data-ed'), v = el.value;
    if (f === 'staffName') { var si = +el.getAttribute('data-si'); silentSet(ed.scope, function (o) { o.staff = o.staff.map(function (st, i) { return i === si ? Object.assign({}, st, { name: v }) : st; }); return o; }); return; }
    if (f === 'kaninName') { silentSet(ed.scope, function (o) { o.kanin = Object.assign({}, o.kanin || {}, { name: v }); return o; }); return; }
    if (f.indexOf('row.') === 0) { fsSetRowField(ed.scope, fsRowRef(ed.id), f.slice(4), v); return; }
    silentSet(ed.scope, function (o) { o[f] = v; return o; });
    // 候補の作り直しは打鍵中(input)だけ。フォーカスが外れた時(change)に作り直すと、押しかけた候補ボタンが消えてタップが効かない
    if (f === 'koban' && evType === 'input') { var box = document.getElementById('fs-sugg'); if (box) box.innerHTML = kobanSuggestHtml(v, fsObj(ed.scope).type); }
  }

  function renderFsSheet() {
    var ed = S.edit; if (!ed) return '';
    var scope = ed.scope, o = fsObj(scope), id = ed.id, isNew = scope === 'new', isLW = o.type === 'LW';
    var inp = function (f, label, opt) {
      opt = opt || {};
      return '<label class="fs-fld"><span>' + label + '</span><input id="fs-in-' + f + '" data-ed="' + f + '" value="' + esc(o[f] || '') + '"' + (opt.type ? ' type="' + opt.type + '"' : '') + (opt.ph ? ' placeholder="' + esc(opt.ph) + '"' : '') + (opt.mode ? ' inputmode="' + opt.mode + '"' : '') + ' autocomplete="off"></label>';
    };
    var btns = function (list, cur, action, extra) {
      return '<div class="fs-opts">' + list.map(function (x) { var p = { val: x }; for (var k in (extra || {})) p[k] = extra[k]; return '<button' + act(action, p) + ' type="button" class="' + (x === cur ? 'on' : '') + '">' + esc(x) + '</button>'; }).join('') + '</div>';
    };
    var title = '', sub = '', body = '', hint = function (t) { return '<p class="fs-phint">' + t + '</p>'; };

    if (id === 'koban') {
      title = '工番 №';
      body = hint('工番を打つと候補が出ます。選ぶと <b>お客様名（納品先）・住所・機種</b> が自動で入ります。') +
        inp('koban', '工番', { ph: isLW ? '例：LW25083' : '例：TS26052' }) + '<div class="fs-sugg" id="fs-sugg">' + kobanSuggestHtml(o.koban, o.type) + '</div>';
    } else if (id === 'okyaku') {
      title = 'お客様名'; body = inp('nohinSaki', 'お客様名（納品先）', { ph: '例：株式会社 赤木鉄工所' }) + inp('okyakuSub', '2行目（製造所・ご担当者など）', { ph: '例：稲毛事業所 関' });
    } else if (id === 'kishu') {
      title = '機種'; body = inp('kishu', '機種', { ph: '例：LN-3000' });
    } else if (id === 'motoKoban') {
      title = '元工番'; body = inp('motoKoban', '元工番', { ph: '例：LW24310' });
    } else if (id === 'date') {
      title = '作業日'; body = hint('作業予定日を入れます。空欄のときは、作業時間の最初の日付が作業日として印字されます。') + inp('yoteibi', '作業日（作業予定日）', { type: 'date' });
    } else if (id === 'paid') {
      title = '区分'; body = btns(['有償', '無償', '調整中'], o.paid, 'setPaid', { scope: scope });
    } else if (id === 'wt') {
      title = '作業の種類'; sub = '複数選べます';
      var wt = o.workTypes || {};
      body = hint('当てはまるものを選んでください。帳票の表題の文字を直接タップしても切り替わります。') +
        '<div class="fs-opts">' + WT.map(function (w) { return '<button' + act('toggleWorkType', { scope: scope, key: w }) + ' type="button" class="' + (wt[w] ? 'on' : '') + '">' + w + '</button>'; }).join('') + '</div>';
    } else if (id === 'genin' || id === 'shori') {
      var lim = LIMIT[id];
      title = id === 'genin' ? '【作業内容】' : '【実施内容】'; sub = id === 'genin' ? '管理者が記入' : '作業者が記入';
      body = hint(id === 'genin' ? '実施する作業の内容・指示を、事前に分かる範囲で書きます。' : '実際に行った作業と結果を書きます。話して入力し、AIで報告書向けの文章に整えることもできます。') +
        '<div class="fs-tools"><button' + act('fsVoice', { target: id }) + ' type="button" class="mic">🎤 音声で入力・AIで整える</button></div>' +
        '<textarea id="fs-in-' + id + '" data-ed="' + id + '" maxlength="' + lim + '" data-counter="cnt-fs-' + id + '" placeholder="' + (id === 'genin' ? '例：下記設備の油圧計交換・不具合点検' : '例：油圧計を交換し、動作確認を実施しました。') + '">' + esc(o[id] || '') + '</textarea>' + taCounter('cnt-fs-' + id, o[id], lim);
    } else if (id === 'staff') {
      title = '作業者名'; sub = '現場に行く人';
      var rows = (o.staff || []).map(function (st, si) {
        var seg = isNew ? '' : '<div class="fs-seg"><button' + act('setSeparate', { si: si, val: 'false' }) + ' type="button" class="' + (!st.separate ? 'on' : '') + '">メイン</button><button' + act('setSeparate', { si: si, val: 'true' }) + ' type="button" class="' + (st.separate ? 'on' : '') + '">別行動</button></div>';
        return '<div class="fs-srow"><span class="fs-num">' + (si + 1) + '</span><input id="fs-in-staff-' + si + '" data-ed="staffName" data-si="' + si + '" value="' + esc(st.name) + '" placeholder="氏名" autocomplete="off">' + seg +
          ((o.staff || []).length > 1 ? '<button' + act('removeStaff', { scope: scope, si: si }) + ' type="button" class="fs-x" aria-label="削除">×</button>' : '') + '</div>';
      }).join('');
      var totals = isNew ? '' : '<div class="fs-stot"><div class="fs-sh">スタッフ別 作業時間合計</div>' + (o.staff || []).map(function (st) { return '<div><span>' + esc(st.name || '—') + '</span><i>' + (st.separate ? '別行動' : 'メイン') + '</i><b>' + fmtHM(st.separate ? sumWork(st.work) : sumWork(o.commonWork)) + '</b></div>'; }).join('') + '</div>';
      body = hint(isNew ? '現場に行く人を登録します。作業時間・移動時間は現場で入力します。' : '「別行動」にした人は、作業時間・移動時間を個別に入力できます（それ以外は全員同じ時間で連名）。') +
        '<div class="fs-slist">' + rows + '</div><button' + act(isNew ? 'addNewStaff' : 'addStaffCase') + ' type="button" class="fs-add">＋ スタッフを追加</button>' + staffPicker(scope) + totals;
    } else if (id === 'kanin') {
      var kp = kaninParts(o), stamped = !!(o.kanin && o.kanin.stamped), role = isLW ? '製造部 管理者' : 'TSC 管理者';
      title = '責任者 確認印'; sub = '電子印';
      body = hint('作業から戻った報告書を' + role + 'が確認し、電子印を押します。押印するまでクローズはできません（印刷・PDF保存は押印前でも可能）。') +
        '<label class="fs-fld"><span>' + role + '</span><input id="fs-in-kanin" data-ed="kaninName" value="' + esc(kp.name) + '" placeholder="例：製造部 田中" autocomplete="off"></label>' +
        '<div class="fs-kstamp">' + (stamped ? '<div class="fs-stamp big"><small>' + esc(kp.dept) + '</small><span>' + esc(kp.person) + '</span></div>' : '<div class="fs-unstamp">未押印</div>') + '</div>' +
        '<button' + act('toggleStamp', { scope: scope }) + ' type="button" class="fs-stampbtn' + (stamped ? ' off' : '') + '">' + (stamped ? '確認印を取り消す' : '確認印を押す') + '</button>';
    } else if (id === 'osha') {
      title = '御社名'; body = inp('oshaName', '御社名');
    } else if (id === 'tantousha') {
      title = '御担当者名'; body = inp('tantoushaName', '御担当者名');
    } else if (id === 'customer') {
      title = 'お客様情報';
      body = inp('nohinSaki', '納品先（お客様名と同じ項目です）') + inp('basho', '住所', { ph: '例：宮崎県東諸県郡国富町…' }) + '<div class="fs-two">' + inp('tel', '電話番号（TEL）', { mode: 'tel', ph: '例：0985-00-0000' }) + inp('tantou', 'ご担当者', { ph: '例：赤木' }) + '</div>';
    } else if (id === 'plate') {
      title = '銘板情報';
      body = '<div class="fs-tools"><button' + act('fsPlate') + ' type="button" class="cam">📷 銘板を撮影して読み取る</button></div>' +
        '<div class="fs-two">' + inp('kishu', '機種') + inp('katashiki', '型式') + inp('seiban', '製番') + inp('nenGappi', '製造年月', { ph: '例：2024-08' }) + inp('saidaiSekisai', '最大積載重量', { ph: '例：5000kg' }) + inp('hontaiJuryo', '本体重量', { ph: '例：11500kg' }) + '</div>';
    } else if (id === 'meta') {
      title = '帳票に載らない項目';
      body = (S.editId ? '<div class="fs-fld"><span>ステータス</span>' + btns(['未着手', '作業中', '完了'], o.status, 'setNewStatus') + '</div>' : '') +
        inp('kobanName', '工番名（作業内容の概要・一覧に表示）', { ph: '例：3m切断走行 据付' }) + (isLW ? inp('nohinNo', '納品番号', { ph: '例：D-1180' }) : '') +
        '<label class="fs-fld"><span>指示書メモ（作業者への補足）</span><textarea id="fs-in-shijiNaiyou" data-ed="shijiNaiyou" class="sm" placeholder="作業者への補足メモ">' + esc(o.shijiNaiyou || '') + '</textarea></label>';
    } else if (id.indexOf('cf:') === 0) {
      var key = id.slice(3), it = (o.confirmItems || []).filter(function (x) { return x.key === key; })[0] || {};
      title = '作業終了時の確認事項'; sub = it.label || '';
      body = hint('「' + esc(it.label || '') + '」の確認結果を選んでください。') + '<div class="fs-opts">' +
        [['✓', '✓ 完了'], ['−', '－ 該当なし'], ['', '未確認']].map(function (x) { return '<button' + act('fsCfSet', { key: key, val: x[0] }) + ' type="button" class="' + ((it.value || '') === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>';
    } else if (id.indexOf('addrow:') === 0) {
      var kind = id.slice(7);
      title = (kind === 'travel' ? '移動時間' : '作業時間') + 'の行を追加'; sub = '誰の行ですか';
      body = '<div class="fs-opts"><button' + act('fsAddRowFor', { kind: kind, si: '' }) + ' type="button">メイン（' + esc(commonStaff(o).map(function (st) { return st.name; }).filter(Boolean).join('・') || '全員') + '）</button>' +
        (o.staff || []).map(function (st, si) { return st.separate ? '<button' + act('fsAddRowFor', { kind: kind, si: si }) + ' type="button">' + esc(st.name || ('作業者' + (si + 1))) + '（別行動）</button>' : ''; }).join('') + '</div>';
    } else if (id.indexOf('row:') === 0) {
      var ref = fsRowRef(id), r = fsRow(o, ref) || {}, travel = isTravelList(ref.list), which = ed.which || 'start';
      var arr = fsRowArr(o, ref), m = diffM(r.start, r.end);
      title = travel ? '移動時間' : '作業時間'; sub = fsRowNames(o, ref);
      var tab = function (w, label) { return '<button' + act('fsWhich', { w: w }) + ' type="button" class="' + (which === w ? 'on' : '') + '">' + label + ' <b id="fs-tab-' + w + '">' + (esc(r[w]) || '--:--') + '</b></button>'; };
      body = (travel ? '<div class="fs-fld"><span>区分</span>' + btns(['往路', '現地', '復路'], r.dir || '往路', 'fsDir') + '</div>' : '') +
        '<div class="fs-two"><label class="fs-fld"><span>日付</span><input id="fs-in-rdate" data-ed="row.date" type="date" value="' + esc(r.date || '') + '"></label>' +
        (travel ? '<label class="fs-fld"><span>距離（Km）</span><input id="fs-in-rkm" data-ed="row.km" inputmode="decimal" value="' + esc(r.km || '') + '" placeholder="0"></label>' : '<div class="fs-fld"><span>この行の計</span><b class="fs-rtot">' + fmtHM(m) + '</b></div>') + '</div>' +
        '<div class="fs-fld"><span>時刻（回して選ぶ・数字をタップでも選べます）</span><div class="fs-tabs">' + tab('start', '開始') + tab('end', '終了') + '</div>' + drumHtml() + '</div>' +
        '<div class="fs-rowacts"><button' + act('fsClearTime') + ' type="button">時刻をクリア</button>' +
        (arr.length > 1 ? '<button' + act('fsDelRow') + ' type="button" class="del">この行を削除</button>' : '') + '</div>';
    }
    return '<div' + act('fsClose') + ' class="fs-scrim"><div' + act('stop') + ' class="fs-sheet" role="dialog" aria-label="' + esc(title) + '"><div class="fs-grab"></div>' +
      '<div class="fs-shd"><h3>' + esc(title) + '</h3><span>' + esc(sub) + '</span></div>' + body +
      '<div class="fs-acts"><button' + act('fsClose') + ' type="button">閉じる</button><button' + act('fsNext') + ' type="button" class="pri">次の未入力へ →</button></div></div></div>';
  }

  // 帳票の幅(760px)を画面に合わせて縮小（スマホは「拡大」で等倍＋横スクロール）
  function fitPaper() {
    var w = document.querySelector('.fs-wrap'), p = document.querySelector('.fs-paper'); if (!w || !p) return;
    var avail = w.clientWidth - 16;
    p.style.zoom = (S.fsZoom || avail >= PAPER_W) ? 1 : Math.max(0.3, avail / PAPER_W);
  }
  // 次に入力する枠が、下から出る入力パネルに隠れない位置まで帳票をスクロール
  function scrollToField(id) {
    var scr = document.querySelector('.scr'); if (!scr) return;
    var el = scr.querySelector('[data-fsid="' + id + '"]'); if (!el) return;
    var bar = scr.querySelector('.fs-bar'); // 上に貼り付くツールバーの下に来るように
    var top = el.getBoundingClientRect().top - scr.getBoundingClientRect().top;
    scr.scrollTop += top - ((bar ? bar.offsetHeight : 0) + 16);
  }

  /* ---------------- SIGN ---------------- */
  function viewSign() {
    var r = findCase(S.activeId) || {};
    var signerLine = (r.oshaName || '') + (r.tantoushaName ? ('　' + r.tantoushaName + ' 様') : '');
    return '<div style="padding:26px 22px;animation:scin .28s ease both;display:flex;flex-direction:column;height:100%">' +
      '<div style="font:900 20px/1.3 \'Noto Sans JP\',sans-serif;color:var(--text);margin-bottom:6px">お客様サイン</div>' +
      '<div style="font:500 13.5px/1.6 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:20px">下の枠内に、お客様にサインをお願いします。</div>' +
      '<div style="background:#fff;border:2px solid var(--primary);border-radius:18px;padding:14px;box-shadow:0 6px 18px var(--primary-shadow)">' +
      '<canvas id="sigpad" width="700" height="380" style="width:100%;height:380px;display:block;touch-action:none;border-radius:10px;background:#fff"></canvas>' +
      '<div style="height:1px;background:#d7dbe2;margin:0 30px"></div>' +
      '<div style="text-align:right;font:600 12px \'Noto Sans JP\',sans-serif;color:var(--muted);padding:8px 30px 0">' + esc(signerLine) + '</div></div>' +
      '<div style="display:flex;gap:12px;margin-top:24px"><button' + act('clearSig') + ' style="flex:none;width:140px;height:58px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:14px;font:700 16px \'Noto Sans JP\',sans-serif;cursor:pointer">書き直す</button>' +
      '<button' + act('saveSig') + ' style="flex:1;height:58px;border:none;background:var(--primary);color:#fff;border-radius:14px;font:700 16px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">サインを確定する</button></div></div>';
  }

  /* ---------------- PREVIEW ---------------- */
  function viewPreview() {
    var r = findCase(S.activeId) || blankForm('LW');
    var active = S.activeId ? r : null;
    // 本文（原因＋処理）が長いほどフォントを自動縮小してレイアウト崩れ・過度なページ増を抑える
    var pvBodyLen = volume(r.genin) + volume(r.shori);
    var pvBodyFs = pvBodyLen > 650 ? '9px' : (pvBodyLen > 380 ? '10px' : '11px');
    var isLW = active && active.type === 'LW';
    var orderedStaff = r.staff || [];
    var commonNames = orderedStaff.filter(function (st) { return !st.separate; }).map(function (st, i) { return st.name || ('作業者' + (orderedStaff.indexOf(st) + 1)); }).join('・') || '（該当なし）';

    var allWorkM = sumWork(r.commonWork), allTravelM = sumWork(r.commonTravel);
    orderedStaff.forEach(function (st) { if (st.separate) { allWorkM += sumWork(st.work); allTravelM += sumWork(st.travel); } });

    var sepStaff = orderedStaff.filter(function (st) { return st.separate; });
    var pvWork = [];
    (r.commonWork || []).filter(function (e) { return e.start || e.end || e.date; }).forEach(function (e) { pvWork.push({ names: commonNames, date: fmtDate(e.date), range: (e.start || e.end) ? ((e.start || '　') + ' 〜 ' + (e.end || '　') + ' Ｈ') : '　' }); });
    sepStaff.forEach(function (st) { (st.work || []).filter(function (e) { return e.start || e.end || e.date; }).forEach(function (e) { pvWork.push({ names: st.name || '—', date: fmtDate(e.date), range: (e.start || e.end) ? ((e.start || '　') + ' 〜 ' + (e.end || '　') + ' Ｈ') : '　' }); }); });
    var trvRange = function (e) { var pre = (e.dir ? (e.dir + ' ') : '') + (e.date ? (fmtDate(e.date) + '　') : ''); var t = (e.start || e.end) ? ((e.start || '　') + ' 〜 ' + (e.end || '　')) : ''; return (pre + t).trim() || '　'; };
    var pvTravel = [];
    (r.commonTravel || []).filter(function (e) { return e.start || e.end || e.km || e.date; }).forEach(function (e) { pvTravel.push({ names: commonNames, range: trvRange(e), km: e.km ? (e.km + ' Km') : '　' }); });
    sepStaff.forEach(function (st) { (st.travel || []).filter(function (e) { return e.start || e.end || e.km || e.date; }).forEach(function (e) { pvTravel.push({ names: st.name || '—', range: trvRange(e), km: e.km ? (e.km + ' Km') : '　' }); }); });
    if (!pvWork.length) pvWork = [{ names: '　', date: '　', range: '　' }];
    if (!pvTravel.length) pvTravel = [{ names: '　', range: '　', km: '　' }];

    var firstDate = ''; (r.commonWork || []).forEach(function (e) { if (e.date && !firstDate) firstDate = e.date; });
    var kanin = r.kanin || {}; var kStamped = !!kanin.stamped;
    var kName = kanin.name || (r.type === 'LW' ? '製造部 田中' : 'TSC 木下');
    var kp = kName.split(/\s+/); var kDept = kp.length > 1 ? kp[0] : ''; var kPerson = kp.length > 1 ? kp.slice(1).join(' ') : kName;

    var pvTypeStyle = function (on) { return on ? "display:inline-block;color:var(--primary);border:2px solid var(--primary);border-radius:50%;padding:0 3px;line-height:1.15;margin:0 1px" : "color:#111"; };
    var titleTypes = WT.map(function (label, i) { return '<span style="' + pvTypeStyle(!!r.workTypes[label]) + '">' + label + '</span><span style="color:#111">' + (i < WT.length - 1 ? '・' : '') + '</span>'; }).join('');

    var onStyle = "display:inline-block;border:1.5px solid #c0392b;border-radius:50%;padding:1px 7px;color:#c0392b;font-weight:700";
    var offStyle = "display:inline-block;padding:1px 7px;color:#111";
    var kubun = ['有償', '無償', '調整中'].map(function (k) { return '<span style="' + (r.paid === k ? onStyle : offStyle) + '">' + k + '</span>'; }).join('');

    var sig = r.signature ? '<img src="' + esc(r.signature) + '" alt="" style="position:absolute;left:0;bottom:1px;height:38px;width:auto;max-width:100%">' : '';

    var workRowsHtml = pvWork.map(function (w) { return '<div style="display:flex;border-bottom:1px solid #ccc"><div style="width:120px;border-right:1px solid #e2e2e2;padding:3px 6px;font-weight:700">' + esc(w.names) + '</div><div style="width:84px;border-right:1px solid #e2e2e2;padding:3px 6px">' + esc(w.date) + '</div><div style="flex:1;padding:3px 8px">' + esc(w.range) + '</div></div>'; }).join('');
    var travelRowsHtml = pvTravel.map(function (t) { return '<div style="display:flex;border-bottom:1px solid #ccc"><div style="width:120px;border-right:1px solid #e2e2e2;padding:3px 6px;font-weight:700">' + esc(t.names) + '</div><div style="flex:1;border-right:1px solid #e2e2e2;padding:3px 8px">' + esc(t.range) + '</div><div style="width:84px;padding:3px 8px">' + esc(t.km) + '</div></div>'; }).join('');
    var confirmHtml = (r.confirmItems || []).map(function (it) { return '<div style="display:flex;border-bottom:1px solid #ccc"><div style="flex:1;padding:3px 5px;border-right:1px solid #ccc">' + esc(it.label) + '</div><div style="width:30px;text-align:center;padding:3px 0;font-weight:700">' + esc(it.value || '') + '</div></div>'; }).join('');

    var kaninCell = '<span style="position:absolute;top:2px;left:4px;font:700 7px \'Noto Sans JP\',sans-serif;color:#555">' + (r.type === 'LW' ? '製造' : 'TSC') + '</span>' +
      (kStamped ? '<div style="width:50px;height:50px;border-radius:50%;border:2px solid #c0392b;color:#c0392b;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;line-height:1.1;transform:rotate(-6deg)"><span style="font:700 6px \'Noto Sans JP\',sans-serif">' + esc(kDept) + '</span><span style="font:800 11px \'Noto Sans JP\',sans-serif">' + esc(kPerson) + '</span></div>'
        : '<div style="width:46px;height:46px;border-radius:50%;border:1px solid #ccc;color:#bbb;display:flex;align-items:center;justify-content:center;font:700 7px \'Noto Sans JP\',sans-serif">印</div>');

    var logo = isLW ? '<img src="' + esc(window.LW_LOGO || '') + '" alt="LINE W" style="height:42px;width:auto">' : '<span style="font:italic 900 22px \'Noto Sans JP\',sans-serif;letter-spacing:.02em">TS</span>';
    var footerCompany = paperCo(r.type).name;
    var recipient = paperCo(r.type).name;

    var sheet = '<div id="pdf-print" style="background:#fff;box-shadow:0 10px 30px rgba(16,24,40,.18);margin:0 auto;width:100%;max-width:600px;padding:22px 22px 26px;font-family:\'Noto Sans JP\',sans-serif;color:#111">' +
      '<div style="text-align:center;font:900 17px/1.3 \'Noto Sans JP\',sans-serif;margin-bottom:8px">' + titleTypes + '<span style="margin-left:2px">作業書</span></div>' +
      '<div style="border:2px solid #111;font-size:10px;line-height:1.3">' +
      // row1
      '<div style="display:flex;border-bottom:1px solid #111"><div style="width:120px;border-right:1px solid #111;padding:4px 6px"><div style="' + pvLab + '">工番　№</div><div style="font:700 13px \'Noto Sans JP\',sans-serif">' + esc(r.koban || '　') + '</div></div>' +
      '<div style="flex:1;border-right:1px solid #111;padding:4px 6px"><div style="' + pvLab + '">お客様名</div><div style="display:flex;align-items:baseline;gap:7px;flex-wrap:nowrap;white-space:nowrap;overflow:hidden"><span style="font:700 12.5px \'Noto Sans JP\',sans-serif">' + esc(r.nohinSaki || '　') + '</span>' + (r.okyakuSub ? '<span style="font:600 10.5px \'Noto Sans JP\',sans-serif;color:#333">' + esc(r.okyakuSub) + '</span>' : '') + '<span style="font-size:9.5px">様</span></div></div>' +
      '<div style="width:96px;border-right:1px solid #111;padding:4px 6px"><div style="' + pvLab + '">機種</div><div style="font:600 11px \'Noto Sans JP\',sans-serif">' + esc(r.kishu || '—') + '</div></div>' +
      '<div style="width:96px;padding:4px 6px"><div style="' + pvLab + '">作業日</div><div style="font:600 11px \'Noto Sans JP\',sans-serif">' + esc(fmtDate(r.yoteibi || firstDate)) + '</div></div></div>' +
      // row2
      '<div style="display:flex;border-bottom:2px solid #111"><div style="width:120px;border-right:1px solid #111;padding:4px 6px"><div style="' + pvLab + '">元工番</div><div style="font:600 11px \'Noto Sans JP\',sans-serif">' + esc(r.motoKoban || '—') + '</div></div>' +
      '<div style="flex:1;border-right:1px solid #111;padding:4px 6px"><div style="' + pvLab + '">作業者名</div><div style="font:600 11px \'Noto Sans JP\',sans-serif">' + esc((r.staff || []).map(function (x) { return x.name; }).filter(Boolean).join('・') || '　') + '</div></div>' +
      '<div style="width:96px;border-right:1px solid #111;padding:3px 5px"><div style="' + pvLab + '">区分</div><div style="display:flex;gap:4px;justify-content:center;margin-top:1px">' + kubun + '</div></div>' +
      '<div style="width:96px;position:relative;display:flex;align-items:center;justify-content:center;padding:2px">' + kaninCell + '</div></div>' +
      // content
      '<div style="display:flex;border-bottom:2px solid #111;min-height:250px"><div style="width:22px;border-right:1px solid #111;display:flex;align-items:center;justify-content:center"><div style="writing-mode:vertical-rl;font:700 11px \'Noto Sans JP\',sans-serif;letter-spacing:.3em">作業内容</div></div>' +
      '<div style="flex:1;padding:7px 9px;display:flex;flex-direction:column"><div style="flex:1">' +
      (r.genin ? '<div style="font:700 ' + pvBodyFs + ' \'Noto Sans JP\',sans-serif;color:#0b3a63;margin-bottom:2px">【作業内容】</div>' : '') +
      '<div style="font:500 ' + pvBodyFs + '/1.6 \'Noto Sans JP\',sans-serif;white-space:pre-wrap;margin-bottom:8px;color:#16263f;word-break:break-word">' + esc(r.genin || '') + '</div>' +
      (r.shori ? '<div style="font:700 ' + pvBodyFs + ' \'Noto Sans JP\',sans-serif;color:#0b3a63;margin-bottom:2px">【実施内容】</div>' : '') +
      '<div style="font:500 ' + pvBodyFs + '/1.65 \'Noto Sans JP\',sans-serif;white-space:pre-wrap;color:#16263f;word-break:break-word">' + esc(r.shori || '') + '</div></div>' +
      '<div style="align-self:flex-end;margin-top:10px;width:196px;border:1.4px solid #111;font:600 8.5px \'Noto Sans JP\',sans-serif;background:#fff;overflow:hidden"><div style="display:flex;border-bottom:1px solid #111;background:#f3f3f3"><div style="flex:1;padding:2px 5px">作業終了時の確認事項</div><div style="width:30px;text-align:center;border-left:1px solid #111;padding:2px 0">確認</div></div>' + confirmHtml + '<div style="padding:2px 5px;font-size:7.5px;color:#555">※完了は「✓」 該当なしは「－」</div></div></div></div>' +
      // work time
      '<div style="display:flex;border-bottom:1px solid #111;font:600 9.5px \'Noto Sans JP\',sans-serif"><div style="width:70px;border-right:1px solid #111;padding:4px 5px;background:#f7f7f7;display:flex;align-items:center">作業時間</div><div style="flex:1">' + workRowsHtml + '<div style="display:flex;background:#f7f7f7"><div style="flex:1;padding:3px 6px;text-align:right;font-weight:700">作業時間 合計</div><div style="width:120px;border-left:1px solid #ccc;padding:3px 8px;font-weight:700">' + fmtHM(allWorkM) + '</div></div></div></div>' +
      // travel time
      '<div style="display:flex;border-bottom:2px solid #111;font:600 9.5px \'Noto Sans JP\',sans-serif"><div style="width:70px;border-right:1px solid #111;padding:4px 5px;background:#f7f7f7;display:flex;align-items:center">移動時間</div><div style="flex:1">' + travelRowsHtml + '<div style="display:flex;background:#f7f7f7"><div style="flex:1;padding:3px 6px;text-align:right;font-weight:700">移動時間 合計</div><div style="width:120px;border-left:1px solid #ccc;padding:3px 8px;font-weight:700">' + fmtHM(allTravelM) + '</div></div></div></div>' +
      // 総時間（作業＋移動）。日別の「計」バッジを廃し、総計を1行にまとめて右寄せ表示。
      '<div style="border-bottom:2px solid #111;background:#f7f7f7;padding:4px 10px;text-align:right;font:700 10px \'Noto Sans JP\',sans-serif">総時間：' + fmtHM(allWorkM + allTravelM) + '</div>' +
      // approve
      '<div style="display:flex;border-bottom:2px solid #111;min-height:74px"><div style="flex:1;border-right:1px solid #111;padding:7px 9px"><div style="font:600 9px \'Noto Sans JP\',sans-serif;color:#333;margin-bottom:6px">上記作業が終了したことを承認します。</div><div style="font:700 10px \'Noto Sans JP\',sans-serif">' + esc(recipient) + '　殿</div></div>' +
      '<div style="width:240px;padding:8px 10px"><div style="display:flex;align-items:flex-end;margin-bottom:8px"><span style="font:700 9px \'Noto Sans JP\',sans-serif;color:#444;white-space:nowrap">御社名</span><span style="flex:1;border-bottom:1px solid #999;margin-left:6px;font:700 11px \'Noto Sans JP\',sans-serif;padding-bottom:2px">' + esc(r.oshaName || '　') + '</span></div>' +
      '<div style="display:flex;align-items:flex-end"><span style="font:700 9px \'Noto Sans JP\',sans-serif;color:#444;white-space:nowrap">御担当者名</span><span style="flex:1;border-bottom:1px solid #999;margin-left:6px;height:38px;position:relative">' + sig + '</span></div></div></div>' +
      // customer/plate
      '<div style="display:flex;border-bottom:2px solid #111;font:600 9px \'Noto Sans JP\',sans-serif"><div style="flex:1;border-right:1px solid #111;padding:6px 8px"><div style="font:700 9px \'Noto Sans JP\',sans-serif;margin-bottom:3px">お客様情報</div><div style="color:#333;line-height:1.7">納品先：' + esc(r.nohinSaki || '—') + '<br>住所：' + esc(r.basho || '—') + '<br>ＴＥＬ：' + esc(r.tel || '—') + '　担当者：' + esc(r.tantou || '—') + '</div></div>' +
      '<div style="width:240px;padding:6px 8px"><div style="font:700 9px \'Noto Sans JP\',sans-serif;margin-bottom:3px">銘板情報</div><div style="color:#333;line-height:1.7">型式；' + esc(r.katashiki || '—') + '<br>製番；' + esc(r.seiban || '—') + '<br>年月日；' + esc(r.nenGappi || '—') + '<br>最大積載重量；' + esc(r.saidaiSekisai || '—') + '<br>本体重量；' + esc(r.hontaiJuryo || '—') + '</div></div></div>' +
      // footer
      '<div style="display:flex;align-items:center;padding:8px 10px;gap:12px">' + logo + '<div style="font:600 8.5px/1.6 \'Noto Sans JP\',sans-serif;color:#222"><div style="font-weight:700;font-size:10px">' + esc(footerCompany) + '</div>' + paperFootText(r.type) + '</div></div>' +
      '</div></div>';

    var sigBadge = r.signature ? '<div style="max-width:600px;margin:0 auto 12px;background:#e7f4ec;border:1.5px solid #1c7a45;border-radius:14px;padding:10px 14px;display:flex;align-items:center;gap:10px"><span style="width:24px;height:24px;flex:none;border-radius:50%;background:#1c7a45;color:#fff;font:800 13px \'Noto Sans JP\',sans-serif;display:flex;align-items:center;justify-content:center">✓</span><div style="font:700 13px \'Noto Sans JP\',sans-serif;color:#1c5635;flex:1">サインを取得済み</div><button' + act('goSign') + ' style="height:34px;padding:0 13px;border:1.5px solid #1c7a45;background:#fff;color:#1c7a45;border-radius:9px;font:700 12px \'Noto Sans JP\',sans-serif;cursor:pointer">取り直す</button></div>' : '';

    var body = '<div style="padding:18px 14px 28px;background:#dfe2e8;animation:scin .28s ease both">' +
      '<div style="font:700 13px \'Noto Sans JP\',sans-serif;color:#5a6373;text-align:center;margin-bottom:12px">PDFプレビュー ・ ' + esc(pdfName(active) + '.pdf') + '</div>' + sigBadge + sheet + '</div>';

    // footer buttons
    var footer;
    if (active && active.archived) {
      footer = '<div style="position:sticky;bottom:0;padding:14px 20px 16px;background:linear-gradient(transparent,#dfe2e8 40%);display:flex;gap:9px;z-index:5"><button' + act('goBack') + ' style="flex:none;width:130px;height:54px;border:1.5px solid #b9bfca;background:#fff;color:var(--text);border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer">戻る</button><button' + act('printPdf') + ' style="flex:1;height:54px;border:none;background:var(--primary);color:#fff;border-radius:13px;font:700 15px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">印刷・PDF保存</button></div>';
    } else {
      // 印刷・PDF保存は押印前でも可能（現場でお客様控えを出すため）。クローズのみ押印を要件とする。
      var printBtn = '<button' + act('printPdf') + ' style="flex:1;height:54px;border:1.5px solid var(--primary);background:#fff;color:var(--primary);border-radius:13px;font:700 15px \'Noto Sans JP\',sans-serif;cursor:pointer">印刷・PDF保存</button>';
      var stampedBtns = kStamped ? '<div style="display:flex;gap:9px">' + printBtn + '<button' + act('confirmClose') + ' style="flex:1;height:54px;border:none;background:var(--primary);color:#fff;border-radius:13px;font:700 15px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">クローズ（完了）</button></div>'
        // 「クローズ（完了）」は確認モーダル(印刷/メール導線つき)を開く。プロトの直接クローズより安全側に倒し、handover の「保存・印刷・送信のうえクローズ」を担保。
        :
        '<div style="display:flex;gap:9px">' + printBtn + '</div>' +
        '<button' + act('toggleStamp', { scope: 'case' }) + ' style="width:100%;height:54px;border:1.5px solid #c0392b;background:#fff;color:#c0392b;border-radius:13px;font:700 15px \'Noto Sans JP\',sans-serif;cursor:pointer">🟥 ' + (r.type === 'LW' ? '製造部 管理者' : 'TSC 管理者') + 'として確認印を押す</button><div style="text-align:center;font:600 11.5px/1.5 \'Noto Sans JP\',sans-serif;color:#5a6373;padding:2px 0 0">印刷・PDF保存は押印前でも可能です（確認印欄は空欄で出力）。責任者が押印するとクローズができます。</div>';
      footer = '<div style="position:sticky;bottom:0;padding:14px 20px 16px;background:linear-gradient(transparent,#dfe2e8 40%);display:flex;flex-direction:column;gap:9px;z-index:5">' +
        '<div style="display:flex;gap:9px"><button' + act('goBack') + ' style="flex:none;width:130px;height:54px;border:1.5px solid #b9bfca;background:#fff;color:var(--text);border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer">編集に戻る</button><button' + act('goSign') + ' style="flex:1;height:54px;border:none;background:var(--primary);color:#fff;border-radius:13px;font:700 15px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">サインをする →</button></div>' + stampedBtns + '</div>';
    }
    return body + footer;
  }

  /* ---------------- SEND ---------------- */
  function viewSend() {
    var active = findCase(S.activeId);
    var st = S.settings;
    if (!S.sent) {
      return '<div style="padding:26px 22px 40px;animation:scin .28s ease both">' +
        '<div style="font:900 20px/1.3 \'Noto Sans JP\',sans-serif;color:var(--text);margin-bottom:6px">作業報告書をメール送信</div>' +
        '<div style="font:500 13.5px/1.6 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:20px">設定された送信先に、PDFと定型文で送信します。</div>' +
        '<div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;margin-bottom:18px">' +
        '<div style="display:flex;padding:15px 16px;border-bottom:1px solid var(--border)"><span style="width:72px;font:700 13px \'Noto Sans JP\',sans-serif;color:var(--muted);flex:none">送信先</span><span style="font:600 14px \'Noto Sans JP\',sans-serif;color:var(--text);word-break:break-all">' + esc(st.email) + '</span></div>' +
        (st.cc ? '<div style="display:flex;padding:15px 16px;border-bottom:1px solid var(--border)"><span style="width:72px;font:700 13px \'Noto Sans JP\',sans-serif;color:var(--muted);flex:none">CC</span><span style="font:600 14px \'Noto Sans JP\',sans-serif;color:var(--text);word-break:break-all">' + esc(st.cc) + '</span></div>' : '') +
        '<div style="display:flex;padding:15px 16px;border-bottom:1px solid var(--border)"><span style="width:72px;font:700 13px \'Noto Sans JP\',sans-serif;color:var(--muted);flex:none">件名</span><span style="font:600 14px \'Noto Sans JP\',sans-serif;color:var(--text)">' + esc(fillTemplate(st.subject, active)) + '</span></div>' +
        '<div style="display:flex;padding:15px 16px;border-bottom:1px solid var(--border)"><span style="width:72px;font:700 13px \'Noto Sans JP\',sans-serif;color:var(--muted);flex:none">添付</span><span style="font:600 14px \'Noto Sans JP\',sans-serif;color:var(--primary)">' + esc(pdfName(active) + '.pdf') + '</span></div>' +
        '<div style="padding:15px 16px"><div style="font:700 13px \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:8px">本文</div><div style="font:500 13.5px/1.8 \'Noto Sans JP\',sans-serif;color:var(--text);white-space:pre-wrap;background:var(--bg);border-radius:10px;padding:14px">' + esc(fillTemplate(st.body, active)) + '</div></div></div>' +
        '<button' + act('goSettings') + ' style="width:100%;height:48px;border:1.5px solid var(--border);background:var(--surface);color:var(--primary);border-radius:12px;font:700 13.5px \'Noto Sans JP\',sans-serif;cursor:pointer;margin-bottom:12px">送信先・定型文を編集</button>' +
        '<button' + act('sendNow') + ' style="width:100%;height:58px;border:none;background:var(--primary);color:#fff;border-radius:14px;font:700 17px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">送信する</button></div>';
    }
    return '<div style="padding:26px 22px 40px;animation:scin .28s ease both"><div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:60px">' +
      '<div style="width:96px;height:96px;border-radius:50%;background:var(--primary-soft);border:2px solid var(--primary);display:flex;align-items:center;justify-content:center;font-size:46px;color:var(--primary);margin-bottom:24px">✓</div>' +
      '<div style="font:900 22px \'Noto Sans JP\',sans-serif;color:var(--text);margin-bottom:10px">送信が完了しました</div>' +
      '<div style="font:500 14px/1.7 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:6px">' + esc(st.email) + '</div>' +
      '<div style="font:600 13px \'Noto Sans JP\',sans-serif;color:var(--primary);margin-bottom:36px">' + esc(pdfName(active) + '.pdf') + ' を添付して送信</div>' +
      '<button' + act('finishToHome') + ' style="width:260px;height:56px;border:none;background:var(--primary);color:#fff;border-radius:14px;font:700 16px \'Noto Sans JP\',sans-serif;cursor:pointer">案件一覧に戻る</button></div></div>';
  }

  /* ---------------- SETTINGS ---------------- */
  function viewSettings() {
    var st = S.settings;
    var travelSet = {}; getTravelDepts().forEach(function (d) { travelSet[d] = 1; });
    var deptToggles = allDepts().map(function (d) {
      var on = !!travelSet[d];
      return '<button' + act('toggleTravelDept', { dept: d }) + ' style="height:40px;padding:0 14px;border-radius:20px;cursor:pointer;font:700 12.5px \'Noto Sans JP\',sans-serif;border:1.5px solid ' + (on ? 'var(--primary)' : 'var(--border)') + ';background:' + (on ? 'var(--primary)' : 'var(--surface)') + ';color:' + (on ? '#fff' : 'var(--muted)') + '">' + esc(d) + '</button>';
    }).join('');
    var travelSection = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px">' +
      '<div style="font:700 12.5px \'Noto Sans JP\',sans-serif;color:var(--text);margin-bottom:6px">出張部署（名簿の初期表示に使用）</div>' +
      '<div style="font:500 11.5px/1.7 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:10px">選択した部署が、スタッフ「名簿から追加」で上位に表示されます。加工班など基本行かない部署の応援も、追加時に部署を選べば呼び出せます。' + (deptToggles ? '' : '（先にマスターを取り込むと部署が表示されます）') + '</div>' +
      (deptToggles ? '<div style="display:flex;flex-wrap:wrap;gap:8px">' + deptToggles + '</div>' : '') + '</div>';
    var mImportedAt = (MASTER && MASTER.importedAt) ? MASTER.importedAt : '未取込';
    var mKobans = (MASTER && MASTER.kobans) ? MASTER.kobans.length : 0;
    var masterSection = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px">' +
      '<div style="font:700 12.5px \'Noto Sans JP\',sans-serif;color:var(--text);margin-bottom:6px">🔄 マスター取込（工番・作業員・部署）</div>' +
      '<div style="font:500 11.5px/1.7 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:10px">元マスターの最新データを取り込みます。自動取込は毎日早朝(6時台)。更新をすぐ反映したい時は下のボタンで即時取込できます。<br>最終取込：<b style="color:var(--text)">' + esc(mImportedAt) + '</b>（工番 ' + mKobans + ' 件）</div>' +
      '<button' + act('refreshMaster') + ' style="height:44px;padding:0 18px;border:1.5px solid var(--primary);background:var(--surface);color:var(--primary);border-radius:11px;font:700 13px \'Noto Sans JP\',sans-serif;cursor:pointer">マスターを今すぐ最新に更新</button></div>';
    return '<div style="padding:24px 22px 40px;animation:scin .28s ease both">' +
      '<div style="font:900 20px/1.3 \'Noto Sans JP\',sans-serif;color:var(--text);margin-bottom:20px">送信設定</div>' +
      '<div style="display:flex;flex-direction:column;gap:18px">' +
      '<div><label style="' + labStyle + '">送信先（TO）・複数可</label><input class="req"' + chg('settings', { name: 'email' }) + ' value="' + esc(st.email) + '" inputmode="email" placeholder="例：a@example.com, b@example.com" style="' + inpStyle + '"><div style="font:500 11.5px/1.6 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-top:5px">カンマ・スペース・改行区切りで複数指定できます。</div></div>' +
      '<div><label style="' + labStyle + '">CC（任意・複数可）</label><input' + chg('settings', { name: 'cc' }) + ' value="' + esc(st.cc || '') + '" inputmode="email" placeholder="例：kanri@example.com, soumu@example.com" style="' + inpStyle + '"></div>' +
      '<div><label style="' + labStyle + '">件名（定型）</label><input class="req"' + chg('settings', { name: 'subject' }) + ' value="' + esc(st.subject) + '" style="' + inpStyle + '"></div>' +
      '<div><label style="' + labStyle + '">本文（定型文）</label><textarea' + chg('settings', { name: 'body' }) + ' style="width:100%;height:180px;border:1.5px solid var(--border);border-radius:13px;padding:14px 16px;font:500 14px/1.8 \'Noto Sans JP\',sans-serif;color:var(--text);background:var(--surface);resize:none">' + esc(st.body) + '</textarea></div>' +
      '<div style="background:var(--primary-soft);border:1px solid var(--primary-tint);border-radius:12px;padding:14px 16px;font:500 12.5px/1.8 \'Noto Sans JP\',sans-serif;color:var(--text)">差込キーワード： <b style="color:var(--primary)">{工番}</b> ／ <b style="color:var(--primary)">{お客様名}</b> ／ <b style="color:var(--primary)">{作業日}</b><br>送信時に各案件の情報へ自動で置き換わります。</div>' +
      masterSection +
      travelSection +
      (BOOT.folderUrl ? '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px"><div style="font:700 12.5px \'Noto Sans JP\',sans-serif;color:var(--text);margin-bottom:6px">📁 保管フォルダ（PDF・サイン）</div><div style="font:500 12px/1.7 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:10px">クローズ済み案件の作業報告書PDFとサイン画像が、案件ごとのフォルダに保管されます。総務部などと共有してご利用ください。</div><a href="' + esc(BOOT.folderUrl) + '" target="_blank" rel="noopener" style="display:inline-block;height:44px;line-height:44px;padding:0 18px;border:1.5px solid var(--primary);color:var(--primary);border-radius:11px;font:700 13px \'Noto Sans JP\',sans-serif;text-decoration:none">保管フォルダを開く →</a></div>' : '') + '</div>' +
      '<button' + act('saveSettings') + ' style="width:100%;height:56px;border:none;background:var(--primary);color:#fff;border-radius:14px;font:700 16px \'Noto Sans JP\',sans-serif;cursor:pointer;margin-top:24px;box-shadow:0 6px 18px var(--primary-shadow)">保存する</button>' +
      (S.settingsSaved ? '<div style="text-align:center;margin-top:14px;font:600 13px \'Noto Sans JP\',sans-serif;color:var(--primary)">保存しました</div>' : '') + '</div>';
  }

  /* ---------------- HISTORY ---------------- */
  function viewHistory() {
    var filtered = S.historyList || [];
    var archivedTotal = S.archivedCount;
    var mkChip = function (key, label) { var on = S.histType === key; return '<button' + act('setHistType', { val: key }) + ' style="height:38px;padding:0 16px;border-radius:19px;cursor:pointer;font:700 12.5px \'Noto Sans JP\',sans-serif;border:1.5px solid ' + (on ? 'var(--primary)' : 'var(--border)') + ';background:' + (on ? 'var(--primary)' : 'var(--surface)') + ';color:' + (on ? '#fff' : 'var(--muted)') + '">' + label + '</button>'; };
    var rows = filtered.map(function (c) {
      return '<button' + act('openHistory', { id: c.id }) + ' style="width:100%;text-align:left;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:16px 18px;cursor:pointer;display:block">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
        (c.type === 'LW' ? '<span style="font:800 12px \'Noto Sans JP\',sans-serif;color:#fff;background:var(--primary);padding:4px 10px;border-radius:8px">LW工番</span>' : '<span style="font:800 12px \'Noto Sans JP\',sans-serif;color:var(--primary);background:var(--primary-soft);border:1.5px solid var(--primary);padding:3px 10px;border-radius:8px">TS工番</span>') +
        '<span style="font:800 16px \'Noto Sans JP\',sans-serif;color:var(--text)">' + esc(c.koban) + '</span><span style="margin-left:auto;font:700 11.5px \'Noto Sans JP\',sans-serif;padding:5px 11px;border-radius:20px;background:#eef0f3;color:#6b7480">クローズ</span></div>' +
        '<div style="font:700 15px/1.4 \'Noto Sans JP\',sans-serif;color:var(--text);margin-bottom:6px">' + esc(c.kobanName) + '</div>' +
        '<div style="display:flex;flex-wrap:wrap;column-gap:16px;row-gap:4px;font:500 12.5px \'Noto Sans JP\',sans-serif;color:var(--muted)"><span>納品先 ： ' + esc(c.nohinSaki) + '</span><span>装置 ： ' + esc(c.kishu || '—') + '</span><span>製番 ： ' + esc(c.seiban || '—') + '</span><span>クローズ日 ： ' + esc(fmtDate(c.closedAt)) + '</span></div></button>';
    }).join('');
    var empty = S.historyLoading ? '<div style="text-align:center;padding:50px 0;font:600 14px \'Noto Sans JP\',sans-serif;color:var(--muted)">読み込み中…</div>'
      : (archivedTotal === 0 ? '<div style="text-align:center;padding:50px 0;font:600 14px \'Noto Sans JP\',sans-serif;color:var(--muted)">クローズ済みの案件はまだありません。</div>'
        : (filtered.length === 0 ? '<div style="text-align:center;padding:50px 0;font:600 14px \'Noto Sans JP\',sans-serif;color:var(--muted)">条件に一致する履歴が見つかりません。</div>' : ''));
    return '<div style="padding:22px 22px 40px;animation:scin .28s ease both">' +
      '<div style="font:900 20px/1.3 \'Noto Sans JP\',sans-serif;color:var(--text);margin-bottom:6px">履歴管理</div>' +
      '<div style="font:500 13px/1.5 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:16px">クローズ済みの作業報告書 ・ ' + filtered.length + ' / ' + archivedTotal + ' 件（データは保管されています）</div>' +
      '<div style="position:relative;margin-bottom:12px"><span style="position:absolute;left:15px;top:50%;transform:translateY(-50%);font-size:17px;color:var(--muted)">🔍</span>' +
      '<input' + chg('histQuery') + ' value="' + esc(S.histQuery) + '" placeholder="工番・製番・お客様名・装置名・日付で検索" style="width:100%;height:52px;border:1.5px solid var(--border);border-radius:13px;padding:0 44px;font:600 14.5px \'Noto Sans JP\',sans-serif;color:var(--text);background:var(--surface)">' +
      (S.histQuery ? '<button' + act('clearHistQuery') + ' style="position:absolute;right:10px;top:50%;transform:translateY(-50%);width:32px;height:32px;border:none;background:var(--bg);color:var(--muted);border-radius:8px;font-size:16px;cursor:pointer">✕</button>' : '') + '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:18px">' + mkChip('all', 'すべて') + mkChip('LW', 'LW工番') + mkChip('TS', 'TS工番') + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:12px">' + rows + empty + '</div></div>';
  }

  /* ==================================================================
   * MODALS
   * ================================================================== */
  function renderModals() {
    var out = '';
    if (S.menuId) {
      var mc = findCase(S.menuId);
      out += '<div' + act('closeMenu') + ' style="position:absolute;inset:0;background:rgba(15,23,42,.42);z-index:50;display:flex;align-items:flex-end">' +
        '<div' + act('stop') + ' style="width:100%;background:var(--surface);border-radius:24px 24px 0 0;padding:14px 16px 24px;animation:scin .2s ease both">' +
        '<div style="width:42px;height:5px;border-radius:3px;background:#d7dbe2;margin:2px auto 14px"></div>' +
        '<div style="text-align:center;font:700 13px \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:16px">' + esc(mc ? (mc.koban + ' ／ ' + mc.nohinSaki) : '') + '</div>' +
        '<button' + act('menuEdit') + ' style="width:100%;height:56px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:14px;font:700 15px \'Noto Sans JP\',sans-serif;cursor:pointer;margin-bottom:10px">案件情報を編集</button>' +
        '<button' + act('menuDup') + ' style="width:100%;height:56px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:14px;font:700 15px \'Noto Sans JP\',sans-serif;cursor:pointer;margin-bottom:10px">この案件を複製</button>' +
        '<button' + act('menuDelete') + ' style="width:100%;height:56px;border:1.5px solid #f2c4bd;background:#fdecea;color:#b03a2e;border-radius:14px;font:700 15px \'Noto Sans JP\',sans-serif;cursor:pointer;margin-bottom:14px">削除する</button>' +
        '<button' + act('closeMenu') + ' style="width:100%;height:52px;border:none;background:var(--bg);color:var(--muted);border-radius:14px;font:700 15px \'Noto Sans JP\',sans-serif;cursor:pointer">キャンセル</button></div></div>';
    }
    if (S.edit) out += renderFsSheet();
    if (S.voiceOpen) out += renderVoice();
    if (S.plateOpen) out += renderPlate();
    if (S.closingId) {
      out += '<div' + act('cancelClose') + ' style="position:absolute;inset:0;background:rgba(15,23,42,.42);z-index:50;display:flex;align-items:center;justify-content:center;padding:28px">' +
        '<div' + act('stop') + ' style="width:100%;max-width:420px;background:var(--surface);border-radius:20px;padding:24px;animation:scin .2s ease both">' +
        '<div style="font:900 18px/1.4 \'Noto Sans JP\',sans-serif;color:var(--text);margin-bottom:10px">クローズ（完了）</div>' +
        '<div style="font:500 13px/1.7 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:18px">「クローズする」を押すと、この内容でPDFを生成し、設定の宛先（TO／CC）へ<b style="color:var(--primary)">自動でメール送信</b>したうえでクローズします。案件はストック一覧から外れ、履歴管理に保管されます（データは残ります）。手動で先に印刷・送信も可能です。</div>' +
        '<div style="display:flex;gap:10px;margin-bottom:10px"><button' + act('printPdf') + ' style="flex:1;height:50px;border:1.5px solid var(--primary);background:var(--surface);color:var(--primary);border-radius:12px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer">印刷・PDF保存</button><button' + act('goSend') + ' style="flex:1;height:50px;border:1.5px solid var(--primary);background:var(--surface);color:var(--primary);border-radius:12px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer">メール送信</button></div>' +
        '<div style="display:flex;gap:12px"><button' + act('cancelClose') + ' style="flex:1;height:52px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:13px;font:700 15px \'Noto Sans JP\',sans-serif;cursor:pointer">キャンセル</button><button' + act('doClose') + ' style="flex:1;height:52px;border:none;background:var(--primary);color:#fff;border-radius:13px;font:700 15px \'Noto Sans JP\',sans-serif;cursor:pointer">クローズする</button></div></div></div>';
    }
    return out;
  }

  // 整形スタイル選択（自動/箇条書き/番号/見出し/文章）
  function styleSelector() {
    var cur = S.vStyle || 'auto';
    var opts = [['auto', '自動'], ['bullet', '● 箇条書き'], ['number', '① 番号'], ['heading', '【見出し】'], ['plain', '文章']];
    var btns = opts.map(function (o) {
      var on = cur === o[0];
      return '<button' + act('setVStyle', { val: o[0] }) + ' style="height:34px;padding:0 12px;border-radius:9px;cursor:pointer;font:700 12px \'Noto Sans JP\',sans-serif;border:1.5px solid ' + (on ? 'var(--primary)' : 'var(--border)') + ';background:' + (on ? 'var(--primary)' : 'var(--surface)') + ';color:' + (on ? '#fff' : 'var(--muted)') + '">' + o[1] + '</button>';
    }).join('');
    return '<div style="margin-bottom:14px"><div style="' + miniLab + '">整形スタイル</div><div style="display:flex;flex-wrap:wrap;gap:7px">' + btns + '</div></div>';
  }
  function renderVoice() {
    var inner;
    var vTgt = S.vTarget || 'shori';
    var vLbl = vTgt === 'genin' ? '作業内容' : '実施内容';
    var vLim = LIMIT[vTgt] || LIMIT.shori;
    if (S.vProcessing) {
      inner = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 0"><div style="width:54px;height:54px;border:4px solid var(--primary-soft);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite"></div><div style="font:700 13.5px \'Noto Sans JP\',sans-serif;color:var(--primary);margin-top:16px">AIが文章を整えています…</div></div>';
    } else if (S.vResult) {
      inner = '<div style="background:var(--primary-soft);border:1.5px solid var(--primary);border-radius:14px;padding:14px;margin:6px 0 16px"><div style="font:700 11px \'Noto Sans JP\',sans-serif;color:var(--primary);margin-bottom:6px">✨ AI整形結果（' + vLbl + '）</div><div style="font:500 14px/1.8 \'Noto Sans JP\',sans-serif;color:var(--text);white-space:pre-wrap">' + esc(S.vResult) + '</div></div>' +
        '<div style="display:flex;gap:10px"><button' + act('redoVoice') + ' style="flex:none;width:120px;height:52px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer">やり直す</button><button' + act('applyVoice') + ' style="flex:1;height:52px;border:none;background:var(--primary);color:#fff;border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">' + vLbl + 'に反映する</button></div>';
    } else {
      inner = '<div style="margin-bottom:14px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px"><div style="font:700 11px \'Noto Sans JP\',sans-serif;color:var(--muted)">認識テキスト（手入力も可）</div>' + (S.vListening ? '<div style="font:700 11px \'Noto Sans JP\',sans-serif;color:#c0392b">● 録音中…</div>' : '') + '</div>' +
        '<textarea maxlength="' + vLim + '" data-counter="cnt-vraw"' + chg('voiceText') + ' placeholder="マイクで話すか、ここに直接入力できます。" style="width:100%;height:120px;border:1.5px solid var(--border);border-radius:12px;padding:11px 13px;font:500 14px/1.7 \'Noto Sans JP\',sans-serif;color:var(--text);background:var(--surface);resize:none">' + esc(S.vRaw) + '</textarea>' + taCounter('cnt-vraw', S.vRaw, vLim) +
        (S.vListening ? '<div style="font:500 13px/1.6 \'Noto Sans JP\',sans-serif;color:var(--primary);margin-top:6px;min-height:18px">' + esc(S.vInterim) + '</div>' : '') + '</div>' +
        '<div style="display:flex;gap:10px"><button' + act('toggleListen') + ' style="flex:1;height:52px;border:1.5px solid ' + (S.vListening ? '#c0392b' : 'var(--primary)') + ';background:' + (S.vListening ? '#fdecea' : '#fff') + ';color:' + (S.vListening ? '#c0392b' : 'var(--primary)') + ';border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer">' + (S.vListening ? '● 録音を停止' : '🎤 録音を開始') + '</button><button' + act('aiFormatVoice') + ' style="flex:1;height:52px;border:none;background:var(--primary);color:#fff;border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">✨ AIで整える</button></div>';
    }
    return '<div' + act('closeVoice') + ' style="position:absolute;inset:0;background:rgba(15,23,42,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:24px">' +
      '<div' + act('stop') + ' style="width:100%;max-width:520px;max-height:calc(100% - 48px);overflow-y:auto;background:var(--surface);border-radius:22px;padding:24px;animation:scin .2s ease both">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font-size:18px">🎤</span><div style="font:900 18px \'Noto Sans JP\',sans-serif;color:var(--text)">' + vLbl + 'を音声で入力</div></div>' +
      '<div style="font:500 12.5px/1.6 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:12px">マイクで話した内容をAIが報告書向けの文章に整えます。（' + vLbl + '欄へ反映）</div>' +
      styleSelector() +
      (S.vError ? '<div style="background:#fdecea;border:1px solid #f5c6c0;color:#b03a2e;border-radius:12px;padding:12px 14px;font:600 12.5px/1.6 \'Noto Sans JP\',sans-serif;margin-bottom:14px">' + esc(S.vError) + '</div>' : '') +
      inner +
      '<button' + act('closeVoice') + ' style="width:100%;height:44px;border:none;background:none;color:var(--muted);font:700 13px \'Noto Sans JP\',sans-serif;cursor:pointer;margin-top:12px">閉じる</button></div></div>';
  }

  function renderPlate() {
    var inner;
    if (!S.plateImg) {
      inner = '<label style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;border:2px dashed var(--primary);background:var(--primary-soft);border-radius:16px;padding:40px 20px;cursor:pointer"><span style="font-size:40px">📷</span><span style="font:700 14px \'Noto Sans JP\',sans-serif;color:var(--primary)">タップして銘板を撮影 / 選択</span><input type="file" accept="image/*" capture="environment"' + chg('plateFile') + ' style="display:none"></label>';
    } else {
      var overlay = S.plateProcessing ? '<div style="position:absolute;inset:10px;background:rgba(15,23,42,.55);border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center"><div style="width:48px;height:48px;border:4px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite"></div><div style="font:700 13px \'Noto Sans JP\',sans-serif;color:#fff;margin-top:14px">AIが銘板を解析中…</div></div>' : '';
      var imgBox = '<div style="border:1.5px solid var(--border);border-radius:14px;padding:10px;margin-bottom:14px;position:relative"><img src="' + esc(S.plateImg) + '" alt="銘板" style="width:100%;max-height:260px;object-fit:contain;border-radius:10px;background:#000">' + overlay + '</div>';
      var actionArea;
      if (S.plateResult) {
        var pr = S.plateResult;
        actionArea = '<div style="background:var(--primary-soft);border:1.5px solid var(--primary);border-radius:14px;padding:14px;margin-bottom:14px"><div style="font:700 11px \'Noto Sans JP\',sans-serif;color:var(--primary);margin-bottom:10px">✨ 読み取り結果</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
          [['機種', pr.kishu], ['型式', pr.katashiki], ['製番', pr.seiban], ['製造年月', pr.nenGappi], ['最大積載重量', pr.saidaiSekisai], ['本体重量', pr.hontaiJuryo]].map(function (kv) { return '<div><div style="' + miniLab + '">' + kv[0] + '</div><div style="font:700 15px \'Noto Sans JP\',sans-serif;color:var(--text)">' + esc(kv[1] || '—') + '</div></div>'; }).join('') + '</div></div>' +
          '<div style="display:flex;gap:10px"><label style="flex:none;width:120px;height:52px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center">撮り直す<input type="file" accept="image/*" capture="environment"' + chg('plateFile') + ' style="display:none"></label><button' + act('applyPlate') + ' style="flex:1;height:52px;border:none;background:var(--primary);color:#fff;border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">各項目に反映する</button></div>';
      } else {
        actionArea = '<div style="display:flex;gap:10px"><label style="flex:none;width:120px;height:52px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center">選び直す<input type="file" accept="image/*" capture="environment"' + chg('plateFile') + ' style="display:none"></label><button' + act('aiReadPlate') + ' style="flex:1;height:52px;border:none;background:var(--primary);color:#fff;border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">✨ AIで読み取る</button></div>';
      }
      inner = imgBox + actionArea;
    }
    return '<div' + act('closePlate') + ' style="position:absolute;inset:0;background:rgba(15,23,42,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:24px">' +
      '<div' + act('stop') + ' style="width:100%;max-width:520px;max-height:calc(100% - 48px);overflow-y:auto;background:var(--surface);border-radius:22px;padding:24px;animation:scin .2s ease both">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font-size:18px">📷</span><div style="font:900 18px \'Noto Sans JP\',sans-serif;color:var(--text)">銘板を撮影して自動入力</div></div>' +
      '<div style="font:500 12.5px/1.6 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:16px">アルミ銘板を撮影すると、AIが機種・型式・製番・製造年月・最大積載重量・本体重量を読み取ります。</div>' +
      inner +
      '<button' + act('closePlate') + ' style="width:100%;height:44px;border:none;background:none;color:var(--muted);font:700 13px \'Noto Sans JP\',sans-serif;cursor:pointer;margin-top:12px">閉じる</button></div></div>';
  }

  /* ==================================================================
   * ACTIONS
   * ================================================================== */
  function nav(screen) { setState(function (s) { return { history: s.history.concat([s.screen]), screen: screen, settingsSaved: false, edit: null }; }); }
  function pushNav(screen) { setState(function (s) { return { history: s.history.concat([s.screen]), screen: screen, edit: null }; }); }

  function mutateCase(fn) {
    setState(function (s) { return { cases: s.cases.map(function (c) { return c.id === s.activeId ? fn(Object.assign({}, c)) : c; }) }; });
  }
  function mutate(scope, fn) { if (scope === 'new') setState(function (s) { return { newForm: fn(Object.assign({}, s.newForm)) }; }); else mutateCase(fn); }

  var ACTIONS = {
    goBack: function () { var fromReport = S.screen === 'report'; setState(function (s) { var h = s.history.slice(); var prev = h.pop() || 'home'; return { history: h, screen: prev, edit: null }; }); if (fromReport) persistActive().then(function () { return reloadState(); }).catch(function (e) { toast(errMsg(e), true); }); },
    // report の「一時保存」：アクティブ案件をサーバー保存してからトップへ
    goHome: function () {
      var fromReport = S.screen === 'report';
      if (fromReport) { S.edit = null; setBusy(true); persistActive().then(function () { return reloadState(); }).then(function () { setState({ screen: 'home', history: [] }); toast('保存しました'); }).catch(function (e) { setBusy(false); toast(errMsg(e), true); }); }
      else { setState({ screen: 'home', history: [], edit: null }); }
    },
    goSettings: function () { nav('settings'); },
    goHistory: function () { nav('history'); loadHistory(); },
    goNewType: function () { pushNav('newType'); },
    goSign: function () { nav('sign'); },
    goPreview: function () { var fromReport = S.screen === 'report'; nav('preview'); if (fromReport) persistActive().catch(function (e) { toast(errMsg(e), true); }); },
    // 社内ポータルへ移動（外部リンク）。報告書画面のときだけ未保存の編集を保存してから遷移。それ以外は素の<a>遷移に任せる。
    goPortal: function (d, e) {
      if (S.screen !== 'report') return;
      if (e && e.preventDefault) e.preventDefault();
      setBusy(true);
      persistActive().then(function () { (window.top || window).location.href = PORTAL_URL; })
        .catch(function (err) { setBusy(false); toast('保存に失敗しました：' + errMsg(err), true); });
    },
    // メール送信画面へ。プレビュー(#pdf-print)がある間にPDFを用意してから遷移（添付用）
    goSend: function () {
      var doNav = function () { setState(function (s) { return { history: s.history.concat([s.screen]), screen: 'send', sent: false, edit: null }; }); };
      if (document.getElementById('pdf-print')) { setBusy(true); savePdfBackup().then(function () { setState({ busy: false }); doNav(); }); }
      else { doNav(); }
    },
    finishToHome: function () { setState({ screen: 'home', history: [], sent: false, edit: null }); reloadState(); },
    setFilter: function (d) { setState({ filter: d.val }); },
    setHistType: function (d) { setState({ histType: d.val }); loadHistory(); },
    clearHistQuery: function () { setState({ histQuery: '', histType: 'all' }); loadHistory(); },
    pickLW: function () { setState(function (s) { return { draftType: 'LW', editId: null, newForm: blankForm('LW'), nfError: false, edit: null, history: s.history.concat(['newType']), screen: 'newForm' }; }); },
    pickTS: function () { setState(function (s) { return { draftType: 'TS', editId: null, newForm: blankForm('TS'), nfError: false, edit: null, history: s.history.concat(['newType']), screen: 'newForm' }; }); },
    setNewStatus: function (d) { setState(function (s) { return { newForm: Object.assign({}, s.newForm, { status: d.val }) }; }); },
    openCase: function (d) { setState(function (s) { return { activeId: d.id, history: s.history.concat([s.screen]), screen: 'report', edit: null }; }); patchCaseSignature(d.id); },
    openMenu: function (d) { setState({ menuId: d.id }); },
    closeMenu: function () { setState({ menuId: null }); },
    stop: function (e) { if (e) e.stopPropagation(); },
    menuEdit: function () { var id = S.menuId; var c = findCase(id); if (!c) return; setState(function (s) { return { editId: id, draftType: c.type, newForm: JSON.parse(JSON.stringify(c)), menuId: null, nfError: false, edit: null, history: s.history.concat(['home']), screen: 'newForm' }; }); },
    menuDup: function () { var id = S.menuId; setState({ menuId: null }); setBusy(true); server('duplicateCase', id).then(function () { return reloadState(); }).then(function () { toast('複製しました'); }).catch(function (e) { setBusy(false); toast(errMsg(e), true); }); },
    menuDelete: function () { var id = S.menuId; setState({ menuId: null }); setBusy(true); server('deleteCase', id).then(function () { return reloadState(); }).then(function () { toast('削除しました'); }).catch(function (e) { setBusy(false); toast(errMsg(e), true); }); },
    // 名簿から作業員を追加（空行があれば埋める、なければ追加）
    addStaffFromMaster: function (d) {
      var code = d.val; if (!code) return;
      var st = (MASTER.staff || []).filter(function (x) { return x.code === code; })[0];
      if (!st) return;
      mutate(d.scope, function (o) {
        var staff = o.staff.slice(); var emptyIdx = -1;
        for (var i = 0; i < staff.length; i++) { if (!String(staff[i].name).trim()) { emptyIdx = i; break; } }
        if (emptyIdx >= 0) staff[emptyIdx] = Object.assign({}, staff[emptyIdx], { name: st.name });
        else staff = staff.concat([{ id: uid('s'), name: st.name, separate: false }]);
        return Object.assign({}, o, { staff: staff });
      });
    },
    // マスターを今すぐ最新に取り込む（元シートの最新を反映）
    refreshMaster: function () {
      setBusy(true);
      server('refreshMaster').then(function (r) {
        if (r && r.master) MASTER = r.master;
        setState({ busy: false });
        var c = (r && r.counts) || {};
        toast('マスターを最新に更新しました（工番' + (c.kobans || 0) + '・作業員' + (c.staff || 0) + '・部署' + (c.depts || 0) + '）');
      }).catch(function (e) { setBusy(false); toast(errMsg(e), true); });
    },
    // 名簿ピッカー：出張部署のみ ⇔ 全部署 の切替
    togglePickAll: function () { setState({ pickAllDepts: !S.pickAllDepts, pickDept: '' }); },
    // 設定：出張部署のトグル（保存前のローカル変更）
    toggleTravelDept: function (d) {
      var dept = d.dept; var cur = getTravelDepts(); var i = cur.indexOf(dept);
      if (i >= 0) cur.splice(i, 1); else cur.push(dept);
      setState(function (s) { return { settings: Object.assign({}, s.settings, { travelDepts: cur.join(',') }), settingsSaved: false }; });
    },
    addNewStaff: function () { mutate('new', function (o) { return Object.assign({}, o, { staff: o.staff.concat([{ id: uid('s'), name: '', separate: false }]) }); }); },
    addStaffCase: function () { mutate('case', function (o) { return Object.assign({}, o, { staff: o.staff.concat([{ id: uid('s'), name: '', separate: false }]) }); }); },
    removeStaff: function (d) { var si = +d.si; mutate(d.scope, function (o) { return Object.assign({}, o, { staff: o.staff.length > 1 ? o.staff.filter(function (_, i) { return i !== si; }) : o.staff }); }); },
    toggleWorkType: function (d) { mutate(d.scope, function (o) { var w = Object.assign({}, o.workTypes); w[d.key] = !w[d.key]; return Object.assign({}, o, { workTypes: w }); }); },
    setPaid: function (d) { mutate(d.scope, function (o) { return Object.assign({}, o, { paid: d.val }); }); },
    cycleConfirm: function (d) { var order = ['', '✓', '−']; mutate(d.scope, function (o) { return Object.assign({}, o, { confirmItems: o.confirmItems.map(function (it) { return it.key === d.key ? Object.assign({}, it, { value: order[(order.indexOf(it.value) + 1) % 3] }) : it; }) }); }); },
    toggleStamp: function (d) { mutate(d.scope, function (o) { var on = !(o.kanin && o.kanin.stamped); var name = (o.kanin && o.kanin.name) || (o.type === 'LW' ? '製造部 田中' : 'TSC 木下'); return Object.assign({}, o, { kanin: { stamped: on, name: name } }); }); },
    // time rows
    removeTimeRow: function (d) {
      var i = +d.i;
      if (d.si !== undefined) { var si = +d.si, which = d.list; mutate('case', function (o) { return Object.assign({}, o, { staff: o.staff.map(function (st, x) { if (x !== si) return st; var arr = st[which] || []; return Object.assign({}, st, wrapKey(which, arr.length > 1 ? arr.filter(function (_, y) { return y !== i; }) : arr)); }) }); }); }
      else { mutate('case', function (o) { var arr = o[d.list] || []; var p = {}; p[d.list] = arr.length > 1 ? arr.filter(function (_, x) { return x !== i; }) : arr; return Object.assign({}, o, p); }); }
    },
    setSeparate: function (d) { var si = +d.si; setSeparateFn(si, d.val === 'true'); },
    // signature
    clearSig: function () { var c = document.getElementById('sigpad'); if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height); },
    // サインを案件フォルダ(Drive)へ保存し、fileId/表示URLを反映
    saveSig: function () {
      var c = document.getElementById('sigpad');
      if (!c) { ACTIONS.goBack(); return; }
      var url = c.toDataURL('image/png');
      var id = S.activeId;
      setBusy(true);
      server('saveSignature', id, url).then(function (res) {
        setState(function (s) { return { busy: false, cases: s.cases.map(function (x) { return x.id === id ? Object.assign({}, x, { signature: res.url || url, signatureFileId: res.fileId }) : x; }) }; });
        toast('サインを保存しました'); ACTIONS.goBack();
      }).catch(function (e) { setBusy(false); toast(errMsg(e), true); });
    },
    // save / close / send
    saveCase: function () {
      var f = S.newForm;
      if (!String(f.koban).trim() || !String(f.nohinSaki).trim()) { var miss = !String(f.koban).trim() ? 'koban' : 'okyaku'; setState({ nfError: true, edit: { id: miss, scope: 'new', which: 'start', orig: f.koban }, fsScrollTo: miss }); return; }
      S.edit = null;
      var wasEdit = !!S.editId;
      setBusy(true);
      server('saveCase', f).then(function () { return reloadState(); }).then(function () {
        setState({ screen: 'home', history: [], editId: null });
        toast(wasEdit ? '変更を保存しました' : 'ストックに保存しました');
      }).catch(function (e) { setBusy(false); toast(errMsg(e), true); });
    },
    confirmClose: function () { setState({ closingId: S.activeId }); },
    cancelClose: function () { setState({ closingId: null }); },
    // クローズ：保存→PDF生成(この1回)→そのPDFを添付して自動メール送信→サーバーでクローズ→履歴へ
    doClose: function () {
      var id = S.closingId || S.activeId;
      var sent = false;
      setState({ closingId: null }); setBusy(true);
      persistActive()
        .then(function () { return savePdfBackup(); })       // #pdf-print をキャプチャして Drive 保管
        .then(function () {                                    // 生成したPDFを添付して自動送信（TO/CC）
          return server('sendReportMail', id).then(function () { sent = true; })
            .catch(function (e) { toast('メール送信をスキップ/失敗：' + errMsg(e), true); });
        })
        .then(function () { return server('closeCase', id); })
        .then(function () { return reloadState(); })
        .then(function () { setState({ screen: 'home', history: [] }); toast(sent ? 'クローズし、PDFをメール送信・保管しました' : 'クローズしPDFを保管しました（メール未送信）'); })
        .catch(function (e) { setBusy(false); toast(errMsg(e), true); });
    },
    // 保管PDFを添付して実送信（GmailApp）→ ステータス完了に同期
    sendNow: function () {
      var id = S.activeId; setBusy(true);
      server('sendReportMail', id).then(function () { return reloadState(); })
        .then(function () { setState({ busy: false, sent: true }); })
        .catch(function (e) { setBusy(false); toast(errMsg(e), true); });
    },
    // 設定をサーバー(設定シート)へ保存
    saveSettings: function () {
      setBusy(true);
      server('saveSettings', S.settings).then(function (saved) {
        setState({ busy: false, settings: saved || S.settings, settingsSaved: true }); toast('保存しました');
      }).catch(function (e) { setBusy(false); toast(errMsg(e), true); });
    },
    printPdf: function () { doPrint(); },
    openHistory: function (d) { setState(function (s) { return { activeId: d.id, history: s.history.concat(['history']), screen: 'preview', edit: null }; }); patchCaseSignature(d.id); },
    // voice (mock; S6 で Gemini 実装)
    setVStyle: function (d) { setState({ vStyle: d.val }); },
    openVoice: function (d) { setState({ voiceOpen: true, vTarget: (d && d.target) || 'shori', vScope: (d && d.scope) || 'case', vRaw: (d && d.prefill) || '', vInterim: '', vResult: '', vError: '', vProcessing: false, vListening: false, vStyle: S.vStyle || 'auto' }); },
    closeVoice: function () { stopRec(); setState({ voiceOpen: false, vListening: false }); },
    toggleListen: function () { toggleListen(); },
    // やり直す＝音声入力からやり直し（整形結果と認識テキストを消して録音画面へ戻す）
    redoVoice: function () { stopRec(); setState({ vResult: '', vRaw: '', vInterim: '', vError: '', vProcessing: false, vListening: false }); },
    aiFormatVoice: function () {
      var raw = (S.vRaw + ' ' + S.vInterim).trim(); stopRec();
      // 入力が空なら整形せず、録音/入力を促す（サンプル文は出さない）
      if (!raw) { setState({ vListening: false, vProcessing: false, vResult: '', vError: '先にマイクで話すか、テキストを入力してください。' }); return; }
      setState({ vListening: false, vProcessing: true, vResult: '', vError: '' });
      // Gemini 未設定なら簡易整形にフォールバック
      var fallback = function (extra) { var m = mockSummarize(raw); setState(Object.assign({ vProcessing: false }, m ? { vResult: m } : { vResult: '', vError: '整えられる内容がありませんでした。もう一度、話すか入力してください。' })); if (extra) toast(extra, true); };
      if (!BOOT.geminiEnabled) { setTimeout(function () { fallback(); }, 700); return; }
      server('aiFormatShori', raw, S.vStyle || 'auto').then(function (text) {
        if (text) { setState({ vProcessing: false, vResult: text }); } else { fallback(); }
      }).catch(function (e) {
        fallback('AI整形に失敗したため簡易整形しました：' + errMsg(e));
      });
    },
    // 対象欄（作業内容=genin / 実施内容=shori）へ「置き換え」で反映（従来の追記だと重複・肥大化の原因になるため）
    applyVoice: function () {
      var res = S.vResult; var tgt = S.vTarget || 'shori'; var lim = LIMIT[tgt] || LIMIT.shori;
      if (!res) { setState({ voiceOpen: false, vListening: false }); return; }
      var truncated = volume(res) > lim;
      var capped = capVolume(res, lim);
      mutate(S.vScope || 'case', function (o) { var patch = {}; patch[tgt] = capped; return Object.assign({}, o, patch); });
      setState({ voiceOpen: false, vListening: false });
      var lbl = tgt === 'genin' ? '作業内容' : '実施内容';
      toast(truncated ? (lbl + 'に反映しました（上限のため一部省略）') : (lbl + 'に反映しました'));
    },
    // plate (mock; S6 で Gemini Vision 実装)
    openPlate: function (d) { setState({ plateOpen: true, plateScope: (d && d.scope) || 'case', plateImg: '', plateProcessing: false, plateResult: null }); },
    closePlate: function () { setState({ plateOpen: false }); },
    aiReadPlate: function () {
      if (!S.plateImg) return;
      setState({ plateProcessing: true, plateResult: null });
      var mockPlate = function () { var c = fsObj(S.plateScope || 'case') || {}; return { kishu: c.kishu || 'LN-3000', katashiki: c.katashiki || 'CT-3000', seiban: c.seiban || '25-0083', nenGappi: c.nenGappi || '2025-03', saidaiSekisai: c.saidaiSekisai || '5000kg', hontaiJuryo: c.hontaiJuryo || '11500kg' }; };
      if (!BOOT.geminiEnabled) { setTimeout(function () { setState({ plateProcessing: false, plateResult: mockPlate() }); }, 900); return; }
      downscaleDataUrl(S.plateImg, 1600).then(function (small) {
        return server('aiReadPlate', small);
      }).then(function (res) {
        setState({ plateProcessing: false, plateResult: res });
      }).catch(function (e) {
        setState({ plateProcessing: false, plateResult: mockPlate() });
        toast('銘板のAI読み取りに失敗したため暫定値を表示しました：' + errMsg(e), true);
      });
    },
    applyPlate: function () {
      var res = S.plateResult; if (!res) { ACTIONS.closePlate(); return; }
      S.plateOpen = false;
      mutate(S.plateScope || 'case', function (c) { return Object.assign({}, c, { kishu: res.kishu, katashiki: res.katashiki, seiban: res.seiban, nenGappi: res.nenGappi, saidaiSekisai: res.saidaiSekisai, hontaiJuryo: res.hontaiJuryo }); });
    },

    /* ---------- 帳票型入力 ---------- */
    fsOpen: function (d) {
      var scope = fsScope(), id = d.id;
      if (id === 'sign') { // お客様サインはサイン画面で取得（編集中の内容を保存してから）
        if (scope !== 'case') return;
        persistActive().catch(function (e) { toast(errMsg(e), true); });
        nav('sign'); return;
      }
      // 時間の行を開いたとき日付が空なら、作業日（なければ今日）を入れておく
      if (String(id).indexOf('row:') === 0) { var o0 = fsObj(scope), ref0 = fsRowRef(id), r0 = fsRow(o0, ref0); if (r0 && !r0.date) fsSetRowField(scope, ref0, 'date', workDate(o0) || TODAY); }
      setState({ edit: { id: id, scope: scope, which: 'start', orig: fsObj(scope).koban }, fsScrollTo: id });
    },
    // 閉じる：工番を変えていたらマスターから お客様名・住所・機種 を補完
    fsClose: function () {
      var ed = S.edit; if (!ed) return;
      if (ed.id === 'koban') { var k = fsObj(ed.scope).koban; if (k !== ed.orig && applyMasterKoban(ed.scope, k)) toast('工番マスターから お客様名・住所・機種 を入れました'); }
      setState({ edit: null, nfError: false });
    },
    // 次の未入力へ（Excel の Tab のように、帳票の上から順に未入力の枠を開く）
    fsNext: function () {
      var ed = S.edit, scope = ed ? ed.scope : fsScope();
      if (ed && ed.id === 'koban') { var k = fsObj(scope).koban; if (k !== ed.orig && applyMasterKoban(scope, k)) toast('工番マスターから お客様名・住所・機種 を入れました'); }
      var L = fsEmpties(scope, fsObj(scope));
      var cur = ed ? L.indexOf(ed.id) : -1;
      var next = cur >= 0 ? L[cur + 1] : L.filter(function (x) { return !ed || x !== ed.id; })[0];
      if (!next) { setState({ edit: null }); toast(L.length ? '残りの未入力はこの欄だけです' : 'すべて入力済みです'); return; }
      ACTIONS.fsOpen({ id: next });
    },
    fsGuide: function () { setState({ fsGuide: S.fsGuide === false }); },
    fsZoom: function () { setState({ fsZoom: !S.fsZoom }); },
    fsWT: function (d) { ACTIONS.toggleWorkType({ scope: fsScope(), key: d.key }); },
    fsCf: function (d) { ACTIONS.cycleConfirm({ scope: fsScope(), key: d.key }); },
    fsCfSet: function (d) { var ed = S.edit; if (!ed) return; mutate(ed.scope, function (o) { return Object.assign({}, o, { confirmItems: o.confirmItems.map(function (it) { return it.key === d.key ? Object.assign({}, it, { value: d.val }) : it; }) }); }); },
    fsPickKoban: function (d) {
      var ed = S.edit; if (!ed) return;
      applyMasterKoban(ed.scope, d.k);
      setState({ edit: null, nfError: false });
      toast('工番マスターから お客様名・住所・機種 を入れました');
    },
    fsWhich: function (d) { var ed = S.edit; if (!ed) return; setState({ edit: Object.assign({}, ed, { which: d.w }) }); },
    fsDir: function (d) { var ed = S.edit; if (!ed) return; fsSetRowField(ed.scope, fsRowRef(ed.id), 'dir', d.val); render(); },
    fsClearTime: function () { var ed = S.edit; if (!ed) return; var ref = fsRowRef(ed.id); fsSetRowField(ed.scope, ref, 'start', ''); fsSetRowField(ed.scope, ref, 'end', ''); render(); },
    fsDelRow: function () {
      var ed = S.edit; if (!ed) return; var ref = fsRowRef(ed.id);
      S.edit = null;
      ACTIONS.removeTimeRow(ref.si !== undefined ? { list: ref.list, i: ref.i, si: ref.si } : { list: ref.list, i: ref.i });
    },
    // 行の追加：別行動の人がいれば「誰の行か」を聞く
    fsAddRow: function (d) {
      var o = fsObj('case');
      if ((o.staff || []).some(function (st) { return st.separate; })) { setState({ edit: { id: 'addrow:' + d.kind, scope: 'case', which: 'start' } }); return; }
      ACTIONS.fsAddRowFor({ kind: d.kind, si: '' });
    },
    fsAddRowFor: function (d) {
      var travel = d.kind === 'travel', sep = d.si !== '' && d.si !== undefined;
      var o = fsObj('case');
      var blank = travel ? { dir: '往路', date: o.yoteibi || TODAY, start: '', end: '', km: '' } : { date: o.yoteibi || TODAY, start: '', end: '' };
      var list = sep ? (travel ? 'travel' : 'work') : (travel ? 'commonTravel' : 'commonWork');
      var idx;
      silentSet('case', function (c) {
        if (sep) { var si = +d.si; c.staff = c.staff.map(function (st, x) { if (x !== si) return st; idx = (st[list] || []).length; return Object.assign({}, st, wrapKey(list, (st[list] || []).concat([blank]))); }); }
        else { idx = (c[list] || []).length; c[list] = (c[list] || []).concat([blank]); }
        return c;
      });
      ACTIONS.fsOpen({ id: 'row:' + list + ':' + idx + (sep ? ':' + d.si : '') });
    },
    // 文章欄の音声入力（今の文章を下書きとして渡し、AIで整えて置き換える）
    fsVoice: function (d) { var ed = S.edit; if (!ed) return; var o = fsObj(ed.scope); S.edit = null; ACTIONS.openVoice({ target: d.target, scope: ed.scope, prefill: o[d.target] || '' }); },
    fsPlate: function () { var ed = S.edit; if (!ed) return; S.edit = null; ACTIONS.openPlate({ scope: ed.scope }); },

  };

  function wrapKey(k, v) { var o = {}; o[k] = v; return o; }
  function setSeparateFn(si, val) {
    mutate('case', function (o) {
      return Object.assign({}, o, { staff: o.staff.map(function (st, i) { if (i !== si) return st; var work = (st.work && st.work.length) ? st.work : [{ date: o.yoteibi || TODAY, start: '', end: '' }]; var travel = (st.travel && st.travel.length) ? st.travel : [{ dir: '往路', date: o.yoteibi || TODAY, start: '', end: '', km: '' }]; return Object.assign({}, st, { separate: val, work: work, travel: travel }); }) });
    });
  }
  /* ---------------- change dispatch ---------------- */
  var CHANGES = {
    settings: function (d, val) { setState(function (s) { return { settings: Object.assign({}, s.settings, wrapKey(d.name, val)), settingsSaved: false }; }); },
    histQuery: function (d, val) { setState({ histQuery: val }); loadHistory(); },
    pickDept: function (d, val) { setState({ pickDept: val }); },
    addStaffFromMaster: function (d, val) { ACTIONS.addStaffFromMaster({ scope: d.scope, val: val }); },
    voiceText: function (d, val) { setState({ vRaw: val }); },
    plateFile: function (d, val, el) { var f = el.files && el.files[0]; if (!f) return; var rd = new FileReader(); rd.onload = function () { setState({ plateImg: rd.result, plateResult: null }); }; rd.readAsDataURL(f); }
  };

  /* ---------------- event delegation ---------------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var name = el.getAttribute('data-act');
    var fn = ACTIONS[name]; if (!fn) return;
    var d = datasetOf(el);
    // stopProp handled by "stop" acting on inner containers
    if (name === 'stop') { e.stopPropagation(); return; }
    fn(d, e);
  });
  document.addEventListener('change', function (e) {
    var el = e.target.closest('[data-chg]'); if (!el) return;
    var name = el.getAttribute('data-chg');
    var fn = CHANGES[name]; if (!fn) return;
    fn(datasetOf(el), el.value, el);
  });
  // 帳票の枠（role=button の div）もキーボードの Enter / Space で開けるように。Esc で入力パネルを閉じる
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.edit) { ACTIONS.fsClose(); return; }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target; if (!el || !el.getAttribute || el.getAttribute('role') !== 'button' || !el.getAttribute('data-act')) return;
    e.preventDefault(); el.click();
  });
  // 文字数カウンタの live 更新（再描画なしでカウンタだけ書き換え、フォーカス維持）
  document.addEventListener('input', function (e) {
    var el = e.target; if (!el || !el.getAttribute) return;
    var cid = el.getAttribute('data-counter'); if (!cid) return;
    var c = document.getElementById(cid); if (!c) return;
    var max = +c.getAttribute('data-cmax') || 0;
    var v = el.value || '';
    if (volume(v) > max) { el.value = capVolume(v, max); v = el.value; } // 改行込みの実質量で超過を切り詰め
    var vol = volume(v);
    c.textContent = vol + ' / ' + max; c.style.color = vol >= max ? '#c0392b' : '';
  });
  // 入力パネル内の入力を即時反映（描き直さない）。日付欄は change でも拾う
  function onEdInput(e) { var el = e.target; if (el && el.getAttribute && el.getAttribute('data-ed')) fsInput(el, e.type); }
  document.addEventListener('input', onEdInput);
  document.addEventListener('change', onEdInput);
  function datasetOf(el) { var d = {}; for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; if (a.name.indexOf('data-') === 0 && a.name !== 'data-act' && a.name !== 'data-chg') d[a.name.slice(5)] = a.value; } return d; }

  /* ---------------- signature canvas ---------------- */
  function attachSig() {
    var c = document.getElementById('sigpad'); if (!c || c._wired) return; c._wired = true;
    var ctx = c.getContext('2d'); ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#13284a';
    var cs = findCase(S.activeId) || {};
    if (cs.signature) { var img = new Image(); img.onload = function () { ctx.drawImage(img, 0, 0, c.width, c.height); }; img.src = cs.signature; }
    var drawing = false, lastX = 0, lastY = 0;
    var pos = function (e) { var rect = c.getBoundingClientRect(); var sx = c.width / rect.width, sy = c.height / rect.height; var t = e.touches ? e.touches[0] : e; return { x: (t.clientX - rect.left) * sx, y: (t.clientY - rect.top) * sy }; };
    var down = function (e) { e.preventDefault(); drawing = true; var p = pos(e); lastX = p.x; lastY = p.y; ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fillStyle = '#13284a'; ctx.fill(); };
    var move = function (e) { if (!drawing) return; e.preventDefault(); var p = pos(e); ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(p.x, p.y); ctx.stroke(); lastX = p.x; lastY = p.y; };
    var up = function () { drawing = false; };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  /* ---------------- voice (MediaRecorder → Gemini 文字起こし) ---------------- */
  // VPSは公開HTTPS(Funnel)なので getUserMedia が使える。録音→サーバーでGemini文字起こし＆整形。
  var _mediaRec = null, _chunks = [], _stream = null;
  function stopStream() { if (_stream) { try { _stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} _stream = null; } }
  function stopRec() { if (_mediaRec && _mediaRec.state !== 'inactive') { try { _mediaRec.stop(); } catch (e) {} } _mediaRec = null; stopStream(); }
  function blobToDataUrl(blob) { return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(blob); }); }
  // 録音(webm/mp4等)を Gemini が確実に扱える WAV(16kHz mono) の dataURL に変換
  function encodeWav(buf) {
    var n = buf.length, ch = buf.numberOfChannels, rate = buf.sampleRate;
    var mono = new Float32Array(n);
    for (var c = 0; c < ch; c++) { var d = buf.getChannelData(c); for (var i = 0; i < n; i++) mono[i] += d[i] / ch; }
    var ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab);
    function ws(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, n * 2, true);
    var off = 44; for (var j = 0; j < n; j++) { var x = Math.max(-1, Math.min(1, mono[j])); v.setInt16(off, x < 0 ? x * 0x8000 : x * 0x7FFF, true); off += 2; }
    return ab;
  }
  function audioBlobToWav(blob) {
    var AC = window.AudioContext || window.webkitAudioContext;
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AC || !OAC) return blobToDataUrl(blob); // 非対応環境は元データ
    var ac = new AC();
    return blob.arrayBuffer().then(function (b) { return ac.decodeAudioData(b); }).then(function (decoded) {
      try { ac.close(); } catch (e) {}
      var rate = 16000, len = Math.max(1, Math.ceil(decoded.duration * rate));
      var oac = new OAC(1, len, rate);
      var src = oac.createBufferSource(); src.buffer = decoded; src.connect(oac.destination); src.start(0);
      return oac.startRendering();
    }).then(function (rendered) {
      return blobToDataUrl(new Blob([encodeWav(rendered)], { type: 'audio/wav' }));
    });
  }
  function toggleListen() {
    if (S.vListening) { // 停止 → 文字起こし
      try { if (_mediaRec && _mediaRec.state !== 'inactive') _mediaRec.stop(); } catch (e) {}
      setState({ vListening: false });
      return;
    }
    if (!BOOT.geminiEnabled) { setState({ vError: 'AI(Gemini)が未設定です。下の入力欄にキーボードの音声入力で入力し「AIで整える」をお試しください。' }); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      setState({ vError: 'この端末は録音に非対応です。下の入力欄にキーボードの音声入力で入力してください。' }); return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      _stream = stream; _chunks = [];
      var mime = (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm')) ? 'audio/webm' : '';
      _mediaRec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      _mediaRec.ondataavailable = function (e) { if (e.data && e.data.size) _chunks.push(e.data); };
      _mediaRec.onstop = function () {
        stopStream();
        var blob = new Blob(_chunks, { type: (_mediaRec && _mediaRec.mimeType) || 'audio/webm' });
        if (!blob.size) { setState({ vProcessing: false }); return; }
        setState({ vProcessing: true, vResult: '' });
        audioBlobToWav(blob).then(function (dataUrl) {
          return server('aiTranscribe', dataUrl, 'audio/wav', S.vStyle || 'auto');
        }).then(function (text) {
          setState({ vProcessing: false, vResult: text || '' });
        }).catch(function (e) {
          setState({ vProcessing: false, vError: '音声の文字起こしに失敗しました：' + errMsg(e) });
        });
      };
      setState({ vError: '', vListening: true });
      _mediaRec.start();
    }).catch(function (e) {
      var msg = (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) ? 'マイクの使用が許可されませんでした。ブラウザのマイク許可をオンにするか、下の入力欄にキーボードの音声入力で入力してください。' : 'マイクを開始できませんでした：' + errMsg(e);
      setState({ vError: msg, vListening: false });
    });
  }
  function mockSummarize(raw) {
    var t = (raw || '').replace(/[\s　]+/g, '').replace(/(えーと|あのー|あの|まあ|なんか|そのー|えっと)/g, '');
    if (!t) return '';
    var s = t.replace(/(した|ました|です|ます|認した|了した)(?=[^。])/g, '$1。');
    if (!/。$/.test(s)) s += '。';
    return s;
  }

  /* ---------------- print (client) ---------------- */
  function doPrint() {
    var el = document.getElementById('pdf-print'); if (!el) { window.print(); return; }
    var c = findCase(S.activeId) || {};
    var title = pdfName(c);
    var w = window.open('', '_blank', 'width=820,height=1160');
    if (!w) { window.print(); return; }
    var head = '<!DOCTYPE html><html><head><meta charset="utf-8"><base href="' + location.href + '"><title>' + esc(title) + '</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap" rel="stylesheet">' +
      '<style>@page{size:A4;margin:11mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}html,body{margin:0;padding:0;background:#fff}#fitwrap{width:600px;margin:0 auto;transform-origin:top center}#sheet{width:600px;font-family:\'Noto Sans JP\',sans-serif;color:#111}</style></head><body>';
    w.document.write(head + '<div id="fitwrap"><div id="sheet">' + el.innerHTML + '</div></div></body></html>');
    w.document.close();
    // A4 1枚に必ず収める。はみ出す分だけ縮小し、拡大はしない（通常案件の見た目は従来どおり）。
    var fitOnePage = function () {
      try {
        var wrap = w.document.getElementById('fitwrap');
        var sh = w.document.getElementById('sheet');
        if (!wrap || !sh) return;
        var availH = (297 - 11 * 2) * (96 / 25.4); // A4高さ − 上下余白(@page margin) → CSS px
        var h = sh.getBoundingClientRect().height;
        if (!h || h <= availH) return;
        var s = availH / h;
        wrap.style.transform = 'scale(' + s + ')';
        wrap.style.height = (h * s) + 'px'; // 変換後の実寸に合わせ、空の2ページ目が出るのを防ぐ
        wrap.style.overflow = 'hidden';
      } catch (e) {}
    };
    var go = function () { fitOnePage(); try { w.focus(); w.print(); } catch (e) {} };
    if (w.document.fonts && w.document.fonts.ready) { w.document.fonts.ready.then(function () { setTimeout(go, 250); }); } else { setTimeout(go, 700); }
  }

  /* ---------------- PDF backup (client capture → Drive) ---------------- */
  // プレビュー(#pdf-print)を忠実にキャプチャし、A4 PDF にしてサーバーへ保存。
  // 生成タイミングはクローズ時の1回のみ（押印は取消可のため、最終確定のクローズで保管）。
  function savePdfBackup() {
    return new Promise(function (resolve) {
      var el = document.getElementById('pdf-print');
      if (!el || !window.html2canvas || !window.jspdf) { resolve(false); return; }
      setBusy(true);
      window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false }).then(function (canvas) {
        var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
        var pw = 210, ph = 297, margin = 8;
        var iw = pw - margin * 2;
        var pxPerMm = canvas.width / iw;
        var pageHpx = Math.floor((ph - margin * 2) * pxPerMm);
        var y = 0, page = 0;
        while (y < canvas.height) {
          var sliceH = Math.min(pageHpx, canvas.height - y);
          var c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = sliceH;
          var ctx = c2.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c2.width, c2.height);
          ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
          if (page > 0) pdf.addPage();
          pdf.addImage(c2.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, iw, sliceH / pxPerMm);
          y += sliceH; page++;
        }
        var b64 = pdf.output('datauristring').split(',')[1];
        server('saveReportPdf', S.activeId, b64).then(function () { resolve(true); }).catch(function (e) { toast(errMsg(e), true); resolve(false); });
      }).catch(function (e) { toast('PDF生成に失敗しました：' + errMsg(e), true); resolve(false); });
    });
  }

  // 銘板画像を長辺 maxDim に縮小して JPEG dataURL に（Gemini送信の軽量化）
  function downscaleDataUrl(dataUrl, maxDim) {
    return new Promise(function (resolve) {
      try {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height;
          var scale = Math.min(1, maxDim / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
          var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
          cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
          resolve(cv.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = function () { resolve(dataUrl); };
        img.src = dataUrl;
      } catch (e) { resolve(dataUrl); }
    });
  }

  /* ---------------- boot ---------------- */
  function onResize() { var m = computeMode(); if (m !== S.mode) setState({ mode: m }); else fitPaper(); }
  window.addEventListener('resize', onResize);
  S.mode = computeMode();
  render();
})();
