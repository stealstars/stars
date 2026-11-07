/* ==========================================================================
 * 领地档案 · 国策树
 *
 * 三种树并存：
 *   1. 十国预置树（focus.data.js）
 *   2. AI 给领地现造的树（存 localStorage，按聊天隔离）
 *   3. 领地势力能对上某国时，默认用那国
 *
 * 机制：
 *   ready   → 点「推进」→ running（记剩余天数）
 *   每过一期（结算周期变了）→ 所有 running 扣 30 天
 *   扣到 0 → done，同时落一条快讯
 *
 * 前置语义（容易搞反，写在这里防止以后改错）：
 *   [["a","b"]]   → a 或 b 任一完成即可
 *   [["a"],["b"]] → a 和 b 都要完成
 *   依据：卡拉什利亚斯「组建移动粮台」第三组是 ["铁蹄东指","八角为城"]，
 *   这两个节点本身互斥，不可能同时完成，所以内层只能是「或」。
 *
 * 进度存 localStorage，不写变量、不进 prompt。
 * ========================================================================== */
(() => {
  'use strict';

  const LS_PREFIX = 'fief-focus-';
  const PERIOD_DAYS = 30;     // 一个结算期按 30 天算
  const NEWS_MAX = 24;

  let lib = null;
  let escFn = (s) => String(s == null ? '' : s);
  let toastFn = () => {};
  let fillFn = () => {};
  let goSettingsFn = null;
  let host = null;

  let countryId = '';
  let done = new Set();          // 已完成
  let running = new Map();       // nodeId → { left, from }
  let trees = {};                // 自定义树：name → tree
  let news = [];                 // 快讯
  let lastPeriod = '';           // 上次看到的结算周期
  let sel = null;
  let chatId = '';
  let openAll = false;
  let showNews = true;
  let genBusy = false;
  let genErr = '';
  let ctx = {};                  // 领地实况，生成树时用
  let lastHtml = '';             // 上次渲染的 HTML，一样就不重建 DOM
  let impOpen = false;           // 导入 / 手写面板展开着没
  let impText = '';              // 输入框里的 JSON
  let impErr = '';               // 导入失败的原因

  /* ------------------------------------------------------------ 存取 */
  function storeKey() { return LS_PREFIX + (chatId || 'default'); }

  function load() {
    if (!host) return;
    try {
      const raw = host.localStorage.getItem(storeKey());
      if (!raw) return;
      const o = JSON.parse(raw) || {};
      if (Array.isArray(o.done)) done = new Set(o.done);
      if (o.running && typeof o.running === 'object') {
        running = new Map(Object.entries(o.running).filter(([, v]) => v && typeof v.left === 'number'));
      }
      if (o.trees && typeof o.trees === 'object') trees = o.trees;
      if (Array.isArray(o.news)) news = o.news;
      if (typeof o.lastPeriod === 'string') lastPeriod = o.lastPeriod;
      if (typeof o.countryId === 'string') countryId = o.countryId;
    } catch (e) { /* 坏数据就当没有 */ }
  }

  function save() {
    if (!host) return;
    try {
      host.localStorage.setItem(storeKey(), JSON.stringify({
        countryId,
        done: Array.from(done),
        running: Object.fromEntries(running),
        trees,
        news,
        lastPeriod,
      }));
    } catch (e) { /* 忽略 */ }
  }

  /* ------------------------------------------------------------ 取树 */
  const builtinIds = () => (lib ? lib.countryIds() : []);

  /** 十国 + 自己生成的树 */
  function allCountryIds() {
    const base = builtinIds();
    const extra = Object.keys(trees).filter((id) => base.indexOf(id) < 0);
    return base.concat(extra);
  }

  function tree() {
    if (!countryId) return null;
    if (trees[countryId]) return trees[countryId];
    return lib ? lib.treeOf(countryId) : null;
  }

  /* ------------------------------------------------------------ 计算 */
  /** 按前置深度分列。外层「与」取最晚，内层「或」取最早。 */
  function layout(tr) {
    const byId = {};
    for (const n of tr.nodes) byId[n.id] = n;
    const depth = {};

    const walk = (n, stack) => {
      if (depth[n.id] != null) return depth[n.id];
      if (stack.has(n.id)) return 0;
      stack.add(n.id);

      let d = 0;
      const pre = n.prerequisites || [];
      if (pre.length) {
        let latestGroup = -1;
        for (const group of pre) {
          let earliest = Infinity;
          for (const pid of group) {
            if (byId[pid]) earliest = Math.min(earliest, walk(byId[pid], stack));
          }
          if (earliest !== Infinity) latestGroup = Math.max(latestGroup, earliest);
        }
        d = latestGroup < 0 ? 0 : latestGroup + 1;
      }

      stack.delete(n.id);
      depth[n.id] = d;
      return d;
    };

    for (const n of tr.nodes) walk(n, new Set());
    return depth;
  }

  /** 前置：外层全都要（与），内层任一即可（或） */
  function prereqMet(n) {
    const pre = n.prerequisites || [];
    if (!pre.length) return true;
    return pre.every((group) => group.some((id) => done.has(id)));
  }

  function hasCap(tr, key) {
    for (const c of tr.capabilities || []) {
      if (c.id === key && c.active) return true;
    }
    for (const n of tr.nodes) {
      if (!done.has(n.id)) continue;
      for (const e of n.effects || []) {
        if (e.kind === 'capability' && e.key === key) return true;
      }
    }
    return false;
  }

  /** 只累加已完成焦点里无条件的 value；带 when 的依赖剧情事实，不算 */
  function meters(tr) {
    let st = typeof tr.stability === 'number' ? tr.stability : 50;
    let ws = typeof tr.warSupport === 'number' ? tr.warSupport : 50;
    for (const n of tr.nodes) {
      if (!done.has(n.id)) continue;
      for (const e of n.effects || []) {
        if (e.when && e.when.length) continue;
        if (e.kind === 'stability' && typeof e.value === 'number') st += e.value;
        if (e.kind === 'warSupport' && typeof e.value === 'number') ws += e.value;
      }
    }
    const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
    return { stability: clamp(st), warSupport: clamp(ws) };
  }

  function reqList(tr, n) {
    const m = meters(tr);
    return (n.requirements || []).map((r) => {
      if (r.kind === 'capability') {
        return { label: r.label || ('需要 ' + r.id), ok: hasCap(tr, r.id) };
      }
      if (r.kind === 'stability') {
        return { label: r.label || ('稳定度至少 ' + r.minimum), ok: m.stability >= (r.minimum || 0) };
      }
      if (r.kind === 'warSupport') {
        return { label: r.label || ('战争支持至少 ' + r.minimum), ok: m.warSupport >= (r.minimum || 0) };
      }
      return { label: r.label || r.kind, ok: true };
    });
  }

  function mutexTaken(tr, n) {
    if (!n.mutex || !n.mutex.group) return null;
    for (const other of tr.nodes) {
      if (other.id === n.id) continue;
      if (!other.mutex || other.mutex.group !== n.mutex.group) continue;
      if (done.has(other.id) || running.has(other.id)) return other;
    }
    return null;
  }

  /**
   * 状态：done / running / mutexed / locked / blocked / ready
   * 顺序不能换：先查自己，再查互斥，再查前置，最后查条件。
   */
  function stateOf(tr, n) {
    if (done.has(n.id)) return 'done';
    if (running.has(n.id)) return 'running';
    if (mutexTaken(tr, n)) return 'mutexed';
    if (!prereqMet(n)) return 'locked';
    if (reqList(tr, n).some((r) => !r.ok)) return 'blocked';
    return 'ready';
  }

  /* ------------------------------------------------------------ 时间推进 */
  /** 过一期：所有进行中的焦点扣天数，扣完的落成完成并记快讯 */
  function tick(days) {
    const tr = tree();
    let finished = 0;
    for (const [id, r] of Array.from(running)) {
      r.left -= days;
      if (r.left <= 0) {
        running.delete(id);
        done.add(id);
        finished += 1;
        if (tr) {
          const n = tr.nodes.find((x) => x.id === id);
          if (n) pushNews(n);
        }
      }
    }
    if (finished) save();
    return finished;
  }

  function pushNews(n) {
    const eff = (n.effects || []).map((e) => {
      if (e.kind === 'capability') return '获得「' + (e.name || e.key) + '」';
      if (e.kind === 'stability') return '稳定 ' + (e.value > 0 ? '+' : '') + e.value;
      if (e.kind === 'warSupport') return '战争支持 ' + (e.value > 0 ? '+' : '') + e.value;
      return '';
    }).filter(Boolean);

    news.unshift({
      at: lastPeriod || '',
      title: n.name,
      body: String(n.description || '').slice(0, 100),
      eff: eff.join('；'),
      country: countryId,
      _raw: true,        // 本地拼的，等 AI 有空润色一遍
    });
    if (news.length > NEWS_MAX) news.length = NEWS_MAX;
    save();
  }

  /* ------------------------------------------------------------ 快讯润色 */
  let polishBusy = false;
  let lastRoot = null;

  /**
   * 把本地拼的那条快讯交给 AI 重写一遍。
   * 失败就保留本地那条，绝不因此丢内容。
   */
  async function polishOne(i) {
    const ai = window.__fiefAI;
    if (!ai || !aiReady()) return false;
    const it = news[i];
    if (!it || !it._raw) return false;

    try {
      const raw = await ai.chat(
        '领地：' + (it.country || countryId) + '\n'
        + '刚办成的事：' + it.title + '\n'
        + '原本的说明：' + (it.body || '无') + '\n'
        + '影响：' + (it.eff || '无') + '\n\n'
        + '写一条施政快讯，40-70 字。只写发生了什么、接下来会怎样，'
        + '不要评价好坏，不要用「我」「陛下」「在下」，不要加标题。只输出正文。',
        { temperature: 0.8, maxTokens: 300 },
      );
      const txt = String(raw || '').trim()
        .replace(/^["「『]/, '').replace(/["」』]$/, '')
        .replace(/\s+/g, ' ');
      if (txt.length >= 12 && txt.length <= 200) {
        news[i].body = txt;
        news[i]._raw = false;
        save();
        return true;
      }
    } catch (e) { /* 静默失败，保留本地那条 */ }

    /* 失败也把标记去掉，别每次渲染都重试 */
    news[i]._raw = false;
    save();
    return false;
  }

  /** 有没润色的就补一条，一次只跑一个，免得并发打接口 */
  function flushPolish() {
    if (polishBusy) return;
    if (!aiReady()) return;     // 没配接口就别折腾，留着本地那条
    const i = news.findIndex((x) => x && x._raw);
    if (i < 0) return;
    polishBusy = true;
    polishOne(i).then((changed) => {
      polishBusy = false;
      if (changed && lastRoot && lastRoot.isConnected !== false) {
        repaint(lastRoot);
      }
    });
  }

  /* ------------------------------------------------------------ 生成树 */
  /** AI 通道是否可用：地址、密钥、模型三样都填了才算 */
  function aiReady() {
    const ai = window.__fiefAI;
    if (!ai || typeof ai.getConf !== 'function') return false;
    try {
      const c = ai.getConf();
      return !!(c && c.base && c.key && c.model);
    } catch (e) { return false; }
  }

  /* ------------------------------------------------------------ 导入 / 手写 */
  /** 空白骨架：点一下填进输入框，改名字改天数就能用 */
  const TEMPLATE = JSON.stringify({
    name: '我的领地',
    periodTitle: '第一期',
    agenda: '先把边稳住，再谈通商',
    stability: 50,
    warSupport: 50,
    branches: [{ id: 'b1', name: '固边', purpose: '先把边界稳住' }],
    nodes: [
      { id: 'n1', name: '编练乡勇', branch: '固边', days: 20, prerequisites: [], effects: [{ kind: 'stability', value: 3 }] },
      { id: 'n2', name: '修堡', branch: '固边', days: 40, prerequisites: [['n1']], effects: [{ kind: 'warSupport', value: 5 }] },
      { id: 'n3', name: '开市', branch: '固边', days: 30, prerequisites: [['n2']], effects: [{ kind: 'stability', value: 4 }] },
    ],
  }, null, 2);

  /**
   * 导入用的宽松校验：只要结构说得通就收，不像 AI 那套要求 6 个节点以上。
   * 自己手写的树可以只有三五个焦点，也可以有十几个。
   */
  function normalizeImport(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('顶层得是一个对象');
    const list = Array.isArray(raw.nodes) ? raw.nodes : [];
    if (!list.length) throw new Error('nodes 是空的');

    const seen = new Set();
    const nodes = [];
    for (const n of list) {
      if (!n || typeof n !== 'object') continue;
      const id = String(n.id || '').trim();
      if (!id || seen.has(id)) continue;   // 没 id 或重复，直接跳
      seen.add(id);
      const days = Math.round(Number(n.days));
      nodes.push({
        id,
        name: String(n.name || id).trim(),
        branch: String(n.branch || '').trim(),
        days: Number.isFinite(days) ? Math.max(1, Math.min(365, days)) : 30,
        prerequisites: (Array.isArray(n.prerequisites) ? n.prerequisites : [])
          .map((g) => (Array.isArray(g) ? g : [g]).map((x) => String(x).trim()).filter(Boolean))
          .filter((g) => g.length),
        effects: (Array.isArray(n.effects) ? n.effects : [])
          .filter((e) => e && ['stability', 'warSupport', 'capability'].indexOf(e.kind) >= 0),
        requirements: Array.isArray(n.requirements) ? n.requirements : [],
        mutex: n.mutex && typeof n.mutex === 'object' ? n.mutex : null,
      });
    }
    if (!nodes.length) throw new Error('没有一条能用的节点（id 是空的？）');

    /* 悬空前置和自引用清掉，否则状态机永远算不到 ready */
    for (const n of nodes) {
      n.prerequisites = n.prerequisites
        .map((g) => g.filter((x) => x !== n.id && seen.has(x)))
        .filter((g) => g.length);
    }

    const name = String(raw.name || raw.id || '导入树').trim() || '导入树';
    return {
      id: name,
      name,
      _imported: true,
      stability: Number.isFinite(Number(raw.stability)) ? Number(raw.stability) : 50,
      warSupport: Number.isFinite(Number(raw.warSupport)) ? Number(raw.warSupport) : 50,
      periodTitle: String(raw.periodTitle || ''),
      agenda: String(raw.agenda || ''),
      longTerm: Array.isArray(raw.longTerm) ? raw.longTerm : [],
      branches: Array.isArray(raw.branches) ? raw.branches : [],
      capabilities: Array.isArray(raw.capabilities) ? raw.capabilities : [],
      relations: [],
      historical: [],
      nodes,
    };
  }

  /** 把输入框里的 JSON 收成一棵树，成功就切过去 */
  function doImport() {
    let raw = null;
    try {
      raw = JSON.parse(String(impText || '').trim());
    } catch (e) {
      impErr = '不是合法 JSON：' + (e && e.message ? e.message : String(e));
      return false;
    }
    let t = null;
    try {
      t = normalizeImport(raw);
    } catch (e) {
      impErr = '导入失败：' + (e && e.message ? e.message : String(e));
      return false;
    }
    const key = t.name;
    trees[key] = t;
    countryId = key;
    done = new Set();
    running = new Map();
    sel = null;
    openAll = false;
    impOpen = false;
    impErr = '';
    impText = '';
    save();
    return true;
  }

  async function generate(rootEl) {
    const ai = window.__fiefAI;
    const FAI = window.__fiefFocusAI;
    if (!ai) { genErr = 'AI 通道没加载，先去设置里配接口'; repaint(rootEl); return; }
    if (!FAI) { genErr = '国策提示词模块没加载'; repaint(rootEl); return; }
    if (genBusy) return;

    genBusy = true;
    genErr = '';
    repaint(rootEl);

    try {
      const prompt = FAI.build(ctx);
      const raw = await ai.chat(prompt, {
        system: FAI.system,
        temperature: 0.75,
        maxTokens: 8000,
      });
      const obj = ai.extractJson(raw);
      const t = FAI.normalize(obj);

      /* 重名就加个后缀，别把已有的树冲掉 */
      let name = t.name;
      let k = 2;
      while (trees[name] && trees[name] !== t) { name = t.name + ' ' + k; k += 1; }
      t.name = name;
      t.id = name;

      trees[name] = t;
      countryId = name;
      done = new Set();
      running = new Map();
      save();
      toastFn('已生成「' + name + '」的国策树，' + t.nodes.length + ' 个焦点');
    } catch (e) {
      genErr = String((e && e.message) || e);
    }

    genBusy = false;
    repaint(rootEl);
  }

  /* ------------------------------------------------------------ 渲染 */
  function nodeHtml(tr, n, st) {
    const cls = ['fx-node', st];
    if (sel === n.id) cls.push('sel');
    const pivotal = n.impact === 'pivotal' ? '<i class="fx-node-piv"></i>' : '';
    let meta = '';
    if (st === 'running') {
      const r = running.get(n.id);
      meta = '进行中　还剩 ' + (r ? Math.max(0, r.left) : 0) + ' 天';
    } else if (typeof n.days === 'number') {
      meta = n.days + ' 天';
    }
    return '<div class="' + cls.join(' ') + '" data-node="' + escFn(n.id) + '">'
      + pivotal
      + '<div class="fx-node-n">' + escFn(n.name) + '</div>'
      + '<div class="fx-node-m">' + escFn(meta) + '</div>'
      + '</div>';
  }

  function branchHtml(tr, b, depth) {
    const mine = tr.nodes.filter((n) => n.branch === b.name);
    if (!mine.length) return '';

    const byDepth = new Map();
    for (const n of mine) {
      const d = depth[n.id] || 0;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d).push(n);
    }
    const ds = Array.from(byDepth.keys()).sort((a, b2) => a - b2);

    let cols = '';
    for (const d of ds) {
      cols += '<div class="fx-col">';
      for (const n of byDepth.get(d)) cols += nodeHtml(tr, n, stateOf(tr, n));
      cols += '</div>';
    }

    const cnt = mine.filter((n) => done.has(n.id)).length;
    return '<div class="fx-branch">'
      + '<div class="fx-branch-h">'
      + '<b>' + escFn(b.name) + '</b>'
      + (b.core ? '<u>核心</u>' : '')
      + '<i>' + cnt + ' / ' + mine.length + '</i>'
      + '</div>'
      + (b.purpose ? '<div class="fx-branch-h"><em>' + escFn(b.purpose) + '</em></div>' : '')
      + '<div class="fx-cols">' + cols + '</div>'
      + '</div>';
  }

  function fmtEffects(n) {
    const out = [];
    for (const e of n.effects || []) {
      if (e.kind === 'capability') out.push('获得能力「' + (e.name || e.key) + '」');
      else if (e.kind === 'commitment') out.push('承担义务「' + (e.name || e.key) + '」');
      else if (e.kind === 'stability') out.push('稳定 ' + (e.value > 0 ? '+' : '') + e.value);
      else if (e.kind === 'warSupport') out.push('战争支持 ' + (e.value > 0 ? '+' : '') + e.value);
    }
    return out;
  }

  function detailHtml(tr, n) {
    const st = stateOf(tr, n);
    const stName = {
      done: '已完成', running: '进行中', ready: '可推进', blocked: '条件不足',
      locked: '前置未满足', mutexed: '已被另一条路线占位',
    }[st] || st;

    const reqs = reqList(tr, n);
    const effs = fmtEffects(n);
    const pre = n.prerequisites || [];

    const preTxt = pre.length
      ? pre.map((g) => g.map((id) => {
        const p = tr.nodes.find((x) => x.id === id);
        return p ? p.name : id;
      }).join(' 或 ')).join('　且　')
      : '无';

    let out = '<div class="fx-detail">';
    out += '<div class="fx-d-h">'
      + '<b>' + escFn(n.name) + '</b>'
      + '<u>' + escFn(n.branch || '') + '</u>'
      + '<u>' + escFn(stName) + '</u>'
      + '<s data-close="1" title="收起">✕</s>'
      + '</div>';

    out += '<div class="fx-d-b">';
    if (n.description) out += '<div class="fx-d-tx">' + escFn(n.description) + '</div>';

    out += '<div class="fx-d-row"><k>工期</k><v><b>' + (n.days || '?') + ' 天</b>'
      + (n.durationReason ? '　' + escFn(n.durationReason) : '') + '</v></div>';

    if (st === 'running') {
      const r = running.get(n.id);
      out += '<div class="fx-d-row"><k>进度</k><v><b>还剩 ' + (r ? Math.max(0, r.left) : 0)
        + ' 天</b>　从「' + escFn((r && r.from) || lastPeriod || '本期') + '」起算</v></div>';
    }

    out += '<div class="fx-d-row"><k>前置</k><v>' + escFn(preTxt) + '</v></div>';

    if (reqs.length) {
      out += '<div class="fx-d-row"><k>条件</k><v>'
        + reqs.map((r) => '<span class="fx-d-row ' + (r.ok ? 'ok' : 'no') + '" style="display:block">'
          + (r.ok ? '✓ ' : '✕ ') + escFn(r.label) + '</span>').join('')
        + '</v></div>';
    }

    if ((n.investments || []).length) {
      out += '<div class="fx-d-row"><k>投入</k><v>' + n.investments.map((x) => escFn(x)).join('、') + '</v></div>';
    }
    if (effs.length) {
      out += '<div class="fx-d-row"><k>产出</k><v>' + effs.map((x) => escFn(x)).join('、') + '</v></div>';
    }
    if (n.reason) {
      out += '<div class="fx-d-row"><k>依据</k><v>' + escFn(n.reason) + '</v></div>';
    }

    if (n.mutex && n.mutex.reason) {
      const taken = mutexTaken(tr, n);
      out += '<div class="fx-d-row"><k>互斥</k><v>'
        + escFn(n.mutex.reason)
        + (taken ? '　<b style="color:rgba(201,119,106,.95)">已选「' + escFn(taken.name) + '」</b>' : '')
        + '</v></div>';
    }
    out += '</div>';

    out += '<div class="fx-d-f">';
    if (st === 'ready') {
      out += '<button class="fl-btn" data-run="' + escFn(n.id) + '">推 进</button>'
        + '<div class="fx-d-note">推进后进入「进行中」，每过一期扣 30 天；'
        + '同时会填一条指令进聊天框。</div>';
    } else if (st === 'running') {
      const r = running.get(n.id);
      out += '<div class="fx-d-note">进行中，还剩 <b>' + (r ? Math.max(0, r.left) : 0) + ' 天</b>。</div>'
        + '<button class="fl-btn ghost" data-finish="' + escFn(n.id) + '">直接完成</button>';
    } else if (st === 'done') {
      out += '<div class="fx-d-note">已完成。</div>'
        + '<button class="fl-btn ghost" data-undo="' + escFn(n.id) + '">撤销</button>';
    } else if (st === 'locked') {
      out += '<div class="fx-d-note">前置未满足：<b>' + escFn(preTxt) + '</b></div>';
    } else if (st === 'blocked') {
      out += '<div class="fx-d-note">条件不足：<b>'
        + escFn(reqs.filter((r) => !r.ok).map((r) => r.label).join('；')) + '</b></div>';
    } else if (st === 'mutexed') {
      const taken = mutexTaken(tr, n);
      out += '<div class="fx-d-note">这条路线已被「<b>' + escFn(taken ? taken.name : '') + '」占位，不能同时走。</div>';
    }
    out += '</div>';
    out += '</div>';
    return out;
  }

  function newsHtml() {
    if (!news.length) return '';
    let out = '<div class="fx-news">';
    out += '<div class="fx-news-h" data-news-toggle="1">'
      + '<b>国 策 快 讯</b><i>' + news.length + '</i>'
      + '<s>' + (showNews ? '收起' : '展开') + '</s></div>';
    if (showNews) {
      out += '<div class="fx-news-b">';
      for (const it of news.slice(0, 12)) {
        out += '<div class="fx-news-i">'
          + '<div class="fx-news-t">' + escFn(it.title) + '</div>'
          + (it.at ? '<div class="fx-news-at">' + escFn(it.at) + '</div>' : '')
          + (it.body ? '<div class="fx-news-x">' + escFn(it.body) + '</div>' : '')
          + (it.eff ? '<div class="fx-news-e">' + escFn(it.eff) + '</div>' : '')
          + '</div>';
      }
      out += '</div>';
    }
    out += '</div>';
    return out;
  }

  function genHtml() {
    let out = '<div class="fx-gen">';
    if (genBusy) {
      out += '<div class="fx-gen-note">正在拟这棵树的稿…（十来个焦点，可能要几十秒）</div>';
    } else {
      out += '<div class="fx-gen-row">'
        + '<button class="fl-btn ghost fx-gen-btn" data-gen="1">＋ AI 生成</button>'
        + '<button class="fl-btn ghost fx-gen-btn" data-import="1">'
        + (impOpen ? '× 收起' : '⇩ 导入 / 手写') + '</button>'
        + '</div>';
      if (aiReady()) {
        out += '<div class="fx-gen-note">AI 按领地实况现造一棵；'
          + '想自己定方向就点「导入 / 手写」，写 JSON 挂上去。</div>';
      } else {
        out += '<div class="fx-gen-note">AI 还没配接口。'
          + '<span class="fx-gen-link" data-goset="1">去设置 → API 配一个</span>；'
          + '不想用 AI 也行，点「导入 / 手写」自己写树。</div>';
      }
    }

    if (impOpen) {
      out += '<div class="fx-imp">'
        + '<textarea class="fx-imp-ta" data-impta="1" spellcheck="false"'
        + ' placeholder="粘贴国策树 JSON，或者点下面「填空白模板」从骨架改">'
        + escFn(impText) + '</textarea>'
        + '<div class="fx-imp-row">'
        + '<button class="fl-btn ghost" data-tpl="1">填空白模板</button>'
        + '<button class="fl-btn" data-doimport="1">导入</button>'
        + '</div>'
        + (impErr ? '<div class="fx-gen-err">' + escFn(impErr) + '</div>' : '')
        + '</div>';
    }

    if (genErr) out += '<div class="fx-gen-err">' + escFn(genErr) + '</div>';
    out += '</div>';
    return out;
  }

  function html() {
    if (!lib) return '<div class="fx-empty"><b>国策数据没加载</b></div>';

    const ids = allCountryIds();
    if (!countryId || (!trees[countryId] && !lib.treeOf(countryId))) countryId = ids[0] || '';
    const tr = tree();
    if (!tr) {
      return '<div class="fx">' + genHtml()
        + '<div class="fx-empty"><b>还没有国策树</b>'
        + '<small>上面点一下，让 AI 按你这块地的情况造一棵</small></div></div>';
    }

    const m = meters(tr);
    const total = tr.nodes.length;
    const finished = tr.nodes.filter((n) => done.has(n.id)).length;
    const doing = Array.from(running.keys()).length;
    const pct = total ? Math.round(finished / total * 100) : 0;

    let out = '<div class="fx">';

    out += '<div class="fx-head">'
      + '<div class="fx-title"><b>国 策</b><span>' + escFn(tr.name) + '</span>'
      + (tr._imported ? '<u class="fx-gen-tag">导入</u>' : '')
      + (tr._generated ? '<u class="fx-gen-tag">AI 生成</u>' : '')
      + '</div>'
      + '<div class="fx-meters">'
      + '<span class="fx-meter' + (m.stability < 35 ? ' low' : m.stability >= 65 ? ' high' : '') + '">'
      + '<i>稳定</i><b>' + m.stability + '</b></span>'
      + '<span class="fx-meter' + (m.warSupport < 35 ? ' low' : m.warSupport >= 65 ? ' high' : '') + '">'
      + '<i>战争支持</i><b>' + m.warSupport + '</b></span>'
      + '</div></div>';

    if (ids.length > 1) {
      out += '<div class="fx-pick">'
        + ids.map((id) => '<span class="' + (id === countryId ? 'on' : '') + '" data-country="'
          + escFn(id) + '">' + escFn(id) + (trees[id] ? ' ·自造' : '') + '</span>').join('')
        + '</div>';
    }

    if (tr.periodTitle || tr.agenda) {
      out += '<div class="fx-period">'
        + '<div class="fx-period-h"><span>本期</span><b>' + escFn(tr.periodTitle || '') + '</b>'
        + (lastPeriod ? '<i class="fx-period-p">' + escFn(lastPeriod) + '</i>' : '')
        + '</div>';
      if (tr.agenda) {
        const a = String(tr.agenda);
        const cut = openAll ? a : (a.length > 96 ? a.slice(0, 96) + '…' : a);
        out += '<div class="fx-period-b">' + escFn(cut) + '</div>';
        if (a.length > 96) {
          out += '<div class="fx-period-more" data-openall="1">' + (openAll ? '收起' : '展开全文') + '</div>';
        }
      }
      out += '</div>';
    }

    out += '<div class="fx-prog">'
      + '<span class="fx-prog-t">进 度</span>'
      + '<span class="fx-prog-bar"><i style="width:' + pct + '%"></i></span>'
      + '<span class="fx-prog-n"><b>' + finished + '</b> / ' + total
      + (doing ? '　<i style="color:var(--fl-accent)">' + doing + ' 项进行中</i>' : '')
      + '</span></div>';

    const depth = layout(tr);
    for (const b of tr.branches || []) out += branchHtml(tr, b, depth);

    if (sel) {
      const n = tr.nodes.find((x) => x.id === sel);
      if (n) out += detailHtml(tr, n);
    }

    out += newsHtml();
    out += genHtml();

    out += '</div>';
    return out;
  }

  /* ------------------------------------------------------------ 指令 */
  function buildCommand(n) {
    const tr = tree();
    if (!tr || !n) return '';
    const effs = fmtEffects(n);
    const L = [];
    L.push('[国策] ' + tr.name + ' · ' + n.name);
    L.push('[工期] ' + (n.days || '?') + ' 天');
    if (effs.length) L.push('[影响] ' + effs.join('；'));
    if (n.description) L.push('[说明] ' + String(n.description).slice(0, 120));
    return L.join('\n');
  }

  /* ------------------------------------------------------------ 交互 */
  function bind(rootEl) {
    const q = (s) => rootEl.querySelector(s);

    rootEl.querySelectorAll('[data-country]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-country');
        if (id === countryId) return;
        countryId = id;
        sel = null;
        openAll = false;
        done = new Set();
        running = new Map();
        save();
        repaint(rootEl);
      });
    });

    rootEl.querySelectorAll('[data-node]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-node');
        sel = sel === id ? null : id;
        repaint(rootEl);
      });
    });

    const oa = q('[data-openall]');
    if (oa) oa.addEventListener('click', () => { openAll = !openAll; repaint(rootEl); });

    const cl = q('[data-close]');
    if (cl) cl.addEventListener('click', () => { sel = null; repaint(rootEl); });

    const nt = q('[data-news-toggle]');
    if (nt) nt.addEventListener('click', () => { showNews = !showNews; repaint(rootEl); });

    const gen = q('[data-gen]');
    if (gen) gen.addEventListener('click', () => { generate(rootEl); });

    const goset = q('[data-goset]');
    if (goset) goset.addEventListener('click', () => {
      if (goSettingsFn) { try { goSettingsFn(); } catch (e) { /* 忽略 */ } }
      else toastFn('去底部导航的「设置」里配 API');
    });

    /* ---- 导入 / 手写 ---- */
    const imp = q('[data-import]');
    if (imp) imp.addEventListener('click', () => {
      impOpen = !impOpen;
      if (impOpen && !impText) impText = '';   // 不自动塞模板，空着让人自己贴
      impErr = '';
      repaint(rootEl);
    });

    const ta = q('[data-impta]');
    if (ta) {
      /* 只记内容不重绘：一重绘光标就跳回开头，没法打字 */
      ta.addEventListener('input', () => { impText = ta.value; });
    }

    const tpl = q('[data-tpl]');
    if (tpl) tpl.addEventListener('click', () => {
      impText = TEMPLATE;
      impErr = '';
      repaint(rootEl);
    });

    const doImp = q('[data-doimport]');
    if (doImp) doImp.addEventListener('click', () => {
      if (doImport()) {
        toastFn('已导入：' + countryId);
        repaint(rootEl);
      } else {
        repaint(rootEl);
      }
    });

    /* 推进：进「进行中」，不直接完成 */
    const run = q('[data-run]');
    if (run) run.addEventListener('click', () => {
      const id = run.getAttribute('data-run');
      const tr = tree();
      const n = tr && tr.nodes.find((x) => x.id === id);
      if (!n) return;
      running.set(id, { left: n.days || 14, from: lastPeriod || '本期' });
      save();
      repaint(rootEl);
      const cmd = buildCommand(n);
      if (cmd && fillFn) {
        fillFn(cmd);
        toastFn('已开始推进「' + n.name + '」，指令已填进聊天框');
      }
    });

    /* 直接完成：不想等天数就走这条 */
    const fin = q('[data-finish]');
    if (fin) fin.addEventListener('click', () => {
      const id = fin.getAttribute('data-finish');
      const tr = tree();
      const n = tr && tr.nodes.find((x) => x.id === id);
      if (!n) return;
      running.delete(id);
      done.add(id);
      pushNews(n);
      save();
      repaint(rootEl);
      toastFn('「' + n.name + '」已完成');
    });

    const undo = q('[data-undo]');
    if (undo) undo.addEventListener('click', () => {
      const id = undo.getAttribute('data-undo');
      done.delete(id);
      running.delete(id);
      save();
      repaint(rootEl);
      toastFn('已撤销');
    });
  }

  function repaint(rootEl) {
    if (!rootEl) return;
    lastHtml = html();
    rootEl.innerHTML = lastHtml;
    bind(rootEl);
  }

  /* ------------------------------------------------------------ 入口 */
  window.__fiefFocusUI = {
    mount(opts) {
      lib = opts.lib || window.__fiefFocusData || null;
      if (opts.esc) escFn = opts.esc;
      if (opts.toast) toastFn = opts.toast;
      if (opts.fillComposer) fillFn = opts.fillComposer;
      if (opts.goSettings) goSettingsFn = opts.goSettings;
      host = opts.host || window;
      chatId = opts.chatId || '';
      load();
      return this;
    },
    setChat(id) {
      const next = id || '';
      if (next === chatId) return;
      chatId = next;
      done = new Set();
      running = new Map();
      trees = {};
      news = [];
      lastPeriod = '';
      sel = null;
      load();
    },
    /** 领地实况：生成树要用 */
    setContext(o) {
      ctx = Object.assign({}, ctx, o || {});
      const faction = ctx.faction || '';
      if (!faction || countryId) return;
      const ids = builtinIds();
      const hit = ids.find((id) => id.indexOf(faction) >= 0 || faction.indexOf(id) >= 0);
      if (hit) { countryId = hit; save(); }
    },
    /** 主脚本每期结算后把周期传进来，变了就推一期 */
    setPeriod(p) {
      const v = String(p || '').trim();
      if (!v || v === lastPeriod) return 0;
      const first = !lastPeriod;
      lastPeriod = v;
      if (first) { save(); return 0; }
      const n = tick(PERIOD_DAYS);
      save();
      return n;
    },
    render(container) {
      if (!container) return;
      lastRoot = container;
      const h = html();
      /* 内容一模一样就别重建：切回这一页时白刷一遍 DOM，节点越多越卡 */
      if (h !== lastHtml || !container.querySelector('.fx')) {
        lastHtml = h;
        container.innerHTML = h;
        bind(container);
      }
      flushPolish();
    },
    _test: {
      html, layout, stateOf, prereqMet, meters, reqList, buildCommand, mutexTaken,
      tree, tick, pushNews, allCountryIds, normalizeImport, TEMPLATE,
      setCountry(id) { countryId = id; },
      setDone(ids) { done = new Set(ids || []); },
      setRunning(o) { running = new Map(Object.entries(o || {})); },
      setTrees(o) { trees = o || {}; },
      setNews(o) { news = o || []; },
      setPeriodRaw(p) { lastPeriod = p || ''; },
      setSel(id) { sel = id; },
      setImpText(v) { impText = v || ''; },
      doImport,
      impErr: () => impErr,
      done: () => Array.from(done),
      running: () => Object.fromEntries(running),
      news: () => news.slice(),
    },
  };
})();
