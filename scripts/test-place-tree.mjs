/**
 * 地点层级：真实数据下渲染出来对不对
 *
 * 世界书条目名是有层级的：
 *   [兽族联盟][风信子城][皇城区]枢机厅
 * 以前全平铺成一屏平级条目，看不出谁属于谁。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = { console };
win.window = win;
new Function('window', fs.readFileSync(path.join(ROOT, 'modules/worldbook.js'), 'utf8'))(win);
const B = win.__fiefBook;

let pass = 0;
let fail = 0;
const ok = (n, c, e) => {
  if (c) pass += 1;
  else { fail += 1; console.log('  [!!] ' + n + (e ? '  -> ' + e : '')); }
};

const CARD = process.env.FIEF_CARD || path.resolve(ROOT, '..', '命定之诗与黄昏之歌v4.31.json');
if (!fs.existsSync(CARD)) { console.log('跳过：没有卡片文件'); process.exit(0); }

const card = JSON.parse(fs.readFileSync(CARD, 'utf8'));
const raw = (card.data.character_book.entries) || [];
const entries = raw.map((e) => ({
  uid: e.id, name: e.comment, content: e.content,
  strategy: { type: e.constant ? 'constant' : 'selective', keys: e.key || e.keys || [] },
}));
const tree = B.buildFactionTree(B.normalize(entries));

console.log('=== 1. 层级解析 ===');
let total = 0;
let withParent = 0;
let selfRef = 0;
let orphan = 0;
for (const k of Object.keys(tree)) {
  const names = {};
  for (const p of tree[k].places) names[p.name] = true;
  for (const p of tree[k].places) {
    total += 1;
    if (p.parent) withParent += 1;
    if (p.parent === p.name) selfRef += 1;
    // 父级必须真在列表里，否则界面上会挂空
    if (p.parent && !names[p.parent]) orphan += 1;
  }
}
console.log('  地点 ' + total + ' / 有上级 ' + withParent + ' / 自指 ' + selfRef + ' / 孤儿 ' + orphan);
ok('没有自指', selfRef === 0, String(selfRef));
// 孤儿 = 父级被归成了「总述」不在地点列表里（如 潮汐王座、赛瑞利亚 没有规模档）。
// 这不算错，界面上会把它当顶层显示。只要求别太多。
ok('孤儿很少（父级被归总述的那几个）', orphan <= 8, String(orphan));
ok('总量还是 190 上下', total >= 180 && total <= 200, String(total));
ok('确实有层级关系', withParent > 30, String(withParent));

console.log('\n=== 2. 具体关系对不对 ===');
const find = (f, n) => {
  const ps = (tree[f] && tree[f].places) || [];
  return ps.find((p) => p.name === n);
};
const CASES = [
  ['兽族联盟', '枢机厅', '皇城区'],
  ['兽族联盟', '皇城区', '风信子城'],
  ['兽族联盟', '主城区', '风信子城'],
  ['兽族联盟', '金穗宫', '皇城区'],
  ['兽族联盟', '风信子城', ''],
];
for (const [f, n, want] of CASES) {
  const p = find(f, n);
  ok(f + ' · ' + n + ' 的上级是「' + (want || '顶层') + '」',
    p && (p.parent || '') === want, p ? '得到「' + (p.parent || '') + '」' : '条目不存在');
}

console.log('\n=== 3. 风信子城整棵树 ===');
const ms = (tree['兽族联盟'] && tree['兽族联盟'].places) || [];
const kids = {};
for (const p of ms) {
  if (p.parent) { (kids[p.parent] = kids[p.parent] || []).push(p.name); }
}
const show = (n, d) => {
  console.log('  ' + '  '.repeat(d) + (d ? '└ ' : '') + n);
  for (const c of kids[n] || []) show(c, d + 1);
};
show('风信子城', 0);

const deep = ['枢机厅', '金穗宫', '皇城区', '主城区', '外城区'].filter((n) => find('兽族联盟', n));
ok('风信子城的面都还在', deep.length === 5, deep.join(','));

console.log('\n=== 4. 顶层数量合理（不该一屏几十个平级） ===');
const counts = {};
for (const k of Object.keys(tree)) {
  const ps = tree[k].places;
  counts[k] = ps.filter((p) => !p.parent).length + '/' + ps.length;
  console.log('  ' + k.padEnd(22, ' ') + counts[k] + ' 顶层/总数');
}
ok('诺斯加德联盟有层级', (tree['诺斯加德联盟'].places.filter((p) => p.parent).length) > 0);

console.log('\n=== 5. 没有成环 ===');
{
  let cyclic = 0;
  for (const k of Object.keys(tree)) {
    const byName = {};
    for (const p of tree[k].places) byName[p.name] = p;
    for (const p of tree[k].places) {
      let cur = p;
      let guard = 0;
      while (cur && cur.parent && byName[cur.parent] && guard < 20) {
        cur = byName[cur.parent];
        guard += 1;
        if (cur === p) { cyclic += 1; break; }
      }
    }
  }
  ok('没有环', cyclic === 0, String(cyclic));
}

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
