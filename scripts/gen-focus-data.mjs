/**
 * 生成 modules/focus.data.js。
 *
 * 数据来自 D:/223/领地开始/国策参考/国策树合集-十国.json（他人授权参考）。
 * 只做搬运和结构校验，不改内容。
 *
 * 用法：node scripts/gen-focus-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/223/fief-ledger';
const SRC = 'D:/223/领地开始/国策参考/国策树合集-十国.json';
const OUT = path.join(ROOT, 'modules/focus.data.js');

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));

if (raw.kind !== 'national-focus-tree') throw new Error('kind 不对：' + raw.kind);
if (!Array.isArray(raw.countries) || !raw.countries.length) throw new Error('countries 为空');

/* ---- 结构校验：把不合规的地方提前炸出来，别等到运行时 ---- */
const problems = [];
const nodeIds = new Set();
let nodeCount = 0;

for (const c of raw.countries) {
  const tr = c.tree;
  if (!tr || !tr.id) { problems.push('有国家缺 tree.id'); continue; }
  if (!Array.isArray(tr.nodes) || !tr.nodes.length) problems.push(tr.id + ' 没有节点');
  if (!Array.isArray(tr.branches)) problems.push(tr.id + ' 没有 branches');

  const localIds = new Set();
  for (const n of tr.nodes) {
    nodeCount += 1;
    if (!n.id) problems.push(tr.id + ' 有节点缺 id');
    if (!n.name) problems.push(tr.id + '/' + n.id + ' 缺 name');
    if (typeof n.days !== 'number') problems.push(tr.id + '/' + n.id + ' 缺 days');
    if (!n.branch) problems.push(tr.id + '/' + n.id + ' 缺 branch');
    if (localIds.has(n.id)) problems.push(tr.id + ' 节点 id 重复：' + n.id);
    localIds.add(n.id);
    nodeIds.add(tr.id + '/' + n.id);

    /* 分支名必须能在 branches 里找到 */
    if (!tr.branches.some((b) => b.name === n.branch)) {
      problems.push(tr.id + '/' + n.id + ' 的 branch「' + n.branch + '」不在 branches 里');
    }

    /* 前置必须指向本国已有的节点 */
    for (const group of n.prerequisites || []) {
      if (!Array.isArray(group)) { problems.push(tr.id + '/' + n.id + ' prerequisites 不是二维数组'); continue; }
      for (const pid of group) {
        if (!tr.nodes.some((x) => x.id === pid)) {
          problems.push(tr.id + '/' + n.id + ' 前置指向不存在的节点：' + pid);
        }
      }
    }
  }

  /* relations 两端都要存在 */
  for (const r of tr.relations || []) {
    if (!tr.nodes.some((x) => x.id === r.from)) problems.push(tr.id + ' relations.from 不存在：' + r.from);
    if (!tr.nodes.some((x) => x.id === r.to)) problems.push(tr.id + ' relations.to 不存在：' + r.to);
  }
}

if (problems.length) {
  console.error('数据校验未通过：');
  for (const p of problems.slice(0, 20)) console.error('  · ' + p);
  process.exit(1);
}

/* ---- 生成模块 ---- */
const json = JSON.stringify(raw);

const head = `/* 自动生成：国策树数据。改这里没用，改 scripts/gen-focus-data.mjs 再重新生成。 */
/* ==========================================================================
 * 领地档案 · 国策树数据
 *
 * 来源：国策树合集-十国.json（他人授权参考，kind = national-focus-tree）
 * 规模：${raw.countries.length} 国 / ${nodeCount} 个焦点
 *
 * 数据结构：
 *   tree.id / name / description / stability / warSupport
 *   tree.evidence        世界书出处
 *   tree.analysis        局势推演（长文）
 *   tree.periodTitle     本期标题
 *   tree.agenda          本期议程
 *   tree.longTerm[]      长期目标 {id,text}
 *   tree.branches[]      分支 {id,name,purpose,supporters,opposition,tradeoff,destination,core}
 *   tree.capabilities[]  已有能力 {id,name,active,reason}
 *   tree.relations[]     关系 {from,to,kind,change,via[]}
 *   tree.nodes[]         焦点
 *        id / name / branch / description / reason
 *        days / durationReason / icon / impact
 *        prerequisites[][]   外层「与」、内层「或」
 *        requirements[]      {kind,id,label}  kind = capability/stability/warSupport
 *        investments[]       投入（文字）
 *        effects[]           {id,kind,key,name,active}  kind = capability/stability/warSupport/commitment
 *        mutex               {group,route,lock,reason} 互斥路线，lock = start/complete
 *        sustain[] / outcomes[]
 *
 * 前置语义（重要，容易搞反）：
 *   [["a","b"]]        → a 或 b 任一完成即可
 *   [["a"],["b"]]      → a 和 b 都要完成
 *   依据：卡拉什利亚斯「组建移动粮台」的第三组是 ["铁蹄东指","八角为城"]，
 *   而这两个节点本身就是互斥路线，不可能同时完成，所以内层只能是「或」。
 * ========================================================================== */
(() => {
  'use strict';

  const DATA = `;

const tail = `;

  /* -------------------------------------------------------------- 索引 */
  const BY_COUNTRY = {};
  for (const c of DATA.countries) BY_COUNTRY[c.tree.id] = c.tree;

  const NODE = {};
  for (const c of DATA.countries) {
    for (const n of c.tree.nodes) NODE[c.tree.id + '/' + n.id] = n;
  }

  window.__fiefFocusData = {
    kind: DATA.kind,
    version: DATA.version,
    countries: DATA.countries,
    /** 按国名取树 */
    treeOf: (id) => BY_COUNTRY[id] || null,
    /** 取某个焦点 */
    nodeOf: (countryId, nodeId) => NODE[countryId + '/' + nodeId] || null,
    /** 国名清单，按数据顺序 */
    countryIds: () => DATA.countries.map((c) => c.tree.id),
  };
})();
`;

fs.writeFileSync(OUT, head + json + tail, 'utf8');

const bytes = fs.statSync(OUT).size;
console.log('已生成 ' + OUT);
console.log('  国家 ' + raw.countries.length + '　焦点 ' + nodeCount);
console.log('  体积 ' + (bytes / 1024).toFixed(1) + ' KB');
