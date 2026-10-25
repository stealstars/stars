/**
 * 查：外交页的邻邦到底哪一步断了
 *   链路：领地变量 → dipRows() → setNeighbours() → neighbours() → renderNeighbours()
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'modules/core.js'), 'utf8');

// 把内部函数抠出来单独测
const grab = (name) => {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0, st = src.indexOf('{', i);
  for (let j = st; j < src.length; j += 1) {
    if (src[j] === '{') d += 1;
    else if (src[j] === '}') { d -= 1; if (!d) return src.slice(i, j + 1); }
  }
  return '';
};

const toneSrc = (() => {
  const i = src.indexOf('const DIP_TONE = [');
  const j = src.indexOf('];', i);
  return i < 0 ? '' : src.slice(i, j + 2);
})();

const pieces = ['looseNeighbours', 'dipRows', 'dipTone', 'dipLabel'].map(grab);
console.log('抓到函数: ' + pieces.filter(Boolean).length + '/4');
if (pieces.some((p) => !p)) { console.log('有函数没抓到，退出'); process.exit(1); }

const sandbox = new Function('esc', toneSrc + '\n' + pieces.join('\n\n')
  + '\nreturn { looseNeighbours, dipRows, dipTone, dipLabel };')(
  (s) => String(s == null ? '' : s),
);
const { looseNeighbours, dipRows } = sandbox;

console.log('\n=== 1. looseNeighbours 认得几种写法 ===');
const cases = [
  '[邻邦|灰岩镇|观望]',
  '[邻邦: 黑骆驼商会]',
  '邻邦：萨赫拉联邦（戒备）',
  '【邻邦】断角猎团',
  '[邻接|红丘省|友好]',
  '邻邦: 甲镇（友好）、乙城（敌对）',
  '邻邦国：诺德海姆公国',
  '周边势力：精灵王庭',
  '没有任何邻邦的普通文本',
];
for (const t of cases) {
  const r = looseNeighbours(t);
  const flag = r.length ? '✔' : '✘';
  console.log('  ' + flag + ' ' + JSON.stringify(t) + '  →  ' + JSON.stringify(r));
}

console.log('\n=== 2. 模拟一份真实领地（变量来源） ===');
const d = {
  name: '先遣石滩哨垒',
  desc: '初创开拓。治理: 治安60｜民心50｜物资充足｜人口数百人',
  meta: { desc: '[邻邦|灰岩镇|观望]\n[邻邦|黑骆驼商会|敌对]' },
  info: {},
  items: [],
};
const rows = dipRows(d);
console.log('  dipRows 返回 ' + rows.length + ' 条');
for (const r of rows) console.log('    ' + JSON.stringify(r));

console.log('\n=== 3. 只写在 name/desc 里 ===');
const d2 = {
  name: '先遣石滩哨垒',
  desc: '邻邦：灰岩镇（观望）、黑骆驼商会（敌对）',
  meta: {}, info: {}, items: [],
};
const rows2 = dipRows(d2);
console.log('  dipRows 返回 ' + rows2.length + ' 条');
for (const r of rows2) console.log('    ' + JSON.stringify(r));

console.log('\n=== 4. 有 info.邻邦（消息区块来源） ===');
const d3 = {
  name: '先遣石滩哨垒', desc: '', meta: {},
  info: { 邻邦: ['灰岩镇·观望', '黑骆驼商会·敌对'] },
  items: [],
};
const rows3 = dipRows(d3);
console.log('  dipRows 返回 ' + rows3.length + ' 条');
for (const r of rows3) console.log('    ' + JSON.stringify(r));

console.log('\n=== 5. 玩家那份真实描述能不能认出来 ===');
const real = [
  '人口安置: 成功解救风栖羽民部族继承人艾尔菲娅·苍羽',
  '外交与扩张: 待纳姆·碎角归部联络落锤盆地 340 余名断角族人举族迁入；',
  '持有黑骆驼走私契账，具备向帝国行省政厅及萨赫拉商会交涉之核心筹码',
].join('\n');
console.log('  原文: ' + real.slice(0, 60) + '...');
console.log('  looseNeighbours → ' + JSON.stringify(looseNeighbours(real)));
console.log('  ↑ 没有 [邻邦|...] 标记就认不出来，这是预期行为');
