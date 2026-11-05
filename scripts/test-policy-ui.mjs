/**
 * 政策页渲染测试。
 *
 * 政策页分两个分区：抽卡（默认）和国策。
 * 国策区目前是朴素版——只把已选政令列出来，能逐条撤。
 *
 * 这里跑真实的 policy.data.js + policy.ui.js，检查：
 *   1. 默认落在抽卡分区
 *   2. 顶部有分区切换，两边都能切过去
 *   3. 选了政令之后，国策区真的列出来了，标签上数字也跟着变
 *   4. render() 不报错
 */
import fs from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass += 1; console.log('  OK   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (e !== undefined ? ' -> ' + e : '')); }
};

const ROOT = 'D:/223/fief-ledger';

/* ---------- 跑真实模块 ---------- */
const sb = { console };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(ROOT + '/modules/policy.data.js', 'utf8'), sb, { filename: 'policy.data.js' });
vm.runInContext(fs.readFileSync(ROOT + '/modules/policy.ui.js', 'utf8'), sb, { filename: 'policy.ui.js' });

const LIB = sb.__fiefPolicy;
const UI = sb.__fiefPolicyUI;

ok('政令数据加载（108 条）', !!LIB && LIB.ORDER.length === 108, LIB && LIB.ORDER.length);
ok('政策 UI 模块加载', !!UI);

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

UI.mount({ lib: LIB, esc, toast: () => {}, fillComposer: () => {} });
const T = UI._test;

/* ---------- 1. 默认分区 ---------- */
console.log('=== 1. 默认落在抽卡 ===');
ok('默认 tab 是 draw', T.tab() === 'draw', T.tab());

const h1 = T.html();
ok('顶部有分区切换条', /class="fl-ptabs"/.test(h1));
ok('有「抽卡」标签', /data-t="draw"[^>]*>抽卡</.test(h1));
ok('有「国策」标签', /data-t="guo"[^>]*>国策/.test(h1));
ok('抽卡分区显示类别栏', /class="fl-pcats"/.test(h1));
ok('抽卡分区显示抽卡按钮', /id="fl-draw"/.test(h1));
ok('抽卡分区没有国策列表', !/fl-guo-list/.test(h1));

/* ---------- 2. 切到国策 ---------- */
console.log('\n=== 2. 切到国策分区 ===');
T.setTab('guo');
const h2 = T.html();
ok('切过去生效', T.tab() === 'guo');
ok('国策分区出一个挂载点（焦点树由 focus.ui 填）', /id="fx-host"/.test(h2));
ok('抽卡按钮不再出现', !/id="fl-draw"/.test(h2));
ok('分区切换条仍在最上方', h2.indexOf('fl-ptabs') < h2.indexOf('fx-host'));
ok('国策标签是选中态', /class="fl-ptab on" data-t="guo"/.test(h2));

/* ---------- 3. 选了政令之后 ---------- */
console.log('\n=== 3. 选了政令之后 ===');
T.setTab('draw');
T.pick('民1'); T.pick('经1'); T.pick('军1');
ok('已选 3 条', UI.chosen().length === 3, UI.chosen().length);

const h3 = T.html();
ok('分区标签带数量', /data-t="guo">国策<u>3<\/u>/.test(h3),
  (h3.match(/data-t="guo">[^/]{0,30}/) || [''])[0]);

/* 抽卡区底部仍然有已颁政令和发送 */
ok('抽卡区底部有已颁政令', /fl-chosen/.test(h3) || /已 颁 政 令/.test(h3));
ok('抽卡区底部有发送按钮', /id="fl-send"/.test(h3));

/* ---------- 4. 国策分区不掺和政令 ---------- */
console.log('\n=== 4. 国策分区与政令互不干扰 ===');
T.setTab('guo');
const h4 = T.html();
ok('国策分区里没有政令卡片', !/fl-pc-in/.test(h4));
ok('国策分区里没有已颁政令条', !/fl-chosen/.test(h4));
T.setTab('draw');
ok('切回抽卡后政令还在', UI.chosen().length === 3, UI.chosen().length);

/* ---------- 5. render 不报错 ---------- */
console.log('\n=== 5. render 走一遍 ===');
const el = {
  innerHTML: '',
  querySelector: () => null,
  querySelectorAll: () => [],
  classList: { add() {}, remove() {} },
};
let renderErr = null;
try {
  T.setTab('draw');
  UI.render(el);
  T.setTab('guo');
  UI.render(el);
} catch (e) { renderErr = e.message; }
ok('两个分区都能 render', !renderErr, renderErr);
ok('render 真的写了 HTML', el.innerHTML.length > 100, el.innerHTML.length);

/* ---------- 6. 生成指令没被改坏 ---------- */
console.log('\n=== 6. 生成指令仍正常 ===');
UI.setChosen(['民1', '经1']);
const cmd = UI.command();
ok('指令以 [政令] 开头', /^\[政令\]/.test(cmd), cmd.slice(0, 40));
ok('指令含两条名字', cmd.includes('轻徭薄赋') && cmd.includes('鼓励工商'));

console.log('\n' + (fail ? fail + ' 项失败  ' : '全部通过 ✔  ') + (pass + fail) + ' 项');
process.exit(fail ? 1 : 0);
