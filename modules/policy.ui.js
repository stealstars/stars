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
  function pick(id) {
    if (chosen.indexOf(id) >= 0) {
      chosen = chosen.filter((x) => x !== id);
      lastPicked = null;
      return;
    }
    for (const other of chosen.slice()) {
      if (lib.isExclusive(id, other)) chosen = chosen.filter((x) => x !== other);
    }
    chosen.push(id);
    lastPicked = id;
  }

  function isBlocked(id) {
    for (const other of chosen) if (lib.isExclusive(id, other)) return other;
    return null;
  }

  /* ------------------------------------------------------------ 交叉计算 */
  function relations() {
    const ex = [], sy = [], cf = [];
    for (let i = 0; i < chosen.length; i += 1) {
      for (let j = i + 1; j < chosen.length; j += 1) {
        const a = chosen[i], b = chosen[j];
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
    const names = chosen.map((id) => lib.BY_ID[id].name);
    let out = '[政令] ' + names.join('、');
    const { cf } = relations();
    if (cf.length) {
      const parts = cf.map(([a, b]) => lib.BY_ID[a].name + ' 与 ' + lib.BY_ID[b].name + ' 相互牵制');
      out += '\n[牵制] ' + parts.join('；');
    }
    return out;
  }

  /* -------------------------------------------------------------- 渲染 */
  function cardHtml(id, idx) {
    const p = lib.BY_ID[id];
    const on = chosen.indexOf(id) >= 0;
    const blockedBy = isBlocked(id);
    const cls = ['fl-pc'];
    if (on) cls.push('on');
    if (blockedBy) cls.push('off');
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

    return `<div class="${cls.join(' ')}" data-id="${id}" data-k="${dealKey}-${idx}" style="${st}">
      <div class="fl-pc-in">
        <div class="fl-pc-fx"></div>
        <div class="fl-pc-sheen"></div>
        <div class="fl-pc-top"><span class="fl-pc-cat">${escFn(p.cat)}</span><span class="fl-pc-id">${p.id}</span></div>
        <div class="fl-pc-name">${escFn(p.name)}</div>
        <div class="fl-pc-desc">${escFn(p.desc)}</div>
        ${blockedBy ? `<div class="fl-pc-block">与「${escFn(lib.BY_ID[blockedBy].name)}」互斥</div>` : ''}
        <div class="fl-pc-check">✓</div>
      </div>
    </div>`;
  }

  function chipHtml(id) {
    const p = lib.BY_ID[id];
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
      relHtml += `<div class="fl-rel sy"><b>协同</b><span>${rel.sy.map(([a, b]) => `${escFn(lib.BY_ID[a].name)} ＋ ${escFn(lib.BY_ID[b].name)}`).join('　·　')}</span></div>`;
    }
    if (rel.cf.length) {
      relHtml += `<div class="fl-rel cf"><b>牵制</b><span>${rel.cf.map(([a, b, w]) => `<div class="fl-rel-r">${escFn(lib.BY_ID[a].name)} 与 ${escFn(lib.BY_ID[b].name)}——${escFn(w)}</div>`).join('')}</span></div>`;
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
    render(container) {
      if (!container) return;
      container.innerHTML = html();
      bind(container);
      const h = container.querySelector('.fl-phand');
      if (h) h.classList.add('dealing');
    },
    command: buildCommand,
    chosen: () => chosen.slice(),
    setChosen(ids) { chosen = (ids || []).filter((x) => lib.BY_ID[x]); },
    _test: {
      draw, reroll, pick, reset, relations, buildCommand, html,
      state: () => ({ cat, hand, chosen, rerolls, discarded: Array.from(discarded), dealKey }),
      setHand(ids) { hand = ids.slice(); },
      setCat(c) { cat = c; },
      setRerolls(n) { rerolls = n; },
      clearDiscarded() { discarded = new Set(); },
      discardAll(ids) { for (const id of ids || []) discarded.add(id); },
      HAND_SIZE, REROLL_MAX,
    },
  };
})();
