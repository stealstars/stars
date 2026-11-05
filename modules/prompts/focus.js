/* ==========================================================================
 * 领地档案 · 国策树生成提示词
 *
 * 给一块领地现造一棵焦点树。产出的 JSON 必须能被 focus.ui.js 直接吃，
 * 所以这里把 schema 写死，并在 normalize 里做严格校验——模型给的东西
 * 只要有一处对不上，宁可整棵不用，也不许半截混进去。
 *
 * 硬口径（跟政策页一致）：
 *   - 只能基于给它的领地实况和世界书，不许自己发明势力、资源、机构
 *   - 焦点必须是这块领地这个规模真能做的（村子别搞帝国军需总署）
 *   - 不写数值加成式的空话，写「做什么、卡在哪」
 * ========================================================================== */
(() => {
  'use strict';

  const h = window;

  const MAX_NODES = 14;
  const MIN_NODES = 6;

  const SYSTEM = [
    '你是一个领地行政的谋士，要给一块领地画一张施政路线图（国策树）。',
    '',
    '【你要做的事】',
    '玩家会给你这块领地的实况：名字、规模档、所属势力、政体、人口、金库、当前处境。',
    '你要据此设计 6-14 个「焦点」（可以理解为一件要花时间推的大事），',
    '把它们组织成 1-2 条「分支」（一条施政主线），标清先后顺序和互相牵制的地方。',
    '',
    '【最重要的三条】',
    '1. 只能用玩家给你的信息。你没看到的东西就是不存在，不许自己发明势力、机构、资源。',
    '2. 规模要对得上。村庄能做的和帝国行省能做的完全不同：',
    '   村庄：修水渠、编户籍、办团练、通商路；',
    '   城镇：设税关、办官学、扩常备、修城墙；',
    '   小国以上：设总署、编法典、建战区、开官营。',
    '   给村庄设计「设立帝国军需总署」是错的。',
    '3. 天数要合理。小事 7-14 天，中等 15-30 天，大事 30-90 天。',
    '',
    '【分支怎么分】',
    '一条分支 = 一条施政主线。常见分法是「主线 / 侧翼」：',
    '主线是你这期最想推的事，侧翼是处理它引起的反应（舆论、反对派、外部压力）。',
    '分支数 1-2 条就够，不要为了凑数硬分。',
    '',
    '【前置怎么用】',
    'prerequisites 是二维数组：',
    '  []                     没有前置',
    '  [["a"]]                要先完成 a',
    '  [["a"],["b"]]          a 和 b 都要完成',
    '  [["a","b"]]            a 或 b 完成一个即可（用于两条互斥路线汇流）',
    '如果两条焦点是「只能选一条」的，用 mutex 标出来：',
    '  "mutex": {"group":"同一个组名","route":"这条路的代号","lock":"start","reason":"为什么只能选一条"}',
    '互斥的两条要指向同一个 group，route 不同。',
    '',
    '【效果只允许这几种】',
    'effects 里每一项的 kind 只能是：',
    '  {"kind":"stability","value":-3}        稳定度变化，-20 到 +20',
    '  {"kind":"warSupport","value":4}        战争支持变化，-20 到 +20',
    '  {"kind":"capability","key":"xxx","name":"能力名","active":true}   解锁一项能力',
    '不要写「+10% 税收」这种百分比加成，系统不认识。',
    '',
    '【输出格式】严格 JSON，不要代码块，不要解释文字',
    '{',
    '  "name": "领地全名",',
    '  "description": "一句话说清这块地的处境，不超过 80 字",',
    '  "stability": 55,',
    '  "warSupport": 40,',
    '  "periodTitle": "本期标题，4-8 字",',
    '  "agenda": "本期要干什么，120 字以内，说清主要矛盾和两条路的分歧点",',
    '  "longTerm": [{"id":"lt1","text":"长期目标，一句话"}],',
    '  "branches": [',
    '    {"id":"b1","name":"分支名，4-8 字","purpose":"这条线要达到什么","core":true}',
    '  ],',
    '  "capabilities": [',
    '    {"id":"cap1","name":"开局就有的能力","active":true,"reason":"依据是什么"}',
    '  ],',
    '  "nodes": [',
    '    {',
    '      "id": "n1",',
    '      "name": "焦点名，4-10 字，像公文标题",',
    '      "branch": "分支名，必须和 branches 里的 name 一模一样",',
    '      "description": "做什么、会碰到什么阻力。60-140 字。",',
    '      "reason": "为什么这么设计，一句话",',
    '      "days": 14,',
    '      "prerequisites": [],',
    '      "requirements": [],',
    '      "investments": ["要投进去的东西"],',
    '      "effects": [{"kind":"stability","value":-2}],',
    '      "impact": "normal",',
    '      "mutex": null',
    '    }',
    '  ]',
    '}',
    '',
    '【impact】',
    '普通焦点写 "normal"，改变整条路线走向的写 "pivotal"。一棵树里 pivotal 不超过 3 个。',
    '',
    '【硬规矩】',
    '· 节点 id 用 n1、n2…，分支 id 用 b1、b2…，能力 id 用 cap1、cap2…',
    '· 前置只能指向本树里存在的节点 id',
    '· 第一个焦点不能有前置',
    '· 每棵树至少有一个没有前置的起点',
    '· 政策名不要古风堆砌，不要四字成语连用，要像真的公文',
    '· 不许出现「某位大人」「在下」这类角色口吻，就是管事的人在写方案',
  ].join('\n');

  /** 把领地实况拼成一段话 */
  function build(ctx) {
    const L = [];
    L.push('领地：' + (ctx.domain || '未命名'));
    if (ctx.faction) L.push('所属势力：' + ctx.faction);
    if (ctx.scale) L.push('规模档：' + ctx.scale);
    if (ctx.gov) L.push('政体：' + ctx.gov);
    if (ctx.pop) L.push('人口：' + ctx.pop);
    if (ctx.treasury) L.push('金库：' + ctx.treasury);
    if (ctx.tierNote) L.push('档位参考：' + ctx.tierNote);
    if (ctx.situation) L.push('当前处境：' + ctx.situation);
    if (ctx.builds && ctx.builds.length) L.push('在建工程：' + ctx.builds.join('、'));
    if (ctx.todo && ctx.todo.length) L.push('待决政务：' + ctx.todo.join('、'));
    L.push('');
    L.push('请给这块领地设计一棵国策树。');
    return L.join('\n');
  }

  /* ------------------------------------------------------------ 校验 */
  function clip(s, n) {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }

  function num(v, lo, hi, dflt) {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  }

  function cleanId(v, prefix, i) {
    const s = String(v == null ? '' : v).trim().replace(/[^\w-]/g, '');
    return s || (prefix + (i + 1));
  }

  /**
   * 严格校验并修正模型返回的树。
   * 任何一处结构不对就抛错——宁可让玩家重试，也不要塞一棵半坏的树进去。
   */
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('模型没返回 JSON 对象');

    const nodesIn = Array.isArray(raw.nodes) ? raw.nodes : null;
    if (!nodesIn) throw new Error('缺 nodes 数组');
    if (nodesIn.length < MIN_NODES) throw new Error('焦点太少（' + nodesIn.length + ' 个，至少 ' + MIN_NODES + ' 个）');
    if (nodesIn.length > MAX_NODES) nodesIn.length = MAX_NODES;

    /* 分支：允许模型只给名字，也允许给完整对象 */
    const branchesIn = Array.isArray(raw.branches) ? raw.branches : [];
    const branchNames = [];
    for (let i = 0; i < branchesIn.length; i += 1) {
      const b = branchesIn[i];
      const name = clip(typeof b === 'string' ? b : b.name, 20);
      if (name && branchNames.indexOf(name) < 0) branchNames.push(name);
    }

    /* 节点 id 去重 */
    const used = new Set();
    const nodes = [];
    for (let i = 0; i < nodesIn.length; i += 1) {
      const n = nodesIn[i] || {};
      let id = cleanId(n.id, 'n', i);
      while (used.has(id)) id += '_';
      used.add(id);

      const branch = clip(n.branch, 20);
      if (!branch) throw new Error('第 ' + (i + 1) + ' 个焦点没写分支');
      if (branchNames.indexOf(branch) < 0) branchNames.push(branch);

      nodes.push({
        id,
        name: clip(n.name, 24) || ('焦点 ' + (i + 1)),
        branch,
        description: clip(n.description, 200),
        reason: clip(n.reason, 120),
        days: num(n.days, 3, 180, 14),
        impact: n.impact === 'pivotal' ? 'pivotal' : 'normal',
        _pre: n.prerequisites,
        _req: n.requirements,
        investments: Array.isArray(n.investments) ? n.investments.slice(0, 6).map((x) => clip(x, 24)) : [],
        _eff: n.effects,
        mutex: null,
        _mutex: n.mutex,
      });
    }

    /* 分支补全：模型可能只给了名字，这里补齐结构 */
    const branches = branchNames.map((name, i) => {
      const src = branchesIn.find((b) => (typeof b === 'string' ? b : b.name) === name) || {};
      return {
        id: cleanId(typeof src === 'string' ? '' : src.id, 'b', i),
        name,
        purpose: clip(typeof src === 'string' ? '' : src.purpose, 80),
        supporters: clip(typeof src === 'string' ? '' : src.supporters, 80),
        opposition: clip(typeof src === 'string' ? '' : src.opposition, 80),
        tradeoff: clip(typeof src === 'string' ? '' : src.tradeoff, 100),
        destination: clip(typeof src === 'string' ? '' : src.destination, 80),
        core: !!(src && src.core),
      };
    });
    /* 一条分支都没标 core，就把第一条当核心 */
    if (branches.length && !branches.some((b) => b.core)) branches[0].core = true;

    /* 前置：只保留指向本树节点的引用 */
    const ids = new Set(nodes.map((n) => n.id));
    for (const n of nodes) {
      const pre = Array.isArray(n._pre) ? n._pre : [];
      const groups = [];
      for (const g of pre) {
        const arr = Array.isArray(g) ? g : [g];
        const keep = arr.map((x) => String(x)).filter((x) => ids.has(x) && x !== n.id);
        if (keep.length) groups.push(keep);
      }
      n.prerequisites = groups;
    }

    /* 至少一个起点 */
    if (!nodes.some((n) => !n.prerequisites.length)) {
      throw new Error('所有焦点都有前置，没有起点');
    }

    /* 条件：只认 capability / stability / warSupport */
    for (const n of nodes) {
      const req = Array.isArray(n._req) ? n._req : [];
      n.requirements = [];
      for (const r of req) {
        if (!r || typeof r !== 'object') continue;
        if (r.kind === 'capability' && r.id) {
          n.requirements.push({ kind: 'capability', id: String(r.id), label: clip(r.label, 60) || ('需要 ' + r.id) });
        } else if (r.kind === 'stability') {
          n.requirements.push({ kind: 'stability', minimum: num(r.minimum, 0, 100, 40), label: clip(r.label, 60) || ('稳定度至少 ' + num(r.minimum, 0, 100, 40)) });
        } else if (r.kind === 'warSupport') {
          n.requirements.push({ kind: 'warSupport', minimum: num(r.minimum, 0, 100, 40), label: clip(r.label, 60) || ('战争支持至少 ' + num(r.minimum, 0, 100, 40)) });
        }
      }
    }

    /* 效果 */
    for (const n of nodes) {
      const eff = Array.isArray(n._eff) ? n._eff : [];
      n.effects = [];
      let k = 0;
      for (const e of eff) {
        if (!e || typeof e !== 'object') continue;
        k += 1;
        if (e.kind === 'capability' && e.key) {
          n.effects.push({
            id: 'e' + k, kind: 'capability',
            key: String(e.key), name: clip(e.name, 30) || String(e.key), active: true,
          });
        } else if (e.kind === 'stability') {
          n.effects.push({ id: 'e' + k, kind: 'stability', value: num(e.value, -20, 20, 0) });
        } else if (e.kind === 'warSupport') {
          n.effects.push({ id: 'e' + k, kind: 'warSupport', value: num(e.value, -20, 20, 0) });
        }
      }
    }

    /* 互斥：同一个 group 至少两条才有意义 */
    const groups = new Map();
    for (const n of nodes) {
      const m = n._mutex;
      if (!m || typeof m !== 'object' || !m.group) continue;
      const g = String(m.group);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(n);
      n.mutex = {
        group: g,
        route: clip(m.route, 20) || n.id,
        lock: m.lock === 'complete' ? 'complete' : 'start',
        reason: clip(m.reason, 120),
      };
    }
    for (const [g, arr] of groups) {
      if (arr.length < 2) {
        for (const n of arr) n.mutex = null;
        groups.delete(g);
      }
    }

    /* 能力：开局就有的 */
    const capsIn = Array.isArray(raw.capabilities) ? raw.capabilities : [];
    const capabilities = capsIn.slice(0, 6).map((c, i) => ({
      id: cleanId(c && c.id, 'cap', i),
      name: clip(c && c.name, 30) || ('能力 ' + (i + 1)),
      active: c && c.active !== false,
      reason: clip(c && c.reason, 80),
    }));

    /* 收尾：去掉临时字段 */
    for (const n of nodes) {
      delete n._pre; delete n._req; delete n._eff; delete n._mutex;
    }

    const longTerm = (Array.isArray(raw.longTerm) ? raw.longTerm : []).slice(0, 4).map((x, i) => ({
      id: cleanId(x && x.id, 'lt', i),
      text: clip(x && x.text, 120),
    })).filter((x) => x.text);

    return {
      id: clip(raw.name, 24) || '本领地',
      name: clip(raw.name, 24) || '本领地',
      description: clip(raw.description, 160),
      stability: num(raw.stability, 0, 100, 55),
      warSupport: num(raw.warSupport, 0, 100, 40),
      evidence: '由领地实况生成',
      keywords: [],
      analysis: '',
      periodTitle: clip(raw.periodTitle, 16) || '本期施政',
      agenda: clip(raw.agenda, 300),
      longTerm,
      autoPeriod: false,
      branches,
      relations: [],
      capabilities,
      historical: [],
      nodes,
      _generated: true,
    };
  }

  h.__fiefFocusAI = {
    system: SYSTEM,
    build,
    normalize,
    MAX_NODES,
    MIN_NODES,
  };
})();
