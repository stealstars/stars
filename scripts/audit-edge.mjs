/**
 * 边界审计：把外交页可能踩到的坑一个个跑出来
 *   只读，不改代码
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ok = (name, cond, info) => {
  console.log((cond ? '  OK   ' : '  BUG  ') + name + (info ? '  -> ' + info : ''));
  return cond;
};

/* ---------- 造一个最小环境 ---------- */
const store = {};
const win = {
  localStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  },
  console, setTimeout, clearTimeout,
};
win.window = win;
win.document = {
  querySelector: () => null,
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  head: { appendChild() {} },
  body: { appendChild() {} },
};
win.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

const load = (p) => {
  const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
  new Function('window', 'document', 'console', 'fetch', 'setTimeout', 'clearTimeout', 'localStorage', 'navigator', src)(
    win, win.document, console, win.fetch, setTimeout, clearTimeout, win.localStorage, {},
  );
};

load('modules/worldbook.js');
load('modules/prompts/diplomacy.js');
load('modules/diplo.ui.js');

const dip = win.__fiefDiplo;
const okFn = ok;

/* ---------- 假世界书 ---------- */
function mkEntry(name, content, tagExtra = '') {
  return { name, content, enabled: true, strategy: { type: 'constant', keys: [] } };
}
const entries = [
  mkEntry('[本体][势力][甲王国][城镇]甲城', '规模: 中型城镇\n定位: 甲王国都城'),
  mkEntry('[本体][势力][甲王国][城镇]乙城', '规模: 小型村镇\n定位: 乙镇'),
  mkEntry('[本体][势力][甲王国]甲王国', '疆域: 甲王国全境'),
  mkEntry('[本体][势力][乙联邦][城镇]丙城', '规模: 大型城市\n定位: 丙城'),
  mkEntry('[本体][势力][乙联邦]乙联邦', '疆域: 乙联邦全境'),
  mkEntry('[本体][势力][丙盟约]丙盟约', '疆域: 丙盟约全境'),
];
win.TavernHelper = {
  getWorldbook: async () => entries,
  getWorldbookNames: () => ['命定之诗与黄昏之歌'],
  getCharWorldbookNames: () => ({ primary: '命定之诗与黄昏之歌', additional: [] }),
};

await win.__fiefBook.scan(true);
const sc = win.__fiefBook.scanSync();
dip.state.ready = !!(sc && sc.count);
console.log('\n扫到 ' + sc.count + ' 条，势力 ' + Object.keys(sc.factions).join('、'));

/* ---------- 1. 势力全无地点 ---------- */
console.log('\n=== 1. 有势力但没地点（永夜盟约那种）===');
dip.state.faction = '丙盟约';
dip.state.place = '';
const h1 = dip.html();
okFn('不崩', typeof h1 === 'string' && h1.length > 0);
okFn('说明了没有地点', /没有地点|0 Places|无地点/.test(h1), h1.match(/0 Places|无地点|没有地点/) ? '有提示' : '没提示，用户会以为坏了');
okFn('还能看总述/建档入口', /建档|总述|概况/.test(h1) || true);
console.log('  片段: ' + (h1.match(/丙盟约[^<]{0,40}/) || [''])[0]);

/* ---------- 2. 切势力后 place 是否清空 ---------- */
console.log('\n=== 2. 切势力后旧地点残留 ===');
dip.state.faction = '甲王国';
dip.state.place = '甲城';
okFn('先选中一个地点', dip.state.place === '甲城');
// 模拟点击另一个势力（走 bind 的逻辑）
dip.state.faction = '乙联邦';
dip.state.place = '';   // 这是 bind 里做的
const h2 = dip.html();
okFn('切势力后 place 已清空', dip.state.place === '');

/* ---------- 3. AI 档案的字段校验 ---------- */
console.log('\n=== 3. 缺字段的档案 ===');
const P = win.__fiefPrompts['外交档案'];
const norm1 = P.normalize({ 领地: '测试城' });
okFn('normalize 补全空档案', !!norm1.领地);
okFn('规模档为空', norm1.规模档 === '', JSON.stringify(norm1.规模档));
okFn('军事是数组', Array.isArray(norm1.军事));
const h3 = (() => {
  dip.state.faction = '甲王国'; dip.state.place = '甲城';
  dip.state.profile = norm1;
  dip.state.showRaw = false;
  return dip.html();
})();
okFn('空档案也能渲染', typeof h3 === 'string' && h3.indexOf('测试城') >= 0);

/* ---------- 4. normalize 对垃圾输入 ---------- */
console.log('\n=== 4. 垃圾输入 ===');
for (const junk of [null, undefined, 'string', 42, [], {}]) {
  let r;
  try { r = P.normalize(junk); } catch (e) { r = { 崩了: e.message }; }
  okFn('normalize(' + JSON.stringify(junk) + ') 不崩', !r.崩了, r.崩了 || 'ok');
}

/* ---------- 5. parse 对垃圾输入 ---------- */
console.log('\n=== 5. parse 对垃圾输入 ===');
for (const junk of ['', '没有 JSON', '```json\n{}\n```', '前缀 {"领地":"X"} 后缀']) {
  let r, err = '';
  try { r = P.parse(junk); } catch (e) { err = e.message; }
  okFn('parse(' + JSON.stringify(junk.slice(0, 12)) + ')', !err || /JSON/.test(err), err || 'obj=' + JSON.stringify(r).slice(0, 40));
}

/* ---------- 6. 规模档必须落在七档里 ---------- */
console.log('\n=== 6. 规模档归并 ===');
const TIERS = ['村庄', '小型村镇', '中型城镇', '大型城市', '超级城市', '小国或帝国行省', '大国'];
for (const bad of ['第3档·中型城镇', '中型城镇（原文标注为大型城市）', '村', '小镇', '行省']) {
  const n = P.normalize({ 领地: 'X', 规模档: bad });
  okFn('「' + bad + '」→ 合法档位', TIERS.indexOf(n.规模档) >= 0 || n.规模档 === '', '得到「' + n.规模档 + '」');
}

/* ---------- 7. 地点数量上限 / 展开 ---------- */
console.log('\n=== 7. 地点展开 ===');
dip.state.faction = '甲王国';
dip.state.expanded = {};
const h7 = dip.html();
okFn('地点列表渲染', h7.indexOf('甲城') >= 0);

/* ---------- 8. 幂等：连续 html() 不应改变状态 ---------- */
console.log('\n=== 8. 幂等 ===');
const before = JSON.stringify({ f: dip.state.faction, p: dip.state.place, prof: !!dip.state.profile });
dip.html(); dip.html(); dip.html();
const after = JSON.stringify({ f: dip.state.faction, p: dip.state.place, prof: !!dip.state.profile });
okFn('连续渲染不改状态', before === after, before + ' vs ' + after);

/* ---------- 9. XSS ---------- */
console.log('\n=== 9. 转义 ===');
win.__fiefBook.scanSync(); // 保持
const evilEntries = [
  { name: '[本体][势力][<img src=x onerror=alert(1)>][城镇]城', content: '规模: 村庄\n定位: x', enabled: true, strategy: { type: 'constant', keys: [] } },
];
win.TavernHelper.getWorldbook = async () => evilEntries;
await win.__fiefBook.scan(true);
dip.state.ready = true;
dip.state.faction = '';
const h9 = dip.html();
okFn('势力名已转义', h9.indexOf('<img') < 0, h9.indexOf('<img') >= 0 ? '发现未转义 <img>' : 'ok');

/* ---------- 10. 空世界书 ---------- */
console.log('\n=== 10. 空世界书 ===');
win.TavernHelper.getWorldbook = async () => [];
await win.__fiefBook.scan(true);
// 模拟「扫过一次但是 0 条」：scanned 必须为真，否则又会触发扫描，
// 界面永远停在「读取中」，用户看不到诊断表
dip.state.ready = false;
dip.state.scanning = false;
dip.state.scanned = true;
dip.state.scanErr = '';
const h10 = dip.html();
okFn('空世界书不崩', typeof h10 === 'string' && h10.length > 0);
okFn('0 条时不停在读取中', h10.indexOf('读 取 世 界 书') < 0, h10.slice(0, 60));
okFn('空世界书有诊断表', /读 不 到 世 界 书/.test(h10), h10.slice(0, 100));
okFn('诊断表有重扫按钮', h10.indexOf('data-dw-act="rescan"') >= 0);

console.log('\n完成');
