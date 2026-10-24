/**
 * 世界书模块测试：用真实的命定世界书跑解析
 */
import fs from 'node:fs';

let pass = 0, fail = 0;
const ok = (n, v, e) => { if (v) { pass++; console.log('  OK   ' + n); } else { fail++; console.log('  FAIL ' + n + (e ? ' -> ' + e : '')); } };

const win = { console };
win.window = win;

const code = fs.readFileSync(new URL('../modules/worldbook.js', import.meta.url), 'utf8');
new Function('window', 'console', code)(win, console);

ok('模块安装到 window.__fiefBook', !!win.__fiefBook);

/* 把真实世界书塞进去 */
const card = JSON.parse(fs.readFileSync('D:\\223\\命定之诗与黄昏之歌v4.31.json', 'utf8'));
const entries = win.__fiefBook.normalize(card.data.character_book);
console.log('  归一化条目 ' + entries.length + ' 条（空白条目已剔除）');
ok('条目数 >= 580', entries.length >= 580, String(entries.length));

/* 拆标签 */
const sp = win.__fiefBook.splitFactionTag('[本体][势力][诺斯加德联盟][城镇][林歌城]林歌城');
ok('拆出势力名', sp && sp.faction === '诺斯加德联盟', sp && sp.faction);
ok('拆出子标签', sp && sp.tags.join('/') === '城镇/林歌城', sp && sp.tags.join('/'));
ok('拆出名字', sp && sp.name === '林歌城', sp && sp.name);

const sp2 = win.__fiefBook.splitFactionTag('[本体][势力][奥古斯提姆帝国]翠庭城(快乐柠萌茶)');
ok('无标签也能拆', sp2 && sp2.faction === '奥古斯提姆帝国', sp2 && sp2.faction);
ok('剥掉作者签名', sp2 && sp2.name === '翠庭城', sp2 && sp2.name);

const sp3 = win.__fiefBook.splitFactionTag('[本体][势力][兽族联盟][鼠族王国][风信子城][主城区]主城区');
ok('多层嵌套能拆', sp3 && sp3.faction === '兽族联盟', sp3 && sp3.faction);
ok('多层嵌套名字对', sp3 && sp3.name === '主城区', sp3 && sp3.name);

/* 规模识别 */
ok('认出 规模: 大型城市', win.__fiefBook.placeScale('位置: X\n规模: 大型城市\n人口构成: 人类') === '大型城市');
ok('认出 规模: 村庄', win.__fiefBook.placeScale('规模: 村庄') === '村庄');
ok('总述没有规模', win.__fiefBook.placeScale('定位: 统治大陆东部平原\n疆域: 广阔') === '');

/* 建势力树 */
const tree = win.__fiefBook.buildFactionTree(entries);
const names = Object.keys(tree);
ok('建出 10 个势力', names.length === 10, String(names.length));

let total = 0;
console.log('');
console.log('=== 势力树 ===');
names.sort((a, b) => tree[b].places.length - tree[a].places.length).forEach((f) => {
  const t = tree[f];
  total += t.places.length;
  console.log('  ' + f.padEnd(12) + ' 地点 ' + String(t.places.length).padStart(3) + '   总述 ' + t.overview.length);
});
console.log('  地点合计 ' + total);

ok('地点总数 > 150', total > 150, String(total));
ok('诺斯加德地点 > 40', tree['诺斯加德联盟'].places.length > 40, String(tree['诺斯加德联盟'] && tree['诺斯加德联盟'].places.length));

/* 误判检查 */
const bad = [];
names.forEach((f) => tree[f].places.forEach((p) => {
  if (/政治与社会|地理与治理|地理概览|分割线|派系|节庆|贵族|派阀/.test(p.name)) bad.push(f + '|' + p.name);
  if (p.name === f) bad.push(f + '|(总述混入)');
}));
ok('无误判', bad.length === 0, bad.slice(0, 4).join(', '));

/* 三家的地点确实找到了 */
ok('瓦伦蒂亚有地点（原本被漏）', tree['瓦伦蒂亚'].places.length > 10, String(tree['瓦伦蒂亚'].places.length));
ok('萨赫拉有地点（原本被漏）', tree['萨赫拉联邦'].places.length >= 5, String(tree['萨赫拉联邦'].places.length));
ok('奥古斯提姆有地点（原本被漏）', tree['奥古斯提姆帝国'].places.length > 15, String(tree['奥古斯提姆帝国'].places.length));

console.log('');
console.log('=== 抽样：奥古斯提姆帝国（规模识别）===');
tree['奥古斯提姆帝国'].places.slice(0, 12).forEach((p) => {
  console.log('  ' + String(p.len).padStart(4) + ' 字  ' + p.name.padEnd(14) + ' | ' + (p.scale || '未记'));
});

console.log('');
console.log('=== 抽样：瓦伦蒂亚 ===');
tree['瓦伦蒂亚'].places.slice(0, 10).forEach((p) => {
  console.log('  ' + String(p.len).padStart(4) + ' 字  ' + p.name.padEnd(16) + ' | ' + (p.scale || '未记'));
});

console.log('');
console.log('=== 抽样：萨赫拉联邦 ===');
tree['萨赫拉联邦'].places.forEach((p) => {
  console.log('  ' + String(p.len).padStart(4) + ' 字  ' + p.name.padEnd(12) + ' | ' + (p.scale || '未记'));
});

console.log('');
console.log('=== 抽样：诺斯加德联盟前 10 ===');
tree['诺斯加德联盟'].places.slice(0, 10).forEach((p) => {
  console.log('  ' + String(p.len).padStart(4) + ' 字  ' + p.name.padEnd(14) + ' | ' + (p.scale || '未记'));
});

console.log('\n' + (fail ? fail + ' 项失败 / ' + (fail + pass) : '全部通过 ✔  ' + pass + ' 项'));
process.exit(fail ? 1 : 0);
