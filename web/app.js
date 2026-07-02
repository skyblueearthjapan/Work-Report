/* =========================================================================
 * デジタル作業報告書アプリ — フロント（HtmlService / vanilla JS）
 * 参照実装 作業報告書アプリ.dc.html を移植。
 * S2: 全9画面＋モーダルのUI/操作（メモリ内state）。永続化/AI/PDF/メールは後続S。
 * ======================================================================= */
(function () {
  'use strict';

  var BOOT = window.BOOT || {};
  var COMPANY = BOOT.company || { companyLW: 'LINE W', companyTS: 'テクノサービス' };
  var TODAY = BOOT.today || '2026-06-30';
  var WT = ['据付', '移設', '納品', '点検', '改造', '修理', '調査'];
  var MASTER = BOOT.master || { kobans: [], staff: [], depts: [], importedAt: '' };

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
  function pickerDepts() {
    var all = allDepts(); var travel = getTravelDepts(); var tset = {}; travel.forEach(function (d) { tset[d] = 1; });
    var head = travel.filter(function (d) { return all.indexOf(d) >= 0; });
    var rest = all.filter(function (d) { return !tset[d]; });
    return head.concat(rest);
  }

  /* ---------------- state ---------------- */
  var S = {
    screen: 'home', history: [], filter: 'all', activeId: null,
    draftType: 'LW', sent: false, settingsSaved: false, nfError: false, menuId: null, editId: null,
    voiceOpen: false, vListening: false, vRaw: '', vInterim: '', vProcessing: false, vResult: '', vError: '',
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
    aiFormatShori: function (text) { return _http('POST', '/api/ai/format', { text: text }).then(function (r) { return r.text; }); },
    aiReadPlate: function (image) { return _http('POST', '/api/ai/plate', { image: image }); },
    aiTranscribe: function (audio, mime) { return _http('POST', '/api/ai/transcribe', { audio: audio, mime: mime }).then(function (r) { return r.text; }); },
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
    setState({ toastMsg: msg, toastErr: !!isErr });
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { setState({ toastMsg: '' }); }, isErr ? 5000 : 2200);
  }
  function setBusy(v) { setState({ busy: v }); }
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
      seiban: '', nenGappi: '', yoteibi: '', shijiNaiyou: '', workTypes: {}, paid: '有償',
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
  function fmtH(m) { if (m == null || m <= 0) return ''; var h = Math.floor(m / 60), mm = m % 60; return h + (mm ? ('.' + Math.round(mm / 6)) : '') + 'H'; }
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
  var inpSm = "height:48px;border:1.5px solid var(--border);border-radius:12px;padding:0 13px;font:600 14.5px 'Noto Sans JP',sans-serif;color:var(--text);background:var(--surface)";
  var taSm = "width:100%;height:84px;border:1.5px solid var(--border);border-radius:12px;padding:11px 14px;font:500 14.5px/1.6 'Noto Sans JP',sans-serif;color:var(--text);resize:none;background:var(--surface)";
  var taMd = "width:100%;height:130px;border:1.5px solid var(--border);border-radius:12px;padding:11px 14px;font:500 14.5px/1.7 'Noto Sans JP',sans-serif;color:var(--text);resize:none;background:var(--surface)";
  var secTitle = "font:700 14px 'Noto Sans JP',sans-serif;color:var(--text);margin-bottom:12px";
  var secLabel = "font:800 14px 'Noto Sans JP',sans-serif;color:var(--primary);margin:4px 2px 10px;letter-spacing:.02em";
  var cardStyle = "background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:18px;display:flex;flex-direction:column;gap:14px";
  var miniLab = "font:700 12px 'Noto Sans JP',sans-serif;color:var(--muted);margin-bottom:7px";
  var rowDate = "width:118px;height:46px;border:1.5px solid var(--border);border-radius:10px;padding:0 6px;font:600 12.5px 'Noto Sans JP',sans-serif;color:var(--text)";
  var rowTime = "width:84px;height:46px;border:1.5px solid var(--border);border-radius:10px;padding:0 6px;font:600 12.5px 'Noto Sans JP',sans-serif;color:var(--text)";
  var rowDel = "width:34px;height:34px;flex:none;border:none;background:#f0f1f4;color:#9aa1ac;border-radius:9px;font-size:17px;cursor:pointer";
  var addBtn = "margin-top:10px;width:100%;height:44px;border:1.5px dashed var(--primary-tint);background:var(--primary-soft);color:var(--primary);border-radius:11px;font:700 13px 'Noto Sans JP',sans-serif;cursor:pointer";
  var addBtnSm = "margin-top:8px;align-self:flex-start;height:38px;padding:0 16px;border:1.5px dashed var(--primary-tint);background:var(--primary-soft);color:var(--primary);border-radius:10px;font:700 12.5px 'Noto Sans JP',sans-serif;cursor:pointer";
  var confirmRow = "display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:none;border:none;border-bottom:1px solid var(--border);padding:13px 2px;cursor:pointer";
  var staffNumStyle = "width:30px;height:30px;flex:none;border-radius:50%;background:var(--primary);color:#fff;font:800 13px 'Noto Sans JP',sans-serif;display:flex;align-items:center;justify-content:center";
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
    return '<div style="margin-top:6px;padding-top:12px;border-top:1px dashed var(--border)">' +
      '<div style="' + miniLab + '">名簿から追加（部署で絞り込み）</div>' +
      '<div style="display:flex;gap:8px"><select' + chg('pickDept') + ' style="' + selStyle + ';flex:1">' + deptOpts + '</select>' +
      '<select' + chg('addStaffFromMaster', { scope: scope }) + ' style="' + selStyle + ';flex:1">' + staffOpts + '</select></div></div>';
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
    if (mode === 'tablet') {
      rootStyle = varStr + ';min-height:100%;display:flex;align-items:flex-start;justify-content:center;padding:28px;background:#e6e8ee;font-family:' + FONT;
      bezelStyle = "background:#0e1218;padding:16px;border-radius:48px;box-shadow:0 36px 80px rgba(15,23,42,.34),inset 0 0 0 2px #20262f";
      frameStyle = "width:800px;height:1160px;background:var(--bg);border-radius:32px;overflow:hidden;display:flex;flex-direction:column;position:relative";
    } else if (mode === 'mobile') {
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

    var header =
      '<div style="height:70px;flex:none;display:flex;align-items:center;gap:14px;padding:0 20px;background:var(--primary);color:#fff">' +
      (showBack ? '<button' + act('goBack') + ' style="width:44px;height:44px;border:none;background:rgba(255,255,255,.16);color:#fff;border-radius:12px;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none">←</button>' : '') +
      '<div style="flex:1;min-width:0"><div style="font:700 19px/1.2 \'Noto Sans JP\',sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(tm[0]) + '</div>' +
      '<div style="font:500 12px/1.3 \'Noto Sans JP\',sans-serif;opacity:.72">' + esc(tm[1]) + '</div></div>' +
      '<button' + act('goSettings') + ' style="height:40px;padding:0 14px;border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;border-radius:10px;font:600 13px \'Noto Sans JP\',sans-serif;cursor:pointer;flex:none">設定</button>' +
      '</div>';

    var body = screenBody(isPC);
    var modals = renderModals();

    var frame = '<div style="' + bezelStyle + '"><div style="' + frameStyle + '">' + header +
      '<div class="scr" style="flex:1;overflow-y:auto;position:relative">' + body + '</div>' +
      modals + '</div></div>';

    var overlays = '';
    if (S.busy) overlays += '<div style="position:fixed;top:0;left:0;right:0;z-index:200;display:flex;justify-content:center;pointer-events:none"><div style="margin-top:12px;background:rgba(15,23,42,.86);color:#fff;padding:8px 16px;border-radius:20px;font:700 12.5px \'Noto Sans JP\',sans-serif;display:flex;align-items:center;gap:8px"><span style="width:14px;height:14px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;display:inline-block;animation:spin .8s linear infinite"></span>処理中…</div></div>';
    if (S.toastMsg) overlays += '<div style="position:fixed;bottom:24px;left:0;right:0;z-index:200;display:flex;justify-content:center;pointer-events:none"><div style="background:' + (S.toastErr ? '#b03a2e' : 'rgba(15,23,42,.9)') + ';color:#fff;padding:11px 20px;border-radius:12px;font:700 13px \'Noto Sans JP\',sans-serif;max-width:80%;box-shadow:0 8px 24px rgba(0,0,0,.24)">' + esc(S.toastMsg) + '</div></div>';

    root.setAttribute('style', rootStyle);
    root.innerHTML = frame + overlays;

    var scr2 = root.querySelector('.scr'); if (scr2) scr2.scrollTop = prevScroll;
    if (S.screen === 'sign') attachSig();
  }

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

  /* ---------------- shared small builders ---------------- */
  function wtButtons(scope, o) {
    return WT.map(function (label) { var on = !!o.workTypes[label]; return '<button' + act('toggleWorkType', { scope: scope, key: label }) + ' style="height:42px;padding:0 16px;border-radius:11px;cursor:pointer;font:700 14px \'Noto Sans JP\',sans-serif;border:1.5px solid ' + (on ? 'var(--primary)' : 'var(--border)') + ';background:' + (on ? 'var(--primary)' : 'var(--surface)') + ';color:' + (on ? '#fff' : 'var(--text)') + '">' + label + '</button>'; }).join('');
  }
  function paidButtons(scope, cur) {
    return ['有償', '無償', '調整中'].map(function (label) { var on = cur === label; return '<button' + act('setPaid', { scope: scope, val: label }) + ' style="height:46px;padding:0 20px;border-radius:11px;cursor:pointer;font:700 15px \'Noto Sans JP\',sans-serif;border:1.5px solid ' + (on ? 'var(--primary)' : 'var(--border)') + ';background:' + (on ? 'var(--primary)' : 'var(--surface)') + ';color:' + (on ? '#fff' : 'var(--text)') + '">' + label + '</button>'; }).join('');
  }
  function markStyleOf(v) { var b = "width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font:700 16px 'Noto Sans JP',sans-serif;flex:none;"; if (v === '✓') return b + 'background:var(--primary);color:#fff'; if (v === '−') return b + 'background:#eef0f3;color:#6b7480'; return b + 'background:#fff;border:1.5px dashed #c9ced8;color:#c9ced8'; }
  function confirmButtons(scope, o) {
    return (o.confirmItems || []).map(function (it) { return '<button' + act('cycleConfirm', { scope: scope, key: it.key }) + ' style="' + confirmRow + '"><span style="' + markStyleOf(it.value) + '">' + (it.value || '＋') + '</span><span style="font:600 14px \'Noto Sans JP\',sans-serif;color:var(--text)">' + esc(it.label) + '</span></button>'; }).join('');
  }
  function staffRows(scope, o) {
    return (o.staff || []).map(function (st, si) {
      var canRemove = (o.staff || []).length > 1;
      return '<div style="display:flex;align-items:center;gap:10px"><span style="' + staffNumStyle + '">' + (si + 1) + '</span>' +
        '<input class="req"' + chg('staffName', { scope: scope, si: si }) + ' value="' + esc(st.name) + '" placeholder="スタッフ名" style="' + inpSm + ';flex:1;min-width:0">' +
        (canRemove ? '<button' + act('removeStaff', { scope: scope, si: si }) + ' style="' + rowDel + '">×</button>' : '') + '</div>';
    }).join('');
  }

  /* ---------------- NEW / EDIT FORM ---------------- */
  function viewNewForm() {
    var nf = S.newForm; var draftIsLW = S.draftType === 'LW'; var isEditing = !!S.editId;
    var draftBadge = draftIsLW ? "font:800 12px 'Noto Sans JP',sans-serif;color:#fff;background:var(--primary);padding:5px 12px;border-radius:8px" : "font:800 12px 'Noto Sans JP',sans-serif;color:var(--primary);background:#fff;border:1.5px solid var(--primary);padding:4px 12px;border-radius:8px";
    var f = function (name) { return esc(nf[name]); };
    var input = function (name, ph, type, req) { return '<input class="req"' + chg('nf', { name: name }) + ' value="' + f(name) + '"' + (type ? ' type="' + type + '"' : '') + (ph ? ' placeholder="' + esc(ph) + '"' : '') + ' style="' + inpStyle + '">'; };
    // 工番マスタの候補（datalist）。選択で 納品先/住所/装置名 を自動補完
    var kobanDatalist = '<datalist id="kobanList">' + (MASTER.kobans || []).map(function (k) {
      return '<option value="' + esc(k.koban) + '">' + esc([k.nohinSaki, k.kishu].filter(Boolean).join(' / ')) + '</option>';
    }).join('') + '</datalist>';

    var statusBlock = isEditing ? ('<div style="' + secLabel + '">ステータス</div><div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:18px;display:flex;gap:9px">' +
      ['未着手', '作業中', '完了'].map(function (st) { var on = nf.status === st; return '<button' + act('setNewStatus', { val: st }) + ' style="flex:1;height:46px;border-radius:11px;cursor:pointer;font:700 14px \'Noto Sans JP\',sans-serif;border:1.5px solid ' + (on ? 'var(--primary)' : 'var(--border)') + ';background:' + (on ? 'var(--primary)' : 'var(--surface)') + ';color:' + (on ? '#fff' : 'var(--text)') + '">' + st + '</button>'; }).join('') + '</div>') : '';

    var body = '<div style="padding:18px 22px 28px;animation:scin .28s ease both">' +
      '<div style="display:flex;align-items:center;gap:12px;background:var(--primary-soft);border:1px solid var(--primary-tint);border-radius:14px;padding:14px 16px;margin-bottom:18px">' +
      '<span style="' + draftBadge + '">' + (draftIsLW ? 'LW工番' : 'TS工番') + '</span>' +
      '<div style="font:600 13px \'Noto Sans JP\',sans-serif;color:var(--text);flex:1">' + esc(draftIsLW ? COMPANY.companyLW : COMPANY.companyTS) + ' の案件として登録します</div>' +
      (!isEditing ? '<button' + act('goNewType') + ' style="background:none;border:none;color:var(--primary);font:700 12.5px \'Noto Sans JP\',sans-serif;cursor:pointer;text-decoration:underline">変更</button>' : '') + '</div>' +
      statusBlock +
      // スタッフ
      '<div style="' + secLabel + '">作業スタッフ（名前を登録）</div><div style="' + cardStyle + '">' +
      '<div style="font:500 12px/1.6 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:4px">現場に行くスタッフを登録します。作業時間・移動時間は現場で各自が入力します。</div>' +
      '<div style="display:flex;flex-direction:column;gap:10px">' + staffRows('new', nf) + '</div>' +
      '<button' + act('addNewStaff') + ' style="' + addBtn + '">＋ スタッフを追加</button>' + staffPicker('new') + '</div>' +
      // 予定
      '<div style="' + secLabel + '">作業予定・指示メモ</div><div style="' + cardStyle + '">' +
      '<div><label style="' + labStyle + '">作業予定日</label>' + input('yoteibi', '', 'date') + '</div>' +
      '<div><label style="' + labStyle + '">指示書メモ（任意）</label><textarea' + chg('nf', { name: 'shijiNaiyou' }) + ' placeholder="作業者への補足メモ" style="' + taSm + '">' + f('shijiNaiyou') + '</textarea></div></div>' +
      // 工番
      '<div style="' + secLabel + '">工番情報</div><div style="' + cardStyle + '">' +
      kobanDatalist +
      '<div style="display:flex;gap:12px"><div style="flex:1"><label style="' + labStyle + '">工番　№ <span style="color:#c0392b">必須</span></label>' +
      '<input class="req" list="kobanList"' + chg('nf', { name: 'koban' }) + ' value="' + f('koban') + '" placeholder="' + esc(draftIsLW ? '例：LW25083（入力で候補・自動補完）' : '例：TS26052') + '" style="' + inpStyle + '">' +
      '<div style="font:500 11.5px/1.6 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-top:5px">工番を選ぶと 納品先・住所・装置名 を自動補完します。</div></div>' +
      '<div style="flex:1"><label style="' + labStyle + '">元工番</label>' + input('motoKoban', '例：LW24310') + '</div></div>' +
      '<div><label style="' + labStyle + '">工番名（作業内容の概要）</label>' + input('kobanName', '例：3m切断走行 据付') + '</div></div>' +
      // お客様
      '<div style="' + secLabel + '">お客様情報</div><div style="' + cardStyle + '">' +
      '<div><label style="' + labStyle + '">お客様名 / 納品先 <span style="color:#c0392b">必須</span></label>' + input('nohinSaki', '例：株式会社 赤木鉄工所') + '</div>' +
      '<div><label style="' + labStyle + '">お客様名 2行目（製造所・ご担当者など）</label>' + input('okyakuSub', '例：稲毛事業所 関') + '</div>' +
      '<div><label style="' + labStyle + '">住所</label>' + input('basho', '例：宮崎県東諸県郡国富町…') + '</div>' +
      '<div style="display:flex;gap:12px"><div style="flex:1"><label style="' + labStyle + '">ご担当者</label>' + input('tantou', '例：赤木') + '</div>' +
      '<div style="flex:1"><label style="' + labStyle + '">電話番号（TEL）</label>' + input('tel', '例：0985-00-0000') + '</div></div></div>' +
      // 機械
      '<div style="' + secLabel + '">機械・銘板情報</div><div style="' + cardStyle + '">' +
      '<div><label style="' + labStyle + '">機種</label>' + input('kishu', '例：LN-3000') + '</div>' +
      '<div style="display:flex;gap:12px"><div style="flex:1"><label style="' + labStyle + '">型式</label>' + input('katashiki', '') + '</div>' +
      '<div style="flex:1"><label style="' + labStyle + '">製番</label>' + input('seiban', '') + '</div></div>' +
      '<div style="display:flex;gap:12px"><div style="flex:1"><label style="' + labStyle + '">銘板 年月日</label>' + input('nenGappi', '', 'month') + '</div>' +
      (draftIsLW ? '<div style="flex:1"><label style="' + labStyle + '">納品番号</label>' + input('nohinNo', '例：D-1180') + '</div>' : '') + '</div></div>' +
      // 作業内容(事前)
      '<div style="' + secLabel + '">作業内容（事前登録）</div><div style="' + cardStyle + '">' +
      '<div><div style="' + miniLab + '">作業種別（該当を選択・複数可）</div><div style="display:flex;flex-wrap:wrap;gap:9px">' + wtButtons('new', nf) + '</div></div>' +
      '<div style="display:flex;gap:18px;flex-wrap:wrap"><div><div style="' + miniLab + '">区分</div><div style="display:flex;gap:8px">' + paidButtons('new', nf.paid) + '</div></div></div>' +
      '<div><label style="' + labStyle + '">（原因）</label><textarea' + chg('nf', { name: 'genin' }) + ' placeholder="不具合の原因・現状（事前にわかる範囲で）" style="' + taSm + '">' + f('genin') + '</textarea></div>' +
      '<div><label style="' + labStyle + '">（処理）</label><textarea' + chg('nf', { name: 'shori' }) + ' placeholder="予定している処理・作業指示" style="' + taMd + '">' + f('shori') + '</textarea></div>' +
      '<div><div style="' + miniLab + '">作業終了時の確認事項</div><div style="display:flex;flex-direction:column">' + confirmButtons('new', nf) + '</div></div></div>' +
      (S.nfError ? '<div style="margin-top:14px;background:#fdecea;border:1px solid #f5c6c0;color:#b03a2e;border-radius:12px;padding:12px 16px;font:600 13px \'Noto Sans JP\',sans-serif">工番№・お客様名は必須項目です。</div>' : '') +
      '</div>';

    var footer = '<div style="position:sticky;bottom:0;padding:16px 22px;background:linear-gradient(transparent,var(--bg) 55%);display:flex;gap:12px;z-index:5">' +
      '<button' + act('goBack') + ' style="flex:none;width:120px;height:56px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:14px;font:700 16px \'Noto Sans JP\',sans-serif;cursor:pointer">キャンセル</button>' +
      '<button' + act('saveCase') + ' style="flex:1;height:56px;border:none;background:var(--primary);color:#fff;border-radius:14px;font:700 16px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">' + (isEditing ? '変更を保存' : 'ストックに保存') + '</button></div>';

    return body + footer;
  }

  /* ---------------- REPORT ---------------- */
  function viewReport() {
    var r = findCase(S.activeId) || blankForm('LW');
    var badge = r.type === 'LW' ? "font:800 11.5px 'Noto Sans JP',sans-serif;color:#fff;background:var(--primary);padding:4px 11px;border-radius:8px" : "font:800 11.5px 'Noto Sans JP',sans-serif;color:var(--primary);background:#fff;border:1.5px solid var(--primary);padding:3px 11px;border-radius:8px";
    var rv = function (name) { return esc(r[name]); };
    var rinput = function (name, ph, style) { return '<input class="req"' + chg('report', { name: name }) + ' value="' + rv(name) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + ' style="' + (style || inpSm) + '">'; };

    var orderedStaff = r.staff || [];
    var multiStaff = orderedStaff.length > 1;
    var commonNames = orderedStaff.filter(function (st) { return !st.separate; }).map(function (st, i) { return st.name || ('作業者' + (orderedStaff.indexOf(st) + 1)); }).join('・') || '（該当なし）';

    // header info
    var info = '<div style="background:var(--primary-soft);border:1px solid var(--primary-tint);border-radius:14px;padding:13px 16px;margin-bottom:16px">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span style="' + badge + '">' + r.type + '工番</span><span style="font:800 15px \'Noto Sans JP\',sans-serif;color:var(--text)">' + esc(r.koban) + '</span><span style="font:600 13px \'Noto Sans JP\',sans-serif;color:var(--muted);margin-left:auto">' + esc(r.nohinSaki) + ' 様</span></div>' +
      '<div style="display:flex;flex-wrap:wrap;column-gap:16px;row-gap:3px;font:500 12px \'Noto Sans JP\',sans-serif;color:var(--muted)"><span>元工番 ： ' + esc(r.motoKoban || '—') + '</span><span>機種 ： ' + esc(r.kishu || '—') + '</span><span>製番 ： ' + esc(r.seiban || '—') + '</span></div>' +
      (r.shijiNaiyou ? '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--primary-tint);font:500 12.5px/1.6 \'Noto Sans JP\',sans-serif;color:var(--text)"><b style="color:var(--primary)">指示メモ：</b>' + esc(r.shijiNaiyou) + '</div>' : '') + '</div>';

    var workType = '<div style="' + cardStyle + '"><div style="' + secTitle + '">作業種別 <span style="font-weight:500;color:var(--muted);font-size:12px">（該当を選択・複数可）</span></div><div style="display:flex;flex-wrap:wrap;gap:9px">' + wtButtons('case', r) + '</div></div>';

    var basic = '<div style="' + cardStyle + '"><div style="' + secTitle + '">基本情報</div>' +
      '<label style="' + labStyle + '">お客様名</label>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' + rinput('nohinSaki', '', 'flex:1;height:48px;border:1.5px solid var(--border);border-radius:12px;padding:0 14px;font:600 15px \'Noto Sans JP\',sans-serif;color:var(--text)') + '<span style="font:700 15px \'Noto Sans JP\',sans-serif;color:var(--text)">様</span></div>' +
      rinput('okyakuSub', '2行目：製造所・ご担当者など', 'width:100%;height:46px;border:1.5px solid var(--border);border-radius:12px;padding:0 14px;font:600 14px \'Noto Sans JP\',sans-serif;color:var(--text);margin-bottom:14px') +
      '<div style="display:flex;gap:18px;flex-wrap:wrap"><div><div style="' + miniLab + '">区分</div><div style="display:flex;gap:8px">' + paidButtons('case', r.paid) + '</div></div></div></div>';

    var staff = '<div style="' + secLabel + '">作業スタッフ</div><div style="' + cardStyle + '">' +
      '<div style="font:500 12px/1.6 \'Noto Sans JP\',sans-serif;color:var(--muted)">現場に行くスタッフを登録します。作業時間・移動時間は下の「作業時間・移動時間」欄で入力します。</div>' +
      '<div style="display:flex;flex-direction:column;gap:10px">' + staffRows('case', r) + '</div>' +
      '<button' + act('addStaffCase') + ' style="' + addBtn + '">＋ スタッフを追加</button>' + staffPicker('case') + '</div>';

    var content = '<div style="' + cardStyle + '"><div style="' + secTitle + '">作業内容</div>' +
      '<label style="' + miniLab + '">（原因）</label><textarea' + chg('report', { name: 'genin' }) + ' placeholder="不具合の原因・現状" style="' + taSm + ';margin-bottom:12px">' + rv('genin') + '</textarea>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px"><label style="' + miniLab + ';margin-bottom:0">（処理）</label><button' + act('openVoice') + ' style="display:flex;align-items:center;gap:6px;height:34px;padding:0 13px;border:1.5px solid var(--primary);background:var(--primary-soft);color:var(--primary);border-radius:9px;font:700 12.5px \'Noto Sans JP\',sans-serif;cursor:pointer">🎤 音声で入力</button></div>' +
      '<textarea' + chg('report', { name: 'shori' }) + ' placeholder="実施した処理・作業の結果（音声入力も可）" style="' + taMd + '">' + rv('shori') + '</textarea></div>';

    var plate = '<div style="' + cardStyle + '"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><div style="' + secTitle + ';margin-bottom:0">銘板情報</div><button' + act('openPlate') + ' style="display:flex;align-items:center;gap:6px;height:34px;padding:0 13px;border:1.5px solid var(--primary);background:var(--primary-soft);color:var(--primary);border-radius:9px;font:700 12.5px \'Noto Sans JP\',sans-serif;cursor:pointer">📷 銘板を撮影</button></div>' +
      '<div style="font:500 11.5px/1.6 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:10px">設備の銘板を撮影すると、AIが各項目を自動で読み取ります。</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      ['機種:kishu', '型式:katashiki', '製番:seiban', '製造年月:nenGappi'].map(function (pair) { var kv = pair.split(':'); return '<div><div style="' + miniLab + '">' + kv[0] + '</div><div style="font:700 14px \'Noto Sans JP\',sans-serif;color:var(--text)">' + esc(r[kv[1]] || '—') + '</div></div>'; }).join('') + '</div></div>';

    var confirm = '<div style="' + cardStyle + '"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px"><div style="font:700 14px \'Noto Sans JP\',sans-serif;color:var(--text)">作業終了時の確認事項</div><div style="font:500 11.5px \'Noto Sans JP\',sans-serif;color:var(--muted)">完了「✓」 該当なし「−」</div></div>' +
      '<div style="font:500 11.5px \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:8px">作業の最後に上記の確認を行ってください。</div>' +
      '<div style="display:flex;flex-direction:column">' + confirmButtons('case', r) + '</div></div>';

    var times = viewTimes(r, orderedStaff, multiStaff, commonNames);
    var approve = viewApprove(r);
    var kanin = viewKanin(r);

    var body = '<div style="padding:16px 20px 28px;animation:scin .28s ease both">' + info + workType + basic + staff + content + plate + confirm + times + approve + kanin + '</div>';
    var footer = '<div style="position:sticky;bottom:0;padding:16px 22px;background:linear-gradient(transparent,var(--bg) 55%);display:flex;gap:12px;z-index:5">' +
      '<button' + act('goHome') + ' style="flex:none;width:90px;height:56px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:14px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer">一時保存</button>' +
      '<button' + act('goPreview') + ' style="flex:1;height:56px;border:none;background:var(--primary);color:#fff;border-radius:14px;font:700 16px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">PDFで内容を確認 →</button></div>';
    return body + footer;
  }

  function timeWorkRow(scope, listKey, e, i, canRemove, si) {
    var p = { scope: scope, list: listKey, i: i }; if (si !== undefined) { p.si = si; }
    var chgP = function (field) { var q = {}; for (var k in p) q[k] = p[k]; q.field = field; return q; };
    return '<div style="display:flex;align-items:center;gap:7px">' +
      '<input class="req"' + chg('timeRow', chgP('date')) + ' value="' + esc(e.date || '') + '" type="date" style="' + rowDate + '">' +
      '<input class="req"' + chg('timeRow', chgP('start')) + ' value="' + esc(e.start || '') + '" type="time" style="' + rowTime + '">' +
      '<span style="font:700 13px \'Noto Sans JP\',sans-serif;color:var(--muted)">〜</span>' +
      '<input class="req"' + chg('timeRow', chgP('end')) + ' value="' + esc(e.end || '') + '" type="time" style="' + rowTime + '">' +
      '<span style="font:600 11.5px \'Noto Sans JP\',sans-serif;color:var(--muted);width:42px;text-align:right">' + fmtH(diffM(e.start, e.end)) + '</span>' +
      (canRemove ? '<button' + act('removeTimeRow', p) + ' style="' + rowDel + '">×</button>' : '') + '</div>';
  }
  function timeTravelRow(scope, listKey, e, i, canRemove, si) {
    var p = { scope: scope, list: listKey, i: i }; if (si !== undefined) { p.si = si; }
    var chgP = function (field) { var q = {}; for (var k in p) q[k] = p[k]; q.field = field; return q; };
    var dirBtns = ['往路', '現地', '復路'].map(function (d) { var on = (e.dir || '往路') === d; var pp = {}; for (var k in p) pp[k] = p[k]; pp.dir = d; return '<button' + act('setDir', pp) + ' style="height:34px;padding:0 13px;border-radius:9px;cursor:pointer;font:700 12px \'Noto Sans JP\',sans-serif;border:1.5px solid ' + (on ? 'var(--primary)' : 'var(--border)') + ';background:' + (on ? 'var(--primary)' : 'var(--surface)') + ';color:' + (on ? '#fff' : 'var(--muted)') + '">' + d + '</button>'; }).join('');
    return '<div style="display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--border);border-radius:11px;background:var(--bg)">' +
      '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">' + dirBtns + '<input class="req"' + chg('timeRow', chgP('date')) + ' value="' + esc(e.date || '') + '" type="date" style="' + rowDate + ';flex:1;min-width:118px"></div>' +
      '<div style="display:flex;align-items:center;gap:7px">' +
      '<input class="req"' + chg('timeRow', chgP('start')) + ' value="' + esc(e.start || '') + '" type="time" style="' + rowTime + '">' +
      '<span style="font:700 13px \'Noto Sans JP\',sans-serif;color:var(--muted)">〜</span>' +
      '<input class="req"' + chg('timeRow', chgP('end')) + ' value="' + esc(e.end || '') + '" type="time" style="' + rowTime + '">' +
      '<div style="display:flex;align-items:center;border:1.5px solid var(--border);border-radius:10px;height:46px;padding:0 10px;flex:1"><input class="req"' + chg('timeRow', chgP('km')) + ' value="' + esc(e.km || '') + '" inputmode="decimal" placeholder="0" style="width:100%;border:none;font:600 14px \'Noto Sans JP\',sans-serif;color:var(--text);text-align:right"><span style="font:600 13px \'Noto Sans JP\',sans-serif;color:var(--muted);margin-left:6px">Km</span></div>' +
      (canRemove ? '<button' + act('removeTimeRow', p) + ' style="' + rowDel + '">×</button>' : '') + '</div></div>';
  }
  function sumWork(arr) { var t = 0; (arr || []).forEach(function (row) { var m = diffM(row.start, row.end); if (m) t += m; }); return t; }

  function viewTimes(r, orderedStaff, multiStaff, commonNames) {
    var modeCard = '';
    if (multiStaff) {
      var segStyle = function (on) { return 'height:38px;padding:0 15px;border-radius:9px;cursor:pointer;font:700 12.5px \'Noto Sans JP\',sans-serif;border:1.5px solid ' + (on ? 'var(--primary)' : 'var(--border)') + ';background:' + (on ? 'var(--primary)' : 'var(--surface)') + ';color:' + (on ? '#fff' : 'var(--muted)') + ''; };
      modeCard = '<div style="' + cardStyle + '"><div style="' + miniLab + '">行動区分 <span style="font-weight:500">（スタッフごとに「メイン」か「別行動」を選択）</span></div><div style="display:flex;flex-direction:column;gap:9px">' +
        orderedStaff.map(function (st, si) {
          return '<div style="display:flex;align-items:center;gap:10px"><span style="flex:1;font:700 13.5px \'Noto Sans JP\',sans-serif;color:var(--text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(st.name || ('作業者' + (si + 1))) + '</span>' +
            '<div style="display:flex;gap:6px;flex:none"><button' + act('setSeparate', { si: si, val: 'false' }) + ' style="' + segStyle(!st.separate) + '">メイン</button><button' + act('setSeparate', { si: si, val: 'true' }) + ' style="' + segStyle(!!st.separate) + '">別行動</button></div></div>';
        }).join('') + '</div></div>';
    }

    var cw = (r.commonWork || []).map(function (e, i) { return timeWorkRow('case', 'commonWork', e, i, (r.commonWork || []).length > 1); }).join('');
    var ct = (r.commonTravel || []).map(function (e, i) { return timeTravelRow('case', 'commonTravel', e, i, (r.commonTravel || []).length > 1); }).join('');
    var mainCard = '<div style="' + cardStyle + '"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font:800 13px \'Noto Sans JP\',sans-serif;color:#fff;background:var(--primary);padding:3px 11px;border-radius:8px">メイン</span><span style="font:600 12.5px \'Noto Sans JP\',sans-serif;color:var(--muted)">' + esc(commonNames) + '</span></div>' +
      '<div style="' + miniLab + '">作業時間 <span style="font-weight:500">（複数日は行を追加）</span></div><div style="display:flex;flex-direction:column;gap:9px">' + cw + '</div>' +
      '<button' + act('addCommon', { list: 'commonWork' }) + ' style="' + addBtnSm + '">＋ 作業時間</button>' +
      '<div style="text-align:right;font:700 12.5px \'Noto Sans JP\',sans-serif;color:var(--primary);margin-top:2px">作業時間 合計 ： ' + fmtHM(sumWork(r.commonWork)) + '</div>' +
      '<div style="' + miniLab + ';margin-top:14px">移動時間・距離</div><div style="display:flex;flex-direction:column;gap:9px">' + ct + '</div>' +
      '<button' + act('addCommon', { list: 'commonTravel' }) + ' style="' + addBtnSm + '">＋ 移動</button>' +
      '<div style="text-align:right;font:700 12.5px \'Noto Sans JP\',sans-serif;color:var(--primary);margin-top:2px">移動時間 合計 ： ' + fmtHM(sumWork(r.commonTravel)) + '</div></div>';

    var sepBlocks = orderedStaff.map(function (st, si) { return { st: st, si: si }; }).filter(function (x) { return x.st.separate; }).map(function (o) {
      var st = o.st, si = o.si;
      var wr = (st.work || []).map(function (e, ri) { return timeWorkRow('case', 'work', e, ri, (st.work || []).length > 1, si); }).join('');
      var tr = (st.travel || []).map(function (e, ri) { return timeTravelRow('case', 'travel', e, ri, (st.travel || []).length > 1, si); }).join('');
      return '<div style="background:var(--surface);border:1.5px solid var(--primary);border-radius:16px;padding:16px;margin-bottom:18px;display:flex;flex-direction:column;gap:14px">' +
        '<div style="display:flex;align-items:center;gap:9px"><span style="font:800 12px \'Noto Sans JP\',sans-serif;color:#fff;background:var(--primary);padding:3px 11px;border-radius:8px">別行動</span><span style="font:700 14.5px \'Noto Sans JP\',sans-serif;color:var(--text);flex:1">' + esc(st.name || ('作業者' + (si + 1))) + '</span><button' + act('cancelSeparate', { si: si }) + ' style="height:34px;padding:0 13px;border:1.5px solid var(--border);background:var(--surface);color:var(--muted);border-radius:9px;font:700 12px \'Noto Sans JP\',sans-serif;cursor:pointer">全員と同じに戻す</button></div>' +
        '<div style="' + miniLab + '">作業時間</div><div style="display:flex;flex-direction:column;gap:9px">' + wr + '</div>' +
        '<button' + act('addStaffRow', { si: si, which: 'work' }) + ' style="' + addBtnSm + '">＋ 作業時間</button>' +
        '<div style="text-align:right;font:700 12px \'Noto Sans JP\',sans-serif;color:var(--primary)">作業時間 合計 ： ' + fmtHM(sumWork(st.work)) + '</div>' +
        '<div style="' + miniLab + ';margin-top:6px">移動時間・距離</div><div style="display:flex;flex-direction:column;gap:9px">' + tr + '</div>' +
        '<button' + act('addStaffRow', { si: si, which: 'travel' }) + ' style="' + addBtnSm + '">＋ 移動</button>' +
        '<div style="text-align:right;font:700 12px \'Noto Sans JP\',sans-serif;color:var(--primary)">移動時間 合計 ： ' + fmtHM(sumWork(st.travel)) + '</div></div>';
    }).join('');

    var totals = '<div style="' + cardStyle + '"><div style="' + miniLab + '">スタッフ別 作業時間合計</div><div style="display:flex;flex-direction:column;gap:7px">' +
      orderedStaff.map(function (st) { return '<div style="display:flex;align-items:center;gap:8px;font:600 13px \'Noto Sans JP\',sans-serif;color:var(--text)"><span style="flex:1">' + esc(st.name || '—') + '</span><span style="font:600 10.5px \'Noto Sans JP\',sans-serif;color:var(--muted)">' + (st.separate ? '別行動' : 'メイン') + '</span><span style="color:var(--primary);font-weight:700;width:96px;text-align:right">' + fmtHM(st.separate ? sumWork(st.work) : sumWork(r.commonWork)) + '</span></div>'; }).join('') + '</div></div>';

    return '<div style="' + secLabel + '">作業時間・移動時間</div>' + modeCard + mainCard + sepBlocks + totals;
  }

  function viewApprove(r) {
    var hasSig = !!r.signature;
    var sigBtn = hasSig
      ? '<button' + act('goPreview') + ' style="width:100%;border:1.5px solid var(--primary);background:var(--primary-soft);border-radius:14px;padding:10px;cursor:pointer;display:flex;align-items:center;gap:14px"><img src="' + esc(r.signature) + '" alt="サイン" style="height:70px;width:auto;max-width:58%;background:#fff;border-radius:8px"><span style="font:700 13.5px \'Noto Sans JP\',sans-serif;color:var(--primary);margin-left:auto;margin-right:8px">PDFを確認 →</span></button>'
      : '<button' + act('goPreview') + ' style="width:100%;border:1.5px dashed var(--primary);background:var(--primary-soft);border-radius:14px;padding:14px 16px;cursor:pointer;text-align:left;display:flex;align-items:center;gap:12px"><span style="font-size:22px;line-height:1;color:var(--primary)">→</span><span style="font:600 13px/1.6 \'Noto Sans JP\',sans-serif;color:var(--primary)">サインは「PDFで内容を確認」画面で、お客様に内容をご説明したうえで取得します。</span></button>';
    return '<div style="' + cardStyle + '"><div style="font:600 12.5px/1.5 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:12px">上記作業が終了したことを承認します。</div>' +
      '<div style="display:flex;gap:12px;margin-bottom:16px"><div style="flex:1"><label style="' + labStyle + '">御社名</label><input class="req"' + chg('report', { name: 'oshaName' }) + ' value="' + esc(r.oshaName) + '" style="' + inpSm + '"></div>' +
      '<div style="flex:1"><label style="' + labStyle + '">御担当者名</label><input class="req"' + chg('report', { name: 'tantoushaName' }) + ' value="' + esc(r.tantoushaName) + '" style="' + inpSm + '"></div></div>' +
      '<div style="' + miniLab + '">お客様サイン</div>' + sigBtn + '</div>';
  }

  function viewKanin(r) {
    var kanin = r.kanin || {}; var stamped = !!kanin.stamped;
    var name = kanin.name || (r.type === 'LW' ? '製造部 田中' : 'TSC 木下');
    var roleLabel = r.type === 'LW' ? '製造部 管理者' : 'TSC 管理者';
    var p = name.split(/\s+/); var dept = p.length > 1 ? p[0] : ''; var person = p.length > 1 ? p.slice(1).join(' ') : name;
    var stampVisual = stamped
      ? '<div style="width:74px;height:74px;flex:none;border-radius:50%;border:2.5px solid #c0392b;color:#c0392b;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;line-height:1.15;transform:rotate(-6deg)"><span style="font:700 8.5px \'Noto Sans JP\',sans-serif">' + esc(dept) + '</span><span style="font:800 14px \'Noto Sans JP\',sans-serif">' + esc(person) + '</span></div>'
      : '<div style="width:74px;height:74px;flex:none;border-radius:50%;border:2px dashed #c9ced8;color:#c9ced8;display:flex;align-items:center;justify-content:center;font:700 10px \'Noto Sans JP\',sans-serif">未押印</div>';
    return '<div style="' + cardStyle + '"><div style="' + secTitle + '">責任者 確認印（電子印）</div>' +
      '<div style="font:500 12px/1.6 \'Noto Sans JP\',sans-serif;color:var(--muted)">作業から戻った報告書を' + roleLabel + 'が確認し、電子印を押します。</div>' +
      '<div style="display:flex;align-items:center;gap:16px"><div style="flex:1"><label style="' + labStyle + '">' + roleLabel + '</label><input class="req"' + chg('kaninName', { scope: 'case' }) + ' value="' + esc(name) + '" placeholder="責任者名" style="' + inpSm + ';width:100%"></div>' + stampVisual + '</div>' +
      '<button' + act('toggleStamp', { scope: 'case' }) + ' style="width:100%;height:48px;border:1.5px solid #c0392b;background:' + (stamped ? '#fdecea' : '#c0392b') + ';color:' + (stamped ? '#c0392b' : '#fff') + ';border-radius:12px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer">' + (stamped ? '確認印を取り消す' : '確認印を押す') + '</button></div>';
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
    var isLW = active && active.type === 'LW';
    var orderedStaff = r.staff || [];
    var commonNames = orderedStaff.filter(function (st) { return !st.separate; }).map(function (st, i) { return st.name || ('作業者' + (orderedStaff.indexOf(st) + 1)); }).join('・') || '（該当なし）';

    // day totals
    var dayMap = {};
    var addDay = function (d, kind, mins) { if (!d || !mins) return; if (!dayMap[d]) dayMap[d] = { work: 0, travel: 0 }; dayMap[d][kind] += mins; };
    (r.commonWork || []).forEach(function (e) { addDay(e.date, 'work', diffM(e.start, e.end)); });
    (r.commonTravel || []).forEach(function (e) { addDay(e.date, 'travel', diffM(e.start, e.end)); });
    orderedStaff.forEach(function (st) { if (st.separate) { (st.work || []).forEach(function (e) { addDay(e.date, 'work', diffM(e.start, e.end)); }); (st.travel || []).forEach(function (e) { addDay(e.date, 'travel', diffM(e.start, e.end)); }); } });
    var dayTot = function (d) { return dayMap[d] ? fmtHM(dayMap[d].work + dayMap[d].travel) : ''; };

    var allWorkM = sumWork(r.commonWork), allTravelM = sumWork(r.commonTravel);
    orderedStaff.forEach(function (st) { if (st.separate) { allWorkM += sumWork(st.work); allTravelM += sumWork(st.travel); } });

    var sepStaff = orderedStaff.filter(function (st) { return st.separate; });
    var pvWork = [];
    (r.commonWork || []).filter(function (e) { return e.start || e.end || e.date; }).forEach(function (e) { pvWork.push({ names: commonNames, date: fmtDate(e.date), range: (e.start || e.end) ? ((e.start || '　') + ' 〜 ' + (e.end || '　') + ' Ｈ') : '　', dayTotal: dayTot(e.date) }); });
    sepStaff.forEach(function (st) { (st.work || []).filter(function (e) { return e.start || e.end || e.date; }).forEach(function (e) { pvWork.push({ names: st.name || '—', date: fmtDate(e.date), range: (e.start || e.end) ? ((e.start || '　') + ' 〜 ' + (e.end || '　') + ' Ｈ') : '　', dayTotal: dayTot(e.date) }); }); });
    var trvRange = function (e) { var pre = (e.dir ? (e.dir + ' ') : '') + (e.date ? (fmtDate(e.date) + '　') : ''); var t = (e.start || e.end) ? ((e.start || '　') + ' 〜 ' + (e.end || '　')) : ''; return (pre + t).trim() || '　'; };
    var pvTravel = [];
    (r.commonTravel || []).filter(function (e) { return e.start || e.end || e.km || e.date; }).forEach(function (e) { pvTravel.push({ names: commonNames, range: trvRange(e), km: e.km ? (e.km + ' Km') : '　', dayTotal: dayTot(e.date) }); });
    sepStaff.forEach(function (st) { (st.travel || []).filter(function (e) { return e.start || e.end || e.km || e.date; }).forEach(function (e) { pvTravel.push({ names: st.name || '—', range: trvRange(e), km: e.km ? (e.km + ' Km') : '　', dayTotal: dayTot(e.date) }); }); });
    if (!pvWork.length) pvWork = [{ names: '　', date: '　', range: '　', dayTotal: '' }];
    if (!pvTravel.length) pvTravel = [{ names: '　', range: '　', km: '　', dayTotal: '' }];

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

    var workRowsHtml = pvWork.map(function (w) { return '<div style="display:flex;border-bottom:1px solid #ccc"><div style="width:120px;border-right:1px solid #e2e2e2;padding:3px 6px;font-weight:700">' + esc(w.names) + '</div><div style="width:84px;border-right:1px solid #e2e2e2;padding:3px 6px">' + esc(w.date) + '</div><div style="flex:1;padding:3px 8px;display:flex;justify-content:space-between;align-items:baseline;gap:6px"><span>' + esc(w.range) + '</span><span style="font-size:8px;color:#1c7a45;font-weight:700;white-space:nowrap">' + (w.dayTotal ? '計 ' + esc(w.dayTotal) : '') + '</span></div></div>'; }).join('');
    var travelRowsHtml = pvTravel.map(function (t) { return '<div style="display:flex;border-bottom:1px solid #ccc"><div style="width:120px;border-right:1px solid #e2e2e2;padding:3px 6px;font-weight:700">' + esc(t.names) + '</div><div style="flex:1;border-right:1px solid #e2e2e2;padding:3px 8px;display:flex;justify-content:space-between;align-items:baseline;gap:6px"><span>' + esc(t.range) + '</span><span style="font-size:8px;color:#1c7a45;font-weight:700;white-space:nowrap">' + (t.dayTotal ? '計 ' + esc(t.dayTotal) : '') + '</span></div><div style="width:84px;padding:3px 8px">' + esc(t.km) + '</div></div>'; }).join('');
    var confirmHtml = (r.confirmItems || []).map(function (it) { return '<div style="display:flex;border-bottom:1px solid #ccc"><div style="flex:1;padding:3px 5px;border-right:1px solid #ccc">' + esc(it.label) + '</div><div style="width:30px;text-align:center;padding:3px 0;font-weight:700">' + esc(it.value || '') + '</div></div>'; }).join('');

    var kaninCell = '<span style="position:absolute;top:2px;left:4px;font:700 7px \'Noto Sans JP\',sans-serif;color:#555">' + (r.type === 'LW' ? '製造' : 'TSC') + '</span>' +
      (kStamped ? '<div style="width:50px;height:50px;border-radius:50%;border:2px solid #c0392b;color:#c0392b;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;line-height:1.1;transform:rotate(-6deg)"><span style="font:700 6px \'Noto Sans JP\',sans-serif">' + esc(kDept) + '</span><span style="font:800 11px \'Noto Sans JP\',sans-serif">' + esc(kPerson) + '</span></div>'
        : '<div style="width:46px;height:46px;border-radius:50%;border:1px solid #ccc;color:#bbb;display:flex;align-items:center;justify-content:center;font:700 7px \'Noto Sans JP\',sans-serif">印</div>');

    var logo = isLW ? '<img src="' + (window.LW_LOGO || '') + '" alt="LINE W" style="height:42px;width:auto">' : '<span style="font:900 16px \'Noto Sans JP\',sans-serif;letter-spacing:.12em">' + esc(COMPANY.companyTS) + '</span>';
    var footerCompany = isLW ? '株式会社 ラインワークス' : COMPANY.companyTS;
    var recipient = isLW ? '株式会社 ラインワークス' : COMPANY.companyTS;

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
      '<div style="flex:1;padding:7px 9px;display:flex;flex-direction:column"><div style="flex:1"><div style="font:700 10px \'Noto Sans JP\',sans-serif;color:#333;margin-bottom:2px">（原因）</div><div style="font:500 11px/1.6 \'Noto Sans JP\',sans-serif;white-space:pre-wrap;margin-bottom:8px;color:#16263f;word-break:break-word">' + esc(r.genin || '') + '</div>' +
      '<div style="font:700 10px \'Noto Sans JP\',sans-serif;color:#333;margin-bottom:2px">（処理）</div><div style="font:500 11px/1.65 \'Noto Sans JP\',sans-serif;white-space:pre-wrap;color:#16263f;word-break:break-word">' + esc(r.shori || '') + '</div></div>' +
      '<div style="align-self:flex-end;margin-top:10px;width:196px;border:1.4px solid #111;font:600 8.5px \'Noto Sans JP\',sans-serif;background:#fff;overflow:hidden"><div style="display:flex;border-bottom:1px solid #111;background:#f3f3f3"><div style="flex:1;padding:2px 5px">作業終了時の確認事項</div><div style="width:30px;text-align:center;border-left:1px solid #111;padding:2px 0">確認</div></div>' + confirmHtml + '<div style="padding:2px 5px;font-size:7.5px;color:#555">※完了は「✓」 該当なしは「－」</div></div></div></div>' +
      // work time
      '<div style="display:flex;border-bottom:1px solid #111;font:600 9.5px \'Noto Sans JP\',sans-serif"><div style="width:70px;border-right:1px solid #111;padding:4px 5px;background:#f7f7f7;display:flex;align-items:center">作業時間</div><div style="flex:1">' + workRowsHtml + '<div style="display:flex;background:#f7f7f7"><div style="flex:1;padding:3px 6px;text-align:right;font-weight:700">作業時間 合計</div><div style="width:120px;border-left:1px solid #ccc;padding:3px 8px;font-weight:700">' + fmtHM(allWorkM) + '</div></div></div></div>' +
      // travel time
      '<div style="display:flex;border-bottom:2px solid #111;font:600 9.5px \'Noto Sans JP\',sans-serif"><div style="width:70px;border-right:1px solid #111;padding:4px 5px;background:#f7f7f7;display:flex;align-items:center">移動時間</div><div style="flex:1">' + travelRowsHtml + '<div style="display:flex;background:#f7f7f7"><div style="flex:1;padding:3px 6px;text-align:right;font-weight:700">移動時間 合計</div><div style="width:120px;border-left:1px solid #ccc;padding:3px 8px;font-weight:700">' + fmtHM(allTravelM) + '</div></div></div></div>' +
      // approve
      '<div style="display:flex;border-bottom:2px solid #111;min-height:74px"><div style="flex:1;border-right:1px solid #111;padding:7px 9px"><div style="font:600 9px \'Noto Sans JP\',sans-serif;color:#333;margin-bottom:6px">上記作業が終了したことを承認します。</div><div style="font:700 10px \'Noto Sans JP\',sans-serif">' + esc(recipient) + '　殿</div></div>' +
      '<div style="width:240px;padding:8px 10px"><div style="display:flex;align-items:flex-end;margin-bottom:8px"><span style="font:700 9px \'Noto Sans JP\',sans-serif;color:#444;white-space:nowrap">御社名</span><span style="flex:1;border-bottom:1px solid #999;margin-left:6px;font:700 11px \'Noto Sans JP\',sans-serif;padding-bottom:2px">' + esc(r.oshaName || '　') + '</span></div>' +
      '<div style="display:flex;align-items:flex-end"><span style="font:700 9px \'Noto Sans JP\',sans-serif;color:#444;white-space:nowrap">御担当者名</span><span style="flex:1;border-bottom:1px solid #999;margin-left:6px;height:38px;position:relative">' + sig + '</span></div></div></div>' +
      // customer/plate
      '<div style="display:flex;border-bottom:2px solid #111;font:600 9px \'Noto Sans JP\',sans-serif"><div style="flex:1;border-right:1px solid #111;padding:6px 8px"><div style="font:700 9px \'Noto Sans JP\',sans-serif;margin-bottom:3px">お客様情報</div><div style="color:#333;line-height:1.7">納品先：' + esc(r.nohinSaki || '—') + '<br>住所：' + esc(r.basho || '—') + '<br>ＴＥＬ：' + esc(r.tel || '—') + '　担当者：' + esc(r.tantou || '—') + '</div></div>' +
      '<div style="width:240px;padding:6px 8px"><div style="font:700 9px \'Noto Sans JP\',sans-serif;margin-bottom:3px">銘板情報</div><div style="color:#333;line-height:1.7">型式；' + esc(r.katashiki || '—') + '<br>製番；' + esc(r.seiban || '—') + '<br>年月日；' + esc(r.nenGappi || '—') + '</div></div></div>' +
      // footer
      '<div style="display:flex;align-items:center;padding:8px 10px;gap:12px">' + logo + '<div style="font:600 8.5px/1.6 \'Noto Sans JP\',sans-serif;color:#222"><div style="font-weight:700;font-size:10px">' + esc(footerCompany) + '</div>〒262-0012　千葉県千葉市花見川区千種町53<br>Tel 043-250-0165 ／ Fax 043-257-9488</div></div>' +
      '</div></div>';

    var sigBadge = r.signature ? '<div style="max-width:600px;margin:0 auto 12px;background:#e7f4ec;border:1.5px solid #1c7a45;border-radius:14px;padding:10px 14px;display:flex;align-items:center;gap:10px"><span style="width:24px;height:24px;flex:none;border-radius:50%;background:#1c7a45;color:#fff;font:800 13px \'Noto Sans JP\',sans-serif;display:flex;align-items:center;justify-content:center">✓</span><div style="font:700 13px \'Noto Sans JP\',sans-serif;color:#1c5635;flex:1">サインを取得済み</div><button' + act('goSign') + ' style="height:34px;padding:0 13px;border:1.5px solid #1c7a45;background:#fff;color:#1c7a45;border-radius:9px;font:700 12px \'Noto Sans JP\',sans-serif;cursor:pointer">取り直す</button></div>' : '';

    var body = '<div style="padding:18px 14px 28px;background:#dfe2e8;animation:scin .28s ease both">' +
      '<div style="font:700 13px \'Noto Sans JP\',sans-serif;color:#5a6373;text-align:center;margin-bottom:12px">PDFプレビュー ・ ' + esc(pdfName(active) + '.pdf') + '</div>' + sigBadge + sheet + '</div>';

    // footer buttons
    var footer;
    if (active && active.archived) {
      footer = '<div style="position:sticky;bottom:0;padding:14px 20px 16px;background:linear-gradient(transparent,#dfe2e8 40%);display:flex;gap:9px;z-index:5"><button' + act('goBack') + ' style="flex:none;width:130px;height:54px;border:1.5px solid #b9bfca;background:#fff;color:var(--text);border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer">戻る</button><button' + act('printPdf') + ' style="flex:1;height:54px;border:none;background:var(--primary);color:#fff;border-radius:13px;font:700 15px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">印刷・PDF保存</button></div>';
    } else {
      var stampedBtns = kStamped ? '<div style="display:flex;gap:9px"><button' + act('printPdf') + ' style="flex:1;height:54px;border:1.5px solid var(--primary);background:#fff;color:var(--primary);border-radius:13px;font:700 15px \'Noto Sans JP\',sans-serif;cursor:pointer">印刷・PDF保存</button><button' + act('confirmClose') + ' style="flex:1;height:54px;border:none;background:var(--primary);color:#fff;border-radius:13px;font:700 15px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">クローズ（完了）</button></div>'
        // 「クローズ（完了）」は確認モーダル(印刷/メール導線つき)を開く。プロトの直接クローズより安全側に倒し、handover の「保存・印刷・送信のうえクローズ」を担保。
        :
        '<button' + act('toggleStamp', { scope: 'case' }) + ' style="width:100%;height:54px;border:1.5px solid #c0392b;background:#fff;color:#c0392b;border-radius:13px;font:700 15px \'Noto Sans JP\',sans-serif;cursor:pointer">🟥 ' + (r.type === 'LW' ? '製造部 管理者' : 'TSC 管理者') + 'として確認印を押す</button><div style="text-align:center;font:600 11.5px/1.5 \'Noto Sans JP\',sans-serif;color:#5a6373;padding:2px 0 0">PDFの内容を確認し、責任者が押印すると印刷・PDF保存／クローズができます。</div>';
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

  function renderVoice() {
    var inner;
    if (S.vProcessing) {
      inner = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 0"><div style="width:54px;height:54px;border:4px solid var(--primary-soft);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite"></div><div style="font:700 13.5px \'Noto Sans JP\',sans-serif;color:var(--primary);margin-top:16px">AIが文章を整えています…</div></div>';
    } else if (S.vResult) {
      inner = '<div style="background:var(--primary-soft);border:1.5px solid var(--primary);border-radius:14px;padding:14px;margin:6px 0 16px"><div style="font:700 11px \'Noto Sans JP\',sans-serif;color:var(--primary);margin-bottom:6px">✨ AI整形結果（処置）</div><div style="font:500 14px/1.8 \'Noto Sans JP\',sans-serif;color:var(--text);white-space:pre-wrap">' + esc(S.vResult) + '</div></div>' +
        '<div style="display:flex;gap:10px"><button' + act('aiFormatVoice') + ' style="flex:none;width:120px;height:52px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer">やり直す</button><button' + act('applyVoice') + ' style="flex:1;height:52px;border:none;background:var(--primary);color:#fff;border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">処置に反映する</button></div>';
    } else {
      inner = '<div style="margin-bottom:14px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px"><div style="font:700 11px \'Noto Sans JP\',sans-serif;color:var(--muted)">認識テキスト（手入力も可）</div>' + (S.vListening ? '<div style="font:700 11px \'Noto Sans JP\',sans-serif;color:#c0392b">● 録音中…</div>' : '') + '</div>' +
        '<textarea' + chg('voiceText') + ' placeholder="マイクで話すか、ここに直接入力できます。（空のまま「AIで整える」を押すとサンプル文が生成されます）" style="width:100%;height:120px;border:1.5px solid var(--border);border-radius:12px;padding:11px 13px;font:500 14px/1.7 \'Noto Sans JP\',sans-serif;color:var(--text);background:var(--surface);resize:none">' + esc(S.vRaw) + '</textarea>' +
        (S.vListening ? '<div style="font:500 13px/1.6 \'Noto Sans JP\',sans-serif;color:var(--primary);margin-top:6px;min-height:18px">' + esc(S.vInterim) + '</div>' : '') + '</div>' +
        '<div style="display:flex;gap:10px"><button' + act('toggleListen') + ' style="flex:1;height:52px;border:1.5px solid ' + (S.vListening ? '#c0392b' : 'var(--primary)') + ';background:' + (S.vListening ? '#fdecea' : '#fff') + ';color:' + (S.vListening ? '#c0392b' : 'var(--primary)') + ';border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer">' + (S.vListening ? '● 録音を停止' : '🎤 録音を開始') + '</button><button' + act('aiFormatVoice') + ' style="flex:1;height:52px;border:none;background:var(--primary);color:#fff;border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">✨ AIで整える</button></div>';
    }
    return '<div' + act('closeVoice') + ' style="position:absolute;inset:0;background:rgba(15,23,42,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:24px">' +
      '<div' + act('stop') + ' style="width:100%;max-width:520px;background:var(--surface);border-radius:22px;padding:24px;animation:scin .2s ease both">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font-size:18px">🎤</span><div style="font:900 18px \'Noto Sans JP\',sans-serif;color:var(--text)">処置を音声で入力</div></div>' +
      '<div style="font:500 12.5px/1.6 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:16px">マイクで話した内容をAIが報告書向けの文章に整えます。</div>' +
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
          [['機種', pr.kishu], ['型式', pr.katashiki], ['製番', pr.seiban], ['製造年月', pr.nenGappi]].map(function (kv) { return '<div><div style="' + miniLab + '">' + kv[0] + '</div><div style="font:700 15px \'Noto Sans JP\',sans-serif;color:var(--text)">' + esc(kv[1] || '—') + '</div></div>'; }).join('') + '</div></div>' +
          '<div style="display:flex;gap:10px"><label style="flex:none;width:120px;height:52px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center">撮り直す<input type="file" accept="image/*" capture="environment"' + chg('plateFile') + ' style="display:none"></label><button' + act('applyPlate') + ' style="flex:1;height:52px;border:none;background:var(--primary);color:#fff;border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">各項目に反映する</button></div>';
      } else {
        actionArea = '<div style="display:flex;gap:10px"><label style="flex:none;width:120px;height:52px;border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center">選び直す<input type="file" accept="image/*" capture="environment"' + chg('plateFile') + ' style="display:none"></label><button' + act('aiReadPlate') + ' style="flex:1;height:52px;border:none;background:var(--primary);color:#fff;border-radius:13px;font:700 14px \'Noto Sans JP\',sans-serif;cursor:pointer;box-shadow:0 6px 18px var(--primary-shadow)">✨ AIで読み取る</button></div>';
      }
      inner = imgBox + actionArea;
    }
    return '<div' + act('closePlate') + ' style="position:absolute;inset:0;background:rgba(15,23,42,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:24px">' +
      '<div' + act('stop') + ' style="width:100%;max-width:520px;background:var(--surface);border-radius:22px;padding:24px;animation:scin .2s ease both">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font-size:18px">📷</span><div style="font:900 18px \'Noto Sans JP\',sans-serif;color:var(--text)">銘板を撮影して自動入力</div></div>' +
      '<div style="font:500 12.5px/1.6 \'Noto Sans JP\',sans-serif;color:var(--muted);margin-bottom:16px">アルミ銘板を撮影すると、AIが機種・型式・製番・製造年月を読み取ります。</div>' +
      inner +
      '<button' + act('closePlate') + ' style="width:100%;height:44px;border:none;background:none;color:var(--muted);font:700 13px \'Noto Sans JP\',sans-serif;cursor:pointer;margin-top:12px">閉じる</button></div></div>';
  }

  /* ==================================================================
   * ACTIONS
   * ================================================================== */
  function nav(screen) { setState(function (s) { return { history: s.history.concat([s.screen]), screen: screen, settingsSaved: false }; }); }
  function pushNav(screen) { setState(function (s) { return { history: s.history.concat([s.screen]), screen: screen }; }); }

  function mutateCase(fn) {
    setState(function (s) { return { cases: s.cases.map(function (c) { return c.id === s.activeId ? fn(Object.assign({}, c)) : c; }) }; });
  }
  function mutate(scope, fn) { if (scope === 'new') setState(function (s) { return { newForm: fn(Object.assign({}, s.newForm)) }; }); else mutateCase(fn); }

  var ACTIONS = {
    goBack: function () { var fromReport = S.screen === 'report'; setState(function (s) { var h = s.history.slice(); var prev = h.pop() || 'home'; return { history: h, screen: prev }; }); if (fromReport) persistActive().then(function () { return reloadState(); }).catch(function (e) { toast(errMsg(e), true); }); },
    // report の「一時保存」：アクティブ案件をサーバー保存してからトップへ
    goHome: function () {
      var fromReport = S.screen === 'report';
      if (fromReport) { setBusy(true); persistActive().then(function () { return reloadState(); }).then(function () { setState({ screen: 'home', history: [] }); toast('保存しました'); }).catch(function (e) { setBusy(false); toast(errMsg(e), true); }); }
      else { setState({ screen: 'home', history: [] }); }
    },
    goSettings: function () { nav('settings'); },
    goHistory: function () { nav('history'); loadHistory(); },
    goNewType: function () { pushNav('newType'); },
    goSign: function () { nav('sign'); },
    goPreview: function () { var fromReport = S.screen === 'report'; nav('preview'); if (fromReport) persistActive().catch(function (e) { toast(errMsg(e), true); }); },
    // メール送信画面へ。プレビュー(#pdf-print)がある間にPDFを用意してから遷移（添付用）
    goSend: function () {
      var doNav = function () { setState(function (s) { return { history: s.history.concat([s.screen]), screen: 'send', sent: false }; }); };
      if (document.getElementById('pdf-print')) { setBusy(true); savePdfBackup().then(function () { setState({ busy: false }); doNav(); }); }
      else { doNav(); }
    },
    finishToHome: function () { setState({ screen: 'home', history: [], sent: false }); reloadState(); },
    setFilter: function (d) { setState({ filter: d.val }); },
    setHistType: function (d) { setState({ histType: d.val }); loadHistory(); },
    clearHistQuery: function () { setState({ histQuery: '', histType: 'all' }); loadHistory(); },
    pickLW: function () { setState(function (s) { return { draftType: 'LW', editId: null, newForm: blankForm('LW'), nfError: false, history: s.history.concat(['newType']), screen: 'newForm' }; }); },
    pickTS: function () { setState(function (s) { return { draftType: 'TS', editId: null, newForm: blankForm('TS'), nfError: false, history: s.history.concat(['newType']), screen: 'newForm' }; }); },
    setNewStatus: function (d) { setState(function (s) { return { newForm: Object.assign({}, s.newForm, { status: d.val }) }; }); },
    openCase: function (d) { setState(function (s) { return { activeId: d.id, history: s.history.concat([s.screen]), screen: 'report' }; }); patchCaseSignature(d.id); },
    openMenu: function (d) { setState({ menuId: d.id }); },
    closeMenu: function () { setState({ menuId: null }); },
    stop: function (e) { if (e) e.stopPropagation(); },
    menuEdit: function () { var id = S.menuId; var c = findCase(id); if (!c) return; setState(function (s) { return { editId: id, draftType: c.type, newForm: JSON.parse(JSON.stringify(c)), menuId: null, nfError: false, history: s.history.concat(['home']), screen: 'newForm' }; }); },
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
    addCommon: function (d) { mutate('case', function (o) { var blank = d.list === 'commonWork' ? { date: o.yoteibi || TODAY, start: '', end: '' } : { dir: '往路', date: o.yoteibi || TODAY, start: '', end: '', km: '' }; var arr = (o[d.list] || []).concat([blank]); var p = {}; p[d.list] = arr; return Object.assign({}, o, p); }); },
    removeTimeRow: function (d) {
      var i = +d.i;
      if (d.si !== undefined) { var si = +d.si, which = d.list; mutate('case', function (o) { return Object.assign({}, o, { staff: o.staff.map(function (st, x) { if (x !== si) return st; var arr = st[which] || []; return Object.assign({}, st, wrapKey(which, arr.length > 1 ? arr.filter(function (_, y) { return y !== i; }) : arr)); }) }); }); }
      else { mutate('case', function (o) { var arr = o[d.list] || []; var p = {}; p[d.list] = arr.length > 1 ? arr.filter(function (_, x) { return x !== i; }) : arr; return Object.assign({}, o, p); }); }
    },
    setDir: function (d) { updateTime(d, 'dir', d.dir); },
    addStaffRow: function (d) { var si = +d.si, which = d.which; mutate('case', function (o) { return Object.assign({}, o, { staff: o.staff.map(function (st, x) { if (x !== si) return st; var blank = which === 'work' ? { date: o.yoteibi || TODAY, start: '', end: '' } : { dir: '往路', date: o.yoteibi || TODAY, start: '', end: '', km: '' }; return Object.assign({}, st, wrapKey(which, (st[which] || []).concat([blank]))); }) }); }); },
    cancelSeparate: function (d) { var si = +d.si; setSeparateFn(si, false); },
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
      if (!String(f.koban).trim() || !String(f.nohinSaki).trim()) { setState({ nfError: true }); return; }
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
    openHistory: function (d) { setState(function (s) { return { activeId: d.id, history: s.history.concat(['history']), screen: 'preview' }; }); patchCaseSignature(d.id); },
    // voice (mock; S6 で Gemini 実装)
    openVoice: function () { setState({ voiceOpen: true, vRaw: '', vInterim: '', vResult: '', vError: '', vProcessing: false, vListening: false }); },
    closeVoice: function () { stopRec(); setState({ voiceOpen: false, vListening: false }); },
    toggleListen: function () { toggleListen(); },
    aiFormatVoice: function () {
      var raw = (S.vRaw + ' ' + S.vInterim).trim(); stopRec();
      setState({ vListening: false, vProcessing: true, vResult: '' });
      // 入力が空、または Gemini 未設定ならモック整形にフォールバック
      if (!raw || !BOOT.geminiEnabled) { setTimeout(function () { setState({ vProcessing: false, vResult: mockSummarize(raw) }); }, 700); return; }
      server('aiFormatShori', raw).then(function (text) {
        setState({ vProcessing: false, vResult: text || mockSummarize(raw) });
      }).catch(function (e) {
        setState({ vProcessing: false, vResult: mockSummarize(raw) });
        toast('AI整形に失敗したため簡易整形しました：' + errMsg(e), true);
      });
    },
    applyVoice: function () { var res = S.vResult; if (res) mutateCase(function (o) { return Object.assign({}, o, { shori: (o.shori ? o.shori + '\n' : '') + res }); }); setState({ voiceOpen: false, vListening: false }); },
    // plate (mock; S6 で Gemini Vision 実装)
    openPlate: function () { setState({ plateOpen: true, plateImg: '', plateProcessing: false, plateResult: null }); },
    closePlate: function () { setState({ plateOpen: false }); },
    aiReadPlate: function () {
      if (!S.plateImg) return;
      setState({ plateProcessing: true, plateResult: null });
      var mockPlate = function () { var c = findCase(S.activeId) || {}; return { kishu: c.kishu || 'LN-3000', katashiki: c.katashiki || 'CT-3000', seiban: c.seiban || '25-0083', nenGappi: c.nenGappi || '2025-03' }; };
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
    applyPlate: function () { var res = S.plateResult, id = S.activeId; if (res && id) { setState(function (s) { return { cases: s.cases.map(function (c) { return c.id === id ? Object.assign({}, c, { kishu: res.kishu, katashiki: res.katashiki, seiban: res.seiban, nenGappi: res.nenGappi }) : c; }), plateOpen: false }; }); } else ACTIONS.closePlate(); }
  };

  function wrapKey(k, v) { var o = {}; o[k] = v; return o; }
  function setSeparateFn(si, val) {
    mutate('case', function (o) {
      return Object.assign({}, o, { staff: o.staff.map(function (st, i) { if (i !== si) return st; var work = (st.work && st.work.length) ? st.work : [{ date: o.yoteibi || TODAY, start: '', end: '' }]; var travel = (st.travel && st.travel.length) ? st.travel : [{ dir: '往路', date: o.yoteibi || TODAY, start: '', end: '', km: '' }]; return Object.assign({}, st, { separate: val, work: work, travel: travel }); }) });
    });
  }
  function updateTime(d, field, val) {
    var i = +d.i;
    if (d.si !== undefined) { var si = +d.si, which = d.list; mutate('case', function (o) { return Object.assign({}, o, { staff: o.staff.map(function (st, x) { if (x !== si) return st; return Object.assign({}, st, wrapKey(which, (st[which] || []).map(function (row, y) { return y === i ? Object.assign({}, row, wrapKey(field, val)) : row; }))); }) }); }); }
    else { mutate('case', function (o) { var arr = o[d.list] || []; return Object.assign({}, o, wrapKey(d.list, arr.map(function (row, x) { return x === i ? Object.assign({}, row, wrapKey(field, val)) : row; }))); }); }
  }

  /* ---------------- change dispatch ---------------- */
  var CHANGES = {
    nf: function (d, val) {
      setState(function (s) {
        var patch = wrapKey(d.name, val);
        // 工番選択で 納品先/住所/装置名 を自動補完（マスターに値がある項目のみ上書き）
        if (d.name === 'koban') {
          var mk = masterKoban(val);
          if (mk) {
            if (mk.nohinSaki) patch.nohinSaki = mk.nohinSaki;
            if (mk.basho) patch.basho = mk.basho;
            if (mk.kishu) patch.kishu = mk.kishu;
          }
        }
        return { newForm: Object.assign({}, s.newForm, patch), nfError: false };
      });
    },
    report: function (d, val) { mutateCase(function (o) { return Object.assign({}, o, wrapKey(d.name, val)); }); },
    settings: function (d, val) { setState(function (s) { return { settings: Object.assign({}, s.settings, wrapKey(d.name, val)), settingsSaved: false }; }); },
    staffName: function (d, val) { var si = +d.si; mutate(d.scope, function (o) { return Object.assign({}, o, { staff: o.staff.map(function (st, i) { return i === si ? Object.assign({}, st, { name: val }) : st; }) }); }); },
    kaninName: function (d, val) { mutate(d.scope, function (o) { return Object.assign({}, o, { kanin: Object.assign({}, o.kanin || {}, { name: val }) }); }); },
    timeRow: function (d, val) { updateTime(d, d.field, val); },
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
        blobToDataUrl(blob).then(function (dataUrl) {
          return server('aiTranscribe', dataUrl, blob.type);
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
    if (!t) return '主軸まわりの軸受を新品へ交換し、芯出しと回転バランスを再調整しました。潤滑経路を清掃のうえ規定グリスを再充填し、各部を規定トルクで締め直しています。交換後に連続運転試験を実施し、異音・振動・温度上昇が基準値内であること、安全装置の不要作動がないことを確認しました。最後にお客様立会いのもと動作確認を行い、正常稼働を確認して作業を完了しました。';
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
      '<style>@page{size:A4;margin:11mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}html,body{margin:0;padding:0;background:#fff}#sheet{width:600px;margin:0 auto;font-family:\'Noto Sans JP\',sans-serif;color:#111}</style></head><body>';
    w.document.write(head + '<div id="sheet">' + el.innerHTML + '</div></body></html>');
    w.document.close();
    var go = function () { try { w.focus(); w.print(); } catch (e) {} };
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
  function onResize() { var m = computeMode(); if (m !== S.mode) setState({ mode: m }); }
  window.addEventListener('resize', onResize);
  S.mode = computeMode();
  render();
})();
