/* ==========================================================================
 * 领地档案 · 政策提示词（合成 / 自创）
 *
 * 两个功能：
 *   合成  选中的几条政策 → 推演出一条把它们串起来的新政策
 *   自创  一句话想法 + 当前领地 → 推演成一条正式政令
 *
 * 硬口径（跟外交页一致）：
 *   - 只产出「要做什么、代价是什么」，不产数值加成
 *   - 类别必须落在现有 6 类里，不发明新类别
 *   - 与已有政策冲突的，要说清冲突在哪，不许装作没这回事
 *   - 不要写成古风骈文，就是管事的人说话
 * ========================================================================== */
(() => {
  'use strict';

  const h = window;

  const CAT_KEYS = ['民生', '经济', '军事', '法度', '外交', '人事'];

  const SYSTEM_SYNTH = [
    '你是一个领地行政的谋士，负责把几条零散政令合并成一条可执行的施政纲领。',
    '',
    '【你要做的事】',
    '玩家给出几条已经选定的政策，你判断它们能不能合成一条更上位的新政策。',
    '合成不是把名字拼在一起，是找出它们共同的施政意图，用一句话重新说清楚。',
    '',
    '【什么叫能合成】',
    '能合成：几条政策指向同一个目的，只是手段不同。',
    '  例：兴修水利 + 疏浚沟渠 + 设立义仓 → 可以合成「治水备荒」',
    '不能合成：几条政策各有各的目的，硬凑只会变成一句空话。',
    '  这种情况要老实说「合不成」，并说明哪几条互相拉扯。',
    '',
    '【输出格式】严格 JSON，不要代码块，不要解释文字',
    '{',
    '  "ok": true 或 false,',
    '  "name": "政策名，4-8 字",',
    '  "cat": "类别，只能是 民生/经济/军事/法度/外交/人事 之一",',
    '  "desc": "一到两句话。第一句说要做什么，第二句说代价或风险。不超过 60 字。",',
    '  "why": "为什么这几条能合到一起，一句话。ok 为 false 时这里写为什么合不成。",',
    '  "cost": "推行代价，一句话，要具体（钱、人、时间、得罪谁）",',
    '  "risk": "失败风险，一句话。没风险就写空字符串。"',
    '}',
    '',
    '【硬规矩】',
    '· 说明只写「做什么、付什么代价」，绝对不写「+10% 税收」这种数值加成',
    '· 政策名不要用「之」「乃」「矣」，也不要四字成语堆砌，要像真的公文标题',
    '· 类别只能从上面 6 个里挑，不许发明新类别',
    '· 如果玩家选的政策里有互相牵制的，必须在 risk 或 why 里点出来',
    '· ok 为 false 时，name/cat/desc 可以留空字符串',
  ].join('\n');

  const SYSTEM_CREATE = [
    '你是一个领地行政的谋士，负责把玩家的一句想法写成一条可执行的政令。',
    '',
    '【你要做的事】',
    '玩家给一句话（可能很粗糙，比如「我想搞点商业」「让老百姓多生孩子」），',
    '你把它写成一条像样的政策：有名字、有类别、说清做什么和代价。',
    '',
    '【输出格式】严格 JSON，不要代码块，不要解释文字',
    '{',
    '  "name": "政策名，4-8 字",',
    '  "cat": "类别，只能是 民生/经济/军事/法度/外交/人事 之一",',
    '  "desc": "一到两句话。第一句说要做什么，第二句说代价或风险。不超过 60 字。",',
    '  "cost": "推行代价，一句话，要具体",',
    '  "risk": "失败风险，一句话。没风险就写空字符串。"',
    '}',
    '',
    '【硬规矩】',
    '· 只写「做什么、付什么代价」，绝对不写数值加成',
    '· 政策名要像真的公文标题，不要古风堆砌，不要四字成语',
    '· 类别只能从 6 个里挑',
    '· 要贴合玩家领地的实际情况（规模、势力、当前处境），不要写放之四海皆准的空话',
    '· 如果这个想法在这个领地上根本行不通（比如村子要办大学），要在 risk 里直说',
  ].join('\n');

  /** 合成 */
  function buildSynth(o) {
    const picked = (o.picked || []).map((p) => '· ' + p.name + '（' + p.cat + '）：' + p.desc).join('\n');
    const L = [];
    L.push('领地：' + (o.domain || '未命名'));
    if (o.faction) L.push('所属势力：' + o.faction);
    if (o.scale) L.push('规模：' + o.scale);
    L.push('');
    L.push('玩家选定的政策：');
    L.push(picked || '（没有选）');
    L.push('');
    L.push('请判断这几条能不能合成一条新政策。');
    return L.join('\n');
  }

  /** 自创 */
  function buildCreate(o) {
    const L = [];
    L.push('领地：' + (o.domain || '未命名'));
    if (o.faction) L.push('所属势力：' + o.faction);
    if (o.scale) L.push('规模：' + o.scale);
    if (o.pop) L.push('人口：' + o.pop);
    if (o.treasury) L.push('金库：' + o.treasury);
    if (o.existing && o.existing.length) {
      L.push('已颁政令：' + o.existing.join('、'));
    }
    L.push('');
    L.push('玩家的想法：' + (o.idea || ''));
    L.push('');
    L.push('请写成一条正式政令。');
    return L.join('\n');
  }

  /** 从返回里抠 JSON，模型爱包代码块 */
  function parse(text) {
    let s = String(text || '').trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i >= 0 && j > i) s = s.slice(i, j + 1);
    return JSON.parse(s);
  }

  function cleanCat(v) {
    const s = String(v || '').trim();
    for (const k of CAT_KEYS) if (s.indexOf(k) >= 0) return k;
    return '民生';
  }

  function clip(s, n) {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }

  /** 政策名不许太长、不许带标点 */
  function cleanName(v) {
    let s = String(v || '').replace(/[《》「」『』"']/g, '').replace(/[。．，,；;：:]/g, '').trim();
    // 去掉常见的凑字前后缀
    s = s.replace(/^(政策|政令|法令|举措)[:：]?/, '');
    if (s.length > 10) s = s.slice(0, 10);
    return s;
  }

  function normalizeSynth(obj) {
    const o = obj || {};
    const ok = o.ok !== false && o.ok !== 'false' && !!cleanName(o.name);
    if (!ok) {
      return {
        ok: false,
        why: clip(o.why || '这几条凑不到一起', 120),
      };
    }
    return {
      ok: true,
      name: cleanName(o.name),
      cat: cleanCat(o.cat),
      desc: clip(o.desc, 80),
      why: clip(o.why, 120),
      cost: clip(o.cost, 60),
      risk: clip(o.risk, 60),
    };
  }

  function normalizeCreate(obj) {
    const o = obj || {};
    if (!cleanName(o.name)) throw new Error('模型没给出政策名');
    return {
      name: cleanName(o.name),
      cat: cleanCat(o.cat),
      desc: clip(o.desc, 80),
      cost: clip(o.cost, 60),
      risk: clip(o.risk, 60),
    };
  }

  h.__fiefPolicyAI = {
    CAT_KEYS,
    systemSynth: SYSTEM_SYNTH,
    systemCreate: SYSTEM_CREATE,
    buildSynth,
    buildCreate,
    parse,
    normalizeSynth,
    normalizeCreate,
  };
})();
