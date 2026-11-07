/**
 * 国策树测试。
 *
 * 跑真实的 focus.data.js + focus.ui.js，验证：
 *   1. 数据完整（10 国 / 132 焦点，前置都指向存在的节点）
 *   2. 布局算法（按前置深度分列，分岔并排）
 *   3. 前置语义：外层「与」、内层「或」  ← 最容易搞反的地方
 *   4. 状态机：done / ready / locked / blocked / mutexed
 *   5. 稳定度与战争支持的计算
 *   6. 渲染出来的 HTML 结构
 */
import fs from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass += 1; console.log('  OK   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (e !== undefined ? ' -> ' + e : '')); }
};

const ROOT = 'D:/223/fief-ledger';

/* ---------- 假 localStorage ---------- */
const mem = new Map();
const fakeHost = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
};

const sb = { console };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(ROOT + '/modules/focus.data.js', 'utf8'), sb, { filename: 'focus.data.js' });
vm.runInContext(fs.readFileSync(ROOT + '/modules/focus.ui.js', 'utf8'), sb, { filename: 'focus.ui.js' });
vm.runInContext(fs.readFileSync(ROOT + '/modules/prompts/focus.js', 'utf8'), sb, { filename: 'prompts/focus.js' });

const DATA = sb.__fiefFocusData;
const UI = sb.__fiefFocusUI;
const FAI = sb.__fiefFocusAI;

ok('国策数据加载', !!DATA);
ok('国家数 10', DATA.countries.length === 10, DATA.countries.length);

let nodes = 0;
for (const c of DATA.countries) nodes += c.tree.nodes.length;
ok('焦点总数 132', nodes === 132, nodes);

/* 前置都必须指向存在的节点 */
let dangling = 0;
for (const c of DATA.countries) {
  for (const n of c.tree.nodes) {
    for (const g of n.prerequisites || []) {
      for (const id of g) if (!c.tree.nodes.some((x) => x.id === id)) dangling += 1;
    }
  }
}
ok('前置没有悬空引用', dangling === 0, dangling);

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

UI.mount({ lib: DATA, esc, toast: () => {}, fillComposer: () => {}, host: fakeHost, chatId: 'test' });
const T = UI._test;

/* ---------- 2. 布局 ---------- */
console.log('\n=== 2. 布局：按前置深度分列 ===');
T.setCountry('奥古斯提姆帝国');
T.setDone([]);
const tr = T.tree();
const depth = T.layout(tr);

ok('首个焦点在第 0 列', depth['supply_directorate'] === 0, depth['supply_directorate']);
ok('第二层在第 1 列', depth['chiyuan_trial'] === 1, depth['chiyuan_trial']);
ok('总清册在第 2 列', depth['strategic_inventory'] === 2, depth['strategic_inventory']);

/* 互斥的两条并排在同一列 */
ok('专营令与特许状同列',
  depth['monopoly_decree'] === depth['family_charters'] && depth['monopoly_decree'] === 3,
  depth['monopoly_decree'] + ' vs ' + depth['family_charters']);

/* ---------- 3. 前置语义 ---------- */
console.log('\n=== 3. 前置语义（外层与 / 内层或）===');

/* 奥古斯提姆「颁定帝国军需法典」前置 [["fief_buyback","quota_council"]] → 任一即可 */
const code = tr.nodes.find((n) => n.id === 'supply_code');
T.setDone(['fief_buyback']);
ok('内层「或」：只满足其中一个就够', T.prereqMet(code) === true);

T.setDone(['quota_council']);
ok('内层「或」：换另一个也够', T.prereqMet(code) === true);

T.setDone([]);
ok('两个都没有就不满足', T.prereqMet(code) === false);

/* 卡拉什利亚斯「组建移动粮台」前置三组，外层「与」 */
T.setCountry('卡拉什利亚斯');
const ktr = T.tree();
const depot = ktr.nodes.find((n) => n.id === 'mobile_depots');
ok('找到测试节点', !!depot, depot && depot.id);

T.setDone(['salamander_grain']);
ok('只满足第一组 → 不通过（外层是与）', T.prereqMet(depot) === false);

T.setDone(['salamander_grain', 'caravan_trains']);
ok('满足两组、第三组没走 → 不通过', T.prereqMet(depot) === false);

T.setDone(['salamander_grain', 'caravan_trains', 'iron_hooves']);
ok('第三组走「铁蹄东指」→ 通过', T.prereqMet(depot) === true);

T.setDone(['salamander_grain', 'caravan_trains', 'octagon_city']);
ok('第三组走「八角为城」→ 也通过', T.prereqMet(depot) === true);

/* ---------- 4. 状态机 ---------- */
console.log('\n=== 4. 状态机 ===');
T.setCountry('奥古斯提姆帝国');
const atr = T.tree();
const first = atr.nodes.find((n) => n.id === 'supply_directorate');
const second = atr.nodes.find((n) => n.id === 'chiyuan_trial');

T.setDone([]);
ok('无前置无要求 → ready', T.stateOf(atr, first) === 'ready', T.stateOf(atr, first));
ok('前置没完成 → locked', T.stateOf(atr, second) === 'locked', T.stateOf(atr, second));

T.setDone(['supply_directorate']);
ok('前置完成后 → ready', T.stateOf(atr, second) === 'ready', T.stateOf(atr, second));
ok('自己已完成 → done', T.stateOf(atr, first) === 'done', T.stateOf(atr, first));

/* 互斥：走了一条，另一条 mutexed */
T.setDone(['strategic_inventory', 'monopoly_decree']);
const charter = atr.nodes.find((n) => n.id === 'family_charters');
ok('互斥组另一条 → mutexed', T.stateOf(atr, charter) === 'mutexed', T.stateOf(atr, charter));

/* 条件不足：法典需要稳定度 ≥ 45，且需要 supply_office 能力。
   先满足前置（走回购封地这一支），但故意不给 supply_office，应该判 blocked 而不是 locked。 */
T.setDone(['fief_buyback']);
const codeNode = atr.nodes.find((n) => n.id === 'supply_code');
const reqs = T.reqList(atr, codeNode);
ok('法典有 2 条要求', reqs.length === 2, reqs.length);
ok('缺能力时 reqList 报不满足', reqs.some((r) => !r.ok));
ok('前置满足但条件不足 → blocked', T.stateOf(atr, codeNode) === 'blocked', T.stateOf(atr, codeNode));

/* 补上能力和稳定度 */
T.setDone(['supply_directorate', 'chiyuan_trial', 'strategic_inventory', 'monopoly_decree']);
const reqs2 = T.reqList(atr, codeNode);
ok('能力齐了之后 capability 那条通过',
  reqs2.find((r) => /军需总署/.test(r.label)) ? reqs2.find((r) => /军需总署/.test(r.label)).ok : true,
  JSON.stringify(reqs2));

/* ---------- 5. 指针计算 ---------- */
console.log('\n=== 5. 稳定度 / 战争支持 ===');
T.setDone([]);
const m0 = T.meters(atr);
ok('初始稳定 = 64', m0.stability === 64, m0.stability);
ok('初始战争支持 = 56', m0.warSupport === 56, m0.warSupport);

/* 驰原试行：稳定 -3 */
T.setDone(['chiyuan_trial']);
const m1 = T.meters(atr);
ok('完成试行后稳定 -3', m1.stability === 61, m1.stability);

/* 带 when 的条件式效果不该被算进去 */
T.setDone(['chiyuan_trial', 'monopoly_decree']);
const m2 = T.meters(atr);
/* 试行 -3，专营令 -5 → 64-3-5=56；专营令的 warSupport +2 是无条件的，+4 有 when 不算 */
ok('条件式效果不计入（战争支持只加无条件的 +2）', m2.warSupport === 58, m2.warSupport);

/* ---------- 6. 渲染 ---------- */
console.log('\n=== 6. 渲染 ===');
T.setCountry('奥古斯提姆帝国');
T.setDone([]);
T.setSel(null);
const h = T.html();

ok('有国策标题', /国 策/.test(h));
ok('有国名', h.includes('奥古斯提姆帝国'));
ok('有稳定指针', /稳定/.test(h) && /64/.test(h));
ok('有本期标题', h.includes('军需归于皇座'));
ok('有进度条', /fx-prog-bar/.test(h));
ok('渲染出分支', (h.match(/class="fx-branch"/g) || []).length === 2, (h.match(/class="fx-branch"/g) || []).length);
ok('渲染出节点', (h.match(/data-node="/g) || []).length === 12, (h.match(/data-node="/g) || []).length);
ok('首个节点是 ready', /class="fx-node ready[^"]*" data-node="supply_directorate"/.test(h),
  (h.match(/class="fx-node [a-z ]*" data-node="supply_directorate"/) || [''])[0]);
ok('第二个节点是 locked', /class="fx-node locked[^"]*" data-node="chiyuan_trial"/.test(h),
  (h.match(/class="fx-node [a-z ]*" data-node="chiyuan_trial"/) || [''])[0]);

/* 详情 */
T.setSel('supply_directorate');
const hd = T.html();
ok('详情显示节点名', /fx-detail/.test(hd) && hd.includes('设立帝国军需总署'));
ok('详情有推进按钮', /data-run="supply_directorate"/.test(hd));
ok('详情有工期', /14 天/.test(hd));

/* 指令 */
const cmd = T.buildCommand(atr.nodes.find((n) => n.id === 'supply_directorate'));
ok('指令以 [国策] 开头', /^\[国策\]/.test(cmd), cmd.slice(0, 30));
ok('指令含国名与焦点名', cmd.includes('奥古斯提姆帝国') && cmd.includes('设立帝国军需总署'));
ok('指令含影响', /\[影响\]/.test(cmd));

/* 十个国家都能渲染，不报错 */
console.log('\n=== 7. 十国逐个渲染 ===');
let renderBad = [];
for (const id of DATA.countryIds()) {
  try {
    T.setCountry(id);
    T.setDone([]);
    T.setSel(null);
    const hh = T.html();
    if (!/fx-node/.test(hh)) renderBad.push(id + '(无节点)');
    if (!/fx-branch/.test(hh)) renderBad.push(id + '(无分支)');
  } catch (e) { renderBad.push(id + '(' + e.message + ')'); }
}
ok('十国全部渲染正常', renderBad.length === 0, renderBad.join(', '));

/* 每国首个焦点都应该是 ready（没前置没要求） */
let badReady = [];
for (const c of DATA.countries) {
  T.setCountry(c.tree.id);
  T.setDone([]);
  const root = c.tree.nodes.filter((n) => !(n.prerequisites || []).length);
  if (!root.length) { badReady.push(c.tree.id + '(没有根节点)'); continue; }
  for (const n of root) {
    const st = T.stateOf(c.tree, n);
    if (st !== 'ready' && st !== 'blocked') badReady.push(c.tree.id + '/' + n.name + '=' + st);
  }
}
ok('每国根节点都可推进（或仅缺条件）', badReady.length === 0, badReady.slice(0, 3).join(', '));

/* ---------- 8. 时间推进 ---------- */
console.log('\n=== 8. 时间推进 ===');
T.setCountry('奥古斯提姆帝国');
T.setDone([]);
T.setRunning({});
T.setNews([]);
T.setPeriodRaw('本年三月');

T.setRunning({ supply_directorate: { left: 14, from: '本年三月' } });
ok('进行中的焦点状态是 running',
  T.stateOf(T.tree(), T.tree().nodes.find((n) => n.id === 'supply_directorate')) === 'running');

/* 一期 30 天，14 天的活应该直接完成 */
const fin1 = T.tick(30);
ok('过一期后完成 1 项', fin1 === 1, fin1);
ok('完成状态落到 done', T.done().indexOf('supply_directorate') >= 0, T.done().join(','));
ok('进行中列表已清空', Object.keys(T.running()).length === 0, JSON.stringify(T.running()));
ok('自动落了一条快讯', T.news().length === 1, T.news().length);
ok('快讯带焦点名', T.news()[0] && T.news()[0].title === '设立帝国军需总署', T.news()[0] && T.news()[0].title);
ok('快讯带周期', T.news()[0] && T.news()[0].at === '本年三月', T.news()[0] && T.news()[0].at);

/* 长工期不会被一期扣完 */
T.setDone([]);
T.setRunning({ chiyuan_trial: { left: 90, from: '本年三月' } });
const fin2 = T.tick(30);
ok('90 天的活过一期没完成', fin2 === 0, fin2);
ok('剩余天数扣到 60', T.running().chiyuan_trial.left === 60, T.running().chiyuan_trial.left);

/* ---------- 9. setPeriod ---------- */
console.log('\n=== 9. 结算周期驱动 ===');
T.setPeriodRaw('');
const r1 = UI.setPeriod('本年三月');
ok('第一次设周期只记录，不推进', r1 === 0, r1);

T.setRunning({ chiyuan_trial: { left: 40, from: '本年三月' } });
const r2 = UI.setPeriod('本年四月');
ok('换期后推一期', T.running().chiyuan_trial.left === 10, T.running().chiyuan_trial.left);

const r3 = UI.setPeriod('本年四月');
ok('同一期重复设不重复推', T.running().chiyuan_trial.left === 10, T.running().chiyuan_trial.left);

const r4 = UI.setPeriod('本年五月');
ok('再换一期扣到完成', r4 === 1, r4);
ok('完成后进 done', T.done().indexOf('chiyuan_trial') >= 0, T.done().join(','));

/* ---------- 10. 自定义树 ---------- */
console.log('\n=== 10. 领地自造树 ===');
const fakeTree = {
  id: '灰冠领', name: '灰冠领', _generated: true,
  stability: 58, warSupport: 42,
  periodTitle: '先稳边再通商', agenda: '测一下能不能挂上去',
  longTerm: [], branches: [{ id: 'b1', name: '固边', purpose: '先稳住', core: true }],
  capabilities: [], relations: [], historical: [],
  nodes: [
    { id: 'n1', name: '编练乡勇', branch: '固边', days: 20, prerequisites: [], requirements: [], effects: [], investments: [] },
    { id: 'n2', name: '修堡', branch: '固边', days: 40, prerequisites: [['n1']], requirements: [], effects: [], investments: [] },
  ],
};
T.setTrees({ 灰冠领: fakeTree });
const ids2 = T.allCountryIds();
ok('自造树进了国名列表', ids2.indexOf('灰冠领') >= 0, ids2.length + ' 个');

T.setCountry('灰冠领');
T.setDone([]);
T.setRunning({});
const selfTree = T.tree();
ok('能取到自造树', !!selfTree && selfTree.name === '灰冠领', selfTree && selfTree.name);
const hs = T.html();
ok('自造树能渲染', /编练乡勇/.test(hs) && /修堡/.test(hs));
ok('自造树有 AI 生成标记', /AI 生成/.test(hs));

/* ---------- 11. 生成提示词的校验 ---------- */
console.log('\n=== 11. 生成树的校验 ===');
ok('提示词模块加载', !!FAI);
ok('系统提示词有输出格式', /"nodes"/.test(FAI.system));

const goodRaw = {
  name: '灰冠领',
  description: '边地小领',
  stability: 58, warSupport: 42,
  periodTitle: '先稳边',
  agenda: '先把边稳住',
  longTerm: [{ id: 'lt1', text: '让商队愿意常驻' }],
  branches: [{ id: 'b1', name: '固边', purpose: '稳边', core: true }],
  capabilities: [{ id: 'cap1', name: '乡勇名册', active: true, reason: '已有团练' }],
  nodes: [
    { id: 'n1', name: '编练乡勇', branch: '固边', days: 20, prerequisites: [], requirements: [], effects: [{ kind: 'stability', value: 3 }] },
    { id: 'n2', name: '修堡', branch: '固边', days: 40, prerequisites: [['n1']], requirements: [], effects: [{ kind: 'warSupport', value: 5 }] },
    { id: 'n3', name: '开市', branch: '固边', days: 30, prerequisites: [['n2']], requirements: [], effects: [] },
    { id: 'n4', name: '通商路', branch: '固边', days: 25, prerequisites: [['n3']], requirements: [], effects: [] },
    { id: 'n5', name: '设税卡', branch: '固边', days: 15, prerequisites: [['n4']], requirements: [], effects: [] },
    { id: 'n6', name: '立乡约', branch: '固边', days: 10, prerequisites: [['n5']], requirements: [], effects: [] },
  ],
};
let normOk = null, normErr = null;
try { normOk = FAI.normalize(goodRaw); } catch (e) { normErr = e.message; }
ok('合法树能通过校验', !!normOk && !normErr, normErr);
ok('节点数保留', normOk && normOk.nodes.length === 6, normOk && normOk.nodes.length);
ok('标记为生成物', normOk && normOk._generated === true);
ok('分支自动补齐 core', normOk && normOk.branches[0].core === true);

/* 节点太少 */
let tooFew = null;
try { FAI.normalize(Object.assign({}, goodRaw, { nodes: goodRaw.nodes.slice(0, 2) })); } catch (e) { tooFew = e.message; }
ok('节点太少会报错', !!tooFew, tooFew);

/* 没有起点：让所有节点首尾相接成环，每个都有前置（自引用会被过滤，所以用环形） */
let noRoot = null;
try {
  const bad = JSON.parse(JSON.stringify(goodRaw));
  bad.nodes.forEach((n, i) => {
    n.prerequisites = [[bad.nodes[(i + 1) % bad.nodes.length].id]];
  });
  FAI.normalize(bad);
} catch (e) { noRoot = e.message; }
ok('没有起点会报错', !!noRoot, noRoot);

/* 悬空前置被过滤掉 */
const danglingPre = JSON.parse(JSON.stringify(goodRaw));
danglingPre.nodes[1].prerequisites = [['不存在的节点']];
const nd = FAI.normalize(danglingPre);
ok('悬空前置被丢掉', nd.nodes[1].prerequisites.length === 0, JSON.stringify(nd.nodes[1].prerequisites));

/* 非法效果被丢弃 */
const badEff = JSON.parse(JSON.stringify(goodRaw));
badEff.nodes[0].effects = [{ kind: '税收百分比', value: 10 }, { kind: 'stability', value: 999 }];
const ne = FAI.normalize(badEff);
ok('非法 kind 被丢弃', ne.nodes[0].effects.length === 1, JSON.stringify(ne.nodes[0].effects));
ok('越界数值被夹住', ne.nodes[0].effects[0].value === 20, ne.nodes[0].effects[0].value);

/* 单条互斥会被清掉 */
const singleMutex = JSON.parse(JSON.stringify(goodRaw));
singleMutex.nodes[0].mutex = { group: 'g1', route: 'a', lock: 'start', reason: '测试' };
const nm = FAI.normalize(singleMutex);
ok('只有一条的互斥组被清空', nm.nodes[0].mutex === null, JSON.stringify(nm.nodes[0].mutex));

/* ---------- 12. 没配 API 时的提示 ---------- */
console.log('\n=== 12. 没配 API 时的提示 ===');
T.setCountry('奥古斯提姆帝国');
T.setDone([]);
T.setSel(null);
const hNoAi = T.html();
ok('生成按钮仍在', /data-gen="1"/.test(hNoAi));
ok('提示去设置里配接口', /去设置/.test(hNoAi), (hNoAi.match(/还没配[^<]{0,40}/) || [''])[0]);
ok('「去设置」是可点的', /data-goset="1"/.test(hNoAi));

/* ---------- 13. 快讯润色标记 ---------- */
console.log('\n=== 13. 快讯润色 ===');
T.setNews([{ at: '本年三月', title: '编练乡勇', body: '本地拼的说明', eff: '', _raw: true }]);
T.setCountry('奥古斯提姆帝国');
const hNews = T.html();
ok('快讯能渲染出来', /编练乡勇/.test(hNews));
ok('快讯带正文', /本地拼的说明/.test(hNews));

/* 没配 AI 时不该把 _raw 清掉（留着以后润色） */
T.setNews([{ at: '', title: '测试', body: '正文', eff: '', _raw: true }]);
const before = JSON.stringify(T.news());
UI.render({ innerHTML: '', querySelector: () => null, querySelectorAll: () => [] });
ok('没配 AI 时不动润色标记', JSON.stringify(T.news()) === before, '变了');

/* ---------- 14. 渲染缓存 ---------- */
console.log('\n=== 14. 渲染缓存 ===');
T.setNews([]);
T.setCountry('奥古斯提姆帝国');
T.setDone([]);
T.setSel(null);
let writes = 0;
const cacheEl = {
  _h: '',
  get innerHTML() { return this._h; },
  set innerHTML(v) { writes += 1; this._h = v; },
  querySelector: () => ({ classList: { add() {}, toggle() {} }, addEventListener() {} }),
  querySelectorAll: () => [],
};
UI.render(cacheEl);
const w1 = writes;
UI.render(cacheEl);
ok('内容没变时不重建 DOM', writes === w1, '多写了 ' + (writes - w1) + ' 次');
ok('html() 幂等', T.html() === T.html());

/* ---------- 15. 导入 / 手写 ---------- */
console.log('\n=== 15. 导入 / 手写 ===');
const tiny = {
  name: '三节点小树',
  nodes: [
    { id: 'a', name: '甲', days: 10, prerequisites: [] },
    { id: 'b', name: '乙', days: 20, prerequisites: [['a']] },
    { id: 'c', name: '丙', days: 30, prerequisites: [['b'], ['不存在的']] },
  ],
};
const ti = T.normalizeImport(tiny);
ok('导入没有 6 节点门槛（3 个也收）', ti.nodes.length === 3, ti.nodes.length);
ok('导入标记 _imported', ti._imported === true);
ok('悬空前置被清掉', ti.nodes[2].prerequisites.length === 1
  && ti.nodes[2].prerequisites[0].length === 1, JSON.stringify(ti.nodes[2].prerequisites));
ok('缺 days 给默认 30',
  T.normalizeImport({ name: 'x', nodes: [{ id: 'a', name: 'a' }] }).nodes[0].days === 30);

let impNoNodes = null;
try { T.normalizeImport({ name: 'x', nodes: [] }); } catch (e) { impNoNodes = e.message; }
ok('nodes 空会报错', !!impNoNodes, impNoNodes);

T.setImpText('{ 这不是 json');
ok('非法 JSON 导入失败', T.doImport() === false);
ok('失败有原因', /JSON/.test(T.impErr()), T.impErr());

T.setImpText(T.TEMPLATE);
ok('空白模板能直接导入', T.doImport() === true);
ok('导入后切到新树', !!T.tree() && T.tree().name === '我的领地', T.tree() && T.tree().name);
ok('导入的树能渲染', /编练乡勇/.test(T.html()));

console.log('\n' + (fail ? fail + ' 项失败  ' : '全部通过 ✔  ') + (pass + fail) + ' 项');
process.exit(fail ? 1 : 0);
