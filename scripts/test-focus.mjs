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

const DATA = sb.__fiefFocusData;
const UI = sb.__fiefFocusUI;

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

console.log('\n' + (fail ? fail + ' 项失败  ' : '全部通过 ✔  ') + (pass + fail) + ' 项');
process.exit(fail ? 1 : 0);
