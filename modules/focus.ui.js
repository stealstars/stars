/* ==========================================================================
 * 领地档案 · 国策树
 *
 * 把「国策树合集-十国」的焦点树画成领地档案的样子。
 * 只做「看 + 推进」，不做编辑器，不碰 AI 生成。
 *
 * 前置语义（容易搞反，写在这里防止以后改错）：
 *   [["a","b"]]   → a 或 b 任一完成即可
 *   [["a"],["b"]] → a 和 b 都要完成
 *   依据：卡拉什利亚斯「组建移动粮台」第三组是 ["铁蹄东指","八角为城"]，
 *   这两个节点本身互斥，不可能同时完成，所以内层只能是「或」。
 *
 * 状态存 localStorage，按聊天隔离，不写变量、不进 prompt。
 * ========================================================================== */
(() => {
  'use strict';

  const LS_PREFIX = 'fief-focus-';

  let lib = null;
  let escFn = (s) => String(s == null ? '' : s);
  let toastFn = () => {};
  let fillFn = () => {};
  let host = null;

  let countryId = '';
  let done = new Set();     // 已完成的焦点 id
  let sel = null;           // 详情面板当前打开的焦点 id
  let chatId = '';
  let openAll = false;      // 本期议程展开全文

  /* ------------------------------------------------------------ 存取 */
  function storeKey() { return LS_PREFIX + (chatId || 'default'); }

  function load() {
    if (!host) return;
    try {
      const raw = host.localStorage.getItem(storeKey());
      if (!raw) return;
      const o = JSON.parse(raw);
      if (o && Array.isArray(o.done)) done = new Set(o.done);
      if (o && typeof o.countryId === 'string') countryId = o.countryId;
    } catch (e) { /* 坏数据就当没有 */ }
  }

  function save() {
    if (!host) return;
    try {
      host.localStorage.setItem(storeKey(), JSON.stringify({
        countryId,
        done: Array.from(done),
      }));
    } catch (e) { /* 忽略 */ }
  }

  /* ------------------------------------------------------------ 计算 */
  const tree = () => (lib && countryId ? lib.treeOf(countryId) : null);

  /** 按前置深度分列。外层「与」取最晚，内层「或」取最早。 */
  function layout(tr) {
    const byId = {};
    for (const n of tr.nodes) byId[n.id] = n;
    const depth = {};

    const walk = (n, stack) => {
      if (depth[n.id] != null) return depth[n.id];
      if (stack.has(n.id)) return 0;      // 环保护，数据里应该没有
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

  /** 前置是否满足：外层全都要（与），内层任一即可（或） */
  function prereqMet(n) {
    const pre = n.prerequisites || [];
    if (!pre.length) return true;
    return pre.every((group) => group.some((id) => done.has(id)));
  }

  /** 某项能力是否已经拿到 */
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

  /**
   * 两个指针的当前值。
   * 只累加已完成焦点里无条件的 value；带 when 的是条件式效果，
   * 依赖剧情事实，这里不算，免得凭空给数。
   */
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

  /** 逐条检查 requirements，返回明细供详情面板显示 */
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

  /** 同组互斥里，另一条是否已经占了 */
  function mutexTaken(tr, n) {
    if (!n.mutex || !n.mutex.group) return null;
    for (const other of tr.nodes) {
      if (other.id === n.id) continue;
      if (!other.mutex || other.mutex.group !== n.mutex.group) continue;
      if (done.has(other.id)) return other;
    }
    return null;
  }

  /**
   * 节点状态：
   *   done    已完成
   *   mutexed 互斥组的另一条已经走了
   *   locked  前置没满足
   *   blocked 前置满足但条件不足
   *   ready   可以推进
   */
  function stateOf(tr, n) {
    if (done.has(n.id)) return 'done';
    if (mutexTaken(tr, n)) return 'mutexed';
    if (!prereqMet(n)) return 'locked';
    if (reqList(tr, n).some((r) => !r.ok)) return 'blocked';
    return 'ready';
  }

  /* ------------------------------------------------------------ 渲染 */
  function nodeHtml(tr, n, st) {
    const cls = ['fx-node', st];
    if (sel === n.id) cls.push('sel');
    const pivotal = n.impact === 'pivotal' ? '<i class="fx-node-piv"></i>' : '';
    const days = typeof n.days === 'number' ? n.days + ' 天' : '';
    return '<div class="' + cls.join(' ') + '" data-node="' + escFn(n.id) + '">'
      + pivotal
      + '<div class="fx-node-n">' + escFn(n.name) + '</div>'
      + '<div class="fx-node-m">' + escFn(days) + '</div>'
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
      done: '已完成', ready: '可推进', blocked: '条件不足',
      locked: '前置未满足', mutexed: '已被另一条路线占位',
    }[st] || st;

    const reqs = reqList(tr, n);
    const effs = fmtEffects(n);
    const pre = n.prerequisites || [];

    /* 前置文字：外层「与」、内层「或」 */
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

    out += '<div class="fx-d-row"><k>前置</k><v>' + escFn(preTxt) + '</v></div>';

    if (reqs.length) {
      out += '<div class="fx-d-row"><k>条件</k><v>'
        + reqs.map((r) => '<span class="' + (r.ok ? 'fx-d-row ok' : 'fx-d-row no') + '" '
          + 'style="display:block;' + (r.ok ? '' : '') + '">'
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

    /* 互斥说明 */
    if (n.mutex && n.mutex.reason) {
      const taken = mutexTaken(tr, n);
      out += '<div class="fx-d-row"><k>互斥</k><v>'
        + escFn(n.mutex.reason)
        + (taken ? '　<b style="color:rgba(201,119,106,.95)">已选「' + escFn(taken.name) + '」</b>' : '')
        + '</v></div>';
    }
    out += '</div>';

    /* 底部按钮 */
    out += '<div class="fx-d-f">';
    if (st === 'ready') {
      out += '<button class="fl-btn" data-run="' + escFn(n.id) + '">推 进</button>'
        + '<div class="fx-d-note">推进后会填一条指令进聊天框，由 AI 记进剧情。</div>';
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
      out += '<div class="fx-d-note">这条路线已被「<b>' + escFn(taken ? taken.name : '') + '</b>」占位，不能同时走。</div>';
    }
    out += '</div>';
    out += '</div>';
    return out;
  }

  function html() {
    if (!lib) return '<div class="fx-empty"><b>国策数据没加载</b></div>';

    const ids = lib.countryIds();
    if (!countryId || !lib.treeOf(countryId)) countryId = ids[0] || '';
    const tr = tree();
    if (!tr) return '<div class="fx-empty"><b>没有国策树</b></div>';

    const m = meters(tr);
    const total = tr.nodes.length;
    const finished = tr.nodes.filter((n) => done.has(n.id)).length;
    const pct = total ? Math.round(finished / total * 100) : 0;

    let out = '<div class="fx">';

    /* 头部 */
    out += '<div class="fx-head">'
      + '<div class="fx-title"><b>国 策</b><span>' + escFn(tr.name) + '</span></div>'
      + '<div class="fx-meters">'
      + '<span class="fx-meter' + (m.stability < 35 ? ' low' : m.stability >= 65 ? ' high' : '') + '">'
      + '<i>稳定</i><b>' + m.stability + '</b></span>'
      + '<span class="fx-meter' + (m.warSupport < 35 ? ' low' : m.warSupport >= 65 ? ' high' : '') + '">'
      + '<i>战争支持</i><b>' + m.warSupport + '</b></span>'
      + '</div></div>';

    /* 国名切换 */
    if (ids.length > 1) {
      out += '<div class="fx-pick">'
        + ids.map((id) => '<span class="' + (id === countryId ? 'on' : '') + '" data-country="'
          + escFn(id) + '">' + escFn(id) + '</span>').join('')
        + '</div>';
    }

    /* 本期 */
    if (tr.periodTitle || tr.agenda) {
      out += '<div class="fx-period">'
        + '<div class="fx-period-h"><span>本期</span><b>' + escFn(tr.periodTitle || '') + '</b></div>';
      if (tr.agenda) {
        const a = String(tr.agenda);
        const cut = openAll ? a : (a.length > 96 ? a.slice(0, 96) + '…' : a);
        out += '<div class="fx-period-b">' + escFn(cut) + '</div>';
        if (a.length > 96) {
          out += '<div class="fx-period-more" data-openall="1">'
            + (openAll ? '收起' : '展开全文') + '</div>';
        }
      }
      out += '</div>';
    }

    /* 进度 */
    out += '<div class="fx-prog">'
      + '<span class="fx-prog-t">进 度</span>'
      + '<span class="fx-prog-bar"><i style="width:' + pct + '%"></i></span>'
      + '<span class="fx-prog-n"><b>' + finished + '</b> / ' + total + '</span>'
      + '</div>';

    /* 分支 */
    const depth = layout(tr);
    for (const b of tr.branches || []) out += branchHtml(tr, b, depth);

    /* 详情 */
    if (sel) {
      const n = tr.nodes.find((x) => x.id === sel);
      if (n) out += detailHtml(tr, n);
    }

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

    const run = q('[data-run]');
    if (run) run.addEventListener('click', () => {
      const id = run.getAttribute('data-run');
      const tr = tree();
      const n = tr && tr.nodes.find((x) => x.id === id);
      if (!n) return;
      done.add(id);
      save();
      repaint(rootEl);
      const cmd = buildCommand(n);
      if (cmd && fillFn) {
        fillFn(cmd);
        toastFn('已推进「' + n.name + '」，指令已填进聊天框');
      }
    });

    const undo = q('[data-undo]');
    if (undo) undo.addEventListener('click', () => {
      const id = undo.getAttribute('data-undo');
      done.delete(id);
      save();
      repaint(rootEl);
      toastFn('已撤销');
    });
  }

  function repaint(rootEl) {
    if (!rootEl) return;
    rootEl.innerHTML = html();
    bind(rootEl);
  }

  /* ------------------------------------------------------------ 入口 */
  window.__fiefFocusUI = {
    mount(opts) {
      lib = opts.lib || window.__fiefFocusData || null;
      if (opts.esc) escFn = opts.esc;
      if (opts.toast) toastFn = opts.toast;
      if (opts.fillComposer) fillFn = opts.fillComposer;
      host = opts.host || window;
      chatId = opts.chatId || '';
      load();
      return this;
    },
    /** 主脚本换聊天时调，重新按新聊天取进度 */
    setChat(id) {
      if (id === chatId) return;
      chatId = id || '';
      done = new Set();
      sel = null;
      openAll = false;
      load();
    },
    /** 领地所属势力能对上某棵树时，默认选它 */
    setContext(o) {
      const faction = (o && o.faction) || '';
      if (!faction || countryId) return;
      const ids = lib ? lib.countryIds() : [];
      const hit = ids.find((id) => id.indexOf(faction) >= 0 || faction.indexOf(id) >= 0);
      if (hit) { countryId = hit; save(); }
    },
    render(container) {
      if (!container) return;
      container.innerHTML = html();
      bind(container);
    },
    _test: {
      html, layout, stateOf, prereqMet, meters, reqList, buildCommand, mutexTaken,
      tree,
      setCountry(id) { countryId = id; },
      setDone(ids) { done = new Set(ids || []); },
      setSel(id) { sel = id; },
      done: () => Array.from(done),
    },
  };
})();
