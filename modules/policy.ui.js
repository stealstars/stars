/* 政令抽卡界面。改这里。 */
/* ==========================================================================
 * 政策抽卡（内测）—— 领地档案的页签模块 · 特效版
 *
 * 设计：
 *   - 不设稀有度，颜色只表示类别
 *   - 一屏抽 5 张，可重抽（放弃的不再出现）
 *   - 互斥：选了就灰掉对面
 *   - 冲突：同选时红字牵制，并写进 <政令> 区块
 *   - 选中 → 填进聊天框，草稿可改
 *
 * 特效层：
 *   卡背流光 / 发牌翻转入场 / 3D 悬浮跟随 / 选中脉冲 / 粒子飞散
 *   全部用 CSS 变量驱动，不依赖 color-mix（旧 WebView 会整条丢声明）
 * ========================================================================== */
(() => {
  'use strict';

  const HAND_SIZE = 5;
  const REROLL_MAX = 3;

  /* -------------------------------------------------------------- 状态 */
  let lib = null;
  let escFn = (s) => String(s == null ? '' : s);
  let toastFn = () => {};
  let fillFn = () => {};

  let cat = '全部';
  let hand = [];
  let discarded = new Set();
  let chosen = [];
  let rerolls = REROLL_MAX;
  let dealKey = 0;      // 每次发牌 +1，用来重播入场动画
  let lastPicked = null; // 刚刚点下的那张，用于脉冲

  /* ------------------------------------------------ AI：合成 / 自创 */
  // 生成出来的政策不进牌库，单独放在这里，跟抽到的政策一样能选能删
  let custom = [];          // [{id,name,desc,cat,cost,risk,why,src}]
  let aiBusy = false;
  let aiErr = '';
  let aiMode = '';          // 'synth' | 'create'
  let ideaText = '';        // 自创时玩家输入的想法
  let lastResult = null;    // 合成结果，显示在结果条里

  let ctx = {};             // 主脚本塞进来的领地上下文

  const AI = () => window.__fiefAI || null;
  const PR = () => window.__fiefPolicyAI || null;

  function customColor(c) {
    const x = (lib && lib.CATS || []).find((y) => y.key === c);
    return x ? x.color : '#d4af5a';
  }

  /** 把 AI 产出的一条政策转成卡片能用的形状 */
  function toItem(o, src) {
    return {
      id: 'X' + (custom.length + 1) + '_' + Date.now().toString(36),
      name: o.name,
      desc: o.desc || '',
      cat: o.cat || '民生',
      color: customColor(o.cat || '民生'),
      cost: o.cost || '',
      risk: o.risk || '',
      why: o.why || '',
      src: src,
      no: 0,
    };
  }

  /* -------------------------------------------------------------- 工具 */
  function tint(hex, alpha) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return 'rgba(212,175,90,' + alpha + ')';
    const n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  /* -------------------------------------------------------------- 抽取 */
  function poolOf(c) {
    if (!lib) return [];
    if (c === '全部') return lib.ORDER.slice();
    return lib.ORDER.filter((id) => lib.BY_ID[id].cat === c);
  }

  function draw() {
    const pool = poolOf(cat).filter((id) => chosen.indexOf(id) < 0 && !discarded.has(id));
    const arr = pool.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    hand = arr.slice(0, HAND_SIZE);
    dealKey += 1;
  }

  function reroll() {
    if (rerolls <= 0) { toastFn('重抽次数用完了'); return false; }
    for (const id of hand) discarded.add(id);
    rerolls -= 1;
    draw();
    return true;
  }

  function reset() {
    discarded = new Set();
    rerolls = REROLL_MAX;
    hand = [];
    draw();
  }

  /* -------------------------------------------------------------- 选 / 弃 */
  /** 统一取项：内置政策查 BY_ID，AI 生成的在 custom 里 */
  function itemOf(id) {
    if (lib && lib.BY_ID[id]) return lib.BY_ID[id];
    for (let i = 0; i < custom.length; i += 1) if (custom[i].id === id) return custom[i];
    return null;
  }

  function allItems() {
    const list = lib ? lib.ORDER.map((id) => lib.BY_ID[id]) : [];
    return list.concat(custom);
  }

  function pick(id) {
    if (chosen.indexOf(id) >= 0) {
      chosen = chosen.filter((x) => x !== id);
      lastPicked = null;
      return;
    }
    // AI 生成的政策不在牌库里，没有预设互斥关系，跳过这一步
    if (lib.BY_ID[id]) {
      for (const other of chosen.slice()) {
        if (lib.isExclusive(id, other)) chosen = chosen.filter((x) => x !== other);
      }
    }
    chosen.push(id);
    lastPicked = id;
  }

  function isBlocked(id) {
    // AI 生成的政策不参与互斥判定
    if (!lib.BY_ID[id]) return null;
    for (const other of chosen) {
      if (!lib.BY_ID[other]) continue;
      if (lib.isExclusive(id, other)) return other;
    }
    return null;
  }

  /* ------------------------------------------------------------ 交叉计算 */
  function relations() {
    const ex = [], sy = [], cf = [];
    for (let i = 0; i < chosen.length; i += 1) {
      for (let j = i + 1; j < chosen.length; j += 1) {
        const a = chosen[i], b = chosen[j];
        // AI 生成的政策没有预设的互斥 / 协同关系，跳过
        if (!lib.BY_ID[a] || !lib.BY_ID[b]) continue;
        if (lib.isExclusive(a, b)) ex.push([a, b]);
        if (lib.isSynergy(a, b)) sy.push([a, b]);
        const why = lib.conflictWith(a, b);
        if (why) cf.push([a, b, why]);
      }
    }
    return { ex, sy, cf };
  }

  /* ---------------------------------------------------------- 生成指令 */
  function buildCommand() {
    if (!chosen.length) return '';
    const names = chosen.map((id) => (itemOf(id) || {}).name).filter(Boolean);
    let out = '[政令] ' + names.join('、');
    const { cf } = relations();
    if (cf.length) {
      const parts = cf.map(([a, b]) => (itemOf(a) || {}).name + ' 与 ' + (itemOf(b) || {}).name + ' 相互牵制');
      out += '\n[牵制] ' + parts.join('；');
    }
    // AI 造出来的政策要注明来历，免得 AI 以为是牌库里本来就有的
    const made = chosen.filter((id) => {
      const x = itemOf(id);
      return x && x.src;
    }).map((id) => itemOf(id));
    if (made.length) {
      out += '\n[新拟] ' + made.map((x) => x.name + '（' + x.cat + '）'
        + (x.cost ? '，代价：' + x.cost : '')
        + (x.risk ? '，风险：' + x.risk : '')).join('；');
    }
    return out;
  }

  /* -------------------------------------------------------------- 渲染 */
  function cardHtml(id, idx) {
    const p = itemOf(id);
    if (!p) return '';
    const on = chosen.indexOf(id) >= 0;
    const blockedBy = isBlocked(id);
    const cls = ['fl-pc'];
    if (on) cls.push('on');
    if (blockedBy) cls.push('off');
    if (p.src) cls.push('ai');
    if (lastPicked === id) cls.push('pop');

    const glow = on ? 0.45 : 0.16;
    const st = [
      '--fl-pc:' + p.color,
      '--fl-pc-06:' + tint(p.color, 0.06),
      '--fl-pc-14:' + tint(p.color, 0.14),
      '--fl-pc-28:' + tint(p.color, 0.28),
      '--fl-pc-55:' + tint(p.color, 0.55),
      '--fl-pc-glow:' + tint(p.color, glow),
      '--fl-d:' + (idx * 90) + 'ms',
    ].join(';');

    const bx = blockedBy ? itemOf(blockedBy) : null;
    return `<div class="${cls.join(' ')}" data-id="${id}" data-k="${dealKey}-${idx}" style="${st}">
      <div class="fl-pc-in">
        <div class="fl-pc-fx"></div>
        <div class="fl-pc-sheen"></div>
        <div class="fl-pc-top"><span class="fl-pc-cat">${escFn(p.cat)}</span><span class="fl-pc-id">${escFn(p.src === 'synth' ? '合' : p.src === 'create' ? '创' : p.id)}</span></div>
        <div class="fl-pc-name">${escFn(p.name)}</div>
        <div class="fl-pc-desc">${escFn(p.desc)}</div>
        ${blockedBy && bx ? `<div class="fl-pc-block">与「${escFn(bx.name)}」互斥</div>` : ''}
        <div class="fl-pc-check">✓</div>
      </div>
    </div>`;
  }

  function chipHtml(id) {
    const p = itemOf(id);
    if (!p) return '';
    return `<span class="fl-chosen" data-del="${id}" style="--fl-pc:${p.color};--fl-pc-18:${tint(p.color, 0.18)};--fl-pc-50:${tint(p.color, 0.5)}">${escFn(p.name)}<i>✕</i></span>`;
  }

  function html() {
    if (!lib) return '<div class="fl-empty"><b>◇</b>政令数据未加载</div>';

    const cats = ['全部'].concat(lib.CATS.map((c) => c.key));
    const catBar = cats.map((k) => {
      const c = lib.CATS.find((x) => x.key === k);
      const n = k === '全部' ? lib.ORDER.length : lib.POOL[k].length;
      const st = c
        ? `--fl-pc:${c.color};--fl-pc-14:${tint(c.color, 0.14)};--fl-pc-30:${tint(c.color, 0.3)}`
        : '--fl-pc:var(--fl-accent)';
      return `<span class="fl-pcat${cat === k ? ' on' : ''}" data-c="${k}" style="${st}"><b>${escFn(k)}</b><u>${n}</u></span>`;
    }).join('');

    const handHtml = hand.length
      ? hand.map((id, i) => cardHtml(id, i)).join('')
      : '<div class="fl-pempty">'
        + '<div class="fl-pempty-ring"><i></i><i></i><i></i></div>'
        + '<b>这一类别抽完了</b><small>换个类别，或点「重置」</small></div>';

    const rel = relations();
    let relHtml = '';
    if (rel.sy.length) {
      relHtml += `<div class="fl-rel sy"><b>协同</b><span>${rel.sy.map(([a, b]) => `${escFn((itemOf(a) || {}).name)} ＋ ${escFn((itemOf(b) || {}).name)}`).join('　·　')}</span></div>`;
    }
    if (rel.cf.length) {
      relHtml += `<div class="fl-rel cf"><b>牵制</b><span>${rel.cf.map(([a, b, w]) => `<div class="fl-rel-r">${escFn((itemOf(a) || {}).name)} 与 ${escFn((itemOf(b) || {}).name)}——${escFn(w)}</div>`).join('')}</span></div>`;
    }

    return `<div class="fl-policy">
      <div class="fl-pbar">
        <div class="fl-pcats">${catBar}</div>
        <div class="fl-pact">
          <button class="fl-btn fl-drawbtn" id="fl-draw"><span>抽 五 张</span></button>
          <button class="fl-btn ghost" id="fl-reroll"${rerolls <= 0 ? ' disabled' : ''}>重抽 <b>${rerolls}</b></button>
          <button class="fl-btn ghost" id="fl-reset">重置</button>
        </div>
      </div>

      ${aiPanelHtml()}

      <div class="fl-phand" data-deal="${dealKey}">${handHtml}</div>

      <div class="fl-pfoot">
        <div class="fl-pchosen">
          <span class="fl-plabel">已 颁 政 令 <u>${chosen.length}</u></span>
          <div class="fl-pchips">${chosen.length ? chosen.map(chipHtml).join('') : '<span class="fl-pnone">还没选</span>'}</div>
        </div>
        ${relHtml}
        <div class="fl-pgo">
          <button class="fl-btn primary fl-sendbtn" id="fl-send"${chosen.length ? '' : ' disabled'}>
            <span>填 进 聊 天 框</span>
          </button>
          <button class="fl-btn ghost" id="fl-clear"${chosen.length ? '' : ' disabled'}>清空</button>
        </div>
      </div>
    </div>`;
  }

  /* ------------------------------------------------ AI 面板（合成 / 自创） */

  /** 内置政策的（用于合成）—— 只列已选的 */
  function chosenBuiltin() {
    return chosen.map((id) => itemOf(id)).filter((x) => x && !x.src);
  }

  function aiPanelHtml() {
    const pr = PR();
    const ai = AI();
    const ready = !!(pr && ai);
    const picked = chosenBuiltin();
    // 允许「一个字也行，按回车就提交」，但至少要有内容
    const canSynth = ready && picked.length >= 2 && !aiBusy;
    const canCreate = ready && ideaText.trim().length >= 1 && !aiBusy;

    let out = '<div class="fl-pai">';
    // 合成
    out += '<div class="fl-pai-r">'
      + '<button class="fl-btn ghost fl-pai-btn" id="fl-synth"'
      + (canSynth ? '' : ' aria-disabled="true"') + '>'
      + '合成已选 <b>' + picked.length + '</b></button>'
      + '<span class="fl-pai-hint">'
      + (picked.length < 2 ? '选两条以上才能合成' : '把这几条并成一条上位政策')
      + '</span></div>';

    // 自创
    // 不用 disabled：禁用的按钮点了毫无反馈，玩家会以为页面坏了。
    // 换成 aria-disabled + 点击时说明原因。
    out += '<div class="fl-pai-r fl-pai-idea">'
      + '<input class="fl-pai-in" id="fl-idea" type="text" maxlength="60" '
      + 'placeholder="一句话想法，比如「让商队愿意常驻」" value="' + escFn(ideaText) + '">'
      + '<button class="fl-btn ghost fl-pai-btn" id="fl-create"'
      + (canCreate ? '' : ' aria-disabled="true"') + '>自创</button>'
      + '</div>';

    if (!ready) {
      out += '<div class="fl-pai-note">要用合成与自创，先去 <b>设置 → API</b> 配好接口。</div>';
    }
    if (aiBusy) {
      out += '<div class="fl-pai-note busy">' + (aiMode === 'synth' ? '正在合成…' : '正在拟稿…')
        + '<i class="fl-pai-dot"></i></div>';
    }
    if (aiErr) out += '<div class="fl-pai-note err">' + escFn(aiErr) + '</div>';

    // 合成失败：明确告诉玩家合不成，别装作成功
    if (lastResult && lastResult.ok === false) {
      out += '<div class="fl-pai-note warn">合不成：' + escFn(lastResult.why) + '</div>';
    }

    // 生成出来的政策
    if (custom.length) {
      out += '<div class="fl-pai-made">';
      for (const it of custom) {
        const picked = chosen.indexOf(it.id) >= 0;
        out += '<span class="fl-made' + (picked ? ' on' : '') + '" data-made="' + escFn(it.id) + '" style="--fl-pc:' + it.color + '">'
          + '<b>' + escFn(it.name) + '</b><u>' + escFn(it.cat) + '</u>'
          + (it.src === 'synth' ? '<s>合成</s>' : '<s>自创</s>')
          + '<i data-drop="' + escFn(it.id) + '">✕</i>'
          + '</span>';
      }
      out += '</div>';
      out += '<div class="fl-pai-note">点上面的名字可以选进政令；点右边的 ✕ 去掉。</div>';
    }

    out += '</div>';
    return out;
  }

  /* ------------------------------------------------ AI：合成 / 自创 */

  /** 合成本身：AI 判断能不能合，不能合就老实说 */
  function runSynth(rootEl) {
    const pr = PR(), ai = AI();
    if (!pr || !ai) return;
    const picked = chosenBuiltin().map((x) => ({ name: x.name, cat: x.cat, desc: x.desc }));
    if (picked.length < 2) { toastFn('至少选两条'); return; }

    aiBusy = true; aiErr = ''; aiMode = 'synth'; lastResult = null;
    repaint(rootEl, false, true);

    let userText = '';
    try {
      userText = pr.buildSynth({
        picked,
        domain: ctx.domain || '',
        faction: ctx.faction || '',
        scale: ctx.scale || '',
      });
    } catch (e) {
      aiBusy = false; aiErr = '拼提示词出错：' + ((e && e.message) || e);
      repaint(rootEl, false, true); return;
    }

    ai.chat(userText, {
      system: pr.systemSynth,
      temperature: 0.6,
      maxTokens: 1200,
      module: 'policy',
    }).then((text) => {
      const obj = pr.parse(text);
      const norm = pr.normalizeSynth(obj);
      aiBusy = false;
      aiMode = '';
      if (!norm.ok) {
        lastResult = { ok: false, why: norm.why };
        repaint(rootEl, false, true);
        return;
      }
      const item = toItem(norm, 'synth');
      custom.push(item);
      lastResult = { ok: true, id: item.id };
      // 合出来的政策直接选上
      chosen.push(item.id);
      toastFn('合成了「' + item.name + '」');
      repaint(rootEl, true);
    }).catch((e) => {
      aiBusy = false; aiMode = '';
      aiErr = String((e && e.message) || e).slice(0, 200);
      repaint(rootEl, false, true);
    });
  }

  /** 自创：一句话 → 一条政令 */
  function runCreate(rootEl) {
    const pr = PR(), ai = AI();
    if (!pr || !ai) { aiErr = 'AI 模块或提示词没加载'; repaint(rootEl, false, true); return; }
    // 以输入框当前值为准：缓存可能因为没重绘而对不上
    const el = rootEl ? rootEl.querySelector('#fl-idea') : null;
    if (el) ideaText = el.value;
    const idea = String(ideaText || '').trim();
    if (!idea) { toastFn('先写一句想法'); return; }
    if (aiBusy) return;

    aiBusy = true; aiErr = ''; aiMode = 'create'; lastResult = null;
    repaint(rootEl, false, true);

    let userText = '';
    try {
      userText = pr.buildCreate({
        idea,
        domain: ctx.domain || '',
        faction: ctx.faction || '',
        scale: ctx.scale || '',
        pop: ctx.pop || '',
        treasury: ctx.treasury || '',
        existing: chosen.map((id) => (itemOf(id) || {}).name).filter(Boolean),
      });
    } catch (e) {
      aiBusy = false; aiErr = '拼提示词出错：' + ((e && e.message) || e);
      repaint(rootEl, false, true); return;
    }

    ai.chat(userText, {
      system: pr.systemCreate,
      temperature: 0.75,
      maxTokens: 1000,
      module: 'policy',
    }).then((text) => {
      const obj = pr.parse(text);
      const norm = pr.normalizeCreate(obj);
      aiBusy = false; aiMode = '';
      const item = toItem(norm, 'create');
      custom.push(item);
      lastResult = { ok: true, id: item.id };
      chosen.push(item.id);
      ideaText = '';
      toastFn('拟好了「' + item.name + '」');
      repaint(rootEl, true);
    }).catch((e) => {
      aiBusy = false; aiMode = '';
      aiErr = String((e && e.message) || e).slice(0, 200);
      repaint(rootEl, false, true);
    });
  }

  /* -------------------------------------------------------------- 绑定 */
  /** 触摸设备不做 3D 跟随：没有 hover，监听器纯属空跑 */
  function isTouch() {
    try {
      return (window.matchMedia && window.matchMedia('(hover: none)').matches) === true;
    } catch (e) {
      return false;
    }
  }

  function bind3d(rootEl) {
    if (isTouch()) return;
    rootEl.querySelectorAll('.fl-pc').forEach((n) => {
      const move = (ev) => {
        const r = n.getBoundingClientRect();
        if (!r.width) return;
        const px = (ev.clientX - r.left) / r.width;
        const py = (ev.clientY - r.top) / r.height;
        n.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
        n.style.setProperty('--my', (py * 100).toFixed(1) + '%');
        n.style.setProperty('--rx', ((0.5 - py) * 12).toFixed(2) + 'deg');
        n.style.setProperty('--ry', ((px - 0.5) * 14).toFixed(2) + 'deg');
      };
      n.addEventListener('mousemove', move);
      n.addEventListener('mouseleave', () => {
        n.style.setProperty('--rx', '0deg');
        n.style.setProperty('--ry', '0deg');
        n.style.setProperty('--mx', '50%');
        n.style.setProperty('--my', '50%');
      });
    });
  }

  function bind(rootEl) {
    const q = (s) => rootEl.querySelector(s);

    rootEl.querySelectorAll('.fl-pcat').forEach((n) => {
      n.addEventListener('click', () => {
        cat = n.dataset.c;
        rerolls = REROLL_MAX;
        discarded = new Set();
        lastPicked = null;
        draw();
        repaint(rootEl, true);
      });
    });

    rootEl.querySelectorAll('.fl-pc:not(.off)').forEach((n) => {
      n.addEventListener('click', (ev) => {
        const id = n.dataset.id;
        const wasOn = chosen.indexOf(id) >= 0;
        pick(id);
        if (!wasOn) burst(n, lib.BY_ID[id].color);
        if (wasOn) n.classList.remove('pop');
        repaint(rootEl, false, true);
      });
    });

    const d = q('#fl-draw');
    if (d) d.addEventListener('click', () => { lastPicked = null; reset(); repaint(rootEl, true); });

    const r = q('#fl-reroll');
    if (r) r.addEventListener('click', () => {
      if (reroll()) { lastPicked = null; repaint(rootEl, true); }
    });

    const rs = q('#fl-reset');
    if (rs) rs.addEventListener('click', () => {
      chosen = []; lastPicked = null; reset(); repaint(rootEl, true); toastFn('已重置');
    });

    rootEl.querySelectorAll('.fl-chosen').forEach((n) => {
      n.addEventListener('click', () => {
        chosen = chosen.filter((x) => x !== n.dataset.del);
        lastPicked = null;
        repaint(rootEl, false);
      });
    });

    const s = q('#fl-send');
    if (s) s.addEventListener('click', () => {
      const cmd = buildCommand();
      if (!cmd) return;
      fillFn(cmd);
      s.classList.remove('fired');
      void s.offsetWidth;
      s.classList.add('fired');
      toastFn('已填进聊天框，可再改');
    });

    const c = q('#fl-clear');
    if (c) c.addEventListener('click', () => { chosen = []; lastPicked = null; repaint(rootEl, false); });

    /* ---- AI：合成 / 自创 ---- */
    const sy = q('#fl-synth');
    if (sy) sy.addEventListener('click', () => {
      if (!PR() || !AI()) { aiErr = 'AI 没配好，先去 设置 → API'; repaint(rootEl, false, true); return; }
      const n = chosenBuiltin().length;
      if (n < 2) {
        aiErr = '要合成，先选两条以上（现在选了 ' + n + ' 条）';
        repaint(rootEl, false, true);
        return;
      }
      aiErr = '';
      runSynth(rootEl);
    });

    const idea = q('#fl-idea');
    if (idea) {
      // 输入时只记状态、顺手开关按钮，不整块重绘（重绘会丢焦点，输入到一半就断了）
      const syncBtns = () => {
        const okIdea = ideaText.trim().length >= 1;
        const hasAI = !!(PR() && AI());
        const cr2 = q('#fl-create');
        if (cr2) {
          if (okIdea && hasAI && !aiBusy) cr2.removeAttribute('aria-disabled');
          else cr2.setAttribute('aria-disabled', 'true');
        }
        const sy2 = q('#fl-synth');
        if (sy2) {
          if (chosenBuiltin().length >= 2 && hasAI && !aiBusy) sy2.removeAttribute('aria-disabled');
          else sy2.setAttribute('aria-disabled', 'true');
        }
      };
      idea.addEventListener('input', () => { ideaText = idea.value; syncBtns(); });
      idea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          // 回车时以输入框的实际值为准，别用可能没同步的缓存
          ideaText = idea.value;
          runCreate(rootEl);
        }
      });
      syncBtns();
    }
    const cr = q('#fl-create');
    if (cr) cr.addEventListener('click', () => {
      const el = q('#fl-idea');
      if (el) ideaText = el.value;
      // 点了一定给反馈，让玩家知道缺什么
      if (!PR() || !AI()) { aiErr = 'AI 没配好，先去 设置 → API'; repaint(rootEl, false, true); return; }
      if (!String(ideaText || '').trim()) {
        aiErr = '先在左边写一句想法';
        repaint(rootEl, false, true);
        const back = q('#fl-idea');
        if (back) { try { back.focus(); } catch (e) { /* 忽略 */ } }
        return;
      }
      aiErr = '';
      runCreate(rootEl);
    });

    // 生成出来的政策：点一下选上，点 ✕ 去掉
    rootEl.querySelectorAll('[data-made]').forEach((n) => {
      n.addEventListener('click', (e) => {
        const id = n.getAttribute('data-made');
        if (e.target.closest('[data-drop]')) {
          e.stopPropagation();
          custom = custom.filter((x) => x.id !== id);
          chosen = chosen.filter((x) => x !== id);
          repaint(rootEl, false, true);
          return;
        }
        pick(id);
        repaint(rootEl, false, true);
      });
    });

    bind3d(rootEl);
  }

  /* ------------------------------------------------------------ 粒子飞散 */
  function burst(node, color) {
    const doc = node.ownerDocument;
    if (!doc || !doc.createElement) return;
    const r = node.getBoundingClientRect();
    if (!r.width) return;
    const layer = doc.createElement('div');
    layer.className = 'fl-burst';
    layer.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483646';
    const N = 14;
    for (let i = 0; i < N; i += 1) {
      const d = doc.createElement('i');
      const ang = (Math.PI * 2 * i) / N + Math.random() * 0.5;
      const dist = 40 + Math.random() * 70;
      d.style.cssText = 'position:absolute;width:4px;height:4px;border-radius:50%;'
        + 'left:' + (r.left + r.width / 2) + 'px;top:' + (r.top + r.height / 2) + 'px;'
        + 'background:' + color + ';box-shadow:0 0 8px ' + color + ';'
        + '--tx:' + (Math.cos(ang) * dist).toFixed(1) + 'px;'
        + '--ty:' + (Math.sin(ang) * dist).toFixed(1) + 'px;'
        + '--dl:' + (i * 12) + 'ms;animation:fl-part .62s cubic-bezier(.2,.7,.3,1) forwards';
      layer.appendChild(d);
    }
    doc.body.appendChild(layer);
    setTimeout(() => { try { layer.remove(); } catch (e) { /* 忽略 */ } }, 900);
  }

  /* -------------------------------------------------------------- 重绘 */
  /**
   * @param {Element} rootEl
   * @param {boolean} animate  是否重播发牌动画
   * @param {boolean} keepScroll 是否保持滚动位置（选卡时不要跳）
   */
  function repaint(rootEl, animate, keepScroll) {
    if (!rootEl) return;
    const sy = keepScroll ? rootEl.scrollTop : 0;
    rootEl.innerHTML = html();
    bind(rootEl);
    if (keepScroll) rootEl.scrollTop = sy;
    if (animate) {
      const h = rootEl.querySelector('.fl-phand');
      if (h) { h.classList.remove('dealing'); void h.offsetWidth; h.classList.add('dealing'); }
    }
  }

  /* -------------------------------------------------------------- 入口 */
  window.__fiefPolicyUI = {
    mount(opts) {
      lib = opts.lib || window.__fiefPolicy || null;
      if (opts.esc) escFn = opts.esc;
      if (opts.toast) toastFn = opts.toast;
      if (opts.fillComposer) fillFn = opts.fillComposer;
      draw();
      return this;
    },
    /** 主脚本塞领地上下文，合成/自创时用 */
    setContext(o) { ctx = Object.assign({}, ctx, o || {}); },
    render(container) {
      if (!container) return;
      container.innerHTML = html();
      bind(container);
      const h = container.querySelector('.fl-phand');
      if (h) h.classList.add('dealing');
    },
    command: buildCommand,
    chosen: () => chosen.slice(),
    setChosen(ids) { chosen = (ids || []).filter((x) => itemOf(x)); },
    custom: () => custom.slice(),
    _test: {
      draw, reroll, pick, reset, relations, buildCommand, html, itemOf, allItems,
      state: () => ({
        cat, hand, chosen, rerolls,
        discarded: Array.from(discarded), dealKey,
        custom: custom.map((x) => x.name), aiBusy, aiErr, lastResult,
      }),
      setHand(ids) { hand = ids.slice(); },
      setCat(c) { cat = c; },
      setRerolls(n) { rerolls = n; },
      setIdea(v) { ideaText = v; },
      clearDiscarded() { discarded = new Set(); },
      discardAll(ids) { for (const id of ids || []) discarded.add(id); },
      HAND_SIZE, REROLL_MAX,
    },
  };
})();
