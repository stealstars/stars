/* 领地档案 主脚本：状态解析、面板、视图、读取回退。改这里。 */
/* ==========================================================================
 * 领地档案 (Fief Ledger)
 * 酒馆助手脚本 —— 只读聊天与变量，不改世界书、不改正则。
 *
 * 状态来源（五级回退，见 resolveState）：
 *   ① 消息变量   —— MVU 的 stat_data 真正待的地方
 *   ② 聊天变量
 *   ③ TavernHelper 消息接口
 *   ④ 历史补丁   —— 重放 <UpdateVariable> 的 JSON Patch
 *   ⑤ 存档快照   —— 消息被删/重新生成后的最后一道
 *
 * 检测通道：函数挂载 / 事件订阅 / 变量指纹 / 消息指纹
 * 数据契约：<fief_domain> <fief_report> <fief_build>，字段按行首标签归类
 * 档位常量：TIERS 照抄世界书「二、七档规模阶梯」，自检页会核对
 * ========================================================================== */
(() => {
  'use strict';

  const KEY = '__fiefLedger';
  const UI_ID = 'fief-ledger-root';
  const STYLE_ID = 'fief-ledger-style';
  const VERSION = '0.9.0';

  /* ---------------------------------------------------------------- 单例 */
  const prev = window[KEY];
  if (prev && typeof prev.dispose === 'function') {
    try { prev.dispose(); } catch (e) { /* 忽略 */ }
  }

  /* ------------------------------------------------------------ 宿主窗口 */
  // 手机端酒馆助手的脚本 iframe 嵌得很深，且不一定能查到 #chat。
  // 旧逻辑找不到 #chat 就退回自己那个 iframe —— 星标是 fixed 还能看见，
  // 但面板只够 iframe 那么高，看起来就是「点了没反应、没有面板」。
  // 所以：优先找 #chat，找不到就用一路能上溯到的最顶层可访问窗口。
  function resolveHost() {
    let cur = window, top = window, found = null;
    for (let i = 0; i < 10; i += 1) {
      try {
        const d = cur.document;
        if (d && d.body) {
          top = cur;
          if (!found && d.querySelector('#chat')) found = cur;
        }
        const p = cur.parent;
        if (!p || p === cur) break;
        cur = p;
      } catch (e) { break; }
    }
    return found || top || window;
  }

  const host = resolveHost();
  const doc = host.document || document;

  /* ------------------------------------------- 跨窗口清理（手机端关键） */
  // 酒馆助手的脚本 iframe 可能嵌得比 window.parent 更深：旧实例若把星标挂到
  // 了别的窗口，只清当前 window 会留下一个「看得见、点不动」的僵尸星标。
  // 这里沿 window 链一路往上扫，能访问到的每一层都清一遍。
  try {
    const chain = [];
    let scan = window;
    for (let i = 0; i < 8; i += 1) {
      chain.push(scan);
      let up = null;
      try { up = scan.parent; } catch (e) { break; }
      if (!up || up === scan) break;
      scan = up;
    }
    for (const w of chain) {
      try {
        const p = w[KEY];
        if (p && typeof p.dispose === 'function') p.dispose();
      } catch (e) { /* 忽略 */ }
      try {
        const d = w.document;
        if (!d) continue;
        const g = d.getElementById(UI_ID);
        if (g && g.parentNode) g.parentNode.removeChild(g);
        const oldStyle = d.getElementById(STYLE_ID);
        if (oldStyle && oldStyle.parentNode) oldStyle.parentNode.removeChild(oldStyle);
      } catch (e) { /* 跨域访问不了就算了 */ }
    }
  } catch (e) { /* 忽略 */ }

  /* -------------------------------------------------------------- 上下文 */
  function getCtx() {
    const cands = [host.SillyTavern, window.SillyTavern, host.parent && host.parent.SillyTavern];
    for (const S of cands) {
      try { if (S && typeof S.getContext === 'function') return S.getContext(); } catch (e) { /* 忽略 */ }
    }
    return null;
  }

  function getMessages() {
    const ctx = getCtx();
    return ctx && Array.isArray(ctx.chat) ? ctx.chat : [];
  }

  function mesText(m) {
    if (!m) return '';
    return String(m.mes != null ? m.mes : (m.content != null ? m.content : ''));
  }

  /* ------------------------------------------------------------ 变量读写 */
  const TH = () => host.TavernHelper || host.tavernHelper || window.TavernHelper || window.tavernHelper || null;

  function readChatVars() {
    const th = TH();
    if (th && typeof th.getVariables === 'function') {
      try {
        const v = th.getVariables({ type: 'chat' });
        if (v && typeof v === 'object') return v;
      } catch (e) { /* 忽略 */ }
    }
    const ctx = getCtx();
    try {
      if (ctx && ctx.chatMetadata && typeof ctx.chatMetadata.variables === 'object') return ctx.chatMetadata.variables;
    } catch (e) { /* 忽略 */ }
    return null;
  }

  function writeChatVars(patch) {
    const th = TH();
    if (th && typeof th.insertOrAssignVariables === 'function') {
      try { th.insertOrAssignVariables(patch, { type: 'chat' }); return true; } catch (e) { /* 忽略 */ }
    }
    const ctx = getCtx();
    try {
      if (ctx && ctx.chatMetadata) {
        if (!ctx.chatMetadata.variables || typeof ctx.chatMetadata.variables !== 'object') ctx.chatMetadata.variables = {};
        Object.assign(ctx.chatMetadata.variables, patch);
        if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
        else if (host.SillyTavern && typeof host.SillyTavern.saveMetadata === 'function') host.SillyTavern.saveMetadata();
        return true;
      }
    } catch (e) { /* 忽略 */ }
    return false;
  }

  /* ------------------------------------------- 消息变量（MVU 的权威存档） */
  /** MVU 把 stat_data 挂在「消息」上（m.variables 是数组），不是聊天元数据。
   *  旧实现只翻聊天变量与补丁重放，所以真存档里明明有 4 座建筑，读出来是 0 座。 */
  function statFromBag(bag) {
    const list = Array.isArray(bag) ? bag : [bag];
    for (const c of list) {
      if (!c || typeof c !== 'object') continue;
      try {
        if (c.stat_data && typeof c.stat_data === 'object') return c.stat_data;
        if (c.主角 && typeof c.主角 === 'object') return c;
      } catch (e) { /* 忽略 */ }
    }
    return null;
  }

  function statFromMessage(m) {
    if (!m || typeof m !== 'object') return null;
    const bags = [];
    try { if (m.variables != null) bags.push(m.variables); } catch (e) { /* 忽略 */ }
    try { if (m.extra && m.extra.variables != null) bags.push(m.extra.variables); } catch (e) { /* 忽略 */ }
    for (const bag of bags) {
      const st = statFromBag(bag);
      if (st) return st;
    }
    return null;
  }

  function thMessageState() {
    const th = TH();
    if (!th || typeof th.getVariables !== 'function') return null;
    try { return statFromBag(th.getVariables({ type: 'message' })); } catch (e) { return null; }
  }

  /** 从最后一条带状态的消息往前找，取最近一份 */
  function messageState() {
    const msgs = getMessages();
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const st = statFromMessage(msgs[i]);
      if (st) return { state: st, idx: i, via: 'message' };
    }
    return null;
  }

  function hasAssets(stat) {
    const a = stat && stat.主角 && stat.主角.资产;
    return !!(a && typeof a === 'object' && Object.keys(a).length);
  }

  /* -------------------------------------------------------------- 偏好 */
  const PREF_KEY = 'fief-ledger-prefs-v4';

  function loadPrefs() {
    const read = (k) => { try { const r = host.localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch (e) { return null; } };
    const p = read(PREF_KEY) || read('fief-ledger-prefs-v3') || read('fief-ledger-prefs-v2') || read('fief-ledger-prefs-v1') || {};
    return {
      // 主题色：老存档里可能是非法值（手改过 localStorage），回落到琥珀
      accent: normHex(p.accent) || '#d4af5a',
      // 字色：null = 跟随主题
      text: normHex(p.text),
      auto: p.auto !== false,
      pos: p.pos && typeof p.pos === 'object' ? p.pos : null,
    };
  }

  function savePrefs(p) { try { host.localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) { /* 忽略 */ } }

  /* -------------------------------------------------------------- 主题 */
  // 一套主题 = 一个主色。背景、描边、星标球面全由主色推出来，
  // 所以换色不会出现「冷色主色 + 暖黑底」这种拼接感。
  const THEMES = [
    { id: 'amber', name: '琥珀', accent: '#d4af5a' },
    { id: 'jade', name: '青玉', accent: '#6ec2a0' },
    { id: 'cinnabar', name: '朱砂', accent: '#cf6a55' },
    { id: 'indigo', name: '靛蓝', accent: '#7d9bd6' },
    { id: 'violet', name: '紫檀', accent: '#b184c9' },
    { id: 'moss', name: '苔绿', accent: '#9cb56a' },
    { id: 'ink', name: '墨青', accent: '#63a8b8' },
    { id: 'silver', name: '霜银', accent: '#c3ccd8' },
  ];

  const DEFAULT_ACCENT = THEMES[0].accent;

  // 字体颜色：null 表示跟随主色推出来的那一档
  const INKS = [
    { id: 'auto', name: '跟随主题', hex: null },
    { id: 'warm', name: '暖白', hex: '#ece2cc' },
    { id: 'paper', name: '纸白', hex: '#f4efe2' },
    { id: 'cool', name: '冷白', hex: '#e3e9f1' },
    { id: 'ash', name: '雾灰', hex: '#c9cdd2' },
    { id: 'moon', name: '月白', hex: '#e8e6f2' },
    { id: 'sand', name: '砂金', hex: '#e6d9b8' },
  ];

  function hexToRgb(hex) {
    let h = String(hex == null ? '' : hex).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function rgbToHex(r, g, b) {
    const p = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return '#' + p(r) + p(g) + p(b);
  }

  /**
   * 规范成 #rrggbb，认不出来就返回 null。
   * 三位的简写必须带 #（#abc），不带 # 的只认六位 ——
   * 不然手改偏好写成 "bad" 这种词也会被当成颜色。
   */
  function normHex(v) {
    const s = String(v == null ? '' : v).trim();
    if (!/^#?[0-9a-f]{6}$/i.test(s) && !/^#[0-9a-f]{3}$/i.test(s)) return null;
    const r = hexToRgb(s);
    return r ? rgbToHex(r[0], r[1], r[2]) : null;
  }

  /** t=0 取 col，t=1 取 to；用来把主色压进暗底里 */
  function mixHex(col, to, t) {
    const a = hexToRgb(col), b = hexToRgb(to);
    if (!a || !b) return col;
    return rgbToHex(
      a[0] * (1 - t) + b[0] * t,
      a[1] * (1 - t) + b[1] * t,
      a[2] * (1 - t) + b[2] * t,
    );
  }

  /** 由主色推整套配色：暗底四层、文字、标题白、星标球面 */
  function paletteOf(accentHex) {
    const accent = normHex(accentHex) || DEFAULT_ACCENT;
    return {
      accent,
      rgb: hexToRgb(accent).join(','),
      bg: mixHex(accent, '#050404', 0.955),
      bg2: mixHex(accent, '#080706', 0.945),
      surface: mixHex(accent, '#0c0a08', 0.93),
      surface2: mixHex(accent, '#100e0b', 0.918),
      text: mixHex('#ece2cc', accent, 0.13),
      bright: mixHex('#f8f1dd', accent, 0.09),
      star1: mixHex(accent, '#000000', 0.6),
      star2: mixHex(accent, '#000000', 0.78),
      star3: mixHex(accent, '#000000', 0.905),
      star4: mixHex(accent, '#000000', 0.945),
      crest1: mixHex(accent, '#ffffff', 0.28),
      crest2: mixHex(accent, '#000000', 0.06),
      crest3: mixHex(accent, '#000000', 0.34),
    };
  }

  /** 把整套配色写进 root 的内联变量；样式表被改写也不影响 */
  function applyAccent(accentHex) {
    const p = paletteOf(accentHex);
    // 字色：手动定过就用它，标题白按它提亮；没定就吃主色推出来的那一档
    const ink = prefs ? normHex(prefs.text) : null;
    const text = ink || p.text;
    const bright = ink ? mixHex(ink, '#ffffff', 0.32) : p.bright;
    p.text = text;
    p.bright = bright;
    if (!root) return p;
    const set = (k, v) => { try { root.style.setProperty(k, v); } catch (e) { /* 忽略 */ } };
    set('--fl-accent', p.accent);
    set('--fl-accent-rgb', p.rgb);
    set('--fl-bg', p.bg);
    set('--fl-bg2', p.bg2);
    set('--fl-surface', p.surface);
    set('--fl-surface2', p.surface2);
    set('--fl-text', text);
    set('--fl-text-rgb', hexToRgb(text).join(','));
    set('--fl-bright', bright);
    set('--fl-star1', p.star1);
    set('--fl-star2', p.star2);
    set('--fl-star3', p.star3);
    set('--fl-star4', p.star4);
    set('--fl-crest1', p.crest1);
    set('--fl-crest2', p.crest2);
    set('--fl-crest3', p.crest3);
    // 全屏层的内联底色跟着走：它是内联写死的，不改就永远是暖黑
    if (screen) { try { screen.style.backgroundColor = p.bg; } catch (e) { /* 忽略 */ } }
    return p;
  }

  /* ============================================================ 解析层 */

  function parseTags(str) {
    const out = {};
    const re = /\[([^:\]]{1,10}):([^\]]*)\]/g;
    let m;
    const s = String(str == null ? '' : str);
    while ((m = re.exec(s))) out[m[1].trim()] = m[2].trim();
    return out;
  }

  /** 标签可能是字符串，也可能是数组 ["类型:民生","位置:核心区"] */
  function tagsText(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map((x) => '[' + String(x) + ']').join('');
    if (typeof v === 'object') return Object.keys(v).map((k) => '[' + k + ':' + v[k] + ']').join('');
    return String(v);
  }

  /** 效果可能是字符串、数组、或对象 {领主官邸:"…"} */
  function effectText(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(effectText).filter(Boolean).join('\n');
    if (typeof v === 'object') {
      return Object.keys(v).map((k) => {
        const val = v[k];
        return k + ': ' + (typeof val === 'object' ? JSON.stringify(val) : String(val));
      }).join('\n');
    }
    return String(v);
  }

  /** 效果拆成「名: 值」行，用于卡片展示与产出识别 */
  function effectLinesOf(item) {
    const raw = item && item.效果;
    const out = [];
    const push = (text) => {
      const t = String(text == null ? '' : text).trim();
      if (!t) return;
      const i = t.indexOf(':');
      const j = t.indexOf('：');
      const p = i >= 0 ? i : j;
      if (p > 0) out.push({ k: t.slice(0, p).trim(), v: t.slice(p + 1).trim() });
      else out.push({ k: '', v: t });
    };
    if (raw == null) return out;
    if (typeof raw === 'string') String(raw).split(/\n|<br\s*\/?>/i).forEach(push);
    else if (Array.isArray(raw)) raw.forEach((x) => effectLinesOf({ 效果: x }).forEach((l) => out.push(l)));
    else if (typeof raw === 'object') {
      for (const k of Object.keys(raw)) {
        const v = raw[k];
        push(k + ': ' + (v && typeof v === 'object' ? JSON.stringify(v) : v));
      }
    }
    return out;
  }

  /** 领地资产的元信息：标签与描述两套写法都认 */
  function parseDomainMeta(asset) {
    const tags = parseTags(tagsText(asset && asset.标签));
    const desc = String((asset && asset.描述) || '');
    const hit = (re) => { const m = desc.match(re); return m ? String(m[1]).trim() : ''; };
    return {
      规模档: tags.领地规模 || tags.规模 || '',
      势力: tags.所属势力 || tags.势力 || '',
      拥有者: tags.拥有者 || '',
      协议: tags.协议类型 || '',
      治理模式: tags.治理模式 || hit(/治理模式[:：]\s*([^\n。；;，,]+)/),
      领地状态: tags.状态 || hit(/领地状态[:：]\s*([^\n。；;，,]+)/),
      品质: String((asset && asset.品质) || tags.品质 || ''),
      位置: String((asset && asset.位置) || ''),
      总空间: String((asset && (asset.总空间 || asset.总占用空间)) || ''),
      结算: String((asset && asset.结算) || ''),
    };
  }

  function normalizeInner(raw) {
    const list = [];
    if (!raw) return list;
    if (Array.isArray(raw)) {
      raw.forEach((it, i) => { if (it && typeof it === 'object') list.push({ key: String(it.名称 || it.name || ('#' + i)), item: it }); });
      return list;
    }
    if (typeof raw === 'object') {
      for (const k of Object.keys(raw)) if (raw[k] && typeof raw[k] === 'object') list.push({ key: k, item: raw[k] });
    }
    return list;
  }

  function extractPatchArrays(text) {
    const s = String(text || '');
    const found = [];
    for (let i = 0; i < s.length; i += 1) {
      if (s[i] !== '[') continue;
      let depth = 0, inStr = false, esc2 = false, end = -1;
      for (let j = i; j < s.length; j += 1) {
        const ch = s[j];
        if (inStr) {
          if (esc2) esc2 = false;
          else if (ch === '\\') esc2 = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '[') depth += 1;
        else if (ch === ']') { depth -= 1; if (depth === 0) { end = j; break; } }
      }
      if (end < 0) continue;
      try {
        const v = JSON.parse(s.slice(i, end + 1));
        if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && typeof v[0].op === 'string') {
          found.push(v); i = end;
        }
      } catch (e) { /* 不是 JSON */ }
    }
    return found;
  }

  function pointerSegs(path) {
    return String(path || '').split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  }

  function patchesFromMessage(mes) {
    const text = String(mes || '');
    if (text.indexOf('<UpdateVariable>') < 0) return [];
    const out = [];
    for (const b of (text.match(/<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/g) || [])) {
      for (const a of extractPatchArrays(b)) out.push(a);
    }
    return out;
  }

  /* ---- 区块行解析：按行首标签归位，不按字段序号套 ----
   * 契约里的行标签与真实存档不完全一致（[状态] 会被写成 [核心]，
   * [钱] 会拆成 [府库]+[收益]，还会多出 [营造][物产][胜景][邻邦][治下]）。
   * 所以这里只做两件事：把 [...] 切出来，按第一个字段决定它是什么。 */
  function bracketRows(body) {
    const rows = [];
    const s = String(body || '');
    let i = 0;
    while (i < s.length) {
      if (s.charAt(i) !== '[') { i += 1; continue; }
      const e = s.indexOf(']', i + 1);
      if (e < 0) break;
      const inner = s.slice(i + 1, e);
      i = e + 1;
      if (inner.indexOf('|') < 0) continue;
      rows.push(inner.split('|').map((x) => x.trim()));
    }
    return rows;
  }

  function blockRows(text, tag) {
    const s = String(text || '');
    const open = '<' + tag + '>';
    const close = '</' + tag + '>';
    /* 先找最后一个闭合标签，再往前找开标签。
       有些楼层会在正文里提到 `<fief_report>` 却没写完整区块，按开标签找会抓空。 */
    const end = s.lastIndexOf(close);
    if (end < 0) return [];
    const at = s.lastIndexOf(open, end);
    if (at < 0) return [];
    return bracketRows(s.slice(at + open.length, end));
  }

  const UNIT_OF = { 千: 1e3, 万: 1e4, 亿: 1e8, 万亿: 1e12 };

  /** 取第一个数字，认得「1.5亿」「3 个月」这种写法 */
  function numberOf(v) {
    const s = String(v == null ? '' : v);
    let num = '';
    let dot = false;
    let sign = 1;
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charAt(i);
      if ((c === '-' || c === '−') && !num) { sign = -1; continue; }
      if (c >= '0' && c <= '9') { num += c; continue; }
      if (c === '.' && num && !dot) { num += c; dot = true; continue; }
      if (c === ',' && num) continue;
      if (num) {
        const two = s.slice(i, i + 2);
        const unit = two === '万亿' ? UNIT_OF.万亿 : UNIT_OF[c];
        if (unit) return sign * Math.round(parseFloat(num) * unit);
        break;
      }
    }
    if (!num) return null;
    const n = parseFloat(num);
    return isNaN(n) ? null : sign * n;
  }

  /** 「59633Z 帝冕币」→ { n, unit:'帝冕币' } */
  function moneyOf(v) {
    const s = String(v == null ? '' : v);
    const n = numberOf(s);
    if (n == null) return null;
    let rest = '';
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charAt(i);
      if ((c >= '0' && c <= '9') || c === '.' || c === ',' || c === 'Z' || c === 'z' || c === '+' || c === '-') continue;
      rest += c;
    }
    rest = rest.split(' ').filter(Boolean).join(' ');
    return { n: n, unit: rest };
  }

  function rowsByTag(rows) {
    const map = {};
    for (const f of rows) {
      const k = f[0];
      if (!k) continue;
      if (!map[k]) map[k] = [];
      map[k].push(f);
    }
    return map;
  }

  /* -------------------------------------------------- <fief_build> 规划 */
  const BUILD_TAGS = ['建设', '规划', '方案'];

  function parseBuildBlock(text) {
    const rows = blockRows(text, 'fief_build');
    const plans = [];
    for (const f of rows) {
      if (BUILD_TAGS.indexOf(f[0]) < 0) continue;
      /* 契约：建设|名|类别|估价|工期|说明
         实际：建设|编号|类别|名|品质|估价|工期|说明|前置 —— 用字段数区分，再校验类别 */
      const long = f.length >= 8;
      const cat = long ? f[2] : f[2];
      const plan = long
        ? { 编号: f[1], 类别: cat, 名: f[3], 品质: f[4], 估价: f[5], 工期: f[6], 说明: f[7], 前置: f[8] || '' }
        : { 编号: '', 类别: cat, 名: f[1], 品质: f[6] || '', 估价: f[3], 工期: f[4], 说明: f[5] || '', 前置: '' };
      if (!plan.名) continue;
      const money = moneyOf(plan.估价);
      plan.数额 = money ? money.n : null;
      plan.货币 = money ? money.unit : '';
      plan.月数 = numberOf(plan.工期);
      plans.push(plan);
    }
    return plans;
  }

  /** 建筑名 → 估价/工期/说明（明细抽屉里补字段用） */
  function buildInfoFromMessage(mes) {
    const out = {};
    for (const p of parseBuildBlock(mes)) {
      out[p.名] = { 估价: p.估价, 工期: p.工期, 说明: p.说明, 类别: p.类别 };
    }
    return out;
  }

  /* ------------------------------------------------- <fief_domain> 总览 */
  function parseDomainBlock(text) {
    const rows = blockRows(text, 'fief_domain');
    if (!rows.length) return null;
    const out = {
      领地名: '', 规模档: '', 所属势力: '', 治理模式: '', 状态: '',
      治安: '', 民心: '', 物资: '', 人口: '', 商路: '',
      金库: '', 货币: '', 月净额: '', 月净额货币: '',
      军事: [], 要事: [], 营造: [], 物产: [], 胜景: [], 邻邦: [], 治下: null,
      rows: rowsByTag(rows),
    };
    for (const f of rows) {
      const k = f[0];
      if (k === '领地') {
        out.领地名 = f[1] || '';
        out.规模档 = f[2] || '';
        out.所属势力 = f[3] || '';
        out.治理模式 = f[4] || '';
        out.状态 = f[5] || '';
      } else if (k === '状态' || k === '核心') {
        /* 契约 [状态|治安|民心|物资|人口]；实际 [核心|78|65|稳定|50] 或 [核心|商路|仓储…] */
        out.治安 = out.治安 || f[1] || '';
        out.民心 = out.民心 || f[2] || '';
        out.物资 = out.物资 || f[3] || '';
        out.人口 = out.人口 || f[4] || '';
      } else if (k === '丁口' || k === '人口') {
        out.人口 = f[1] || out.人口;
      } else if (k === '商路') {
        out.商路 = f[1] || '';
      } else if (k === '钱') {
        out.金库 = f[1] || '';
        out.月净额 = f[2] || '';
      } else if (k === '府库' || k === '金库') {
        out.金库 = f[1] || out.金库;
        out.货币 = f[2] || out.货币;
      } else if (k === '收益' || k === '月净额') {
        out.月净额 = (k === '收益' ? f[2] : f[1]) || out.月净额;
        out.月净额货币 = (k === '收益' ? f[3] : f[2]) || out.货币;
      } else if (k === '军事' || k === '驻军') {
        if (f[1]) {
          const u = { 编制: f[1], 人数: f[2] || '' };
          if (f[3]) u.层级 = f[3];
          out.军事.push(u);
        }
      } else if (k === '要事') {
        if (f[1]) out.要事.push(f[1]);
      } else if (k === '营造') {
        if (f[1]) out.营造.push({ 名: f[1], 数量: f[2] || '', 状态: f[3] || '' });
      } else if (k === '物产') {
        if (f[1]) out.物产.push({ 名: f[1], 数量: f[2] || '', 周期: f[3] || '', 状态: f[4] || '' });
      } else if (k === '胜景') {
        if (f[1]) out.胜景.push(f[1]);
      } else if (k === '邻邦') {
        if (f[1]) out.邻邦.push(f[1]);
      } else if (k === '治下') {
        out.治下 = { 头衔: f[1] || '', 主: f[2] || '', 副: f[3] || '', 态度: f[4] || '' };
      }
    }
    return out.领地名 ? out : null;
  }

  function latestDomainBlocks(msgs) {
    const map = {};
    for (const m of msgs) {
      const info = parseDomainBlock(mesText(m));
      if (info) map[info.领地名] = info;
    }
    return map;
  }

  /* ------------------------------------------------ <fief_report> 账本 */
  function parseReportBlock(text) {
    const rows = blockRows(text, 'fief_report');
    if (!rows.length) return null;
    const out = {
      领地名: '', 规模档: '', 周期: '', 估值: null, 货币: '',
      收入: [], 支出: [], 指标: [], 事件: [], 裁定: [], 待决: null,
      净额: null, 期末: null, rows: rowsByTag(rows),
    };
    for (const f of rows) {
      const k = f[0];
      if (k === '结算') {
        out.领地名 = f[1] || '';
        out.规模档 = f[2] || '';
        out.周期 = f[3] || '';
      } else if (k === '收入' || k === '支出') {
        const m = moneyOf(f[2]);
        out[k].push({ 项目: f[1] || '', 数额: m ? m.n : null, 货币: (f[3] || (m ? m.unit : '')) });
      } else if (k === '净额') {
        const m = moneyOf(f[1]);
        out.净额 = m ? m.n : null;
        if (f[2] || (m && m.unit)) out.货币 = out.货币 || f[2] || m.unit;
      } else if (k === '府库' || k === '金库') {
        const m = moneyOf(f[1]);
        out.期末 = m ? m.n : null;
        if (f[2] || (m && m.unit)) out.货币 = out.货币 || f[2] || m.unit;
      } else if (k === '估值') {
        const m = moneyOf(f[1]);
        out.估值 = m ? m.n : null;
        if (f[2] || (m && m.unit)) out.货币 = out.货币 || f[2] || m.unit;
      } else if (k === '指标') {
        out.指标.push({ 项: f[1] || '', 变化: f[2] || '', 因: f[3] || '' });
      } else if (k === '事件') {
        if (f[1]) out.事件.push(f[1]);
      } else if (k === '裁定') {
        if (f[1]) out.裁定.push(f[1]);
      } else if (k === '待决') {
        out.待决 = { 事: f[1] || '', 代价: f[2] || '', 选项: (f[3] || '').split('/').map((x) => x.trim()).filter(Boolean) };
      }
    }
    if (!out.周期 && !out.收入.length && !out.支出.length) return null;
    return out;
  }

  function latestReports(msgs) {
    const map = {};
    let any = null;
    for (const m of msgs) {
      const r = parseReportBlock(mesText(m));
      if (!r) continue;
      any = r;
      if (r.领地名) map[r.领地名] = r;
    }
    return { byDomain: map, last: any };
  }

  function latestPlans(msgs) {
    let plans = [];
    for (const m of msgs) {
      const p = parseBuildBlock(mesText(m));
      if (p.length) plans = p;
    }
    return plans;
  }

  /* --------------------------------- 治理行与结算：另一种写法的兜底 */
  const GOV_KEYS = [
    ['治安', ['治安']],
    ['民心', ['民心']],
    ['物资', ['物资', '仓储', '库存', '粮秣', '军需', '储备']],
    ['人口', ['人口', '丁口', '户籍', '户口', '民户']],
    ['商路', ['商路', '商贸', '贸易', '流通']],
    ['金库', ['金库', '府库']],
  ];

  function splitBars(s) {
    const out = [];
    let cur = '';
    const str = String(s || '');
    for (let i = 0; i < str.length; i += 1) {
      const c = str.charAt(i);
      if (c === '｜' || c === '|' || c === '/') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function splitBy(s, marks) {
    const out = [];
    let cur = '';
    const str = String(s || '');
    for (let i = 0; i < str.length; i += 1) {
      const c = str.charAt(i);
      if (marks.indexOf(c) >= 0) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  }

  /** 领地描述首行的「治理: 治安78｜民心65｜商路稳定｜仓储50｜丁口数百户」 */
  function parseGovernance(asset) {
    const desc = String((asset && asset.描述) || '');
    const head = splitBy(desc, ['\n'])[0] || '';
    const out = { 治安: '', 民心: '', 物资: '', 人口: '', 商路: '', 金库: '', 货币: '', 结算日: '', 月净额: null, 估值: null, 总空间: '', 空闲: '', 描述正文: '' };

    const parts = splitBars(head);
    for (const p of parts) {
      const body = p.indexOf(':') >= 0 ? p.slice(p.indexOf(':') + 1) : (p.indexOf('：') >= 0 ? p.slice(p.indexOf('：') + 1) : p);
      const text = body.trim();
      if (!text) continue;
      for (const pair of GOV_KEYS) {
        const name = pair[0];
        let hit = false;
        for (const kw of pair[1]) if (text.indexOf(kw) === 0 || text.indexOf(kw) >= 0) { hit = true; break; }
        if (!hit) continue;
        if (name === '金库') continue;
        let val = text;
        for (const kw of pair[1]) val = val.split(kw).join('');
        val = val.split(':').join('').split('：').join('').trim();
        if (!out[name]) out[name] = val;
        break;
      }
    }

    /* 结算字段：契约两段，实际四段（估价/月收益/府库/上次结算日） */
    const settle = String((asset && asset.结算) || '');
    const fields = splitBy(settle, [';', '；']);
    for (const f of fields) {
      const raw = f.trim();
      if (!raw) continue;
      const cut = raw.indexOf(':') >= 0 ? raw.indexOf(':') : raw.indexOf('：');
      if (cut < 0) continue;
      const key = raw.slice(0, cut).trim();
      const val = raw.slice(cut + 1).trim();
      if (key.indexOf('金库') >= 0 || key.indexOf('府库') >= 0) {
        const m = moneyOf(val);
        if (m) { out.金库 = m.n; out.货币 = m.unit; }
      } else if (key.indexOf('结算日') >= 0) {
        out.结算日 = val;
      } else if (key.indexOf('收益') >= 0) {
        const m = moneyOf(val);
        if (m) { out.月净额 = m.n; if (!out.货币) out.货币 = m.unit; }
      } else if (key.indexOf('估价') >= 0) {
        const m = moneyOf(val);
        if (m) { out.估值 = m.n; if (!out.货币) out.货币 = m.unit; }
      }
    }
    if (!out.金库) {
      const m = moneyOf(settle);
      if (m) { out.金库 = m.n; out.货币 = m.unit; }
    }

    /* 总空间：地名+领地名: 类型×数量, …: 总面积m²|空闲面积: m² */
    const space = String((asset && (asset.总空间 || asset.总占用空间)) || '');
    const segs = splitBy(space, ['|', '｜']);
    for (const seg of segs) {
      const t = seg.trim();
      if (!t) continue;
      if (t.indexOf('空闲') >= 0) { const n = numberOf(t); if (n != null) out.空闲 = n; }
      else {
        const at = t.lastIndexOf(':');
        const tail = at >= 0 ? t.slice(at + 1) : '';
        if (tail.indexOf('m') >= 0 || tail.indexOf('平') >= 0) { const n = numberOf(tail); if (n != null) out.总空间 = n; }
      }
    }

    const lines = splitBy(desc, ['\n']);
    out.描述正文 = lines.slice(1).join('\n').trim();
    return out;
  }

  /* --------------------------------------------------------- 历史（缓存） */
  const msgCache = new Map();
  let cacheChatId = null;

  function currentChatId() {
    const ctx = getCtx();
    try { return (ctx && (ctx.chatId || ctx.chat_id)) || 'default'; } catch (e) { return 'default'; }
  }

  function contribute(text, idx, who) {
    const patches = patchesFromMessage(text);
    const out = {};
    const note = (name, ev) => { if (name) (out[name] || (out[name] = [])).push(ev); };
    for (const ops of patches) {
      for (const op of ops) {
        const segs = pointerSegs(op.path);
        const iInner = segs.indexOf('内部资产');
        if (iInner < 0 || iInner + 1 >= segs.length) continue;
        const bName = segs[iInner + 1];
        const tail = segs.slice(iInner + 2).join('/');
        const at = { idx, who, kind: op.op, field: tail || '(条目)' };
        if (op.op === 'remove') { note(bName, Object.assign(at, { text: '被移除' })); continue; }
        if (op.op === 'add' || op.op === 'insert') {
          const tags = op.value && typeof op.value === 'object' ? parseTags(tagsText(op.value.标签)) : {};
          note(bName, Object.assign(at, { text: tags.状态 ? ('建档 · ' + tags.状态) : '建档' }));
          continue;
        }
        if (tail === '标签' || tail === '状态') {
          const tags = parseTags(tagsText(op.value));
          note(bName, Object.assign(at, { text: tags.状态 ? ('状态 → ' + tags.状态) : (tail + ' 更新') }));
        } else if (tail === '效果') note(bName, Object.assign(at, { text: '效果更新' }));
        else if (tail === '') note(bName, Object.assign(at, { text: '条目更新' }));
      }
    }
    return { contrib: out, count: patches.length };
  }

  function buildHistory(msgs) {
    const cid = currentChatId();
    if (cid !== cacheChatId) { msgCache.clear(); cacheChatId = cid; }
    for (const k of msgCache.keys()) if (k >= msgs.length) msgCache.delete(k);

    const byName = {};
    let patchCount = 0;
    msgs.forEach((m, idx) => {
      const text = mesText(m);
      if (!text) return;
      const who = m && m.is_user ? '玩家' : 'AI';
      const sig = idx + '|' + who + '|' + text.length + '|' + text.slice(-40);
      let rec = msgCache.get(idx);
      if (!rec || rec.sig !== sig) {
        rec = Object.assign({ sig }, contribute(text, idx, who), { builds: buildInfoFromMessage(text) });
        msgCache.set(idx, rec);
      }
      patchCount += rec.count;
      for (const name of Object.keys(rec.contrib)) {
        if (!byName[name]) byName[name] = [];
        for (const ev of rec.contrib[name]) byName[name].push(ev);
      }
    });
    return { byName, count: patchCount };
  }

  function buildInfoAll() {
    const out = {};
    for (const [, rec] of msgCache) if (rec.builds) Object.assign(out, rec.builds);
    return out;
  }

  /* ------------------------------------------------ 状态来源（三级回退） */
  let lastStateSource = '无';

  function findStatDataInVars() {
    const vars = readChatVars();
    const roots = [vars, vars && vars.stat_data, vars && vars['stat_data']];
    const ctx = getCtx();
    if (ctx) roots.push(ctx.chatMetadata && ctx.chatMetadata.stat_data);
    for (const r of roots) if (r && typeof r === 'object' && r.主角 && typeof r.主角 === 'object') return r;
    if (vars && typeof vars === 'object') {
      for (const k of Object.keys(vars)) {
        const v = vars[k];
        if (v && typeof v === 'object' && v.主角 && v.主角.资产) return v;
      }
    }
    return null;
  }

  function replayState(msgs) {
    const root = {};
    const walk = (segs, create) => {
      let cur = root;
      for (let i = 0; i < segs.length - 1; i += 1) {
        const k = segs[i];
        if (cur[k] == null || typeof cur[k] !== 'object') {
          if (!create) return null;
          cur[k] = {};
        }
        cur = cur[k];
      }
      return cur;
    };
    for (const m of msgs) {
      const text = mesText(m);
      if (!text || text.indexOf('<UpdateVariable>') < 0) continue;
      for (const ops of patchesFromMessage(text)) {
        for (const op of ops) {
          const segs = pointerSegs(op.path);
          if (!segs.length) continue;
          if (op.op === 'remove') {
            const parent = walk(segs, false);
            if (parent) {
              const last = segs[segs.length - 1];
              if (Array.isArray(parent)) parent.splice(Number(last), 1);
              else delete parent[last];
            }
            continue;
          }
          const parent = walk(segs, true);
          if (!parent) continue;
          const last = segs[segs.length - 1];
          if (last === '-' && Array.isArray(parent)) parent.push(op.value);
          else parent[last] = op.value;
        }
      }
    }
    return root;
  }

  let replayCache = { key: '', state: null };

  function replayStateCached(msgs) {
    let sum = 0;
    for (const m of msgs) sum += mesText(m).length;
    const tail = msgs.length ? mesText(msgs[msgs.length - 1]).slice(-40) : '';
    const key = msgs.length + '|' + sum + '|' + tail;
    if (replayCache.key === key) return replayCache.state;
    const state = replayState(msgs);
    replayCache = { key, state };
    return state;
  }

  /* ------------------------------------------------------------ 读取日志 */
  /** 手机上排错最难的是没有控制台。这里把每次读取都记一条：什么时候、谁触发的、
   *  数据最终取自哪一层、楼层与各项数量，以及各级回退各自的结果。
   *  存 localStorage 而不是聊天变量：不污染存档、不进 prompt；换聊天自动作废，
   *  因为一份日志只对当前这一档有意义。 */
  const LOG_KEY = 'fief-ledger-log';
  const LOG_VER = 1;
  const LOG_MAX = 80;
  let readLog = [];
  let lastTrace = [];

  function logTime(ts) {
    const d = ts ? new Date(ts) : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function loadLog() {
    const cid = currentChatId();
    let raw = null;
    try { raw = host.localStorage.getItem(LOG_KEY); } catch (e) { return; }
    if (!raw) return;
    let disk = [];
    try {
      const j = JSON.parse(raw);
      if (!j || !Array.isArray(j.rows)) return;
      // 别的聊天的日志不要；但启动早期拿不到 chatId 时（'default'）先接上，
      // 等真正进到聊天里再读一次会被下面这条过滤掉
      if (j.cid && j.cid !== cid && cid !== 'default') return;
      disk = j.rows.filter((r) => r && typeof r === 'object');
    } catch (e) { return; }
    if (!disk.length) return;
    // 合并而不是覆盖：本次启动已经记下的那几条（内存里）不能因为再读一次就没了
    const seen = new Set();
    const merged = [];
    for (const r of readLog.concat(disk)) {
      const k = (r.t || 0) + '|' + (r.kind || '') + '|' + (r.why || '');
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(r);
    }
    merged.sort((a, b) => (a.t || 0) - (b.t || 0));
    readLog = merged.slice(-LOG_MAX);
  }

  function saveLog() {
    try {
      host.localStorage.setItem(LOG_KEY, JSON.stringify({
        v: LOG_VER, cid: currentChatId(), version: VERSION, rows: readLog.slice(-LOG_MAX),
      }));
    } catch (e) { /* 存不下就算了，内存里还有 */ }
  }

  /** kind: read 读取 / err 出错 / note 说明 */
  function logPush(kind, info) {
    const row = Object.assign({ t: Date.now(), kind }, info);
    // 反复开关面板会连记几条一模一样：同因同果、5 秒内就合并成一条，
    // 只把时间往前推。数据真的变了（数量不同）不会被合并。
    const last = readLog[readLog.length - 1];
    if (kind === 'read' && last && last.kind === 'read' && last.why === row.why
      && last.src === row.src && last.dom === row.dom && last.bld === row.bld
      && last.msgs === row.msgs && Math.abs(row.t - last.t) < 5000) {
      last.t = row.t;
      last.note = row.note;
      saveLog();
      return last;
    }
    readLog.push(row);
    if (readLog.length > LOG_MAX) readLog.splice(0, readLog.length - LOG_MAX);
    saveLog();
    return row;
  }

  function clearLog() { readLog = []; saveLog(); }

  let lastStateIdx = -1;

  function resolveState(quiet) {
    // quiet=true 时只取状态，不改「来源」那一行（指纹比对会每 1.2 秒调一次）
    const mark = (v) => { if (!quiet) lastStateSource = v; };
    // 逐级记下「试过什么、为什么没成」，读不到数据时这就是排错线索
    if (!quiet) lastTrace = [];
    const tr = (v) => { if (!quiet && lastTrace.length < 12) lastTrace.push(v); };

    // ① 消息变量：MVU 真正存放 stat_data 的地方，最权威
    const ms = messageState();
    if (ms && hasAssets(ms.state)) {
      mark('消息变量');
      lastStateIdx = ms.idx;
      tr('消息变量 #' + (ms.idx + 1) + ' 命中');
      saveSnapshot(ms.state, '消息变量');
      return ms.state;
    }
    tr(ms ? '消息变量 #' + (ms.idx + 1) + ' 有 stat_data 但无领地' : '消息变量 无 stat_data');

    // ② 聊天变量（部分整合包会同步一份到这里）
    const fromVars = findStatDataInVars();
    if (hasAssets(fromVars)) {
      mark('聊天变量');
      lastStateIdx = getMessages().length - 1;
      tr('聊天变量 命中');
      saveSnapshot(fromVars, '聊天变量');
      return fromVars;
    }
    tr('聊天变量 无');

    // ②·5 TavernHelper 的消息变量接口（部分版本才有）
    const thState = thMessageState();
    if (hasAssets(thState)) {
      mark('消息变量');
      lastStateIdx = getMessages().length - 1;
      tr('TH 接口 命中（来源记为消息变量）');
      saveSnapshot(thState, '消息变量');
      return thState;
    }
    tr('TH 接口 无');

    // ③ 历史补丁重放：老存档、消息变量被清掉时的兜底
    const msgs = getMessages();
    if (msgs.length) {
      const fromReplay = replayStateCached(msgs);
      if (hasAssets(fromReplay)) {
        mark('历史补丁');
        lastStateIdx = msgs.length - 1;
        tr('历史补丁 ' + msgs.length + ' 楼重放 命中');
        saveSnapshot(fromReplay, '历史补丁');
        return fromReplay;
      }
      tr('历史补丁 ' + msgs.length + ' 楼重放 未还原出领地');
    } else {
      tr('历史补丁 无消息可重放');
    }

    // ④ 存档快照：删过消息、重新生成过、或者上下文被裁掉了，
    //    前面几层都拿不到时，用它保住六项指标和金库
    const snap = loadSnapshot();
    if (snap && hasAssets(snap.stat)) {
      mark('存档快照');
      lastStateIdx = getMessages().length - 1;
      tr('存档快照 命中' + (snap.savedAt ? '（' + String(snap.savedAt).slice(5, 16).replace('T', ' ') + '）' : ''));
      return snap.stat;
    }
    tr('存档快照 无');

    mark(ms ? '消息变量（无资产）' : (fromVars ? '变量（无资产）' : '无'));
    lastStateIdx = ms ? ms.idx : -1;
    return fromVars || (ms && ms.state) || null;
  }

  /* ------------------------------------------------------- 建筑档案库 */
  /** 变量是活的，存档是死的：AI 漏写一次、变量重置一次，建筑就整批消失。
   *  所以每座建筑都在聊天变量里留一份指纹与流水，缺了就补回来并标记「档案」。 */
  const STORE_KEY = '_fiefLedgerBuildings';
  const STORE_VER = 1;
  const STORE_LS = 'fief-ledger-store-';

  function blankStore() { return { v: STORE_VER, chatId: '', savedAt: '', domains: {} }; }

  function normalizeStore(raw) {
    if (!raw || typeof raw !== 'object' || !raw.domains || typeof raw.domains !== 'object') return null;
    const out = blankStore();
    out.chatId = typeof raw.chatId === 'string' ? raw.chatId : '';
    out.savedAt = typeof raw.savedAt === 'string' ? raw.savedAt : '';
    for (const dn of Object.keys(raw.domains)) {
      const d = raw.domains[dn];
      if (!d || typeof d !== 'object') continue;
      const nd = {
        name: dn,
        meta: d.meta && typeof d.meta === 'object' ? d.meta : {},
        firstSeen: Number(d.firstSeen) || 0,
        lastSeen: Number(d.lastSeen) || 0,
        items: {},
      };
      const items = d.items && typeof d.items === 'object' ? d.items : {};
      for (const bn of Object.keys(items)) {
        const it = items[bn];
        if (!it || typeof it !== 'object') continue;
        nd.items[bn] = Object.assign({}, it, { name: bn, log: Array.isArray(it.log) ? it.log.slice(-40) : [] });
      }
      out.domains[dn] = nd;
    }
    return out;
  }

  let storeCache = null;
  let storeSavedSig = '';
  let muteHooks = false;   // 写档案库时不触发自己的检测通道

  function loadStore() {
    const cid = currentChatId();
    if (storeCache && storeCache.chatId === cid) return storeCache;
    let raw = null;
    const vars = readChatVars();
    if (vars && vars[STORE_KEY]) raw = vars[STORE_KEY];
    if (!raw) {
      try { const s = host.localStorage.getItem(STORE_LS + cid); if (s) raw = JSON.parse(s); } catch (e) { /* 忽略 */ }
    }
    const st = normalizeStore(raw);
    storeCache = (st && st.chatId && st.chatId !== cid) ? blankStore() : (st || blankStore());
    storeCache.chatId = cid;
    return storeCache;
  }

  function storeSig(store) {
    const parts = [];
    for (const dn of Object.keys(store.domains).sort()) {
      const d = store.domains[dn];
      for (const bn of Object.keys(d.items).sort()) {
        const it = d.items[bn];
        parts.push([dn, bn, it.status, it.quality, it.quantity, it.missing ? 1 : 0, it.fp].join('|'));
      }
    }
    return parts.join('||');
  }

  function saveStore(store, force) {
    if (!store) return false;
    store.chatId = currentChatId();
    const sig = storeSig(store);
    if (!force && sig === storeSavedSig) return true;
    store.savedAt = new Date().toISOString();
    let ok = false;
    muteHooks = true;
    try { ok = writeChatVars({ [STORE_KEY]: store }); } catch (e) { ok = false; }
    finally { muteHooks = false; }
    if (!ok) {
      try { host.localStorage.setItem(STORE_LS + currentChatId(), JSON.stringify(store)); ok = true; } catch (e) { /* 忽略 */ }
    }
    if (ok) storeSavedSig = sig;
    return ok;
  }

  function itemFp(it) {
    return [it.category, it.status, it.quality, it.quantity, it.location, it.mode, it.output, it.space, (it.effects || []).length].join('~');
  }

  function snapshotItem(it) {
    return {
      name: it.name,
      category: it.category, status: it.status, quality: it.quality, quantity: it.quantity,
      location: it.location, mode: it.mode, output: it.output, space: it.space,
      effects: (it.effects || []).map((e) => ({ k: e.k, v: e.v })),
      desc: it.desc,
    };
  }

  function diffItem(rec, it) {
    const now = snapshotItem(it);
    const out = [];
    if (rec.status !== now.status) out.push('状态 ' + (rec.status || '—') + ' → ' + now.status);
    if (rec.quality && now.quality && rec.quality !== now.quality) out.push('品质 ' + rec.quality + ' → ' + now.quality);
    if (rec.quantity !== now.quantity) out.push('数量 ' + rec.quantity + ' → ' + now.quantity);
    if (rec.category !== now.category) out.push('类型 ' + rec.category + ' → ' + now.category);
    if (rec.output !== now.output) out.push(now.output ? ('产出 → ' + now.output) : '产出清空');
    return out;
  }

  /** 档案库里的记录 → 展示用条目（变量里没有的，就从这里补） */
  function storeItemView(dn, it, archived, missing) {
    return {
      name: it.name, domain: dn,
      category: it.category || '其他',
      status: it.status || '未知',
      location: it.location || '未分区',
      quality: it.quality || '',
      mode: it.mode || '',
      quantity: it.quantity || '',
      quant: it.output || '',
      output: it.output || '',
      effects: it.effects || [],
      space: it.space || '',
      cost: '', span: '', brief: '',
      desc: it.desc || '',
      events: (it.log || []).slice(-8).map((l) => ({ idx: l.idx, kind: l.kind, text: l.text })),
      firstSeen: it.firstSeen, archived: !!archived, missing: missing == null ? !!it.missing : missing,
    };
  }

  /** 活数据合进档案库：新建筑建档、变动记流水、消失的标 missing 而不是删掉 */
  function mergeStore(domains, msgIdx) {
    const store = loadStore();
    let touched = false;
    const liveNames = new Set();

    for (const d of domains) {
      if (d.fromBlock || !d.items.length) continue;
      liveNames.add(d.name);
      let sd = store.domains[d.name];
      if (!sd) {
        sd = { name: d.name, meta: {}, items: {}, firstSeen: msgIdx, lastSeen: msgIdx };
        store.domains[d.name] = sd;
        touched = true;
      }
      if (sd.lastSeen !== msgIdx) { sd.lastSeen = msgIdx; touched = true; }
      const meta = Object.assign({}, d.meta || {});
      if (JSON.stringify(meta) !== JSON.stringify(sd.meta)) { sd.meta = meta; touched = true; }

      const live = new Set();
      for (const it of d.items) {
        live.add(it.name);
        const fp = itemFp(it);
        const rec = sd.items[it.name];
        if (!rec) {
          sd.items[it.name] = Object.assign({}, snapshotItem(it), {
            firstSeen: msgIdx, lastSeen: msgIdx, fp, missing: false,
            log: [{ idx: msgIdx, kind: 'add', text: '建档' }],
          });
          touched = true;
        } else {
          rec.lastSeen = msgIdx;
          const diff = diffItem(rec, it);
          if (diff.length) {
            rec.log = (rec.log || []).concat(diff.map((t) => ({ idx: msgIdx, kind: 'change', text: t }))).slice(-40);
            touched = true;
          }
          if (diff.length || rec.fp !== fp) {
            Object.assign(rec, snapshotItem(it), { fp });
            touched = true;
          }
          if (rec.missing) { rec.missing = false; rec.missingAt = null; touched = true; }
        }
        const fresh = sd.items[it.name];
        it.name = it.name || fresh.name;
        it.firstSeen = fresh.firstSeen;
        it.archived = false;
        it.missing = false;
      }
      for (const bn of Object.keys(sd.items)) {
        if (live.has(bn)) continue;
        const rec = sd.items[bn];
        if (!rec.missing) { rec.missing = true; rec.missingAt = msgIdx; touched = true; }
        // 仍然展示，只是打上「档案」标记：AI 少写一座，不该让这座建筑凭空消失
        d.items.push(storeItemView(d.name, rec, true, true));
      }
    }

    return { store, touched, liveNames };
  }

  /** 变量整批丢了也能把领地读出来：从档案库复原 */
  function restoreFromStore(store, liveNames, blocks) {
    const out = [];
    for (const dn of Object.keys(store.domains)) {
      if (liveNames.has(dn)) continue;
      const sd = store.domains[dn];
      const items = Object.keys(sd.items).map((bn) => storeItemView(dn, sd.items[bn], true));
      out.push({ name: dn, items, info: blocks[dn] || null, meta: sd.meta || {}, fromStore: true });
    }
    return out;
  }

  /* --------------------------------------------------------- 状态快照 */
  /** 「隐藏」消息不影响读取：读的是完整 ctx.chat，隐藏只是打标记，消息和它的
   *  variables 都还在。真正会掉数据的是「删除消息」和「重新生成」——那会把
   *  那一条上的 stat_data 一起抹掉。所以留一份最近一次解析成功的整体快照。 */
  const SNAP_KEY = '_fiefLedgerSnapshot';
  const SNAP_VER = 1;
  const SNAP_LS = 'fief-ledger-snap-';
  let snapCache = null;
  let snapHashSaved = '';

  function snapHash(s) {
    const str = JSON.stringify(s || null);
    let h = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return str.length + ':' + (h >>> 0);
  }

  function loadSnapshot() {
    const cid = currentChatId();
    if (snapCache && snapCache.chatId === cid) return snapCache;
    let raw = null;
    const vars = readChatVars();
    if (vars && vars[SNAP_KEY]) raw = vars[SNAP_KEY];
    if (!raw) {
      try { const s = host.localStorage.getItem(SNAP_LS + cid); if (s) raw = JSON.parse(s); } catch (e) { /* 忽略 */ }
    }
    if (!raw || typeof raw !== 'object' || !raw.stat || typeof raw.stat !== 'object') { snapCache = null; return null; }
    if (raw.chatId && raw.chatId !== cid) { snapCache = null; return null; }
    snapCache = raw;
    return raw;
  }

  function saveSnapshot(stat, source) {
    if (!stat || !hasAssets(stat)) return;
    const h = snapHash(stat);
    if (h === snapHashSaved) return;
    const rec = {
      v: SNAP_VER,
      chatId: currentChatId(),
      savedAt: new Date().toISOString(),
      source: source || '',
      stat,
    };
    let ok = false;
    const wasMute = muteHooks;
    muteHooks = true;
    try { ok = writeChatVars({ [SNAP_KEY]: rec }); } catch (e) { ok = false; }
    finally { muteHooks = wasMute; }
    if (!ok) {
      try { host.localStorage.setItem(SNAP_LS + currentChatId(), JSON.stringify(rec)); ok = true; } catch (e) { /* 忽略 */ }
    }
    if (ok) { snapHashSaved = h; snapCache = rec; }
  }

  /* ---------------------------------------------------------- 台账组装 */
  const CATEGORIES = ['防务', '经济', '民生', '军事', '资源点'];

  function statusOf(item) { return parseTags(tagsText(item.标签)).状态 || String(item.状态 || '未知'); }

  function categoryOf(key, item) {
    const t = String(item.类型 || parseTags(tagsText(item.标签)).类型 || '');
    // 存档里「军政」与「军事」混用，先归一，再认五类
    if (/军事|军政|军务/.test(t)) return '军事';
    if (/民政|民生/.test(t)) return '民生';
    if (/防务|防御|城防/.test(t)) return '防务';
    if (/资源点|物产|矿|林场|渔场/.test(t)) return '资源点';
    for (const c of CATEGORIES) if (t.indexOf(c) >= 0) return c;
    return t || '其他';
  }

  function locationOf(item) { return parseTags(tagsText(item.标签)).位置 || String(item.位置 || '未分区'); }

  function quantOf(item) {
    const text = effectText(item.效果);
    const m = text.match(/产出\s*[:：]\s*([^\n]+)/);
    if (m) return m[1].trim();
    return text.split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
  }

  function collectDomains(stat) {
    const out = [];
    if (!stat || !stat.主角 || !stat.主角.资产) return out;
    const assets = stat.主角.资产;
    if (typeof assets !== 'object') return out;
    for (const name of Object.keys(assets)) {
      const a = assets[name];
      if (!a || typeof a !== 'object') continue;
      const typeText = String(a.类型 == null ? (parseTags(tagsText(a.标签)).类型 || '') : a.类型);
      if (!/^领地/.test(typeText)) continue;
      out.push({ name, asset: a });
    }
    return out;
  }

  /* ------------------------------------------- 七档阶梯与指标归一 */
  /**
   * 照抄世界书「二、七档规模阶梯」，slots 应与 6/10/18/30/45/60+/90+ 对齐。
   * alias 用于从文本里认档位；**长词必须优先命中**，所以 tierOf 从高档往低档扫，
   * 且低档别名不能是高档别名的子串。
   * 第七档不再收「帝国」——第六档叫「小国或帝国行省」，收「帝国」会把行省误判成大国。
   */
  const TIERS = [
    { n: 1, name: '村庄', value: '400万–1500万Z', slot: 6, base: '+2万Z/月', lv: '第二层级 Lv.5–8', alias: ['村庄', '村落', '村子'] },
    { n: 2, name: '小型村镇', value: '5亿–10亿Z', slot: 10, base: '+60万Z/月', lv: '第三层级 Lv.9–12', alias: ['小型村镇', '村镇', '乡镇', '集镇'] },
    { n: 3, name: '中型城镇', value: '60亿–100亿Z', slot: 18, base: '+400万Z/月', lv: '第三层级 Lv.9–12', alias: ['中型城镇', '城镇'] },
    { n: 4, name: '大型城市', value: '400亿–800亿Z', slot: 30, base: '+2500万Z/月', lv: '第四层级 Lv.13–16', alias: ['大型城市', '城市'] },
    { n: 5, name: '超级城市', value: '3000亿Z+', slot: 45, base: '+1.5亿Z/月', lv: '第四层级 Lv.13–16', alias: ['超级城市', '超大城市'] },
    { n: 6, name: '小国或帝国行省', value: '2万亿–3万亿Z', slot: 60, base: '+10亿Z/月', lv: '第五层级 Lv.17–20', alias: ['小国或帝国行省', '帝国行省', '行省', '小国'] },
    { n: 7, name: '大国', value: '10万亿–12万亿Z', slot: 90, base: '+60亿Z/月', lv: '第六层级 Lv.21–24', alias: ['大国', '帝国本土', '帝国全境'] },
  ];

  function tierOf(txt) {
    const s = String(txt || '').trim();
    if (!s) return null;
    for (let i = TIERS.length - 1; i >= 0; i -= 1) {
      for (const a of TIERS[i].alias) if (s.indexOf(a) >= 0) return TIERS[i];
    }
    return null;
  }

  /**
   * 别名冲突自检：高档位的别名不能出现在低档位别名里，否则永远命中不高档。
   * 例：第七档曾收「帝国」，而第六档叫「小国或帝国行省」——行省会先命中第七档。
   * 返回冲突对，空数组＝干净。
   */
  function aliasConflicts() {
    const out = [];
    for (let hi = TIERS.length - 1; hi >= 0; hi -= 1) {
      for (const a of TIERS[hi].alias) {
        for (let lo = 0; lo < hi; lo += 1) {
          for (const b of TIERS[lo].alias) {
            if (b !== a && b.indexOf(a) >= 0) {
              out.push({ shadow: a, tier: TIERS[hi].name, swallowed: b, owner: TIERS[lo].name });
            }
          }
        }
      }
    }
    return out;
  }

  /**
   * 档位表与世界书的一致性自检。
   * TIERS 是照着世界书「二、七档规模阶梯」抄下来的常量；抄错或世界书改版，
   * 这里会指出来——省得面板悄悄显示一份过期数据。
   * 只比对世界书里出现的档名，不做数字反推。
   */
  function tierAudit(msgs) {
    let text = '';
    for (let i = (msgs || []).length - 1; i >= 0 && text.length < 40000; i -= 1) {
      text += mesText(msgs[i]);
    }
    const names = TIERS.map((t) => t.name);
    const found = [];
    for (const t of TIERS) {
      if (text.indexOf(t.name) >= 0) found.push(t.name);
    }
    // 世界书名。若是「小国或帝国行省」出现在文本里，第六档就算对上了
    const order = found
      .map((n) => names.indexOf(n))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    const inOrder = order.every((v, i) => i === 0 || v > order[i - 1]);
    return {
      total: TIERS.length,
      matched: found.length,
      matchedNames: found,
      inOrder,
      // 脚本的槽位序列，世界书里是 6/10/18/30/45/60+/90+
      slots: TIERS.map((t) => t.slot),
    };
  }

  /**
   * 词与数字都认：安稳 / 尚可 / 72。
   * 词表取自世界书「六大核心指标」的定性梯度，只用于画进度条的相对位置，
   * 不写进任何记录、不当收益系数（世界书：三、六项是治理状态，不是战斗属性）。
   * 顺序即梯度：从好到坏，越长越先匹配。
   */
  const WORD_SCORE = [
    [['极佳', '太平', '繁荣', '安定', '安稳', '安宁'], 86],
    [['良好', '不错', '尚可', '平稳', '稳定'], 68],
    [['浮动', '一般', '普通', '平常', '波动', '波动中'], 48],
    [['不稳', '动荡', '吃紧', '紧张', '低迷'], 34],
    [['混乱', '危急', '崩溃', '叛乱', '民变'], 18],
  ];

  /** 物资四档独立成表：世界书写死只有 充盈/充足/告急/绝粮，不与治安民心共用词表 */
  const STOCK_LEVELS = ['充盈', '充足', '告急', '绝粮'];

  function scoreOf(v) {
    const n = numberOf(v);
    if (n != null && n > 0 && n <= 100) return Math.round(n);
    const s = String(v || '');
    for (const [words, score] of WORD_SCORE) {
      for (const w of words) if (s.indexOf(w) >= 0) return score;
    }
    return null;
  }

  /**
   * 物资只有四档：充盈/充足/告急/绝粮（世界书「3 物资」）。
   * 顺序从差到好地判，避免「充足」被「充」抢先命中。
   */
  function stockLevel(v) {
    const s = String(v || '').trim();
    if (!s) return { i: 0, name: '—' };
    if (s.indexOf('绝') >= 0) return { i: 1, name: '绝粮' };
    if (s.indexOf('告急') >= 0) return { i: 2, name: '告急' };
    if (s.indexOf('充足') >= 0) return { i: 3, name: '充足' };
    if (s.indexOf('充') >= 0 || s.indexOf('满') >= 0) return { i: 4, name: '充盈' };
    if (s.indexOf('紧') >= 0) return { i: 2, name: '告急' };
    return { i: 3, name: '充足' };
  }

  /** 物资可能写成四档词，也可能写成 50 这样的数字——都归到四档 */
  function stockOf(v) {
    const base = stockLevel(v);
    const n = numberOf(v);
    if (n == null || String(v).length > 4 && String(v).indexOf('充') >= 0) return base;
    return {
      i: n >= 75 ? 4 : n >= 45 ? 3 : n >= 20 ? 2 : 1,
      name: n >= 75 ? '充盈' : n >= 45 ? '充足' : n >= 20 ? '告急' : '绝粮',
      num: n,
    };
  }

  /** 资产上的治理行、结算字段，与 <fief_domain> 区块合并：谁有值用谁 */
  function mergedGov(asset, block) {
    const g = parseGovernance(asset || {});
    const b = block || {};
    const pick = (a, c) => (a !== '' && a != null ? a : (c == null ? '' : c));
    const vault = b.金库 ? moneyOf(b.金库) : null;
    const net = b.月净额 ? moneyOf(b.月净额) : null;
    return {
      治安: pick(g.治安, b.治安),
      民心: pick(g.民心, b.民心),
      物资: pick(g.物资, b.物资),
      人口: pick(g.人口, b.人口),
      商路: pick(g.商路, b.商路),
      金库: g.金库 != null ? g.金库 : (vault ? vault.n : null),
      货币: g.货币 || (vault ? vault.unit : '') || b.货币 || '',
      月净额: g.月净额 != null ? g.月净额 : (net ? net.n : null),
      结算日: g.结算日 || '',
      估值: g.估值,
      总空间: g.总空间 || 0,
      空闲: g.空闲 || 0,
      描述正文: g.描述正文,
      治理模式: b.治理模式 || '',
      状态: b.状态 || '',
    };
  }

  function buildLedger() {
    const stat = resolveState();
    const msgs = getMessages();
    const history = buildHistory(msgs);
    const buildInfo = buildInfoAll();
    const blocks = latestDomainBlocks(msgs);
    const reports = latestReports(msgs);
    const plans = latestPlans(msgs);
    const msgIdx = lastStateIdx >= 0 ? lastStateIdx : Math.max(0, msgs.length - 1);

    const out = collectDomains(stat).map((d) => {
      const items = normalizeInner(d.asset.内部资产).map(({ key, item }) => {
        const info = buildInfo[key] || {};
        const tags = parseTags(tagsText(item.标签));
        const effects = effectLinesOf(item);
        const outLine = effects.find((e) => /^产出|^产量/.test(e.k));
        return {
          name: key, domain: d.name,
          category: categoryOf(key, item),
          status: statusOf(item),
          location: locationOf(item),
          quality: String(item.品质 || tags.品质 || ''),
          mode: String(tags.模式 || ''),
          quantity: item.数量 == null ? '' : String(item.数量),
          quant: quantOf(item),
          output: outLine ? outLine.v : '',
          effects,
          space: String(item.总占用空间 || item.总空间 || ''),
          cost: info.估价 || '', span: info.工期 || '', brief: info.说明 || '',
          events: (history.byName[key] || []).slice(-8),
          desc: String(item.描述 || ''),
        };
      });
      const block = blocks[d.name] || null;
      const meta = parseDomainMeta(d.asset);
      return {
        name: d.name, items, info: block,
        report: reports.byDomain[d.name] || null,
        gov: mergedGov(d.asset, block), meta,
        tier: tierOf(meta.规模档 || (block && block.规模档)),
      };
    });

    const known = new Set(out.map((d) => d.name));
    let fromBlocksOnly = 0;
    for (const name of Object.keys(blocks)) {
      if (known.has(name)) continue;
      const block = blocks[name];
      out.push({
        name, items: [], info: block, fromBlock: true,
        report: reports.byDomain[name] || null,
        gov: mergedGov(null, block),
        meta: { 规模档: block.规模档, 势力: block.所属势力, 拥有者: '', 治理模式: block.治理模式, 领地状态: block.状态 },
        tier: tierOf(block.规模档),
      });
      fromBlocksOnly += 1;
    }
    if (fromBlocksOnly && !out.some((d) => d.items.length)) lastStateSource = '总览区块';

    // 档案库：活数据合进去，再把变量里已经消失的领地/建筑补回来
    const merged = mergeStore(out, msgIdx);
    const restored = restoreFromStore(merged.store, merged.liveNames, blocks);
    if (restored.length) {
      out.push(...restored);
      if (!out.some((d) => d.items.length && !d.fromStore)) lastStateSource = '档案库';
    }

    // 有过 remove 补丁的，不是「丢了」而是「拆了」——分开标，别误导人
    const removedNames = new Set();
    for (const n of Object.keys(history.byName)) {
      if (history.byName[n].some((e) => e.kind === 'remove')) removedNames.add(n);
    }
    for (const d of out) {
      if (!d.gov) d.gov = mergedGov(null, d.info);
      if (!d.tier) d.tier = tierOf(d.meta && d.meta.规模档);
      for (const it of d.items) if (it.missing) it.removed = removedNames.has(it.name);
    }

    // 整份状态是从快照恢复的：建筑要标出来，别让人以为是这一轮刚读到的
    const fromSnapshot = lastStateSource === '存档快照';
    if (fromSnapshot) {
      for (const d of out) {
        for (const it of d.items) {
          if (!it.fromStore) { it.fromSnapshot = true; it.archived = true; }
        }
      }
    }

    return {
      domains: out,
      plans: plans,
      reports: reports,
      patchCount: history.count,
      msgCount: msgs.length,
      hasStat: !!stat || out.length > 0,
      store: merged.store,
      storeTouched: merged.touched,
      stateIdx: msgIdx,
    };
  }

  /* ---------------------------------------------------------- 批注 */
  const NOTES_KEY = '_fiefLedgerNotes';

  function readNotes() {
    const vars = readChatVars();
    return vars && vars[NOTES_KEY] && typeof vars[NOTES_KEY] === 'object' ? vars[NOTES_KEY] : {};
  }

  function writeNote(key, text) {
    const notes = readNotes();
    if (text) notes[key] = text; else delete notes[key];
    const ok = writeChatVars({ [NOTES_KEY]: notes });
    if (!ok) { try { host.localStorage.setItem('fief-ledger-notes-' + currentChatId(), JSON.stringify(notes)); } catch (e) { /* 忽略 */ } }
    return ok;
  }

  function readNotesFallback() {
    if (readChatVars()) return readNotes();
    try { const raw = host.localStorage.getItem('fief-ledger-notes-' + currentChatId()); if (raw) return JSON.parse(raw); } catch (e) { /* 忽略 */ }
    return {};
  }

  /* ============================================================== 样式 */
  const CSS = `
  #fief-ledger-root {
    /* 主题色：accent 是主色，accent-rgb 是它的三通道，供半透明叠色复用。
       换主题时这两个由 applyAccent() 一起写内联，下面所有 rgba() 会跟着变。 */
    --fl-accent: #d4af5a;
    --fl-accent-rgb: 212,175,90;
    --fl-bg: #0e0c07;
    --fl-bg2: #12100a;
    --fl-surface: #17140e;
    --fl-surface2: #1d1912;
    --fl-line: rgba(var(--fl-accent-rgb),0.13);
    --fl-line2: rgba(var(--fl-accent-rgb),0.26);
    /* 文字三通道同理：冷色主题下正文带一点同调的冷白，不刺眼也不脏 */
    --fl-text: #ece2cc;
    --fl-text-rgb: 236,226,204;
    /* 标题/数字用的高亮白，比正文再亮一档，换主题时带一点主色调 */
    --fl-bright: #f6eed8;
    --fl-dim: rgba(var(--fl-text-rgb),0.56);
    --fl-dimmer: rgba(var(--fl-text-rgb),0.30);
    /* 悬浮星标的球面渐变，按主色推出来，冷色主题不会留一颗金棕色球 */
    --fl-star1: #57482f;
    --fl-star2: #2c2318;
    --fl-star3: #171208;
    --fl-star4: #0c0a06;
    /* 纹章的三段渐变也由主色推，否则换了冷色主题，头图还是块金牌 */
    --fl-crest1: #e0c588;
    --fl-crest2: #c7a453;
    --fl-crest3: #8c733c;
    --fl-ok: #8fbf7a;
    --fl-warn: #dcbe6a;
    --fl-bad: #d47f6c;
    --fl-plan: #8fa9cf;
    --fl-serif: "Noto Serif SC", "Songti SC", "Source Han Serif SC", "STSong", serif;
    --fl-num: "Optima", "Palatino Linotype", "Georgia", serif;
    /* 独立全屏层：不继承酒馆楼层的层叠上下文，避免被正文压住 */
    position: fixed; inset: 0; z-index: 2147483000;
    pointer-events: none;
    isolation: isolate;
  }

  /* ================= 悬浮星 ================= */
  #fief-ledger-star {
    position: fixed; right: 18px; top: 32%;
    width: 58px; height: 58px; padding: 0; border: 0;
    display: flex; align-items: center; justify-content: center;
    z-index: 99998; cursor: grab; border-radius: 50%;
    background: radial-gradient(circle at 32% 26%, var(--fl-star1) 0%, var(--fl-star2) 42%, var(--fl-star3) 76%, var(--fl-star4) 100%);
    box-shadow:
      0 12px 34px rgba(0,0,0,0.74), 0 2px 8px rgba(0,0,0,0.55),
      inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -3px 8px rgba(0,0,0,0.62),
      0 0 0 1px rgba(var(--fl-accent-rgb),0.5), 0 0 20px rgba(var(--fl-accent-rgb),0.14);
    transition: transform .18s cubic-bezier(.3,1.4,.5,1), box-shadow .22s ease;
    touch-action: none; user-select: none; -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    pointer-events: auto;
  }
  #fief-ledger-star::after {
    content: ""; position: absolute; inset: 5px; border-radius: 50%;
    border: 1px solid rgba(var(--fl-accent-rgb),0.14); pointer-events: none;
  }
  #fief-ledger-star:hover {
    transform: translateY(-1px) scale(1.05);
    box-shadow: 0 16px 40px rgba(0,0,0,0.80), 0 2px 8px rgba(0,0,0,0.55),
      inset 0 1px 0 rgba(255,255,255,0.20), inset 0 -3px 8px rgba(0,0,0,0.62),
      0 0 0 1px var(--fl-accent), 0 0 30px rgba(var(--fl-accent-rgb),0.44);
  }
  #fief-ledger-star.fl-dragging { cursor: grabbing; transition: none; }
  #fief-ledger-star.fl-flash { animation: fl-flash 1s ease-out; }
  @keyframes fl-flash {
    0%   { box-shadow: 0 12px 34px rgba(0,0,0,.74), 0 0 0 1px var(--fl-accent), 0 0 52px 6px rgba(var(--fl-accent-rgb),.8); }
    100% { box-shadow: 0 12px 34px rgba(0,0,0,.74), 0 0 0 1px rgba(var(--fl-accent-rgb),.5), 0 0 20px rgba(var(--fl-accent-rgb),.14); }
  }
  #fief-ledger-star svg {
    width: 34px; height: 34px; display: block; pointer-events: none;
    filter: drop-shadow(0 2px 3px rgba(0,0,0,0.85)) drop-shadow(0 0 6px rgba(var(--fl-accent-rgb),0.26));
  }
  #fief-ledger-star .fl-star-face { fill: var(--fl-accent); }
  #fief-ledger-star .fl-star-edge { fill: none; stroke: rgba(0,0,0,0.62); stroke-width: 1.6; stroke-linejoin: round; }
  #fief-ledger-star .fl-star-hi { fill: rgba(255,255,255,0.32); }
  #fief-ledger-star.fl-dim .fl-star-face { fill: rgba(var(--fl-accent-rgb),0.28); }
  #fief-ledger-star .fl-badge {
    position: absolute; top: -5px; right: -5px; min-width: 20px; height: 20px; padding: 0 5px;
    border-radius: 10px; background: var(--fl-accent); color: rgba(0,0,0,0.82);
    font: 700 11px/20px system-ui, sans-serif; text-align: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.7), 0 0 0 1.5px rgba(12,10,6,0.9);
    display: none; pointer-events: none;
  }
  #fief-ledger-star .fl-badge.on { display: block; }

  /* ================= 全屏 ================= */
  #fief-ledger-screen {
    position: fixed; inset: 0; z-index: 99999; display: none;
    flex-direction: column;
    /* 纯色打底：变量万一失效也不会透出聊天正文 */
    background-color: var(--fl-bg);
    background-image:
      radial-gradient(1100px 520px at 12% -8%, rgba(var(--fl-accent-rgb),0.075), transparent 62%),
      radial-gradient(880px 460px at 104% 4%, rgba(122,96,180,0.045), transparent 60%);
    font-family: var(--fl-serif);
    color: var(--fl-text); -webkit-font-smoothing: antialiased;
    opacity: 0; transform: scale(.995);
    transition: opacity .2s ease, transform .2s ease;
    width: 100%; height: 100%;
    overflow: hidden;
    pointer-events: auto;
    isolation: isolate;
  }
  #fief-ledger-screen.on { display: flex; pointer-events: auto; }
  #fief-ledger-screen.vis { opacity: 1; transform: none; }

  /* ---- 顶栏 ---- */
  .fl-top {
    flex: none; display: flex; align-items: center; gap: 18px;
    padding: 12px 26px; background: var(--fl-bg2);
    border-bottom: 1px solid var(--fl-line);
  }
  .fl-brand { display: flex; align-items: baseline; gap: 10px; }
  .fl-brand b {
    font-size: 16px; letter-spacing: 6px; color: var(--fl-accent); font-weight: 700;
    text-shadow: 0 0 22px rgba(var(--fl-accent-rgb),0.28);
  }
  .fl-brand em {
    font-style: normal; font-size: 9px; letter-spacing: 2.2px;
    color: var(--fl-dimmer); text-transform: uppercase;
  }
  .fl-domsel { display: flex; gap: 6px; margin-left: 6px; flex-wrap: wrap; }
  .fl-domchip {
    cursor: pointer; font-size: 11.5px; letter-spacing: .8px; padding: 4px 10px;
    border-radius: 2px; color: var(--fl-dimmer); border: 1px solid transparent;
    transition: all .15s ease;
  }
  .fl-domchip:hover { color: var(--fl-text); border-color: var(--fl-line); }
  .fl-domchip.on { color: var(--fl-accent); border-color: var(--fl-line2); background: rgba(var(--fl-accent-rgb),0.08); }
  .fl-top-r { margin-left: auto; display: flex; align-items: center; gap: 10px; }
  .fl-btn {
    cursor: pointer; border: 1px solid var(--fl-line2); background: rgba(var(--fl-accent-rgb),0.07);
    color: var(--fl-bright); font: inherit; font-size: 12px; letter-spacing: 1.4px;
    padding: 6px 13px; border-radius: 2px; transition: all .16s ease;
  }
  .fl-btn:hover { background: rgba(var(--fl-accent-rgb),0.18); border-color: var(--fl-accent); }
  .fl-btn:active { transform: translateY(1px); }
  .fl-btn.ghost { background: transparent; border-color: var(--fl-line); color: var(--fl-dim); }
  .fl-btn.ghost:hover { color: #fff; border-color: var(--fl-line2); }
  .fl-switch {
    display: flex; align-items: center; gap: 6px; font-size: 11.5px;
    color: var(--fl-dim); cursor: pointer; user-select: none; letter-spacing: .6px;
  }
  .fl-switch input { accent-color: var(--fl-accent); width: 13px; height: 13px; cursor: pointer; }

  /* 设置不再是一层浮窗：它就是底部导航里的一页，和 .fl-view 抢同一个 flex 位置。
     这样切页时只有一块内容在滚，不会出现「浮层下面还压着正文」的老问题。 */
  .fl-settings {
    flex: 1; min-height: 0; display: none;
    flex-direction: column; background: var(--fl-bg);
    pointer-events: auto;
  }
  .fl-settings.on { display: flex; }
  @keyframes fl-set-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: none; }
  }
  .fl-set-top {
    display: flex; align-items: center; gap: 14px;
    padding: 9px 16px; border-bottom: 1px solid var(--fl-line);
    background: var(--fl-bg2); flex: none;
  }
  .fl-set-title {
    font-family: var(--fl-serif); font-size: 14px; letter-spacing: 5px;
    color: var(--fl-accent); flex: none;
  }
  .fl-set-tabs { display: flex; gap: 4px; overflow-x: auto; }
  .fl-set-tabs::-webkit-scrollbar { display: none; }
  .fl-set-tab {
    cursor: pointer; font-size: 12px; letter-spacing: 1.4px; padding: 5px 12px;
    color: var(--fl-dimmer); border: 1px solid transparent; border-radius: 2px;
    white-space: nowrap; transition: all .15s ease;
  }
  .fl-set-tab:hover { color: var(--fl-text); border-color: var(--fl-line); }
  .fl-set-tab.on { color: var(--fl-accent); border-color: var(--fl-line2); background: rgba(var(--fl-accent-rgb),0.10); }
  .fl-set-body { flex: 1; overflow-y: auto; padding: 18px 20px 40px; }
  .fl-pane { display: none; }
  .fl-pane.on { display: block; }

  .fl-sec { margin-bottom: 22px; }
  .fl-sec-h {
    display: flex; align-items: baseline; gap: 9px; margin-bottom: 10px;
    font-size: 11.5px; letter-spacing: 2.4px; color: var(--fl-dim);
  }
  .fl-sec-h em {
    font-style: normal; font-size: 10px; letter-spacing: .6px; color: var(--fl-dimmer);
  }
  .fl-sec-h span { flex: 1; height: 1px; background: var(--fl-line); }
  .fl-sec-note { font-size: 11px; line-height: 1.75; color: var(--fl-dimmer); margin-top: 9px; }

  /* ---- 读取日志：等宽小字，手机上靠长按选取 / 复制按钮 ---- */
  .fl-logbar { display: flex; gap: 8px; margin-bottom: 8px; }
  .fl-logbar .fl-btn { padding: 4px 11px; font-size: 11px; letter-spacing: .8px; }
  .fl-log {
    max-height: 300px; overflow-y: auto; padding: 2px;
    border: 1px solid var(--fl-line); border-radius: 2px;
    background: rgba(0,0,0,0.30);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    -webkit-overflow-scrolling: touch;
  }
  .fl-log-row {
    font-size: 10.5px; line-height: 1.6; padding: 4px 7px;
    color: var(--fl-dim); white-space: pre-wrap; word-break: break-word;
    border-bottom: 1px solid rgba(var(--fl-accent-rgb),0.07);
    user-select: text; -webkit-user-select: text;
  }
  .fl-log-row:last-child { border-bottom: 0; }
  .fl-log-row b { color: var(--fl-accent); font-weight: 600; }
  .fl-log-row i { color: var(--fl-bright); font-style: normal; }
  .fl-log-row u { color: var(--fl-text); text-decoration: none; }
  /* 回退链：比正文再淡一档，不抢数字 */
  .fl-log-row em {
    display: block; margin-top: 2px; font-style: normal;
    font-size: 10px; color: var(--fl-dimmer);
  }
  /* 数字那行要比回退链亮一点：先看数量对不对，再看是哪一层给的 */
  .fl-log-row em.fl-log-num { color: var(--fl-dim); margin-top: 1px; }
  /* 错误是语义色，不跟主题走 */
  .fl-log-row.err { color: #e8816f; border-bottom-color: rgba(232,129,111,0.22); }
  .fl-log-row.err b, .fl-log-row.err em { color: #e8816f; }
  .fl-log-empty { padding: 14px 8px; text-align: center; font-size: 11px; color: var(--fl-dimmer); }

  /* ---- 色板：预设与字体色共用 ---- */
  /* 宽屏别把色板摊成一条：限宽 + 最小列宽，名字才不会被省略成「琥…」 */
  .fl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 9px; max-width: 660px; }
  .fl-opt {
    position: relative; display: flex; align-items: center; gap: 8px;
    padding: 7px 9px; cursor: pointer; border-radius: 2px;
    border: 1px solid var(--fl-line); background: rgba(var(--fl-text-rgb),0.025);
    transition: all .15s ease; min-width: 0;
  }
  .fl-opt:hover { border-color: var(--fl-line2); background: rgba(var(--fl-accent-rgb),0.08); }
  .fl-opt.on { border-color: var(--fl-accent); background: rgba(var(--fl-accent-rgb),0.13); }
  .fl-opt u {
    text-decoration: none; font-size: 11.5px; letter-spacing: 1px;
    color: var(--fl-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .fl-opt.on u { color: var(--fl-text); }
  .fl-sw {
    position: relative; width: 20px; height: 20px; padding: 0; flex: none;
    border-radius: 50%; border: 1px solid rgba(0,0,0,0.45);
    background: var(--sw, var(--fl-accent));
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.22);
    transition: box-shadow .16s ease;
  }
  /* 选中的那一格打个勾：只靠一圈细光环，在暗底上认不出来 */
  .fl-opt.on .fl-sw::after {
    content: ""; position: absolute; left: 50%; top: 50%;
    width: 3.5px; height: 7px; margin: -5.5px 0 0 -1.8px;
    border-right: 1.8px solid rgba(0,0,0,0.66);
    border-bottom: 1.8px solid rgba(0,0,0,0.66);
    transform: rotate(42deg);
    filter: drop-shadow(0 1px 0 rgba(255,255,255,0.3));
  }
  .fl-sw-custom {
    overflow: hidden; background:
      conic-gradient(#d16a5c, #d4af5a, #9cb56a, #6ec2a0, #63a8b8, #7d9bd6, #b184c9, #d16a5c);
  }
  .fl-sw-custom input {
    position: absolute; inset: -6px; width: calc(100% + 12px); height: calc(100% + 12px);
    opacity: 0; cursor: pointer; border: 0; padding: 0;
  }
  .fl-sw-auto {
    background: linear-gradient(118deg, var(--fl-accent) 0 45%, var(--fl-surface2) 45% 100%);
    border-color: var(--fl-line2);
  }

  /* 外观页的实时预览条 */
  .fl-preview {
    margin-top: 12px; padding: 12px 14px; border-radius: 2px;
    border: 1px solid var(--fl-line2); background: var(--fl-surface);
    display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
  }
  .fl-preview b {
    font-family: var(--fl-serif); font-size: 15px; letter-spacing: 2px; color: var(--fl-bright);
  }
  .fl-preview i {
    font-style: normal; font-size: 12px; letter-spacing: .8px; color: var(--fl-dim);
  }
  .fl-preview u {
    text-decoration: none; font-size: 15px; color: var(--fl-accent);
    font-variant-numeric: tabular-nums;
  }
  .fl-close2 {
    width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: var(--fl-dimmer); font-size: 20px; line-height: 1;
    border-radius: 50%; transition: all .16s ease; border: 1px solid transparent;
  }
  .fl-close2:hover { color: #fff; background: rgba(var(--fl-accent-rgb),0.12); border-color: var(--fl-line); }

  /* ---- 领地头 ---- */
  .fl-hero {
    flex: none; display: flex; align-items: center; gap: 24px;
    padding: 24px 34px 20px; background: var(--fl-bg);
    border-bottom: 1px solid rgba(var(--fl-accent-rgb),0.06);
  }
  .fl-crest { width: 86px; height: 102px; flex: none; }
  .fl-crest svg { width: 100%; height: 100%; display: block; }
  .fl-hmain { flex: 1; min-width: 0; }
  .fl-hname {
    font-size: 30px; letter-spacing: 3px; color: var(--fl-bright); font-weight: 700;
    line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    text-shadow: 0 2px 18px rgba(0,0,0,.6);
  }
  .fl-hsub {
    margin-top: 8px; font-size: 11.5px; letter-spacing: 1.2px; color: var(--fl-dimmer);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .fl-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
  .fl-chip {
    font-size: 11px; letter-spacing: .9px; padding: 3px 9px; border-radius: 2px;
    color: var(--fl-dim); border: 1px solid var(--fl-line); background: rgba(255,255,255,0.012);
  }
  .fl-chip.gold { color: var(--fl-accent); border-color: rgba(var(--fl-accent-rgb),0.38); background: rgba(var(--fl-accent-rgb),0.07); }
  .fl-chip.blue { color: var(--fl-plan); border-color: rgba(143,169,207,0.28); }
  .fl-chip.green { color: var(--fl-ok); border-color: rgba(143,191,122,0.26); }

  /* ---- 七档阶梯 ---- */
  .fl-ladder { flex: none; width: 246px; text-align: right; }
  .fl-lad-h { display: flex; align-items: baseline; gap: 8px; justify-content: flex-end; }
  .fl-lad-h i { font-style: normal; font-size: 10px; letter-spacing: 2.4px; color: var(--fl-dimmer); }
  .fl-lad-h b { font-size: 15px; letter-spacing: 1.6px; color: var(--fl-accent); font-weight: 600; }
  .fl-segs { display: flex; gap: 3px; margin: 9px 0 8px; }
  .fl-seg {
    flex: 1; height: 4px; border-radius: 1px; background: rgba(var(--fl-accent-rgb),0.18);
    position: relative; overflow: hidden;
  }
  .fl-seg.on { background: linear-gradient(90deg, rgba(var(--fl-accent-rgb),0.55), var(--fl-accent)); }
  .fl-seg.cur { box-shadow: 0 0 10px rgba(var(--fl-accent-rgb),0.55); }
  .fl-lad-f { font-size: 10.5px; letter-spacing: .6px; color: var(--fl-dim); }
  .fl-lad-n { font-size: 10px; letter-spacing: .4px; color: var(--fl-dimmer); margin-top: 4px; }

  /* ---- 六项指标 ---- */
  .fl-metrics {
    flex: none; display: grid; grid-template-columns: repeat(6, 1fr);
    gap: 1px; background: var(--fl-line);
    border-top: 1px solid var(--fl-line); border-bottom: 1px solid var(--fl-line);
  }
  .fl-metric {
    background: var(--fl-surface);
    padding: 13px 18px 12px; min-width: 0;
  }
  .fl-metric i {
    display: block; font-style: normal; font-size: 10px; letter-spacing: 2.6px;
    color: rgba(var(--fl-accent-rgb),0.6); margin-bottom: 6px;
  }
  .fl-metric b {
    display: block; font-size: 22px; font-weight: 600; color: var(--fl-bright);
    letter-spacing: .5px; line-height: 1.1; font-variant-numeric: tabular-nums;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .fl-metric b u { text-decoration: none; font-size: 11px; color: var(--fl-dimmer); margin-left: 3px; letter-spacing: 0; }
  .fl-metric b small { font-size: 11px; color: var(--fl-dimmer); font-weight: 400; margin-left: 4px; letter-spacing: 1px; }
  .fl-metric .fl-meter { height: 2px; margin-top: 9px; background: rgba(255,255,255,0.06); overflow: hidden; }
  .fl-metric .fl-meter s { display: block; height: 100%; text-decoration: none; background: linear-gradient(90deg, rgba(var(--fl-accent-rgb),0.55), var(--fl-accent)); }
  .fl-metric .fl-meter.good s { background: linear-gradient(90deg, rgba(143,191,122,0.5), var(--fl-ok)); }
  .fl-metric .fl-meter.bad s { background: linear-gradient(90deg, rgba(212,127,108,0.5), var(--fl-bad)); }
  .fl-pips { display: flex; gap: 4px; }
  .fl-box .fl-pips { max-width: 190px; }
  .fl-metric .fl-pips { margin-top: 9px; gap: 3px; }
  .fl-pips s { flex: 1; height: 2px; background: rgba(255,255,255,0.06); text-decoration: none; display: block; }
  .fl-pips s.on { background: var(--fl-accent); }
  .fl-pips.warn s.on { background: var(--fl-warn); }
  .fl-pips.bad s.on { background: var(--fl-bad); }

  /* ---- 页签 ---- */
  .fl-tabs {
    flex: none; display: flex; gap: 0; padding: 0 28px;
    border-bottom: 1px solid var(--fl-line); background: var(--fl-bg2);
  }
  .fl-tab {
    padding: 13px 16px 11px; font-size: 12.5px; letter-spacing: 3px; color: var(--fl-dimmer);
    cursor: pointer; border-bottom: 2px solid transparent; transition: all .15s ease;
    white-space: nowrap; user-select: none;
  }
  .fl-tab:hover { color: var(--fl-text); }
  .fl-tab.on { color: var(--fl-accent); border-bottom-color: var(--fl-accent); }
  .fl-tab u {
    text-decoration: none; font-size: 9.5px; letter-spacing: 0; margin-left: 5px;
    color: var(--fl-dimmer); font-variant-numeric: tabular-nums;
  }
  .fl-tab.on u { color: rgba(var(--fl-accent-rgb),0.7); }

  /* ---- 内容 ---- */
  .fl-view { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 22px 34px 46px; position: relative; min-width: 0; }
  .fl-view::-webkit-scrollbar { width: 8px; }
  .fl-view::-webkit-scrollbar-thumb { background: rgba(var(--fl-accent-rgb),0.16); border-radius: 4px; }
  .fl-view::-webkit-scrollbar-thumb:hover { background: rgba(var(--fl-accent-rgb),0.3); }

  .fl-sec { margin-bottom: 26px; }
  .fl-sec-h { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .fl-sec-h span {
    font-size: 11px; letter-spacing: 3.4px; color: rgba(var(--fl-accent-rgb),0.82); white-space: nowrap;
  }
  .fl-sec-h s { flex: 1; height: 1px; background: linear-gradient(90deg, var(--fl-line2), transparent); }
  .fl-sec-h em {
    font-style: normal; font-size: 10px; letter-spacing: .8px; color: var(--fl-dimmer);
  }

  /* ---- 卡片 ---- */
  .fl-cards {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 11px;
  }
  .fl-card {
    position: relative; padding: 14px 16px 13px 17px; border-radius: 3px;
    background: var(--fl-surface);
    border: 1px solid var(--fl-line); cursor: pointer;
    transition: border-color .16s ease, transform .16s ease, box-shadow .16s ease;
  }
  .fl-card::before {
    content: ""; position: absolute; left: 0; top: 13px; bottom: 13px; width: 2px;
    background: var(--fl-cat, rgba(var(--fl-accent-rgb),0.5)); opacity: .85;
  }
  .fl-card:hover {
    border-color: rgba(var(--fl-accent-rgb),0.3); transform: translateY(-1px);
    box-shadow: 0 10px 26px rgba(0,0,0,0.42);
  }
  .fl-card-t { display: flex; align-items: center; gap: 8px; }
  .fl-card-t .fl-ic { flex: none; width: 16px; height: 16px; color: var(--fl-cat, var(--fl-accent)); }
  .fl-card-t .fl-ic svg { width: 16px; height: 16px; display: block; }
  .fl-card-n {
    flex: 1; min-width: 0; font-size: 14px; letter-spacing: .8px; color: var(--fl-bright);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .fl-card-m { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; align-items: center; }
  .fl-card-d {
    margin-top: 8px; font-size: 11.5px; line-height: 1.7; color: rgba(var(--fl-text-rgb),0.44);
    max-height: 3.6em; overflow: hidden;
  }
  .fl-card-o {
    margin-top: 9px; padding-top: 8px; border-top: 1px dashed rgba(var(--fl-accent-rgb),0.12);
    font-size: 11px; color: var(--fl-dim); display: flex; gap: 6px; align-items: baseline;
  }
  .fl-card-o b { color: var(--fl-accent); font-weight: 600; font-variant-numeric: tabular-nums; flex: none; }
  .fl-card-o span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* 类别色 */
  [data-cat="防务"] { --fl-cat: #c26a56; }
  [data-cat="经济"] { --fl-cat: #d3ab58; }
  [data-cat="民生"] { --fl-cat: #7fae74; }
  [data-cat="军事"], [data-cat="军政"] { --fl-cat: #7e9cc9; }
  [data-cat="资源点"] { --fl-cat: #a78fd0; }
  [data-cat="其他"] { --fl-cat: #8d8a80; }
  .fl-ic { color: var(--fl-cat, var(--fl-accent)); }
  .fl-ic svg { width: 100%; height: 100%; display: block; }

  /* ---- 药丸 ---- */
  .fl-pill {
    font-size: 10px; padding: 2px 7px; border-radius: 2px; white-space: nowrap;
    letter-spacing: .6px; border: 1px solid currentColor; opacity: .95; flex: none;
    line-height: 1.5;
  }
  .fl-pill.st-ok { color: var(--fl-ok); }
  .fl-pill.st-build { color: var(--fl-warn); }
  .fl-pill.st-bad { color: var(--fl-bad); }
  .fl-pill.st-plan { color: var(--fl-plan); }
  .fl-pill.st-other { color: var(--fl-dimmer); }
  .fl-tag {
    font-size: 10px; letter-spacing: .5px; color: var(--fl-dimmer);
    border: 1px dashed rgba(var(--fl-text-rgb),0.18); padding: 1px 6px; border-radius: 2px;
  }
  .fl-tag.gold { color: rgba(var(--fl-accent-rgb),0.78); border-color: rgba(var(--fl-accent-rgb),0.28); }
  .fl-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--fl-accent); flex: none; box-shadow: 0 0 7px var(--fl-accent); }

  /* ---- 筛选条 ---- */
  .fl-chipbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 14px; }
  .fl-fchip {
    cursor: pointer; font-size: 11px; letter-spacing: .9px; padding: 4px 10px; border-radius: 2px;
    border: 1px solid var(--fl-line); color: var(--fl-dim); transition: all .15s ease;
    display: flex; align-items: center; gap: 6px;
  }
  .fl-fchip:hover { color: var(--fl-text); border-color: var(--fl-line2); }
  .fl-fchip.on { color: var(--fl-accent); border-color: rgba(var(--fl-accent-rgb),0.42); background: rgba(var(--fl-accent-rgb),0.08); }
  .fl-fchip u { text-decoration: none; font-size: 9.5px; color: var(--fl-dimmer); }
  .fl-fchip i { width: 5px; height: 5px; border-radius: 50%; background: var(--fl-cat); display: block; }
  .fl-q {
    margin-left: auto; background: transparent; border: 1px solid var(--fl-line);
    border-radius: 2px; color: var(--fl-text); font: inherit; font-size: 11.5px;
    padding: 5px 10px; outline: none; width: 180px; transition: border-color .16s;
  }
  .fl-q::placeholder { color: rgba(var(--fl-text-rgb),0.2); }
  .fl-q:focus { border-color: var(--fl-line2); }

  /* ---- 键值行 ---- */
  .fl-kvs { display: flex; flex-direction: column; }
  .fl-kv {
    display: flex; gap: 16px; padding: 8px 0; font-size: 12.5px; line-height: 1.7;
    border-bottom: 1px dashed rgba(var(--fl-accent-rgb),0.075);
  }
  .fl-kv:last-child { border-bottom: none; }
  .fl-kv k {
    flex: none; width: 68px; color: rgba(var(--fl-accent-rgb),0.62); letter-spacing: 1.4px;
    font-size: 11px; font-family: var(--fl-serif); padding-top: 2px;
  }
  .fl-kv v { flex: 1; color: rgba(var(--fl-text-rgb),0.86); word-break: break-word; }
  .fl-kv v.mono { font-variant-numeric: tabular-nums; }

  /* ---- 总览信息块 ---- */
  .fl-duo { display: grid; grid-template-columns: 1.25fr 1fr; gap: 18px; align-items: start; }
  .fl-box {
    border: 1px solid var(--fl-line); border-radius: 3px; padding: 14px 16px;
    background: rgba(23,20,14,0.55);
  }
  .fl-notice { display: flex; flex-direction: column; gap: 9px; }
  .fl-notice-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 9px 26px; }
  .fl-notice-r { display: flex; gap: 10px; align-items: flex-start; font-size: 12.5px; line-height: 1.75; }
  .fl-notice-r i {
    flex: none; width: 3px; height: 3px; border-radius: 50%; margin-top: 8px;
    background: rgba(var(--fl-accent-rgb),0.6);
  }
  .fl-notice-r b { color: rgba(var(--fl-accent-rgb),0.86); font-weight: 500; letter-spacing: .5px; }
  .fl-notice-r span { color: rgba(var(--fl-text-rgb),0.82); }

  .fl-space-h { display: flex; justify-content: space-between; align-items: baseline; font-size: 11px; letter-spacing: 1px; color: var(--fl-dim); }
  .fl-space-h b { color: var(--fl-accent); font-variant-numeric: tabular-nums; letter-spacing: 0; font-size: 11.5px; }
  .fl-space-bar { height: 5px; margin-top: 8px; background: rgba(255,255,255,0.05); border-radius: 1px; overflow: hidden; }
  .fl-space-bar s { display: block; height: 100%; background: linear-gradient(90deg, rgba(var(--fl-accent-rgb),0.5), var(--fl-accent)); }

  /* ---- 账本 ---- */
  .fl-led-h { display: flex; gap: 26px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 18px; }
  .fl-led-h .fl-big { font-size: 30px; letter-spacing: .5px; font-variant-numeric: tabular-nums; color: var(--fl-bright); font-weight: 600; line-height: 1; }
  .fl-led-h .fl-big.pos { color: var(--fl-ok); }
  .fl-led-h .fl-big.neg { color: var(--fl-bad); }
  .fl-led-h .fl-lbl { font-size: 10px; letter-spacing: 2.4px; color: var(--fl-dimmer); margin-bottom: 6px; }
  .fl-ledger { border: 1px solid var(--fl-line); border-radius: 3px; overflow: hidden; background: rgba(20,17,12,0.5); }
  .fl-led-row {
    display: flex; align-items: baseline; gap: 14px; padding: 9px 16px;
    border-bottom: 1px dashed rgba(var(--fl-accent-rgb),0.08); font-size: 12.5px;
  }
  .fl-led-row:last-child { border-bottom: none; }
  .fl-led-row.kind { background: rgba(var(--fl-accent-rgb),0.05); padding: 7px 16px; }
  .fl-led-row.kind span { font-size: 10px; letter-spacing: 2.6px; color: rgba(var(--fl-accent-rgb),0.72); }
  .fl-led-row.kind em { font-style: normal; margin-left: auto; font-size: 11px; color: var(--fl-dim); font-variant-numeric: tabular-nums; }
  .fl-led-row .n { flex: 1; color: rgba(var(--fl-text-rgb),0.84); }
  .fl-led-row .v { flex: none; font-variant-numeric: tabular-nums; letter-spacing: .3px; }
  .fl-led-row .v.in { color: var(--fl-ok); }
  .fl-led-row .v.out { color: var(--fl-bad); }
  .fl-led-row.total { background: rgba(var(--fl-accent-rgb),0.055); }
  .fl-led-row.total .n { color: var(--fl-accent); letter-spacing: 1.4px; font-size: 11.5px; }
  .fl-led-row.total .v { font-size: 14px; font-weight: 600; }
  .fl-led-warn {
    margin-top: 10px; padding: 9px 13px; font-size: 11.5px; line-height: 1.7;
    color: var(--fl-warn); border-left: 2px solid rgba(220,190,106,0.5);
    background: rgba(220,190,106,0.05); border-radius: 0 2px 2px 0;
  }
  .fl-deltas { display: flex; flex-wrap: wrap; gap: 8px; }
  .fl-delta {
    display: flex; align-items: baseline; gap: 8px; padding: 7px 12px; border-radius: 2px;
    border: 1px solid var(--fl-line); background: rgba(23,20,14,0.5); font-size: 12px;
  }
  .fl-delta b { font-variant-numeric: tabular-nums; font-weight: 700; }
  .fl-delta b.up { color: var(--fl-ok); }
  .fl-delta b.down { color: var(--fl-bad); }
  .fl-delta span { color: var(--fl-dimmer); font-size: 11px; }

  .fl-timeline { position: relative; padding-left: 16px; }
  .fl-timeline::before {
    content: ""; position: absolute; left: 3px; top: 6px; bottom: 6px; width: 1px;
    background: linear-gradient(180deg, rgba(var(--fl-accent-rgb),0.3), rgba(var(--fl-accent-rgb),0.04));
  }
  .fl-tl { position: relative; padding: 0 0 14px; font-size: 12.5px; line-height: 1.75; color: rgba(var(--fl-text-rgb),0.82); }
  .fl-tl:last-child { padding-bottom: 0; }
  .fl-tl::before {
    content: ""; position: absolute; left: -16px; top: 7px; width: 5px; height: 5px;
    border-radius: 50%; background: var(--fl-bg); border: 1px solid rgba(var(--fl-accent-rgb),0.55);
  }
  .fl-tl em { font-style: normal; color: rgba(var(--fl-accent-rgb),0.66); font-size: 11px; margin-right: 8px; }

  .fl-verdict {
    padding: 14px 16px; border-radius: 3px; font-size: 12.5px; line-height: 1.8;
    color: rgba(var(--fl-text-rgb),0.86); background: rgba(143,169,207,0.055);
    border-left: 2px solid rgba(143,169,207,0.42);
  }
  .fl-verdict b { display: block; font-size: 10px; letter-spacing: 2.6px; color: var(--fl-plan); margin-bottom: 7px; font-weight: 500; }

  /* ---- 空态 ---- */
  .fl-empty {
    padding: 54px 26px; text-align: center; color: rgba(var(--fl-text-rgb),0.4);
    font-size: 12.5px; line-height: 2;
  }
  .fl-empty b {
    display: block; font-size: 26px; color: rgba(var(--fl-accent-rgb),0.24);
    margin-bottom: 14px; letter-spacing: 6px; font-weight: 400;
  }
  .fl-empty small { display: block; font-size: 11px; opacity: .8; margin-top: 6px; }

  /* ---- 抽屉 ---- */
  .fl-scrim {
    position: absolute; inset: 0; background: rgba(0,0,0,0.52); z-index: 4;
    opacity: 0; pointer-events: none; transition: opacity .22s ease;
  }
  .fl-scrim.on { opacity: 1; pointer-events: auto; }
  .fl-drawer {
    position: absolute; top: 0; right: 0; bottom: 0; width: 460px; max-width: 94vw;
    z-index: 5; display: flex; flex-direction: column;
    background: linear-gradient(180deg, var(--fl-surface), var(--fl-bg2));
    border-left: 1px solid var(--fl-line2);
    box-shadow: -26px 0 70px rgba(0,0,0,0.6);
    transform: translateX(103%); transition: transform .27s cubic-bezier(.32,.86,.28,1);
  }
  .fl-drawer.on { transform: none; }
  .fl-dr-h {
    flex: none; display: flex; gap: 14px; align-items: flex-start;
    padding: 22px 22px 18px; border-bottom: 1px solid var(--fl-line);
  }
  .fl-dr-ic {
    flex: none; width: 42px; height: 42px; border-radius: 3px; display: flex;
    align-items: center; justify-content: center;
    border: 1px solid var(--fl-line); background: rgba(var(--fl-accent-rgb),0.05);
    color: var(--fl-cat, var(--fl-accent));
  }
  .fl-dr-ic svg { width: 22px; height: 22px; }
  .fl-dr-t { flex: 1; min-width: 0; }
  .fl-dr-n { font-size: 19px; letter-spacing: 1.4px; color: var(--fl-bright); line-height: 1.35; word-break: break-word; }
  .fl-dr-s { margin-top: 6px; font-size: 11px; color: var(--fl-dimmer); letter-spacing: .7px; }
  .fl-dr-x {
    flex: none; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: var(--fl-dimmer); border-radius: 50%; font-size: 17px; line-height: 1;
  }
  .fl-dr-x:hover { color: #fff; background: rgba(var(--fl-accent-rgb),0.1); }
  .fl-dr-b { flex: 1; overflow-y: auto; padding: 18px 22px 26px; }
  .fl-dr-b::-webkit-scrollbar { width: 7px; }
  .fl-dr-b::-webkit-scrollbar-thumb { background: rgba(var(--fl-accent-rgb),0.16); border-radius: 4px; }
  .fl-fx { display: flex; flex-direction: column; gap: 10px; }
  .fl-fx-r { display: flex; gap: 10px; font-size: 12.5px; line-height: 1.75; }
  .fl-fx-r b {
    flex: none; min-width: 76px; max-width: 40%; color: rgba(var(--fl-accent-rgb),0.82);
    font-weight: 500; letter-spacing: .5px;
  }
  .fl-fx-r span { flex: 1; color: rgba(var(--fl-text-rgb),0.8); }
  .fl-desc { font-size: 12.5px; line-height: 1.9; color: rgba(var(--fl-text-rgb),0.76); }
  .fl-note {
    width: 100%; box-sizing: border-box; min-height: 76px; resize: vertical;
    background: rgba(10,9,6,0.6); border: 1px solid var(--fl-line); border-radius: 3px;
    color: var(--fl-text); font: inherit; font-size: 12.5px; padding: 10px 12px;
    outline: none; line-height: 1.75; transition: border-color .16s;
  }
  .fl-note::placeholder { color: rgba(var(--fl-text-rgb),0.2); }
  .fl-note:focus { border-color: var(--fl-line2); }
  .fl-hint { font-size: 10px; color: rgba(var(--fl-text-rgb),0.24); margin-top: 6px; letter-spacing: .4px; }

  /* ---- 底栏 ---- */
  .fl-foot {
    flex: none; display: flex; align-items: center; gap: 14px;
    padding: 8px 26px; border-top: 1px solid var(--fl-line);
    background: var(--fl-bg2); font-size: 10.5px; letter-spacing: .5px;
    color: rgba(var(--fl-text-rgb),0.34);
  }
  .fl-foot b { color: rgba(var(--fl-accent-rgb),0.75); font-weight: 500; }
  .fl-foot .fl-live { margin-left: auto; display: flex; align-items: center; gap: 6px; color: var(--fl-ok); }
  .fl-foot .fl-live::before {
    content: ""; width: 4px; height: 4px; border-radius: 50%; background: currentColor;
    box-shadow: 0 0 7px currentColor;
  }
  .fl-foot .fl-live.off { color: var(--fl-dimmer); }
  .fl-foot .fl-live.off::before { box-shadow: none; }

  /* ---- 底部导航 ----
     五格等分，图标在上标签在下；选中那格整块提亮 + 顶沿一条 2px 指示线。
     用 flex 等分而不是固定宽度：360px 和 1200px 下都不会挤成一团或散得太开。 */
  .fl-nav {
    flex: none; display: flex; align-items: stretch;
    border-top: 1px solid var(--fl-line2);
    background: var(--fl-bg2);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .fl-nav-i {
    position: relative; flex: 1 1 0; min-width: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 4px; padding: 7px 2px 6px; cursor: pointer;
    color: var(--fl-dimmer); background: transparent;
    transition: color .16s ease, background .16s ease;
    -webkit-tap-highlight-color: transparent; user-select: none;
  }
  .fl-nav-i::before {
    content: ""; position: absolute; top: -1px; left: 50%; transform: translateX(-50%);
    width: 0; height: 2px; background: var(--fl-accent);
    transition: width .18s ease;
  }
  .fl-nav-i:hover { color: var(--fl-dim); background: rgba(var(--fl-accent-rgb),0.045); }
  .fl-nav-i.on {
    color: var(--fl-accent);
    background: linear-gradient(180deg, rgba(var(--fl-accent-rgb),0.13), rgba(var(--fl-accent-rgb),0.03));
  }
  .fl-nav-i.on::before { width: 58%; }
  .fl-nav-i svg { width: 19px; height: 19px; display: block; flex: none; }
  .fl-nav-i b {
    font-size: 11.5px; font-weight: 400; letter-spacing: 1.6px; line-height: 1;
    white-space: nowrap; font-family: var(--fl-serif);
  }
  /* 「内测」角标跟标签同一行、抬起半格当上标：贴在格子顶角会跟分隔线打架 */
  .fl-nav-lb { display: inline-flex; align-items: center; gap: 3px; }
  .fl-nav-i .fl-nav-tag {
    font-size: 7.5px; letter-spacing: 0; line-height: 1; padding: 1.5px 3px;
    border-radius: 2px; color: var(--fl-warn);
    border: 1px solid rgba(220,190,106,0.4); background: rgba(220,190,106,0.10);
    transform: translateY(-3px);
  }

  /* ---- 外交 ---- */
  .fl-dip-h { display: flex; align-items: baseline; gap: 10px; margin: 0 0 10px; }
  .fl-dip-h b { font-size: 13px; letter-spacing: 3px; color: var(--fl-accent); font-weight: 400; }
  .fl-dip-h em { font-style: normal; font-size: 9.5px; letter-spacing: 1.6px; color: var(--fl-dimmer); text-transform: uppercase; }
  .fl-dip-h s { flex: 1; height: 1px; background: var(--fl-line); text-decoration: none; }
  .fl-dip-row {
    display: flex; align-items: center; gap: 10px; padding: 11px 13px;
    background: var(--fl-surface); border: 1px solid var(--fl-line); border-radius: 2px;
    margin-bottom: 7px;
  }
  .fl-dip-nm { flex: 1; min-width: 0; font-size: 13px; line-height: 1.5; color: var(--fl-text); overflow: hidden; text-overflow: ellipsis; }
  .fl-dip-nm small { display: block; font-size: 10.5px; line-height: 1.5; color: var(--fl-dimmer); margin-top: 2px; }
  .fl-dip-at {
    flex: none; font-size: 10px; letter-spacing: 1px; padding: 3px 8px; border-radius: 2px;
    border: 1px solid currentColor;
  }
  .fl-dip-at.ok { color: var(--fl-ok); }
  .fl-dip-at.mid { color: var(--fl-warn); }
  .fl-dip-at.bad { color: var(--fl-bad); }
  .fl-dip-at.none { color: var(--fl-dimmer); }

  /* 治下那种「标签 + 短值」的行：两栏对齐，别用上下堆叠撑成一块砖 */
  .fl-kv {
    display: flex; align-items: baseline; gap: 12px;
    padding: 8px 2px; border-bottom: 1px dashed var(--fl-line);
  }
  .fl-kv:last-child { border-bottom: 0; }
  .fl-kv .k {
    flex: none; width: 86px; font-size: 11px; letter-spacing: 1.4px;
    color: var(--fl-dimmer);
  }
  .fl-kv .v {
    flex: 1; min-width: 0; font-size: 12.5px; line-height: 1.6;
    color: rgba(var(--fl-text-rgb),0.9); word-break: break-word;
  }

  /* ---- 历史 ----
     直接复用账本那套 .fl-timeline / .fl-tl（容器带竖线，条目自带圆点），
     这里只补三种色调和「楼层 + 建筑 + 类型 + 明细」的排版。
     别再新起一套 .fl-tl 容器：那个类名已经被账本事件行占了。 */
  .fl-tl.add::before { background: var(--fl-ok); border-color: var(--fl-ok); box-shadow: 0 0 6px rgba(143,191,122,.6); }
  .fl-tl.rm::before { background: var(--fl-bad); border-color: var(--fl-bad); }
  .fl-tl .nm { color: rgba(var(--fl-text-rgb),0.94); }
  .fl-tl .kd { color: var(--fl-dimmer); font-size: 9.5px; letter-spacing: 1.2px; margin-left: 7px; }
  .fl-tl .tx { margin-top: 2px; font-size: 12px; line-height: 1.65; color: rgba(var(--fl-text-rgb),0.62); }

  /* ---- 自检 ---- */
  .fl-diag-h { font-size: 10.5px; letter-spacing: 3.2px; color: rgba(var(--fl-accent-rgb),0.8); margin: 22px 0 8px; }
  .fl-diag-h:first-child { margin-top: 0; }
  .fl-diag-row {
    display: flex; gap: 14px; padding: 7px 0; font-size: 12.5px; line-height: 1.65;
    border-bottom: 1px dashed rgba(var(--fl-accent-rgb),0.08);
  }
  .fl-diag-k { flex: none; width: 104px; color: rgba(var(--fl-accent-rgb),0.62); letter-spacing: .8px; font-size: 11.5px; }
  .fl-diag-v { flex: 1; color: rgba(var(--fl-text-rgb),0.82); word-break: break-word; }
  .fl-diag-v code {
    font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: #cbdcb4;
    background: rgba(255,255,255,0.035); padding: 1px 5px; border-radius: 2px;
  }
  .fl-diag-v .dg-ok { color: var(--fl-ok); }
  .fl-diag-v .dg-bad { color: var(--fl-bad); }
  .fl-diag-v .dg-warn { color: var(--fl-warn); }
  .fl-diag-note {
    margin-top: 20px; padding: 13px 16px; font-size: 11.5px; line-height: 1.9;
    color: rgba(var(--fl-text-rgb),0.6); background: rgba(var(--fl-accent-rgb),0.045);
    border-left: 2px solid rgba(var(--fl-accent-rgb),0.3); border-radius: 0 3px 3px 0;
  }

  /* ---- 提示 ---- */
  #fief-ledger-toast {
    position: fixed; left: 50%; bottom: 34px; transform: translate(-50%, 10px); z-index: 100000;
    background: var(--fl-surface2); border: 1px solid rgba(var(--fl-accent-rgb),0.34); color: var(--fl-bright);
    font: 12px/1.7 var(--fl-serif); padding: 10px 17px; border-radius: 3px; max-width: 460px;
    box-shadow: 0 16px 40px rgba(0,0,0,0.72), inset 0 1px 0 rgba(255,255,255,0.04);
    opacity: 0; transition: opacity .22s, transform .22s; pointer-events: none;
  }
  #fief-ledger-toast.on { opacity: 1; transform: translate(-50%, 0); }

  /* ============================ 响应式 ============================
     三档：宽屏并排 → 中屏折行 → 手机整块重排。
     手机上全部单位缩小、栅格降列、标题允许换行，宁可多一行也不横向溢出。 */

  @media (max-width: 1180px) {
    .fl-ladder { width: 200px; }
    .fl-crest { width: 72px; height: 86px; }
    .fl-hname { font-size: 26px; }
    .fl-metrics { grid-template-columns: repeat(3, 1fr); }
  }

  @media (max-width: 860px) {
    .fl-hero { flex-wrap: wrap; gap: 14px 18px; padding: 18px 20px 14px; }
    .fl-crest { width: 60px; height: 72px; }
    .fl-hmain { flex: 1 1 240px; }
    .fl-hname { font-size: 21px; letter-spacing: 1.4px; }
    .fl-ladder { width: 100%; text-align: left; }
    .fl-lad-h { justify-content: flex-start; }
    .fl-top { flex-wrap: wrap; gap: 10px; padding: 10px 16px; }
    .fl-tabs { overflow-x: auto; padding: 0 12px; }
    .fl-tabs::-webkit-scrollbar { display: none; }
    .fl-view { padding: 16px 18px 34px; }
    .fl-duo { grid-template-columns: 1fr; }
    .fl-notice-2 { grid-template-columns: 1fr; }
    .fl-q { width: 100%; margin-left: 0; }
  }

  /* ================= 政策抽卡（内测） ================= */




  `;

  /* --- 模块样式：来自 modules/policy.css.js 与 modules/ai.css.js --- */
  function injectModuleCss() {
    const list = [
      ['fief-ledger-css-policy', window.__fiefCssPolicy],
      ['fief-ledger-css-ai', window.__fiefCssAi],
    ];
    for (const pair of list) {
      const id = pair[0], css = pair[1];
      if (!css) continue;
      let old = null;
      try { old = doc.getElementById(id); } catch (e) { old = null; }
      if (old && old.parentNode) { try { old.parentNode.removeChild(old); } catch (e) { /* 忽略 */ } }
      const st = doc.createElement('style');
      st.id = id;
      st.textContent = css;
      (doc.head || doc.documentElement).appendChild(st);
    }
  }

  /* ============================================================== 视图 */
  const el = (tag, cls, html) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /** 千分位，账本里的数字要一眼能读 */
  function fmtNum(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    const neg = n < 0;
    const s = String(Math.abs(Math.round(n)));
    let out = '';
    for (let i = 0; i < s.length; i += 1) {
      if (i && (s.length - i) % 3 === 0) out += ',';
      out += s.charAt(i);
    }
    return (neg ? '−' : '') + out;
  }

  /** 指标条这类窄格子用紧凑写法：132.0 万 / 1.32 亿，完整值放 title */
  function fmtCompact(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    const abs = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    const trim = (x, d) => x.toFixed(d).replace(/\.?0+$/, '');
    if (abs >= 1e8) {
      const v = abs / 1e8;
      return sign + trim(v, v >= 10 ? 2 : 3) + ' 亿';
    }
    if (abs >= 1e4) {
      const v = abs / 1e4;
      return sign + trim(v, v >= 100 ? 1 : 2) + ' 万';
    }
    return fmtNum(n);
  }

  /** 面积用「万 m²」，七百万写全了读不过来 */
  function fmtArea(n) {
    if (!n) return '—';
    if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿 m²';
    if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万 m²';
    return fmtNum(n) + ' m²';
  }

  function statusClass(st) {
    const s = String(st || '');
    if (/运营|运转|启用|开采/.test(s)) return 'st-ok';
    if (/建设中|在建|施工|开垦|规划中/.test(s)) return 'st-build';
    if (/损毁|废弃|拆除|废弃/.test(s)) return 'st-bad';
    if (/规划|待定|拟/.test(s)) return 'st-plan';
    return 'st-other';
  }

  function bucketOf(s) {
    const c = statusClass(s);
    return c === 'st-ok' ? '运营中' : c === 'st-build' ? '建设中' : c === 'st-bad' ? '损毁' : '其他';
  }

  /* ------------------------------------------------------------ 图标 */
  const ICON_PATHS = {
    防务: '<path d="M12 3.2l7 2.6v5.4c0 4.2-2.9 7.7-7 9.1-4.1-1.4-7-4.9-7-9.1V5.8l7-2.6z"/><path d="M9 12l2.2 2.2L15.2 10"/>',
    经济: '<circle cx="12" cy="9" r="5.2"/><path d="M9.8 9h4.4M12 6.8v4.4"/><path d="M6.5 14.8c0 1.6 2.5 2.9 5.5 2.9s5.5-1.3 5.5-2.9"/>',
    民生: '<path d="M4 11.2L12 5l8 6.2"/><path d="M6.4 10.2V19h11.2v-8.8"/><path d="M10 19v-4.4h4V19"/>',
    军事: '<path d="M6 3.5v17"/><path d="M6 4.6h11l-2.2 4.1L17 12.8H6"/>',
    军政: '<path d="M6 3.5v17"/><path d="M6 4.6h11l-2.2 4.1L17 12.8H6"/>',
    资源点: '<path d="M12 3.4l7.2 5.1L12 20.6 4.8 8.5 12 3.4z"/><path d="M4.8 8.5h14.4M12 3.4v17.2"/>',
    其他: '<path d="M12 4.2l7.4 7.8L12 19.8 4.6 12z"/>',
  };

  function iconOf(cat) {
    const p = ICON_PATHS[cat] || ICON_PATHS.其他;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" stroke-linecap="round">' + p + '</svg>';
  }

  /** 纹章：盾形＋地名首字，档位用底部小菱点数 */
  function crestSvg(name, tier) {
    let ch = '';
    const s = String(name || '').replace(/[·・\s]/g, '');
    ch = s ? s.charAt(0) : '领';
    const n = tier ? tier.n : 0;
    let pips = '';
    for (let i = 0; i < 7; i += 1) {
      const x = 43 + (i - 3) * 6;
      const on = i < n;
      pips += `<rect x="${x - 1.6}" y="71" width="3.2" height="3.2" transform="rotate(45 ${x} 72.6)" fill="${on ? 'rgba(0,0,0,0.52)' : 'rgba(0,0,0,0.14)'}"></rect>`;
    }
    return `<svg viewBox="0 0 86 102" aria-hidden="true">
      <defs>
        <linearGradient id="fl-crest-g" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stop-color="var(--fl-crest1)"/>
          <stop offset="46%" stop-color="var(--fl-crest2)"/>
          <stop offset="100%" stop-color="var(--fl-crest3)"/>
        </linearGradient>
      </defs>
      <path d="M43 5 L78 17.5 V53 C78 73.5 60 89.5 43 96 C26 89.5 8 73.5 8 53 V17.5 Z"
        fill="url(#fl-crest-g)" stroke="rgba(0,0,0,0.42)" stroke-width="1.2"/>
      <path d="M43 11.5 L72.5 22 V53 C72.5 70.5 57 85 43 90.5 C29 85 13.5 70.5 13.5 53 V22 Z"
        fill="none" stroke="rgba(0,0,0,0.18)" stroke-width="0.9"/>
      <path d="M43 5 L78 17.5 V53 C78 73.5 60 89.5 43 96 C26 89.5 8 73.5 8 53 V17.5 Z"
        fill="none" stroke="rgba(255,255,255,0.26)" stroke-width="0.6"/>
      <text x="43" y="57" text-anchor="middle" font-family="'Noto Serif SC','Songti SC',serif"
        font-size="30" fill="rgba(0,0,0,0.80)" letter-spacing="0">${esc(ch)}</text>
      ${pips}
    </svg>`;
  }

  /* 领地页内部的横滑页签；顶部五格导航是「页」，这里只是「领地」这一页里的分区 */
  const TABS = ['总览', '建筑', '军政', '资源', '账本', '规划'];

  /* 底部导航五页。图标是 24×24 细线路径，跟整套风格一致。
     tag 是角标文字（「内测」），画在标签右上，不占标签宽度。 */
  const PAGES = [
    {
      k: '领地', tag: '',
      p: ['M4 20.5V9l8-5 8 5v11.5', 'M9.5 20.5V14h5v6.5', 'M3 20.5h18'],
    },
    {
      k: '政策', tag: '内测',
      p: ['M6.4 3.6h7.4l4 4v12.8H6.4z', 'M13.8 3.6v4.2h4', 'M9.2 11.8h6', 'M9.2 15.2h6', 'M9.2 18.6h3.4'],
    },
    {
      k: '外交', tag: '',
      p: ['M3.6 9.2h13.2l-3.1-3.1', 'M20.4 14.8H7.2l3.1 3.1'],
    },
    {
      k: '历史', tag: '',
      p: ['M3.6 11.9a8.4 8.4 0 1 0 2.7-6.1', 'M3.3 4.2v3.6h3.6', 'M12 7.6V12l3.1 1.8'],
    },
    {
      k: '设置', tag: '',
      // 真齿形的齿轮：几根放射线在 18px 下会读成太阳，得用带齿的轮廓
      p: [
        'M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6z',
        'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
      ],
    },
  ];

  let data = { domains: [], plans: [], patchCount: 0, msgCount: 0, hasStat: false };
  let notes = {};
  let prefs = loadPrefs();
  let page = '领地';
  let tab = '总览';
  let catFilter = '全部';
  let keyword = '';
  let selected = null;
  let domIdx = 0;
  let root, star, screen, heroEl, tabsEl, viewEl, drawerEl, scrimEl, footEl, domselEl,
      badgeEl, toastEl, liveEl, sayEl, navEl, metricsEl, settingsEl;
  // buildUI 里赋值：切到设置页时要用它把上一次停留的那一面恢复出来
  let showSetPane = () => {};

  const chan = { hook: false, event: false, data: false, msg: false };
  let lastVarSig = '';
  let lastMsgSig = '';
  let lastFire = '';
  let fires = 0;
  let debounce = null;
  let heartbeat = null;
  let observer = null;
  const hooks = [];

  /* ------------------------------------------------------------ 骨架 */
  function buildUI() {
    const oldStyle = doc.getElementById(STYLE_ID);
    if (oldStyle && oldStyle.parentNode) oldStyle.parentNode.removeChild(oldStyle);
    const st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);

    const old = doc.getElementById(UI_ID);
    if (old) old.remove();

    root = el('div');
    root.id = UI_ID;
    // 层级与定位直接内联：万一酒馆把 <style> 挪走或改写，面板也不会被正文盖住
    root.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;'
      + 'width:100%;height:100%;z-index:2147483000;pointer-events:none;'
      + 'isolation:isolate;-webkit-tap-highlight-color:transparent;';
    // 主题：color, accent-rgb, 暗底四层、文字、星标球面，一次写全
    applyAccent(prefs.accent);
    (doc.body || doc.documentElement).appendChild(root);

    star = el('button', null, `
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path class="fl-star-face" d="M16 2.6l4.2 8.86 9.78 1.34-7.12 6.78 1.75 9.7L16 24.5l-8.61 4.78 1.75-9.7L2.02 12.8l9.78-1.34z"/>
        <path class="fl-star-edge" d="M16 2.6l4.2 8.86 9.78 1.34-7.12 6.78 1.75 9.7L16 24.5l-8.61 4.78 1.75-9.7L2.02 12.8l9.78-1.34z"/>
        <path class="fl-star-hi" d="M16 5.4l2.95 6.2 6.84.94-4.99 4.75-1.19-4.2L15 11.2z"/>
      </svg>
      <span class="fl-badge" id="fl-badge"></span>`);
    star.id = 'fief-ledger-star';
    star.type = 'button';
    star.title = '领地档案 v' + VERSION + '（可拖动）';
    // 父层是 pointer-events:none，这里必须显式撑开，否则点不中
    star.style.pointerEvents = 'auto';
    if (prefs.pos && prefs.pos.left && prefs.pos.top) {
      // 换过设备/转过屏之后旧坐标可能落在视口外，星标会「消失」，这里钳回可见范围
      const w = 58, h = 58;
      const vw = host.innerWidth || doc.documentElement.clientWidth || 800;
      const vh = host.innerHeight || doc.documentElement.clientHeight || 600;
      const l = Math.max(4, Math.min(vw - w - 4, parseInt(prefs.pos.left, 10) || 0));
      const t = Math.max(4, Math.min(vh - h - 4, parseInt(prefs.pos.top, 10) || 0));
      star.style.left = l + 'px'; star.style.top = t + 'px'; star.style.right = 'auto';
    }
    root.appendChild(star);
    badgeEl = star.querySelector('#fl-badge');

    screen = el('div');
    screen.id = 'fief-ledger-screen';
    // 关键布局全部内联：万一 <style> 被酒馆改写或丢弃，
    // 这块也得是「满屏、黑底、竖排」的容器，而不是一个塌成 0 高的空 div。
    screen.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;'
      + 'z-index:2147483600;display:none;flex-direction:column;'
      + 'background-color:var(--fl-bg);pointer-events:none;overflow:hidden;'
      + 'isolation:isolate;';
    screen.innerHTML = `
      <div class="fl-top">
        <div class="fl-brand"><b>领 地 档 案</b><em>Fief Ledger</em></div>
        <div class="fl-domsel" id="fl-domsel"></div>
        <div class="fl-top-r">
          <div class="fl-close2" id="fl-close">✕</div>
        </div>
      </div>
      <div class="fl-hero" id="fl-hero"></div>
      <div class="fl-metrics" id="fl-metrics"></div>
      <div class="fl-tabs" id="fl-tabs"></div>
      <div class="fl-view" id="fl-view"></div>

      <section class="fl-settings" id="fl-settings">
        <div class="fl-set-top">
          <div class="fl-set-title">设 置</div>
          <div class="fl-set-tabs" id="fl-set-tabs">
            <span class="fl-set-tab" data-pane="read">读取</span>
            <span class="fl-set-tab on" data-pane="look">外观</span>
            <span class="fl-set-tab" data-pane="api">API</span>
            <span class="fl-set-tab" data-pane="about">关于</span>
          </div>
        </div>
        <div class="fl-set-body">
          <div class="fl-pane" id="fl-pane-read">
            <div class="fl-sec">
              <div class="fl-sec-h">读 取<em>Read</em><span></span></div>
              <div class="fl-grid">
                <label class="fl-opt" id="fl-opt-auto">
                  <input type="checkbox" id="fl-auto" style="accent-color:var(--fl-accent)">
                  <u>自动检测</u>
                </label>
                <button class="fl-btn" id="fl-scan" type="button" style="width:100%">重新读取</button>
                <button class="fl-btn ghost" id="fl-diag-btn" type="button" style="width:100%">自检</button>
              </div>
              <div class="fl-sec-note" id="fl-read-note"></div>
            </div>
            <div class="fl-sec">
              <div class="fl-sec-h">数 据 来 源<em>Source</em><span></span></div>
              <div class="fl-grid" id="fl-src-list"></div>
              <div class="fl-sec-note">隐藏上下文不影响读取：脚本读的是完整聊天记录，隐藏只是给消息打标记。
                删消息或重新生成才会丢状态，那时用存档快照兜底。</div>
            </div>
            <div class="fl-sec">
              <div class="fl-sec-h">读 取 日 志<em>Log</em><span id="fl-log-count"></span></div>
              <div class="fl-logbar">
                <button class="fl-btn ghost" id="fl-log-copy" type="button">复制日志</button>
                <button class="fl-btn ghost" id="fl-log-clear" type="button">清空</button>
              </div>
              <div class="fl-log" id="fl-log"></div>
              <div class="fl-sec-note">每读一次记一条：时间、谁触发、数据取自哪一层、楼层与数量。
                灰字是各级回退各自的结果——数字不对时，照着这一行就知道断在哪一层。
                日志只存在本机，换聊天会重记。</div>
            </div>
          </div>

          <div class="fl-pane on" id="fl-pane-look">
            <div class="fl-sec">
              <div class="fl-sec-h">主 题 色<em>Accent</em><span></span></div>
              <div class="fl-grid" id="fl-palette"></div>
              <div class="fl-sec-note">选一个主色，暗底、描边、纹章、悬浮星会一起跟着调，不会出现金底配冷色的拼接感。</div>
            </div>
            <div class="fl-sec">
              <div class="fl-sec-h">字 体 颜 色<em>Ink</em><span></span></div>
              <div class="fl-grid" id="fl-ink"></div>
              <div class="fl-sec-note">「跟随主题」会按主色算出一档协调的暖白/冷白；也可以固定成某个颜色。</div>
            </div>
            <div class="fl-preview">
              <b>时钟塔城</b>
              <i>治安</i><u>78</u>
              <i>民心</i><u>65</u>
              <i>金库</i><u>5.96 万</u>
            </div>
          </div>

          <div class="fl-pane" id="fl-pane-api">
            <div class="fl-sec">
              <div class="fl-sec-h">A I 凭 据<em>API</em><span></span></div>
              <div class="fl-sec-note" id="fl-api-note"></div>
              <div id="fl-api-mount" style="margin-top:12px"></div>
            </div>
          </div>

          <div class="fl-pane" id="fl-pane-about">
            <div class="fl-sec">
              <div class="fl-sec-h">版 本<em>About</em><span></span></div>
              <div class="fl-sec-note" id="fl-about-note"></div>
              <div class="fl-grid" style="margin-top:12px">
                <button class="fl-btn ghost" id="fl-reset-look" type="button" style="width:100%">恢复默认外观</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div class="fl-foot">
        <span id="fl-say"></span>
        <span class="fl-live" id="fl-live">自动</span>
      </div>
      <nav class="fl-nav" id="fl-nav"></nav>

      <div class="fl-scrim" id="fl-scrim"></div>
      <aside class="fl-drawer" id="fl-drawer"></aside>`;
    root.appendChild(screen);
    // screen 建好后再刷一次：全屏层的内联底色是写死的，必须换成主题色
    applyAccent(prefs.accent);

    heroEl = screen.querySelector('#fl-hero');
    metricsEl = screen.querySelector('#fl-metrics');
    tabsEl = screen.querySelector('#fl-tabs');
    navEl = screen.querySelector('#fl-nav');
    settingsEl = screen.querySelector('#fl-settings');
    viewEl = screen.querySelector('#fl-view');
    drawerEl = screen.querySelector('#fl-drawer');
    scrimEl = screen.querySelector('#fl-scrim');
    footEl = screen.querySelector('.fl-foot');
    domselEl = screen.querySelector('#fl-domsel');
    liveEl = screen.querySelector('#fl-live');
    sayEl = screen.querySelector('#fl-say');

    toastEl = el('div');
    toastEl.id = 'fief-ledger-toast';
    root.appendChild(toastEl);

    bindStarDrag();

    /* ---------------------------------------------------- 工作台（齿轮） */
    const setPanel = screen.querySelector('#fl-settings');
    let pane = 'look';

    const showPane = (name) => {
      // 不带参数时沿用上一次那一面：render 每帧都会调它，不能把「当前面」清空
      if (name) pane = name;
      const cur = pane;
      screen.querySelectorAll('.fl-set-tab').forEach((t) => t.classList.toggle('on', t.dataset.pane === cur));
      screen.querySelectorAll('.fl-pane').forEach((p) => p.classList.toggle('on', p.id === 'fl-pane-' + cur));
      if (cur === 'read') fillReadPane();
      if (cur === 'api') fillApiPane();
      if (cur === 'about') fillAboutPane();
    };
    // 设置是导航里的一页，不再有开关；外部只通过 goPage('设置') 切过来
    const panelOpen = () => page === '设置';

    screen.querySelector('#fl-set-tabs').addEventListener('click', (e) => {
      const t = e.target.closest('.fl-set-tab');
      if (t) showPane(t.dataset.pane);
    });
    showSetPane = showPane;

    /* ------------------------------------------------------ 底部导航 */
    // 事件委托一次就够：导航项会随 render 重绘，逐项绑会越绑越多
    navEl.addEventListener('click', (e) => {
      const n = e.target.closest('.fl-nav-i');
      if (!n) return;
      goPage(n.dataset.p);
    });

    /* --------------------------------------------------------- 读写面板 */
    const scanBtn = screen.querySelector('#fl-scan');
    scanBtn.addEventListener('click', () => {
      scanBtn.textContent = '读取中…';
      setTimeout(() => {
        try { rescan(true, '重新读取'); } catch (err) { toast('读取出错：' + (err && err.message ? err.message : err)); }
        scanBtn.textContent = '重新读取';
        fillReadPane();
      }, 40);
    });
    screen.querySelector('#fl-diag-btn').addEventListener('click', showDiag);

    // 读取日志：复制走剪贴板，被浏览器拦了就让用户长按选取
    screen.querySelector('#fl-log-copy').addEventListener('click', () => {
      if (!readLog.length) { toast('还没有日志'); return; }
      copyText(logPlain(), '读取日志已复制');
    });
    screen.querySelector('#fl-log-clear').addEventListener('click', () => {
      clearLog();
      renderLog();
      toast('日志已清空');
    });

    const autoBox = screen.querySelector('#fl-auto');
    autoBox.checked = prefs.auto;
    screen.querySelector('#fl-opt-auto').classList.toggle('on', prefs.auto);
    autoBox.addEventListener('change', () => {
      prefs.auto = autoBox.checked;
      savePrefs(prefs);
      screen.querySelector('#fl-opt-auto').classList.toggle('on', prefs.auto);
      if (prefs.auto) startAuto(); else stopAuto();
      toast(prefs.auto ? '自动检测已开' : '自动检测已关');
    });

    /* --------------------------------------------------------- 外观：主题 */
    const paletteEl = screen.querySelector('#fl-palette');
    const inkEl = screen.querySelector('#fl-ink');
    let themeColor = null;
    let inkColor = null;

    const optHtml = (dataAttr, value, name, swStyle) => '<button type="button" class="fl-opt" '
      + dataAttr + '="' + value + '" title="' + name + '">'
      + '<span class="fl-sw" style="--sw:' + (swStyle || value) + '"></span><u>' + name + '</u></button>';

    paletteEl.innerHTML = THEMES.map((t) => optHtml('data-accent', t.accent, t.name)).join('')
      + '<label class="fl-opt" title="自定义主色"><span class="fl-sw fl-sw-custom">'
      + '<input type="color" id="fl-color" value="' + prefs.accent + '"></span><u>自定义</u></label>';

    inkEl.innerHTML = INKS.map((k) => (k.hex
      ? optHtml('data-ink', k.hex, k.name)
      : '<button type="button" class="fl-opt" data-ink="auto" title="跟随主题">'
        + '<span class="fl-sw fl-sw-auto"></span><u>跟随主题</u></button>')).join('')
      + '<label class="fl-opt" title="自定义字色"><span class="fl-sw fl-sw-custom">'
      + '<input type="color" id="fl-ink-color" value="' + (prefs.text || '#ece2cc') + '"></span><u>自定义</u></label>';

    themeColor = screen.querySelector('#fl-color');
    inkColor = screen.querySelector('#fl-ink-color');

    const syncLookUI = () => {
      const cur = String(prefs.accent || DEFAULT_ACCENT).toLowerCase();
      if (themeColor && themeColor.value.toLowerCase() !== cur) themeColor.value = cur;
      paletteEl.querySelectorAll('.fl-opt[data-accent]').forEach((b) => {
        b.classList.toggle('on', String(b.dataset.accent).toLowerCase() === cur);
      });
      const ink = String(prefs.text || 'auto').toLowerCase();
      if (inkColor && prefs.text && inkColor.value.toLowerCase() !== ink) inkColor.value = ink;
      inkEl.querySelectorAll('.fl-opt[data-ink]').forEach((b) => {
        b.classList.toggle('on', String(b.dataset.ink).toLowerCase() === ink);
      });
    };

    const pickAccent = (hex, tip) => {
      prefs.accent = hexToRgb(hex) ? hex : DEFAULT_ACCENT;
      savePrefs(prefs);
      applyAccent(prefs.accent);
      syncLookUI();
      if (tip) toast(tip);
    };
    const pickInk = (hex, tip) => {
      prefs.text = hexToRgb(hex) ? hex : null;
      savePrefs(prefs);
      applyAccent(prefs.accent);
      syncLookUI();
      if (tip) toast(tip);
    };

    paletteEl.addEventListener('click', (e) => {
      const b = e.target.closest('.fl-opt[data-accent]');
      if (!b) return;
      const t = THEMES.find((x) => x.accent === b.dataset.accent);
      pickAccent(b.dataset.accent, t ? '主题色 · ' + t.name : '主题色已换');
    });
    inkEl.addEventListener('click', (e) => {
      const b = e.target.closest('.fl-opt[data-ink]');
      if (!b) return;
      const k = INKS.find((x) => (x.hex || 'auto') === b.dataset.ink);
      pickInk(b.dataset.ink === 'auto' ? null : b.dataset.ink, k ? '字色 · ' + k.name : '字色已换');
    });
    themeColor.addEventListener('input', () => {
      // 拖动取色器时实时预览：不存盘、不弹提示，免得刷一屏 toast
      prefs.accent = themeColor.value;
      applyAccent(prefs.accent);
      syncLookUI();
    });
    themeColor.addEventListener('change', () => {
      savePrefs(prefs); syncLookUI(); toast('自定义主色');
    });
    inkColor.addEventListener('input', () => {
      prefs.text = inkColor.value;
      applyAccent(prefs.accent);
      syncLookUI();
    });
    inkColor.addEventListener('change', () => {
      savePrefs(prefs); syncLookUI(); toast('自定义字色');
    });

    screen.querySelector('#fl-reset-look').addEventListener('click', () => {
      prefs.accent = DEFAULT_ACCENT;
      prefs.text = null;
      savePrefs(prefs);
      applyAccent(prefs.accent);
      syncLookUI();
      toast('外观已恢复默认');
    });

    syncLookUI();

    scrimEl.addEventListener('click', closeDrawer);
    screen.querySelector('#fl-close').addEventListener('click', close);
    doc.addEventListener('keydown', onKey);
  }

  /* ------------------------------------------------ 工作台里的两页面板 */
  function fillReadPane() {
    if (!screen) return;
    loadLog();   // 进来再读一次：启动时未必拿得到 chatId
    const note = screen.querySelector('#fl-read-note');
    if (note) {
      note.textContent = '当前来源：' + (lastStateSource || '未读取')
        + '　·　消息 ' + getMessages().length + ' 条'
        + '　·　补丁 ' + (data.patchCount || 0) + ' 条'
        + '　·　领地 ' + data.domains.length + ' 块';
    }
    const list = screen.querySelector('#fl-src-list');
    if (!list) return;
    const chips = [
      ['消息变量', 'stat_data 在消息变量里，最权威'],
      ['聊天变量', '部分整合包会同步一份'],
      ['历史补丁', '老存档靠补丁重放'],
      ['存档快照', '删消息/重新生成时兜底'],
      ['建筑档案库', '建筑单独留指纹与流水'],
    ];
    list.innerHTML = chips.map(([name, desc]) => {
      const on = String(lastStateSource || '').indexOf(name.slice(0, 2)) >= 0
        || (name === '建筑档案库' && String(lastStateSource || '') === '档案库');
      return '<div class="fl-opt' + (on ? ' on' : '') + '" style="cursor:default">'
        + '<span class="fl-sw" style="--sw:' + (on ? 'var(--fl-accent)' : 'var(--fl-surface2)') + '"></span>'
        + '<u title="' + desc + '">' + name + '</u></div>';
    }).join('');
    renderLog();
  }

  /** 一条日志里的数字串：楼层 → 消息 → 补丁 → 数量，缺的项直接跳过 */
  function logBits(r) {
    const bits = [];
    if (r.idx != null && r.idx >= 0) bits.push('楼 ' + (r.idx + 1));
    if (r.msgs != null) bits.push('消息 ' + r.msgs);
    if (r.patch != null) bits.push('补丁 ' + r.patch);
    bits.push('领地 ' + (r.dom || 0));
    bits.push('建筑 ' + (r.bld || 0));
    bits.push('库 ' + (r.stored || 0));
    return bits;
  }

  function renderLog() {
    if (!screen) return;
    const box = screen.querySelector('#fl-log');
    const cnt = screen.querySelector('#fl-log-count');
    if (cnt) cnt.textContent = readLog.length ? readLog.length + ' 条' : '';
    if (!box) return;
    if (!readLog.length) {
      box.innerHTML = '<div class="fl-log-empty">还没有记录——点「重新读取」或让 AI 回一楼，这里就开始记。</div>';
      return;
    }
    // 最新的在最上面：排错时先看刚发生的那次
    box.innerHTML = readLog.slice().reverse().map((r) => {
      if (r.kind === 'err') {
        return '<div class="fl-log-row err"><b>' + logTime(r.t) + '</b> <u>出错</u> '
          + esc(r.why || '') + '：' + esc(r.err || '') + '</div>';
      }
      // 三行各管一件事：谁触发、数字多少、第几层拿到——一眼看出断在哪
      const head = '<b>' + logTime(r.t) + '</b> <i>' + esc(r.why || '') + '</i>'
        + (r.src ? ' <u>' + esc(r.src) + '</u>' : '');
      const nums = '<em class="fl-log-num">' + esc(logBits(r).join(' · ')) + '</em>';
      // 一层一行：断在哪一层一眼看得到，不用在一长串里找
      const chain = Array.isArray(r.note) && r.note.length
        ? '<em>' + esc(r.note.join('\n')) + '</em>' : '';
      return '<div class="fl-log-row">' + head + nums + chain + '</div>';
    }).join('');
  }

  function logPlain() {
    const head = '领地档案 v' + VERSION + ' · 读取日志 · ' + new Date().toLocaleString()
      + ' · 聊天 ' + currentChatId();
    const lines = readLog.map((r) => {
      if (r.kind === 'err') return logTime(r.t) + ' 出错 ' + (r.why || '') + '：' + (r.err || '');
      return logTime(r.t) + ' ' + (r.why || '') + (r.src ? ' | ' + r.src : '')
        + '\n            ' + logBits(r).join(' · ')
        + (Array.isArray(r.note) && r.note.length ? '\n            ' + r.note.join('\n            ') : '');
    });
    return head + '\n' + (lines.length ? lines.join('\n') : '（无记录）');
  }

  function copyText(text, okTip) {
    let done = false;
    const fallback = () => {
      if (done) return;
      try {
        const ta = doc.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
        (doc.body || doc.documentElement).appendChild(ta);
        try { ta.focus(); ta.select(); if (ta.setSelectionRange) ta.setSelectionRange(0, text.length); } catch (e) { /* 忽略 */ }
        const ok = doc.execCommand && doc.execCommand('copy');
        if (ta.parentNode) ta.parentNode.removeChild(ta);
        done = true;
        toast(ok ? okTip : '复制被浏览器拦了，长按日志手动选取');
      } catch (e) { toast('复制被浏览器拦了，长按日志手动选取'); }
    };
    try {
      const nav = host.navigator || window.navigator;
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        nav.clipboard.writeText(text).then(() => { done = true; toast(okTip); }, fallback);
        return;
      }
    } catch (e) { /* 落到兜底 */ }
    fallback();
  }

  function fillAboutPane() {
    if (!screen) return;
    const note = screen.querySelector('#fl-about-note');
    if (!note) return;
    const store = countStored ? countStored() : 0;
    const chans = ['hook', 'event', 'data', 'msg'].filter((k) => chan && chan[k]);
    note.innerHTML = '领地档案 <b style="color:var(--fl-accent)">v' + esc(VERSION) + '</b>　·　检测通道 '
      + esc(chans.length ? chans.join(' / ') : '无') + '<br>'
      + '建筑档案库 ' + store + ' 座　·　偏好存 localStorage<br>'
      + '批注存 <code>_fiefLedgerNotes</code>，快照存 <code>_fiefLedgerSnapshot</code>，都跟聊天文件走。<br>'
      + '隐藏上下文不影响读取；删消息或重新生成才会丢状态。';
  }

  /* ------------------------------------------------------ AI 凭据面板 */
  // 挂载只做一次；之后每次切过来只重绘内容，不重建 DOM 根，省得滚动位置乱跳
  let apiMounted = false;
  function fillApiPane() {
    if (!screen) return;
    const mount = screen.querySelector('#fl-api-mount');
    const note = screen.querySelector('#fl-api-note');
    if (!mount) return;
    const mod = window.__fiefAISettings;
    if (!mod) {
      if (note) note.textContent = 'AI 面板模块没有加载，请重新导入脚本。';
      return;
    }
    if (note) {
      note.textContent = '外交页生成他国领地要用到这里配的接口。'
        + '地址与密钥只存本机，不写世界书、不进聊天、不随导出行走。';
    }
    if (!apiMounted) {
      try {
        mod.mount({ esc, toast: (m) => toast(m) });
      } catch (e) { reportError('AI 面板挂载', e); }
      apiMounted = true;
    }
    try {
      mod.render(mount);
    } catch (e) { reportError('AI 面板渲染', e); }
  }

  function onKey(e) {
    if (!screen || !screen.classList.contains('on')) return;
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (drawerEl && drawerEl.classList.contains('on')) { closeDrawer(); return; }
    // 不在领地页时，Esc 先回领地，再按一次才关面板
    if (page !== '领地') { goPage('领地'); return; }
    close();
  }

  function bindStarDrag() {
    let drag = null;
    let dragged = false;
    let lastOpen = 0;

    // 轻点打开：三条事件通道都试，谁先到算谁的，220ms 内只认一次。
    // 手机端 pointerup 可能被手势吞掉，只靠它会出现「点了没反应」。
    const tap = (e) => {
      if (dragged) { dragged = false; return; }
      const now = Date.now();
      if (now - lastOpen < 220) return;
      lastOpen = now;
      if (e && e.cancelable) { try { e.preventDefault(); } catch (err) { /* 忽略 */ } }
      // 闪一下，让人知道「点到了」——打不开时也能区分是没点中还是没打开
      try {
        star.classList.remove('fl-flash');
        void star.offsetWidth;
        star.classList.add('fl-flash');
        setTimeout(() => star.classList.remove('fl-flash'), 1100);
      } catch (err) { /* 忽略 */ }
      open();
    };

    const onDown = (e) => {
      if (e.button != null && e.button !== 0) return;
      const r = star.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, moved: false };
      dragged = false;
      try { star.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      star.classList.add('fl-dragging');
      // 这里不 preventDefault：一 preventDefault，浏览器可能就不派发后续 click
    };

    const onMove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      // 手指按下去本来就会抖 5~8px，阈值太小会把轻点误判成拖动
      if (!drag.moved && Math.sqrt(dx * dx + dy * dy) < 9) return;
      drag.moved = true;
      dragged = true;
      const w = star.offsetWidth || 58, h = star.offsetHeight || 58;
      const vw = host.innerWidth || doc.documentElement.clientWidth || 800;
      const vh = host.innerHeight || doc.documentElement.clientHeight || 600;
      star.style.left = Math.max(4, Math.min(vw - w - 4, drag.l + dx)) + 'px';
      star.style.top = Math.max(4, Math.min(vh - h - 4, drag.t + dy)) + 'px';
      star.style.right = 'auto';
      if (e.cancelable) e.preventDefault();
    };

    const onUp = (e) => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      star.classList.remove('fl-dragging');
      try { star.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      if (moved) {
        prefs.pos = { left: star.style.left, top: star.style.top };
        savePrefs(prefs);
        // 拖动后紧跟的 click 要挡掉，60ms 后恢复正常
        setTimeout(() => { dragged = false; }, 60);
      } else tap(e);
    };

    star.addEventListener('pointerdown', onDown);
    star.addEventListener('pointermove', onMove);
    star.addEventListener('pointerup', onUp);
    star.addEventListener('pointercancel', onUp);
    star.addEventListener('click', tap);
    star.addEventListener('touchend', tap);

    // 最后一道保险：酒馆里偶尔有别的浮层压住星标，
    // 它的 pointerdown 收不到，但按在星标那一小块上仍然应该能开。
    doc.addEventListener('pointerup', (e) => {
      if (!star || screen.classList.contains('on')) return;
      if (drag && drag.moved) return;
      if (e.button != null && e.button !== 0) return;
      const r = star.getBoundingClientRect();
      if (r.width < 1) return;
      const pad = 8;
      if (e.clientX >= r.left - pad && e.clientX <= r.right + pad
        && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad) tap(e);
    }, true);
  }

  // 手机浏览器的地址栏会吃掉一截高度：100vh 往往比真正看得见的那块大，
  // 于是面板底部被顶到屏幕外，表现就是「上半截有内容、下面一大片黑」。
  // 这里按可见视口重新铺一遍，地址栏收起、横竖屏切换时跟着改。
  let vpBound = false;
  function fitViewport() {
    try {
      const vv = (host && host.visualViewport) || window.visualViewport;
      let w = (vv && vv.width) || (host && host.innerWidth) || window.innerWidth || 0;
      let h = (vv && vv.height) || (host && host.innerHeight) || window.innerHeight || 0;
      // 面板被错误地挂进几十像素高的 iframe 时，别跟着一起缩，那样等于把它弄没了
      if (h >= 320) screen.style.height = Math.round(h) + 'px';
      if (w >= 240) screen.style.width = Math.round(w) + 'px';
    } catch (e) { /* 拿不到就算了，保留 100vh 兜底 */ }
    if (!vpBound) {
      vpBound = true;
      try {
        window.addEventListener('resize', fitViewport);
        const vv2 = (host && host.visualViewport) || window.visualViewport;
        if (vv2 && vv2.addEventListener) vv2.addEventListener('resize', fitViewport);
      } catch (e) { /* 忽略 */ }
    }
  }

  function open() {
    try {
      fitViewport();
      screen.classList.add('on');
      screen.classList.add('vis');   // 同步加，别等动画帧：等不到就会变成透明全屏层
      // 显示全部走内联：宿主跨窗口时 requestAnimationFrame 可能抛
      // Illegal invocation，或 iframe 不可见时干脆不回调。
      screen.style.display = 'flex';
      screen.style.opacity = '1';
      screen.style.transform = 'none';
      screen.style.pointerEvents = 'auto';
      rescan(false, '打开面板');
      setTimeout(showSelfCheck, 500);
    } catch (err) {
      reportError('open', err);
    }
  }

  // 面板铺不满屏时（宿主 iframe 太矮、样式被清、被别的层压住），
  // 把实际尺寸摊在屏幕上，手机上看一眼就知道卡在哪一步。
  function showSelfCheck() {
    try {
      if (!screen.classList.contains('on')) return;
      const r = screen.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      const cs = host.getComputedStyle ? host.getComputedStyle(screen) : null;
      if (r.width >= 80 && r.height >= 80) return;
      let box = doc.getElementById('fief-ledger-diagbox');
      if (!box) {
        box = el('div');
        box.id = 'fief-ledger-diagbox';
        box.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:2147483647;'
          + 'background:#c02020;color:#fff;font:13px/1.6 monospace;padding:10px;'
          + 'border-radius:4px;pointer-events:none;word-break:break-all;';
        root.appendChild(box);
      }
      box.textContent = '领地档案自检 · 面板 ' + Math.round(r.width) + '×' + Math.round(r.height)
        + ' · 外壳 ' + Math.round(rr.width) + '×' + Math.round(rr.height)
        + ' · ' + (cs ? cs.display + '/' + cs.opacity + '/' + cs.position : 'no-style')
        + ' · v' + VERSION;
    } catch (e) { /* 忽略 */ }
  }

  function close() {
    try { closeDrawer(); } catch (err) { /* 忽略 */ }
    // 下次打开回到领地页，而不是停在离开时的设置
    page = '领地';
    screen.classList.remove('vis');
    screen.style.opacity = '0';
    screen.style.pointerEvents = 'none';   // 淡出途中立刻让出点击，别再挡界面
    setTimeout(() => {
      if (screen.classList.contains('vis')) return;
      screen.classList.remove('on');
      screen.style.display = 'none';
      screen.style.transform = '';
    }, 200);
  }

  function requestAnimationFrameSafe(fn) {
    // 跨窗口取到的 rAF 直接调用会抛 Illegal invocation，必须带着宿主当 this；
    // 拿不到就退回 setTimeout，绝不能因为动画帧不执行而卡住显示。
    try {
      if (typeof host.requestAnimationFrame === 'function') {
        host.requestAnimationFrame.call(host, fn);
        return;
      }
    } catch (err) { /* 落到 window */ }
    try {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(fn);
        return;
      }
    } catch (err) { /* 落到 setTimeout */ }
    setTimeout(fn, 16);
  }

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('on'), 2800);
  }

  // 手机上拿不到控制台，出错的最后一条留在 lastError 里，自检页能看到
  let lastError = '';
  function reportError(tag, err) {
    const msg = (err && (err.message || err.reason)) || String(err);
    lastError = tag + '：' + msg;
    try { console.error('[领地档案] ' + tag, err); } catch (e) { /* 忽略 */ }
    try { logPush('err', { why: tag, err: msg }); } catch (e) { /* 忽略 */ }
    try { toast('出错了：' + msg); } catch (e) { /* 忽略 */ }
  }

  /* ------------------------------------------------------- 当前领地 */
  function currentDomain() {
    if (!data.domains.length) return null;
    if (domIdx >= data.domains.length) domIdx = 0;
    return data.domains[domIdx];
  }

  function sumMoney(list) {
    let n = 0;
    for (const x of list || []) n += (x.数额 || 0);
    return n;
  }

  /** 驻军：区块里的 [驻军] 与内部资产里的兵种合并，同名的只留一条 */
  function militaryOf(d) {
    const map = new Map();
    for (const it of d.items || []) {
      if (!/军事|军政/.test(it.category)) continue;
      map.set(it.name, {
        name: it.name,
        n: numberOf(it.quantity) || 0,
        tier: it.quality || '',
        status: it.status || '',
        fx: it.effects || [],
        from: '内部资产',
      });
    }
    for (const u of (d.info && d.info.军事) || []) {
      const key = u.编制 || '';
      if (!key) continue;
      const cur = map.get(key);
      if (cur) {
        cur.n = numberOf(u.人数) || cur.n;
        cur.tier = u.层级 || cur.tier;
        cur.from = '总览+内部资产';
      } else {
        map.set(key, { name: key, n: numberOf(u.人数) || 0, tier: u.层级 || '', status: '', fx: [], from: '总览区块' });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.n - a.n);
  }

  /* ------------------------------------------------------------ 头部 */
  function renderTop(d) {
    domselEl.innerHTML = data.domains.length > 1
      ? data.domains.map((x, i) => `<span class="fl-domchip${i === domIdx ? ' on' : ''}" data-i="${i}">${esc(x.name)}</span>`).join('')
      : '';
    domselEl.querySelectorAll('.fl-domchip').forEach((c) => {
      c.addEventListener('click', () => {
        domIdx = Number(c.dataset.i) || 0;
        closeDrawer();
        render();
      });
    });
  }

  function chipsOf(d) {
    const meta = d.meta || {};
    const info = d.info || {};
    const out = [];
    const tierName = (d.tier && d.tier.name) || meta.规模档 || info.规模档;
    if (tierName) out.push(['规模 ' + tierName, 'gold']);
    const power = meta.势力 || info.所属势力;
    if (power) out.push(['所属 ' + power, '']);
    const q = meta.品质 || '';
    if (q) out.push(['品质 ' + q, '']);
    const mode = meta.治理模式 || info.治理模式;
    if (mode) out.push(['治理 ' + mode, 'green']);
    const st = meta.领地状态 || info.状态;
    if (st) out.push(['状态 ' + st, '']);
    if (meta.拥有者) out.push(['拥有者 ' + meta.拥有者, '']);
    if (info.治下 && info.治下.副) out.push(['副手 ' + info.治下.副, '']);
    if (d.fromStore && !d.items.some((x) => !x.missing)) out.push(['档案复原', 'blue']);
    return out.map(([t, c]) => `<span class="fl-chip ${c}">${esc(t)}</span>`).join('');
  }

  function renderHero(d) {
    if (!d) {
      heroEl.innerHTML = '';
      return;
    }
    const meta = d.meta || {};
    const loc = meta.位置 || '';
    const tier = d.tier;
    const n = tier ? tier.n : 0;
    let segs = '';
    for (let i = 1; i <= 7; i += 1) {
      segs += `<div class="fl-seg${i <= n ? ' on' : ''}${i === n ? ' cur' : ''}"></div>`;
    }
    const next = tier && tier.n < 7 ? TIERS[tier.n] : null;
    heroEl.innerHTML = `
      <div class="fl-crest">${crestSvg(d.name, tier)}</div>
      <div class="fl-hmain">
        <div class="fl-hname">${esc(d.name)}</div>
        <div class="fl-hsub">${esc(loc || (d.fromBlock ? '仅读到总览区块' : '位置未标注'))}</div>
        <div class="fl-chips">${chipsOf(d)}</div>
      </div>
      <div class="fl-ladder">
        <div class="fl-lad-h"><i>规 模</i><b>${tier ? tier.name : '未标注'}</b>${tier ? `<i>${tier.n}/7</i>` : ''}</div>
        <div class="fl-segs">${segs}</div>
        <div class="fl-lad-f">${tier ? `建筑槽 ${tier.slot}　·　基础月结余 ${tier.base}` : '未读到规模档'}</div>
        <div class="fl-lad-n">${next ? `下一档 ${next.name}　槽 ${next.slot}　${next.base}` : (tier ? '已在阶梯顶档' : '')}</div>
      </div>`;
  }

  function meterHtml(score, cls) {
    if (score == null) return '';
    return `<div class="fl-meter ${cls}"><s style="width:${Math.max(4, Math.min(100, score))}%"></s></div>`;
  }

  function renderMetrics(d) {
    if (!d) { screen.querySelector('#fl-metrics').innerHTML = ''; return; }
    const g = d.gov || {};
    const q = scoreOf(g.治安);
    const m = scoreOf(g.民心);
    const stock = stockOf(g.物资);
    const units = militaryOf(d);
    const troops = units.reduce((a, u) => a + (u.n || 0), 0);

    let pips = '';
    for (let i = 1; i <= 4; i += 1) pips += `<s class="${i <= stock.i ? 'on' : ''}"></s>`;
    const pipCls = stock.i === 1 ? 'bad' : stock.i === 2 ? 'warn' : '';

    const qCls = q == null ? '' : q >= 70 ? 'good' : q < 40 ? 'bad' : '';
    const mCls = m == null ? '' : m >= 70 ? 'good' : m < 40 ? 'bad' : '';

    const cells = [
      `<div class="fl-metric"><i>治 安</i><b>${q == null ? esc(g.治安 || '—') : q + '<u>/100</u>'}</b>${meterHtml(q, qCls)}</div>`,
      `<div class="fl-metric"><i>民 心</i><b>${m == null ? esc(g.民心 || '—') : m + '<u>/100</u>'}</b>${meterHtml(m, mCls)}</div>`,
      `<div class="fl-metric"><i>物 资</i><b>${esc(stock.name)}</b><div class="fl-pips ${pipCls}">${pips}</div></div>`,
      `<div class="fl-metric"><i>人 口</i><b>${esc(g.人口 || '—')}</b><div class="fl-meter"><s style="width:${d.tier ? d.tier.n * 13 : 8}%;opacity:.55"></s></div></div>`,
      `<div class="fl-metric"><i>金 库</i><b title="${g.金库 == null ? '' : fmtNum(g.金库) + ' ' + esc(g.货币 || '')}">${g.金库 == null ? '—' : fmtCompact(g.金库)}<small class="fl-cur">${esc(g.货币 || '')}</small></b></div>`,
      `<div class="fl-metric"><i>军 事</i><b title="${troops ? fmtNum(troops) + ' 人' : ''}">${troops ? fmtCompact(troops) : '—'}<small>${troops ? ' 人' : ''}</small></b></div>`,
    ];
    screen.querySelector('#fl-metrics').innerHTML = cells.join('');
  }

  /* ------------------------------------------------------ 页面切换 */
  /** 先把「哪一块可见」定下来：领地页才显示纹章/指标/横滑页签，设置页换成设置面板 */
  function applyPage() {
    const isFief = page === '领地';
    if (heroEl) heroEl.style.display = isFief ? '' : 'none';
    if (metricsEl) metricsEl.style.display = isFief ? '' : 'none';
    if (tabsEl) tabsEl.style.display = isFief ? '' : 'none';
    if (viewEl) viewEl.style.display = page === '设置' ? 'none' : '';
    if (settingsEl) settingsEl.classList.toggle('on', page === '设置');
    if (page === '设置') { try { showSetPane(); } catch (e) { /* 忽略 */ } }
  }

  function goPage(k) {
    if (!k || page === k) return;
    page = k;
    // 自检只属于领地页，切走就撤掉，回来是正常的视图
    if (k !== '领地') selected = null;
    try { screen.scrollTop = 0; } catch (e) { /* 忽略 */ }
    if (viewEl) viewEl.scrollTop = 0;
    render();
  }

  function renderNav() {
    if (!navEl) return;
    navEl.innerHTML = PAGES.map((p) => {
      const on = page === p.k;
      return '<div class="fl-nav-i' + (on ? ' on' : '') + '" data-p="' + p.k + '"'
        + ' role="tab" aria-selected="' + (on ? 'true' : 'false') + '" title="' + p.k + '">'
        + '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"'
        + ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
        + p.p.map((d) => '<path d="' + d + '"/>').join('') + '</svg>'
        + '<span class="fl-nav-lb"><b>' + p.k + '</b>'
        + (p.tag ? '<i class="fl-nav-tag">' + p.tag + '</i>' : '')
        + '</span>'
        + '</div>';
    }).join('');
  }

  function renderTabs(d) {
    const counts = {
      建筑: d ? d.items.length : 0,
      军政: d ? militaryOf(d).length : 0,
      资源: d && d.info ? d.info.物产.length : 0,
      账本: d && d.report ? 1 : 0,
      规划: data.plans.length,
    };
    tabsEl.innerHTML = TABS.map((t) => {
      const c = counts[t];
      return `<div class="fl-tab${tab === t ? ' on' : ''}" data-t="${t}">${t}${c ? `<u>${c}</u>` : ''}</div>`;
    }).join('');
    tabsEl.querySelectorAll('.fl-tab').forEach((n) => {
      n.addEventListener('click', () => {
        tab = n.dataset.t;
        catFilter = '全部';
        keyword = '';
        render();
      });
    });
  }

  function renderFoot() {
    if (!sayEl) return;
    const n = data.domains.reduce((a, d) => a + d.items.length, 0);
    const arch = data.domains.reduce((a, d) => a + d.items.filter((it) => it.missing).length, 0);
    sayEl.innerHTML = data.domains.length
      ? `领地 <b>${data.domains.length}</b> · 建筑 <b>${n}</b>${arch ? ` · 档案 <b>${arch}</b>` : ''} · 来源 <b>${esc(lastStateSource)}</b> · 消息 ${data.msgCount} 条 · 补丁 ${data.patchCount} 条`
      : `未读到领地 · 来源 ${esc(lastStateSource)} · 消息 ${data.msgCount} 条`;
    if (!data.domains.length) sayEl.style.color = 'rgba(212,127,108,.75)';
    else sayEl.style.color = '';
  }

  /* ------------------------------------------------------------ 总览 */
  function section(title, note, body) {
    return `<div class="fl-sec"><div class="fl-sec-h"><span>${title}</span><s></s>${note ? `<em>${note}</em>` : ''}</div>${body}</div>`;
  }

  function noticesOf(d) {
    const g = d.gov || {};
    const info = d.info || {};
    const out = [];
    const push = (label, text) => {
      const t = String(text || '').trim();
      if (!t) return;
      for (const x of out) if (x.text === t) return;
      out.push({ label: label, text: t });
    };
    for (const x of info.要事 || []) push('要事', x);
    for (const x of info.营造 || []) push('营造', x.名 + (x.数量 && Number(x.数量) > 1 ? ' ×' + x.数量 : '') + (x.状态 ? ' · ' + x.状态 : ''));
    for (const it of d.items || []) if (/建设中|在建/.test(it.status)) push('建设中', it.name);
    if (d.report && d.report.待决) push('待决', d.report.待决.事);
    for (const x of info.邻邦 || []) push('邻邦', x);
    if (!out.length && g.状态) push('局势', g.状态);
    return out;
  }

  function catCounts(d) {
    const map = new Map();
    for (const it of d.items || []) {
      const k = it.category || '其他';
      const cur = map.get(k) || { all: 0, on: 0, build: 0 };
      cur.all += 1;
      if (bucketOf(it.status) === '运营中') cur.on += 1;
      if (bucketOf(it.status) === '建设中') cur.build += 1;
      map.set(k, cur);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].all - a[1].all);
  }

  function overviewHtml(d) {
    const g = d.gov || {};
    const info = d.info || {};
    const notices = noticesOf(d);

    let html = '';

    /* 要事：整行，两列排 */
    const noticeBody = notices.length
      ? `<div class="fl-box fl-notice fl-notice-2">${notices.slice(0, 8).map((x) => `<div class="fl-notice-r"><i></i><span><b>${esc(x.label)}</b>　${esc(x.text)}</span></div>`).join('')}</div>`
      : `<div class="fl-box"><div class="fl-empty" style="padding:16px 8px"><small>总览区块里没有要事、营造或邻邦动向</small></div></div>`;
    html += section('要 事', notices.length ? '当前最要紧的几件' : '', noticeBody);

    html += `<div class="fl-duo"><div>`;

    /* 空间 */
    const total = g.总空间 || 0;
    const free = g.空闲 || 0;
    const used = Math.max(0, total - free);
    if (total) {
      const pct = Math.min(100, Math.round((used / total) * 100));
      html += section('总 空 间', '', `<div class="fl-box">
        <div class="fl-space-h"><span>已用 ${fmtArea(used)}</span><b>${pct}%</b></div>
        <div class="fl-space-bar"><s style="width:${Math.max(2, pct)}%"></s></div>
        <div class="fl-space-h" style="margin-top:8px"><span>总面积 ${fmtArea(total)}</span><span>空闲 ${fmtArea(free)}</span></div>
      </div>`);
    }

    /* 建筑构成 */
    const cats = catCounts(d);
    if (cats.length) {
      html += section('建 筑 构 成', d.items.length + ' 座', `<div class="fl-box" style="padding:8px 14px">
        ${cats.map(([k, v]) => `<div class="fl-kv" data-cat="${esc(k)}" style="padding:7px 0">
          <k style="width:auto;display:flex;align-items:center;gap:8px;color:var(--fl-cat)">
            <span class="fl-ic" style="width:14px;height:14px;display:block;flex:none;opacity:.9">${iconOf(k)}</span>${esc(k)}</k>
          <v style="text-align:right;font-variant-numeric:tabular-nums;color:rgba(var(--fl-text-rgb),.9)">${v.all}<span class="fl-catnote" style="color:var(--fl-dimmer);font-size:11px">　运营中 ${v.on} · 建设中 ${v.build}</span></v>
        </div>`).join('')}
      </div>`);
    }

    html += `</div><div>`;

    /* 治下 */
    if (info.治下) {
      const t = info.治下;
      html += section('治 下', '', `<div class="fl-box"><div class="fl-kvs">
        ${[['头衔', t.头衔], ['领主', t.主], ['副手', t.副], ['态度', t.态度]]
          .filter((x) => x[1]).map(([k, v]) => `<div class="fl-kv"><k>${k}</k><v>${esc(v)}</v></div>`).join('')}
      </div></div>`);
    }

    /* 胜景 */
    if ((info.胜景 || []).length) {
      html += section('胜 景', '', `<div class="fl-box"><div class="fl-notice">
        ${info.胜景.map((x) => `<div class="fl-notice-r"><i></i><span>${esc(x)}</span></div>`).join('')}
      </div></div>`);
    }

    /* 简介 */
    const intro = g.描述正文 || (d.meta && d.meta.位置) || '';
    if (intro) {
      html += section('描 述', '', `<div class="fl-box fl-desc">${esc(intro).replace(/\n/g, '<br>')}</div>`);
    }

    html += `</div></div>`;
    return html;
  }

  /* ------------------------------------------------------------ 建筑 */
  /** 建筑 + 出现过的分类（按出现先后，供筛选条用） */
  function itemsOf(d) {
    const list = (d.items || []).slice();
    const cats = [];
    for (const it of list) if (cats.indexOf(it.category) < 0) cats.push(it.category);
    return { list, cats };
  }

  function buildingCardHtml(it) {
    const key = it.domain + '::' + it.name;
    const hasNote = !!(notes[key] && notes[key].trim());
    const out = it.output || (/\d/.test(it.quant || '') ? it.quant : '');
    return `<div class="fl-card" data-cat="${esc(it.category)}" data-k="${esc(key)}">
      <div class="fl-card-t">
        <span class="fl-ic">${iconOf(it.category)}</span>
        <span class="fl-card-n">${esc(it.name)}</span>
        ${hasNote ? '<span class="fl-dot" title="有批注"></span>' : ''}
      </div>
      <div class="fl-card-m">
        <span class="fl-pill ${statusClass(it.status)}">${esc(it.status || '未标注')}</span>
        ${it.removed ? '<span class="fl-tag">已拆</span>' : (it.missing ? '<span class="fl-tag">档案</span>' : '')}
        ${it.quality ? `<span class="fl-tag gold">${esc(it.quality)}</span>` : ''}
        ${it.location ? `<span class="fl-tag">${esc(it.location)}</span>` : ''}
        ${it.quantity && Number(it.quantity) > 1 ? `<span class="fl-tag">×${esc(it.quantity)}</span>` : ''}
      </div>
      ${it.brief || it.desc ? `<div class="fl-card-d">${esc(it.brief || it.desc)}</div>` : ''}
      ${out ? `<div class="fl-card-o"><b>${esc(out)}</b></div>` : ''}
    </div>`;
  }

  function buildingsHtml(d) {
    const { list, cats } = itemsOf(d);
    if (!list.length) {
      return `<div class="fl-empty"><b>◇</b>没有建筑记录
        <small>${d.fromBlock ? '当前只读到总览区块，变量与补丁里没有「内部资产」明细' : '内部资产里没有条目'}</small>
        <small>点右上角「自检」看卡在哪一层</small></div>`;
    }
    const f = catFilter;
    const kw = keyword.trim();
    const shown = list.filter((it) => {
      if (f !== '全部' && it.category !== f) return false;
      if (!kw) return true;
      const hay = [it.name, it.category, it.location, it.quant, it.output, it.quality, it.desc].join(' ');
      return hay.indexOf(kw) >= 0;
    });

    const chip = (label, n, on, cat) => `<span class="fl-fchip${on ? ' on' : ''}" data-f="${esc(label)}" data-cat="${esc(cat || '')}">${cat ? `<i></i>` : ''}${esc(label)}<u>${n}</u></span>`;

    let bar = `<div class="fl-chipbar">${chip('全部', list.length, f === '全部')}`;
    for (const c of cats) bar += chip(c, list.filter((x) => x.category === c).length, f === c, c);
    bar += `<input class="fl-q" id="fl-q" type="text" placeholder="搜建筑 / 位置 / 产出…" value="${esc(keyword)}"></div>`;

    if (!shown.length) return bar + '<div class="fl-empty"><b>◇</b>没有匹配的建筑</div>';

    const groups = new Map();
    for (const it of shown) {
      const g = it.location || '未分区';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(it);
    }
    let html = bar;
    for (const [g, arr] of groups) {
      arr.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
      html += section(esc(g).toUpperCase(), `${arr.length} 座`, `<div class="fl-cards">${arr.map(buildingCardHtml).join('')}</div>`);
    }
    return html;
  }

  /* ------------------------------------------------------------ 军政 */
  function militaryHtml(d) {
    const units = militaryOf(d);
    const max = units.reduce((a, u) => Math.max(a, u.n || 0), 0) || 1;
    const troops = units.reduce((a, u) => a + (u.n || 0), 0);
    const report = d.report;
    const FORMATION = ['民兵与巡逻队', '民兵与巡逻队', '守备队，含少量职业兵', '常备守备军，可有骑兵或魔导',
      '成建制军团，可含飞行或大型魔物', '多支军团与边防军', '常备军、禁卫军与后备动员'];
    const formation = d.tier ? FORMATION[d.tier.n - 1] : '';
    const pay = report ? report.支出.filter((x) => /军|薪|饷|兵/.test(x.项目)) : [];
    const payer = pay.reduce((a, x) => a + (x.数额 || 0), 0);

    if (!units.length) {
      return `<div class="fl-empty"><b>◇</b>没有驻军记录
        <small>军事写在领地内部资产里，类型为兵种、数量为人数的条目</small></div>`;
    }

    let html = section('军 事', `合计 ${fmtNum(troops)} 人 · ${units.length} 编制`, `<div class="fl-box"><div class="fl-kvs">
      ${units.map((u) => `<div class="fl-kv" style="display:block;padding:10px 0">
        <div style="display:flex;align-items:baseline;gap:10px">
          <span style="flex:1;font-size:13px;color:var(--fl-bright);letter-spacing:.5px">${esc(u.name)}</span>
          ${u.tier ? `<span class="fl-tag gold">${esc(u.tier)}</span>` : ''}
          <span style="font-variant-numeric:tabular-nums;color:rgba(var(--fl-text-rgb),.9);font-size:13px">${u.n ? fmtNum(u.n) + ' 人' : '—'}</span>
        </div>
        <div class="fl-space-bar" style="margin-top:8px;height:3px"><s style="width:${Math.max(3, Math.round((u.n || 0) / max * 100))}%;background:linear-gradient(90deg,rgba(126,156,201,.28),rgba(126,156,201,.72))"></s></div>
        ${(u.fx || []).length ? `<div class="fl-fx" style="margin-top:9px;gap:5px">${u.fx.slice(0, 4).map((e) => `<div class="fl-fx-r" style="font-size:11.5px"><b style="min-width:72px;color:rgba(126,156,201,.85)">${esc(e.k)}</b><span style="color:rgba(var(--fl-text-rgb),.62)">${esc(e.v)}</span></div>`).join('')}</div>` : ''}
        ${u.status ? `<div style="margin-top:7px;font-size:10.5px;color:var(--fl-dimmer);letter-spacing:.5px">${esc(u.status)}　·　${esc(u.from)}</div>` : ''}
      </div>`).join('')}
    </div></div>`);

    html += section('军 费', '', `<div class="fl-box"><div class="fl-kvs">
      <div class="fl-kv"><k>固定军费</k><v class="mono">${pay.length ? fmtNum(payer) + ' ' + esc(report.货币 || '') : '账本里未单列'}</v></div>
      ${formation ? `<div class="fl-kv"><k>本级编制</k><v>${esc(formation)}<span style="color:var(--fl-dimmer);font-size:11px">　（${esc(d.tier.name)}档参考）</span></v></div>` : ''}
      <div class="fl-kv"><k>军费口径</k><v>村庄与乡镇的民兵、巡逻队由份地与口粮自给，不扣金库；城镇以上的职业兵团才逐月计入</v></div>
      <div class="fl-kv"><k>数据来源</k><v>${esc(units.map((u) => u.from).filter((v, i, a) => a.indexOf(v) === i).join(' / '))}</v></div>
    </div></div>`);

    return html;
  }

  /* ------------------------------------------------------------ 资源 */
  function resourcesHtml(d) {
    const info = d.info || {};
    const g = d.gov || {};
    const stock = stockOf(g.物资);
    let html = '';

    let pips = '';
    for (let i = 1; i <= 4; i += 1) pips += `<s class="${i <= stock.i ? 'on' : ''}"></s>`;
    html += section('物 资', g.物资 ? '物资以四档记' : '', `<div class="fl-box">
      <div class="fl-space-h"><span>${esc(stock.name)}</span><b>${stock.i ? stock.i + '/4' : '—'}</b></div>
      <div class="fl-pips ${stock.i === 1 ? 'bad' : stock.i === 2 ? 'warn' : ''}" style="display:flex;gap:4px;margin-top:10px">${pips}</div>
      ${g.商路 ? `<div class="fl-space-h" style="margin-top:12px"><span>商路</span><b style="color:var(--fl-ok)">${esc(g.商路)}</b></div>` : ''}
    </div>`);

    if ((info.物产 || []).length) {
      html += section('物 产', `${info.物产.length} 项`, `<div class="fl-box"><div class="fl-kvs">
        ${info.物产.map((x) => `<div class="fl-kv">
          <k style="width:auto;min-width:88px">${esc(x.名)}</k>
          <v class="mono">${esc(x.数量)}${x.周期 ? ` / ${esc(x.周期)}` : ''}</v>
          <v style="flex:none;text-align:right;color:var(--fl-dim);font-size:11.5px">${esc(x.状态 || '')}</v>
        </div>`).join('')}
      </div></div>`);
    }

    const econ = (d.items || []).filter((it) => it.output || (/资源点|经济/.test(it.category) && /\d/.test(it.quant || '')));
    if (econ.length) {
      html += section('产 出 与 效 果', `${econ.length} 座`, `<div class="fl-box"><div class="fl-kvs">
        ${econ.map((it) => `<div class="fl-kv" data-cat="${esc(it.category)}">
          <k style="width:auto;min-width:88px;color:var(--fl-cat)">${esc(it.name)}</k>
          <v>${esc(it.quant || it.output)}</v>
          <v style="flex:none"><span class="fl-pill ${statusClass(it.status)}">${esc(it.status)}</span></v>
        </div>`).join('')}
      </div></div>`);
    }

    if (!html) {
      return `<div class="fl-empty"><b>◇</b>没有资源记录
        <small>物产、仓储与产出都从总览区块和建筑效果里读</small></div>`;
    }
    return html;
  }

  /* ------------------------------------------------------------ 账本 */
  function ledgerHtml(d) {
    const r = (d && d.report) || (data.reports && data.reports.last);
    if (!r) {
      return `<div class="fl-empty"><b>◇</b>还没有账本
        <small>每月结算后 AI 会输出 &lt;fief_report&gt;，这里才会有内容</small>
        <small>旧存档可能从来没结算过——不影响建筑与指标</small></div>`;
    }
    const unit = r.货币 || (d && d.gov && d.gov.货币) || '';
    const inc = sumMoney(r.收入);
    const exp = sumMoney(r.支出);
    const net = inc - exp;
    const shownNet = r.净额 != null ? r.净额 : net;
    const mismatch = r.净额 != null && Math.abs(r.净额 - net) > 0.5;

    const row = (x, cls) => `<div class="fl-led-row">
      <span class="n">${esc(x.项目)}</span>
      <span class="v ${cls}">${x.数额 == null ? '—' : (cls === 'in' ? '+' : '−') + fmtNum(Math.abs(x.数额))}</span>
    </div>`;

    let table = '<div class="fl-ledger">';
    table += `<div class="fl-led-row kind"><span>收 入</span><em>${fmtNum(inc)} ${esc(unit)}</em></div>`;
    table += r.收入.length ? r.收入.map((x) => row(x, 'in')).join('') : '<div class="fl-led-row"><span class="n" style="color:var(--fl-dimmer)">本期无收入行</span></div>';
    table += `<div class="fl-led-row kind"><span>支 出</span><em>${fmtNum(exp)} ${esc(unit)}</em></div>`;
    table += r.支出.length ? r.支出.map((x) => row(x, 'out')).join('') : '<div class="fl-led-row"><span class="n" style="color:var(--fl-dimmer)">本期无支出行</span></div>';
    table += `<div class="fl-led-row total"><span class="n">本 期 净 额</span><span class="v" style="color:${shownNet < 0 ? 'var(--fl-bad)' : 'var(--fl-ok)'}">${shownNet < 0 ? '−' : '+'}${fmtNum(Math.abs(shownNet))}</span></div>`;
    if (r.期末 != null) {
      table += `<div class="fl-led-row total"><span class="n">期 末 金 库</span><span class="v" style="color:var(--fl-accent)">${fmtNum(r.期末)} <span style="font-size:10.5px;color:var(--fl-dimmer)">${esc(unit)}</span></span></div>`;
    }
    table += '</div>';

    if (mismatch) {
      table += `<div class="fl-led-warn">明细加减得 ${fmtNum(net)}，区块写的是 ${fmtNum(r.净额)}——两处数字不一致，按区块的记，但值得回楼里看一眼。</div>`;
    }

    let html = `<div class="fl-led-h">
      <div><div class="fl-lbl">结 算 周 期</div><div style="font-size:15px;letter-spacing:1px;color:var(--fl-bright)">${esc(r.周期 || '未标注')}</div>
        <div style="margin-top:6px;font-size:10.5px;color:var(--fl-dimmer);letter-spacing:.6px">${esc(r.领地名 || '')}${r.规模档 ? ' · ' + esc(r.规模档) : ''}${r.估值 ? ' · 估值 ' + fmtNum(r.估值) + ' ' + esc(unit) : ''}</div></div>
      <div style="margin-left:auto;text-align:right"><div class="fl-lbl">本 期 净 额</div>
        <div class="fl-big ${shownNet < 0 ? 'neg' : 'pos'}">${shownNet < 0 ? '−' : '+'}${fmtNum(Math.abs(shownNet))}</div>
        <div style="margin-top:6px;font-size:10.5px;color:var(--fl-dimmer);letter-spacing:.6px">${esc(unit)}</div></div>
    </div>`;

    html += table;

    if ((r.指标 || []).length) {
      html += section('指 标 变 动', '每项都要有剧情原因', `<div class="fl-deltas">
        ${r.指标.map((x) => {
          const raw = String(x.变化 || '');
          const up = raw.indexOf('-') < 0 && raw.indexOf('−') < 0;
          return `<div class="fl-delta"><span style="color:var(--fl-dim)">${esc(x.项)}</span><b class="${up ? 'up' : 'down'}">${esc(raw)}</b>${x.因 ? `<span>${esc(x.因)}</span>` : ''}</div>`;
        }).join('')}
      </div>`);
    }

    if ((r.事件 || []).length) {
      html += section('事 件', `${r.事件.length} 条`, `<div class="fl-box"><div class="fl-timeline">
        ${r.事件.map((x, i) => `<div class="fl-tl"><em>${String(i + 1).padStart(2, '0')}</em>${esc(x)}</div>`).join('')}
      </div></div>`);
    }

    if ((r.裁定 || []).length) {
      html += `<div class="fl-verdict"><b>裁 定</b>${r.裁定.map(esc).join('<br>')}</div>`;
    }
    if (r.待决) {
      html += `<div class="fl-verdict" style="border-left-color:rgba(220,190,106,.45);background:rgba(220,190,106,.05);margin-top:12px">
        <b style="color:var(--fl-warn)">待 决</b>
        ${esc(r.待决.事)}${r.待决.代价 ? `<br><span style="color:var(--fl-dim);font-size:11.5px">${esc(r.待决.代价)}</span>` : ''}
        ${(r.待决.选项 || []).length ? `<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">${r.待决.选项.map((o) => `<span class="fl-chip">${esc(o)}</span>`).join('')}</div>` : ''}
      </div>`;
    }

    return html;
  }

  /* ------------------------------------------------------------ 规划 */
  function plansHtml() {
    const plans = data.plans || [];
    if (!plans.length) {
      return `<div class="fl-empty"><b>◇</b>没有建设方案
        <small>&lt;fief_build&gt; 区块出现时才有；资源点是天生的，不进规划清单</small></div>`;
    }
    let html = `<div class="fl-chipbar" style="margin-bottom:16px">
      <span class="fl-tag">选定后由 &lt;UpdateVariable&gt; 写入内部资产</span>
      <span class="fl-tag gold">共 ${plans.length} 项</span>
    </div><div class="fl-cards">`;
    for (const p of plans) {
      html += `<div class="fl-card" data-cat="${esc(p.类别)}" style="cursor:default">
        <div class="fl-card-t">
          <span class="fl-ic">${iconOf(p.类别)}</span>
          <span class="fl-card-n">${esc(p.名)}</span>
        </div>
        <div class="fl-card-m">
          ${p.编号 ? `<span class="fl-tag gold">${esc(p.编号)}</span>` : ''}
          <span class="fl-tag">${esc(p.类别)}</span>
          ${p.品质 ? `<span class="fl-tag">${esc(p.品质)}</span>` : ''}
        </div>
        ${p.说明 ? `<div class="fl-card-d" style="max-height:5.2em">${esc(p.说明)}</div>` : ''}
        <div class="fl-card-o"><b>${esc(p.估价 || '—')}</b><span>${esc(p.工期 || '工期未定')}</span></div>
      </div>`;
    }
    html += '</div>';
    return html;
  }

  /* ------------------------------------------------------------ 渲染 */
  function renderView(d) {
    if (!viewEl) return;
    // 设置是独立面板，view 整块让位，不往里写
    if (page === '设置') return;
    // 政策不依赖领地数据，没领地也能用
    if (page === '政策') { renderPolicy(); return; }
    if (page === '外交') { viewEl.innerHTML = diplomacyHtml(d); bindView(d); return; }
    if (page === '历史') { viewEl.innerHTML = historyHtml(d); bindView(d); return; }
    if (selected === 'diag') {
      viewEl.innerHTML = diagHtml();
      return;
    }
    if (!d) {
      viewEl.innerHTML = `<div class="fl-empty"><b>◇</b>还没有领地
        <small>变量的 stat_data.主角.资产 里没有类型为「领地」的资产</small>
        <small>切到「设置 → 读取 → 自检」，那一屏会说明卡在哪一层</small></div>`;
      return;
    }
    if (tab === '总览') viewEl.innerHTML = overviewHtml(d);
    else if (tab === '建筑') viewEl.innerHTML = buildingsHtml(d);
    else if (tab === '军政') viewEl.innerHTML = militaryHtml(d);
    else if (tab === '资源') viewEl.innerHTML = resourcesHtml(d);
    else if (tab === '账本') viewEl.innerHTML = ledgerHtml(d);
    else viewEl.innerHTML = plansHtml();

    bindView(d);
  }

  /* ------------------------------------------------------ 外交（内测） */
  /* 7合1 里没有独立的外交区块，邻邦只以 `[邻邦|名称 态度]` 这种单行出现，
     所以这里不硬造结构：有就按态度归类摆出来，没有就老实写「开发中」。 */
  const DIP_TONE = [
    [/(盟约|同盟|联盟|结盟|联姻|姻亲|附庸|朝贡|共主)/, 'ok', '盟约'],
    [/(友善|亲善|友好|通商|睦邻|和好|贸易|互市)/, 'ok', '友善'],
    [/(中立|观望|平淡|未定|冷淡|疏远)/, 'mid', '中立'],
    [/(戒备|提防|紧张|不满|摩擦|猜忌|试探|索求)/, 'mid', '戒备'],
    [/(敌对|仇视|交战|开战|吞并|侵略|封锁|劫掠|叛乱|世仇)/, 'bad', '敌对'],
  ];

  function dipTone(text) {
    const s = String(text || '');
    for (const [re, k] of DIP_TONE) if (re.test(s)) return k;
    return 'none';
  }

  function dipLabel(text) {
    const s = String(text || '');
    for (const [re, , name] of DIP_TONE) if (re.test(s)) return name;
    return '未标';
  }

  /** 一行邻邦拆成「名字 + 态度」：分隔符可能是空格、·、｜、：、-、括号，都不套死位置 */
  function dipRows(d) {
    const out = [];
    const info = (d && d.info) || {};
    for (const raw of info.邻邦 || []) {
      const t = String(raw || '').trim();
      if (!t) continue;
      const m = t.match(/^([^·｜|：:\-—\s（(]+)\s*[·｜|：:\-—（(]?\s*(.*)$/);
      const name = (m ? m[1] : t).replace(/[）)]+$/, '');
      const rest = (m ? String(m[2] || '') : '').replace(/[）)]+$/, '').trim();
      const tone = dipTone(rest || name);
      out.push({ name, note: rest, tone, label: dipLabel(rest || name) });
    }
    return out;
  }

  function diplomacyHtml(d) {
    if (!d) {
      return `<div class="fl-empty"><b>◇</b>外交 · 开发中
        <small>这一页还没有数据可读</small>
        <small>它读的是当前领地的「邻邦」行与「要事」里的外部动向</small></div>`;
    }
    const info = d.info || {};
    const rows = dipRows(d);
    const sub = info.治下 || null;
    let html = '';

    // 治下：自己这一头的关系底子（头衔、主事、态度）
    const own = [];
    if (sub) {
      if (sub.头衔) own.push(['头衔', sub.头衔]);
      if (sub.主) own.push(['主事', sub.主]);
      if (sub.副) own.push(['副手', sub.副]);
      if (sub.态度) own.push(['态度', sub.态度]);
    }
    if (d.meta && d.meta.势力) own.push(['所属势力', d.meta.势力]);
    if (d.meta && d.meta.治理模式) own.push(['治理模式', d.meta.治理模式]);
    if (own.length) {
      html += `<div class="fl-dip-h"><b>治 下</b><em>Allegiance</em><s></s></div>`
        + '<div class="fl-dip-own">'
        + own.map(([k, v]) => `<div class="fl-kv"><span class="k">${esc(k)}</span>`
          + `<span class="v">${esc(v)}</span></div>`).join('')
        + '</div>';
    }

    // 邻邦：按态度上色，态度文字原样保留，不做同义词归并
    if (rows.length) {
      const sorted = rows.slice().sort((a, b) => {
        const rank = { ok: 0, mid: 1, bad: 2, none: 3 };
        return (rank[a.tone] ?? 3) - (rank[b.tone] ?? 3);
      });
      html += `<div class="fl-dip-h" style="margin-top:20px"><b>邻 邦</b><em>Neighbours</em><s></s></div>`
        + sorted.map((r) => `<div class="fl-dip-row"><div class="fl-dip-nm">${esc(r.name)}`
          + (r.note ? `<small>${esc(r.note)}</small>` : '')
          + `</div>`
          // 没写下态度就不挂标签，一片「未标」比不标更吵
          + (r.tone === 'none' ? '' : `<span class="fl-dip-at ${r.tone}">${esc(r.label)}</span>`)
          + '</div>').join('');
    } else {
      html += `<div class="fl-dip-h" style="margin-top:20px"><b>邻 邦</b><em>Neighbours</em><s></s></div>
        <div class="fl-empty" style="padding:26px 10px"><b>◇</b>外交 · 开发中
          <small>总览区块里还没有 <code>[邻邦]</code> 行</small>
          <small>有这一行时自动按态度分色列出，不用改脚本</small></div>`;
    }

    // 相关动向：要事里提到某位邻邦的，抽出来
    const names = rows.map((r) => r.name).filter((n) => n.length >= 2);
    const hits = [];
    for (const line of info.要事 || []) {
      const t = String(line || '').trim();
      if (!t) continue;
      if (names.some((n) => t.indexOf(n) >= 0) || /邻邦|边境|使节|盟|条约|商队|朝贡|宣战/.test(t)) hits.push(t);
    }
    if (hits.length) {
      html += `<div class="fl-dip-h" style="margin-top:18px"><b>动 向</b><em>Moves</em><s></s></div>`
        + hits.slice(0, 6).map((t) => `<div class="fl-dip-row"><div class="fl-dip-nm" style="line-height:1.7">${esc(t)}</div></div>`).join('');
    }

    html += `<div class="fl-sec-note" style="margin-top:16px">外交这一页还在做：目前读的是总览区块里的
      <code>[邻邦|名称 态度]</code> 与「要事」中提到邻邦的句子，不额外推断立场。
      想多几条就照这个格式写，面板会自动按态度分组上色。</div>`;
    return html;
  }

  /* ------------------------------------------------------ 历史 */
  /** 建筑档案库里每座建筑都留了流水，这里把它摊成一条时间线，最近的在上 */
  function historyEvents() {
    const store = (data && data.store) || null;
    const out = [];
    if (!store || !store.domains) return out;
    for (const dn of Object.keys(store.domains)) {
      const sd = store.domains[dn] || {};
      for (const bn of Object.keys(sd.items || {})) {
        const rec = sd.items[bn] || {};
        for (const l of rec.log || []) {
          out.push({
            idx: typeof l.idx === 'number' ? l.idx : -1,
            kind: l.kind === 'add' ? 'add' : (l.kind === 'remove' ? 'remove' : 'change'),
            text: String(l.text || ''),
            name: bn, dom: dn,
          });
        }
        if (rec.missing) {
          out.push({
            idx: typeof rec.lastSeen === 'number' ? rec.lastSeen : -1,
            kind: 'remove', text: '最后一次读到之后再没出现，标为已拆或已丢',
            name: bn, dom: dn,
          });
        }
      }
    }
    out.sort((a, b) => (b.idx - a.idx) || String(a.name).localeCompare(String(b.name)));
    return out;
  }

  function historyHtml(d) {
    const evs = historyEvents();
    if (!evs.length) {
      return `<div class="fl-empty"><b>◇</b>历史 · 开发中
        <small>档案库里还没有任何变更记录</small>
        <small>建筑每变一次（状态、品质、数量、位置）这里会记一条</small></div>`;
    }
    const names = new Set(evs.map((e) => e.name));
    const lows = evs.filter((e) => e.idx >= 0).map((e) => e.idx);
    const first = lows.length ? Math.min.apply(null, lows) : -1;

    let html = `<div class="fl-dip-h"><b>变 更 流 水</b><em>Chronicle</em><s></s></div>
      <div class="fl-sec-note" style="margin:0 0 14px">共 <b>${evs.length}</b> 条 · 涉及 <b>${names.size}</b> 座建筑`
      + (first >= 0 ? ` · 最早记于 <b>#${first + 1}</b> 楼` : '')
      + `。只记变化，不记重复读取。</div>`;

    const KIND = { add: '建档', remove: '已拆', change: '变动' };
    // 复用账本的 .fl-timeline / .fl-tl：左边一条竖线，每条一个圆点
    html += '<div class="fl-timeline">' + evs.slice(0, 150).map((e) => {
      const cls = e.kind === 'add' ? ' add' : (e.kind === 'remove' ? ' rm' : '');
      const label = KIND[e.kind] || '变动';
      // 「建档」这类只说明类型：正文跟标签一模一样就不再重复写一遍
      const tx = (e.text && e.text !== label) ? `<div class="tx">${esc(e.text)}</div>` : '';
      return `<div class="fl-tl${cls}">`
        + `<em>${e.idx >= 0 ? '#' + (e.idx + 1) : '—'}</em>`
        + `<span class="nm">${esc(e.name)}</span>`
        + `<span class="kd">${esc(label)}</span>`
        + (d && e.dom !== d.name ? `<span class="kd">${esc(e.dom)}</span>` : '')
        + tx + '</div>';
    }).join('') + '</div>';

    if (evs.length > 150) html += `<div class="fl-sec-note">只显示最近 150 条，更早的在档案库里留档。</div>`;
    return html;
  }

  /* ------------------------------------------------------ 政策抽卡（内测） */
  let policyMounted = false;

  /** 把指令填进聊天框：只写草稿，不发送、不写变量 */
  function fillComposer(text) {
    const targets = [];
    try { targets.push(doc.querySelector('#send_textarea')); } catch (e) { /* 忽略 */ }
    try { if (host !== doc) targets.push(host.parent.document.querySelector('#send_textarea')); } catch (e) { /* 忽略 */ }
    for (const t of targets) {
      if (!t) continue;
      t.value = text;
      try { t.dispatchEvent(new host.Event('input', { bubbles: true })); } catch (e) { /* 忽略 */ }
      try { t.focus(); } catch (e) { /* 忽略 */ }
      return true;
    }
    // 找不到输入框就退到剪贴板
    try {
      if (host.navigator && host.navigator.clipboard) host.navigator.clipboard.writeText(text);
      toast('没找到聊天输入框，已复制到剪贴板');
    } catch (e) { toast('没找到聊天输入框'); }
    return false;
  }

  function renderPolicy() {
    const mod = window.__fiefPolicyUI;
    if (!mod) {
      viewEl.innerHTML = '<div class="fl-empty"><b>◇</b>政令模块没有加载<small>请重新导入脚本</small></div>';
      return;
    }
    if (!policyMounted) {
      mod.mount({
        lib: window.__fiefPolicy,
        esc,
        toast: (m) => toast(m),
        fillComposer,
      });
      policyMounted = true;
    }
    mod.render(viewEl);
    bindPolicyChrome();
  }

  /** 政策页的额外绑定：填进聊天框之后收个尾 */
  function bindPolicyChrome() {
    // 抽卡模块自己绑了按钮，这里只留占位，未来要加"发完自动切回总览"之类
  }

  function bindView(d) {
    viewEl.querySelectorAll('.fl-card[data-k]').forEach((n) => {
      n.addEventListener('click', () => {
        const parts = String(n.dataset.k).split('::');
        openDrawer(parts[0], parts[1]);
      });
    });
    viewEl.querySelectorAll('.fl-fchip').forEach((n) => {
      n.addEventListener('click', () => {
        catFilter = n.dataset.f;
        render();
      });
    });
    const q = viewEl.querySelector('#fl-q');
    if (q) q.addEventListener('input', () => {
      keyword = q.value;
      const at = q.selectionStart;
      render();
      const q2 = viewEl.querySelector('#fl-q');
      if (q2) { q2.focus(); try { q2.setSelectionRange(at, at); } catch (e) { /* 忽略 */ } }
    });
  }

  function render() {
    if (!tabsEl) return;
    try {
      const d = currentDomain();
      if (selected && selected !== 'diag') {
        const still = findItem();
        if (!still) selected = null;
      }
      applyPage();          // 先把哪块可见定下来，再往里填东西
      renderTop(d);
      renderNav();
      if (page === '领地') {
        renderHero(d);
        renderMetrics(d);
        renderTabs(d);
      }
      renderView(d);
      renderFoot();
      if (drawerEl && drawerEl.classList.contains('on')) renderDrawer();
      refreshDiag();
    } catch (err) {
      // 出错别留白：把错误摊在面板里，手机上也能看清卡在哪
      try {
        if (viewEl) {
          viewEl.style.display = '';
          viewEl.innerHTML = '<div style="padding:18px;color:#e07070;'
            + 'font:13px/1.7 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all;">'
            + '渲染出错：' + esc(err && err.stack ? err.stack : String(err)) + '</div>';
        }
      } catch (e) { /* 忽略 */ }
      reportError('render', err);
    }
  }

  /* ------------------------------------------------------------ 抽屉 */
  function findItem() {
    if (!selected || selected === 'diag') return null;
    for (const d of data.domains) {
      if (d.name !== selected.domain) continue;
      for (const it of d.items) if (it.name === selected.name) return { domain: d, item: it };
    }
    return null;
  }

  function openDrawer(domain, name) {
    selected = { domain: domain, name: name };
    renderDrawer();
    drawerEl.classList.add('on');
    scrimEl.classList.add('on');
    viewEl.querySelectorAll('.fl-card').forEach((n) => {
      n.style.borderColor = n.dataset.k === domain + '::' + name ? 'rgba(var(--fl-accent-rgb),0.34)' : '';
    });
  }

  function closeDrawer() {
    if (!drawerEl) return;
    drawerEl.classList.remove('on');
    scrimEl.classList.remove('on');
    selected = null;
    viewEl.querySelectorAll('.fl-card').forEach((n) => { n.style.borderColor = ''; });
  }

  function renderDrawer() {
    const hit = findItem();
    if (!hit) { drawerEl.innerHTML = ''; return; }
    const it = hit.item;
    const d = hit.domain;
    const key = it.domain + '::' + it.name;
    const hasNote = !!(notes[key] && notes[key].trim());

    const kvs = [];
    const kv = (k, v) => { if (v) kvs.push(`<div class="fl-kv"><k>${k}</k><v>${esc(v)}</v></div>`); };
    kv('类别', it.category);
    kv('位置', it.location);
    kv('品质', it.quality);
    kv('模式', it.mode);
    kv('数量', it.quantity && Number(it.quantity) > 1 ? '×' + it.quantity : it.quantity);
    kv('占用', it.space);
    kv('估价', it.cost);
    kv('工期', it.span);
    kv('产出', it.quant || it.output);

    const fx = (it.effects || []).length
      ? `<div class="fl-sec"><div class="fl-sec-h"><span>效 果</span><s></s></div><div class="fl-fx">
          ${it.effects.map((e) => `<div class="fl-fx-r">${e.k ? `<b>${esc(e.k)}</b>` : ''}<span>${esc(e.v)}</span></div>`).join('')}
        </div></div>`
      : '';

    const evs = (it.events || []).length
      ? `<div class="fl-sec"><div class="fl-sec-h"><span>变 更 记 录</span><s></s><em>${it.events.length} 条</em></div>
          <div class="fl-timeline">${it.events.map((e) => {
            const tag = (e.kind === 'add' || e.kind === 'insert') ? '建档' : e.kind === 'remove' ? '移除' : '变更';
            return `<div class="fl-tl"><em>${e.idx + 1} 楼</em>${esc(tag)} · ${esc(e.text)}</div>`;
          }).join('')}</div></div>`
      : '';

    drawerEl.innerHTML = `
      <div class="fl-dr-h">
        <div class="fl-dr-ic" data-cat="${esc(it.category)}">${iconOf(it.category)}</div>
        <div class="fl-dr-t">
          <div class="fl-dr-n">${esc(it.name)}</div>
          <div class="fl-dr-s">${esc(d.name)}${it.location ? ' · ' + esc(it.location) : ''}</div>
          <div class="fl-chips" style="margin-top:9px">
            <span class="fl-pill ${statusClass(it.status)}">${esc(it.status || '未标注')}</span>
            ${it.removed ? '<span class="fl-tag">已拆</span>' : (it.missing ? '<span class="fl-tag">仅存于档案</span>' : '')}
            ${it.quality ? `<span class="fl-tag gold">${esc(it.quality)}</span>` : ''}
          </div>
        </div>
        <div class="fl-dr-x" id="fl-dr-x">✕</div>
      </div>
      <div class="fl-dr-b">
        ${kvs.length ? `<div class="fl-kvs">${kvs.join('')}</div>` : ''}
        ${it.brief ? `<div class="fl-desc" style="margin-top:14px">${esc(it.brief)}</div>` : ''}
        ${fx}
        ${it.desc ? `<div class="fl-sec"><div class="fl-sec-h"><span>描 述</span><s></s></div><div class="fl-desc">${esc(it.desc)}</div></div>` : ''}
        ${evs}
        <div class="fl-sec">
          <div class="fl-sec-h"><span>批 注</span><s></s></div>
          <textarea class="fl-note" id="fl-note" placeholder="补一句设定、记一个钩子，只有你看得到…">${esc(hasNote ? notes[key] : '')}</textarea>
          <div class="fl-hint">存在本存档的聊天变量里 · 不进 prompt · 自动保存</div>
        </div>
      </div>`;

    const x = drawerEl.querySelector('#fl-dr-x');
    if (x) x.addEventListener('click', closeDrawer);
    bindNote();
  }

  function bindNote() {
    const ta = drawerEl.querySelector('#fl-note');
    if (!ta || !selected || selected === 'diag') return;
    const key = selected.domain + '::' + selected.name;
    ta.addEventListener('input', () => {
      clearTimeout(ta._t);
      ta._t = setTimeout(() => {
        const ok = writeNote(key, ta.value.trim());
        notes = readNotesFallback();
        if (!ok) toast('批注只存进了本机缓存');
        renderView(currentDomain());
      }, 600);
    });
  }

  /* ------------------------------------------------------------ 自检 */
  function diagHtml() {
    const ctx = getCtx();
    const vars = readChatVars();
    const stat = resolveState();
    const fromVars = findStatDataInVars();
    const ms = messageState();
    const assets = stat && stat.主角 && stat.主角.资产;
    const domains = collectDomains(stat);
    const msgs = getMessages();
    const n = domains.reduce((a, x) => a + normalizeInner(x.asset.内部资产).length, 0);
    const store = loadStore();
    const stored = countStored();
    const missing = data.domains.reduce((a, d) => a + d.items.filter((it) => it.missing).length, 0);

    const row = (k, v) => `<div class="fl-diag-row"><span class="fl-diag-k">${k}</span><span class="fl-diag-v">${v}</span></div>`;
    const yes = (t) => `<span class="dg-ok">✓ ${t}</span>`;
    const no = (t) => `<span class="dg-bad">✗ ${t}</span>`;
    const warn = (t) => `<span class="dg-warn">! ${t}</span>`;

    let html = '';
    html += '<div class="fl-diag-h">数 据 来 源</div>';
    html += row('酒馆上下文', ctx ? yes('已连接') : no('读不到 SillyTavern.getContext()'));
    html += row('聊天消息', msgs.length + ' 条');
    html += row('消息变量', ms ? yes('第 ' + (ms.idx + 1) + ' 楼带 stat_data') : warn('消息上没有 variables'));
    html += row('聊天变量', vars ? yes(Object.keys(vars).length + ' 个键') : no('读不到 variables'));
    html += row('状态来源', stat ? yes(lastStateSource) : no('读不到'));
    html += row('主角.资产', assets ? yes(Object.keys(assets).length + ' 个资产') : no('没有 主角.资产'));
    html += row('领地资产', domains.length ? yes(domains.length + ' 块') : warn('0 块'));
    html += row('建筑', n ? yes(n + ' 座') : warn('0 座'));

    html += '<div class="fl-diag-h">区 块 与 账 本</div>';
    const withBlock = data.domains.filter((d) => d.info).length;
    html += row('总览区块', withBlock ? yes(withBlock + ' 块有 [领地] 行') : warn('没有读到 <fief_domain>'));
    html += row('账本区块', data.reports && data.reports.last ? yes('最近一期 ' + esc(data.reports.last.周期 || '')) : warn('没有 <fief_report>'));
    html += row('规划区块', data.plans.length ? yes(data.plans.length + ' 项') : warn('没有 <fief_build>'));
    html += row('规模档', data.domains.filter((d) => d.tier).length ? yes(data.domains.filter((d) => d.tier).length + ' 块识别出档位') : warn('没识别出七档'));
    const ta = tierAudit(msgs);
    html += row('档位表对数', ta.matched
      ? yes('最近上下文里出现 ' + ta.matched + '/7 个档名' + (ta.inOrder ? '，顺序一致' : '，顺序对不上'))
      : warn('上下文里一个档名都没出现，无法核对'));
    html += row('脚本档位槽位', '<code>' + ta.slots.join(' / ') + '</code>　<span style="color:var(--fl-dimmer);font-size:11px">应对上世界书 6/10/18/30/45/60+/90+</span>');

    html += '<div class="fl-diag-h">建 筑 档 案 库</div>';
    html += row('存储位置', '<code>' + esc(STORE_KEY) + '</code>' + (vars && vars[STORE_KEY] ? yes('　已写进聊天变量') : warn('　仅本机缓存')));
    html += row('已归档', stored ? yes(stored + ' 座 / ' + Object.keys(store.domains).length + ' 块领地') : warn('还没有归档'));
    html += row('仅存于档案', missing ? warn(missing + ' 座（变量里已无，展示按档案）') : yes('无'));
    html += row('最近写入', store.savedAt ? esc(String(store.savedAt).replace('T', ' ').slice(0, 19)) : '—');

    html += '<div class="fl-diag-h">检 测 通 道</div>';
    html += row('① 函数挂载', hooks.length ? yes(hooks.length + ' 个入口') + '<br><code>' + hooks.map((h) => esc(h.label)).join('</code><br><code>') + '</code>' : warn('未挂上（靠轮询）'));
    html += row('② 事件订阅', chan.event ? yes('已订阅') : warn('不可用（靠轮询）'));
    html += row('③ 数据指纹', chan.data ? yes('每 1.2 秒比对变量') : warn('未运行'));
    html += row('消息指纹', chan.msg ? yes('补历史变化') : warn('未运行'));
    html += row('上次触发', (lastFire || '—') + '　累计 ' + fires + ' 次');

    html += '<div class="fl-diag-h">运 行 环 境</div>';
    html += row('版本', '<code>v' + VERSION + '</code>');
    html += row('宿主窗口', host === window ? '当前窗口' : '上层窗口（已上溯）');
    html += row('当前聊天', '<code>' + esc(currentChatId()) + '</code>');
    html += row('文案口径', '按行首标签归类，旧版 [核心]/[府库]/[营造] 与新契约 [状态]/[钱] 都认');

    html += `<div class="fl-diag-note">
      <b>怎么读：</b>「领地资产」不是 0，就说明数据通了。<br>
      「消息变量」是 ! 但「状态来源」有值，正常——脚本会用历史补丁重建。<br>
      「总览区块」「账本区块」是 !，只是那一层信息还没出现，不影响建筑与指标。<br>
      如果数字不对，把这一屏和出问题的楼层号发我，我照着实际结构改。
    </div>`;
    return html;
  }

  function showDiag() {
    if (!screen.classList.contains('on')) open();
    page = '领地';
    selected = 'diag';
    tab = '总览';
    render();
  }

  /* ------------------------------------------------------------ 检测 */
  function varSignature() {
    const stat = resolveState(true);
    if (!stat) return 'nostat';
    const assets = stat.主角 && stat.主角.资产;
    if (!assets || typeof assets !== 'object') return 'noassets';
    const parts = [];
    for (const k of Object.keys(assets)) {
      const a = assets[k];
      if (!a || typeof a !== 'object' || !/^领地/.test(String(a.类型 == null ? '' : a.类型))) continue;
      const rows = normalizeInner(a.内部资产).map(({ key, item }) => (
        key + '|' + String(item.类型 || '') + '|' + tagsText(item.标签) + '|' + effectText(item.效果) + '|' + String(item.品质 || '')
      ));
      parts.push(k + '#' + rows.join(';'));
    }
    return parts.join('||') || 'empty';
  }

  function messageSignature() {
    const msgs = getMessages();
    if (!msgs.length) return 'M0';
    const last = msgs[msgs.length - 1];
    const t = mesText(last);
    return 'M' + msgs.length + ':' + t.length + ':' + t.slice(-40);
  }

  function checkOnce(force) {
    const vs = varSignature();
    const ms = messageSignature();
    const dataChanged = vs !== lastVarSig;
    const msgChanged = ms !== lastMsgSig;
    if (!force && !dataChanged && !msgChanged) return false;
    lastVarSig = vs; lastMsgSig = ms;
    lastFire = force ? 'manual' : (dataChanged ? 'data' : 'msg');
    rescan(false, force ? '手动' : (dataChanged ? '变量变化' : '消息变化'));
    return true;
  }

  function schedule(reason) {
    if (reason) lastFire = reason;
    if (debounce) return;
    debounce = setTimeout(() => { debounce = null; checkOnce(false); }, 420);
  }

  function installHooks() {
    const targets = [];
    const th = TH();
    if (th) {
      ['insertOrAssignVariables', 'setVariables', 'replaceVariables', 'updateVariables'].forEach((n) => {
        if (typeof th[n] === 'function') targets.push([th, n, 'TH.' + n]);
      });
    }
    const S = host.SillyTavern;
    try {
      const ctx = S && typeof S.getContext === 'function' ? S.getContext() : null;
      if (ctx) {
        ['setVariables', 'saveMetadata'].forEach((n) => {
          if (typeof ctx[n] === 'function') targets.push([ctx, n, 'ctx.' + n]);
        });
      }
    } catch (e) { /* 忽略 */ }

    for (const [obj, name, label] of targets) {
      const orig = obj[name];
      if (typeof orig !== 'function' || orig.__flWrapped) continue;
      const wrapped = function () {
        const r = orig.apply(this, arguments);
        try { if (!muteHooks) schedule('hook'); } catch (e) { /* 忽略 */ }
        return r;
      };
      wrapped.__flWrapped = true;
      try { obj[name] = wrapped; hooks.push({ obj, name, orig, label }); chan.hook = true; }
      catch (e) { /* 只读 */ }
    }
  }

  function installEvents() {
    const th = TH();
    if (!th || typeof th.eventOn !== 'function') return;
    const fire = () => schedule('event');
    for (const ev of ['message_received', 'message_sent', 'generation_ended', 'message_swiped', 'message_edited', 'message_deleted', 'chat_changed']) {
      try { th.eventOn(ev, fire); chan.event = true; } catch (e) { /* 该事件不存在 */ }
    }
  }

  function installObserver() {
    const chat = doc.querySelector('#chat');
    const MO = host.MutationObserver || window.MutationObserver;
    if (!chat || typeof MO !== 'function') return;
    observer = new MO(() => schedule('event'));
    try { observer.observe(chat, { childList: true, subtree: true, characterData: true }); } catch (e) { /* 忽略 */ }
  }

  function startAuto() {
    stopAuto();
    if (!prefs.auto) { refreshDiag(); return; }
    installHooks();
    installEvents();
    installObserver();
    lastVarSig = varSignature();
    lastMsgSig = messageSignature();
    heartbeat = setInterval(() => checkOnce(false), 1200);
    refreshDiag();
  }

  function stopAuto() {
    if (observer) { try { observer.disconnect(); } catch (e) { /* 忽略 */ } observer = null; }
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    if (debounce) { clearTimeout(debounce); debounce = null; }
    for (const h of hooks.splice(0)) { try { h.obj[h.name] = h.orig; } catch (e) { /* 忽略 */ } }
    refreshDiag();
  }

  function refreshDiag() {
    if (!liveEl) return;
    liveEl.textContent = prefs.auto ? '自动' : '手动';
    liveEl.className = 'fl-live' + (prefs.auto ? '' : ' off');
  }

  /* ------------------------------------------------------------ 扫描 */
  /** 出错不能让面板白掉：记一条日志，把栈留在自检页 */
  function rescan(manual, why) {
    try {
      return doRescan(manual, why);
    } catch (err) {
      logPush('err', { why: why || (manual ? '手动读取' : '自动读取'), err: String((err && err.message) || err) });
      reportError('读取', err);
      return false;
    }
  }

  function doRescan(manual, why) {
    fires += 1;
    const at = Date.now();
    data = buildLedger();
    notes = readNotesFallback();

    // 建筑档案库：只在指纹变了才写变量，避免 1.2 秒一次的写盘
    if (data.store && (data.storeTouched || manual)) {
      try { saveStore(data.store, !!manual); } catch (e) { /* 忽略 */ }
    }

    if (selected && selected !== 'diag' && !findItem()) selected = null;

    render();

    const n = data.domains.reduce((a, d) => a + d.items.length, 0);
    const arch = data.domains.reduce((a, d) => a + d.items.filter((it) => it.missing).length, 0);
    const stored = countStored();
    if (badgeEl) { badgeEl.textContent = n; badgeEl.classList.toggle('on', n > 0); }
    if (star) star.classList.toggle('fl-dim', n === 0);
    chan.data = true; chan.msg = true;

    logPush('read', {
      t: at,
      why: why || (manual ? '手动' : '自动'),
      src: lastStateSource || '无',
      idx: lastStateIdx,
      msgs: getMessages().length,
      patch: data.patchCount || 0,
      dom: data.domains.length,
      bld: n,
      miss: arch,
      stored,
      note: lastTrace.slice(),
    });

    // 正停在日志那一面就顺手刷一下，不用退出再进来
    try {
      const pane = screen.querySelector('#fl-pane-read');
      if (pane && pane.classList.contains('on')) renderLog();
    } catch (e) { /* 忽略 */ }

    if (manual) toast(`领地 ${data.domains.length} 块 · 建筑 ${n} 座 · 档案库 ${stored} 座 · 来源 ${lastStateSource}`);
    return true;
  }

  function countStored() {
    const store = loadStore();
    let n = 0;
    for (const dn of Object.keys(store.domains)) n += Object.keys(store.domains[dn].items).length;
    return n;
  }

  /* ------------------------------------------------------------ 启动 */
  // 手机上看不到控制台，未捕获的错误先记下来，自检页能翻到
  if (window && typeof window.addEventListener === 'function') {
    window.addEventListener('error', (ev) => {
      lastError = '未捕获：' + ((ev && ev.message) || '') + (ev && ev.lineno ? ' @' + ev.lineno : '');
    });
    window.addEventListener('unhandledrejection', (ev) => {
      const r = ev && ev.reason;
      lastError = 'Promise：' + ((r && r.message) || String(r || ''));
    });
  }

  loadLog();   // 上次的日志先接上，这次读取追加在后面
  buildUI();
  lastVarSig = varSignature();
  lastMsgSig = messageSignature();
  rescan(false, '启动');
  if (prefs.auto) startAuto();

  // 启动自报一次：手机上要能确认「新版本真的跑起来了」
  setTimeout(() => {
    try { toast('领地档案 v' + VERSION + ' 已就绪 · 点星标打开'); } catch (e) { /* 忽略 */ }
  }, 1200);

  window[KEY] = {
    version: VERSION,
    open, close,
    toggle: () => (screen.classList.contains('on') ? close() : open()),
    scan: (why) => rescan(true, why || '接口'),
    data: () => data,
    log: () => ({ rows: readLog.slice(), text: logPlain() }),
    clearLog: () => { clearLog(); renderLog(); },
    diag: () => ({ chan, lastFire, fires, hooks: hooks.map((h) => h.label), lastError }),
    _ui: {
      page: (k) => goPage(k),
      pageNow: () => page,
      tab: (t) => { tab = t; catFilter = '全部'; keyword = ''; render(); },
      domain: (i) => { domIdx = i; render(); },
      drawer: (dn, bn) => openDrawer(dn, bn),
      closeDrawer,
      view: () => (viewEl ? viewEl.innerHTML : ''),
      nav: () => (navEl ? navEl.innerHTML : ''),
      settings: () => (settingsEl ? settingsEl.innerHTML : ''),
      history: () => historyEvents(),
      diplomacy: () => dipRows(currentDomain()),
      hero: () => (heroEl ? heroEl.innerHTML : ''),
      metrics: () => (screen ? screen.querySelector('#fl-metrics').innerHTML : ''),
      drawerHtml: () => (drawerEl ? drawerEl.innerHTML : ''),
      filter: (f) => { catFilter = f; render(); },
    },
    _pure: {
      parseTags, tagsText, effectText, normalizeInner, extractPatchArrays, pointerSegs,
      patchesFromMessage, buildInfoFromMessage, buildHistory, replayState, resolveState,
      parseDomainBlock, latestDomainBlocks, parseBuildBlock, parseReportBlock,
      latestReports, latestPlans, parseGovernance, mergedGov, blockRows, bracketRows,
      numberOf, moneyOf, tierOf, scoreOf, stockLevel, TIERS, tierAudit, aliasConflicts,
      WORD_SCORE, STOCK_LEVELS, itemsOf,
      statusOf, categoryOf, locationOf, quantOf, effectLinesOf, parseDomainMeta,
      findStatDataInVars, collectDomains, buildLedger,
      statFromMessage, messageState, hasAssets,
      loadStore, saveStore, mergeStore, restoreFromStore, countStored,
      loadSnapshot, saveSnapshot,
      readNotes, writeNote, loadPrefs, savePrefs, NOTES_KEY,
      store: () => loadStore(),
      varSignature, messageSignature, checkOnce,
      source: () => lastStateSource,
    },
    dispose() {
      stopAuto();
      try { if (data.store) saveStore(data.store, true); } catch (e) { /* 忽略 */ }
      try { doc.removeEventListener('keydown', onKey); } catch (e) { /* 忽略 */ }
      try { if (root && root.parentNode) root.parentNode.removeChild(root); } catch (e) { /* 忽略 */ }
      const st = doc.getElementById(STYLE_ID);
      if (st && st.parentNode) st.parentNode.removeChild(st);
      delete window[KEY];
    },
  };

  // 同一个实例也在宿主窗口留一份，下次加载（不论从哪个 iframe 进来）才清得到
  try {
    if (host && host !== window) host[KEY] = window[KEY];
  } catch (e) { /* 忽略 */ }

  console.log('[领地档案] v' + VERSION + ' 已加载 · 通道 ' + JSON.stringify(chan));
})();
