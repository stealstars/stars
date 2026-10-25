/**
 * 邻邦：写法与界面
 *
 * 这是玩家报过的 bug：「外交页完全没有邻邦」。
 * 根因是 looseNeighbours 只认 [邻邦|名] 一种写法，
 * 实际会遇到 [邻邦: 名]、邻邦：名、【邻邦】名 等等。
 *
 * 外交页还有个坑：邻邦那块是 `if (nb) out += nb`，
 * 没数据就整块消失，玩家连「这里本来有邻邦」都看不到。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'modules/core.js'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (n, c, e) => {
  if (c) pass += 1;
  else { fail += 1; console.log('  [!!] ' + n + (e ? '  -> ' + e : '')); }
  return c;
};

/** 从源码里抠函数原文 */
const grab = (name) => {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let d = 0;
  const st = SRC.indexOf('{', i);
  for (let j = st; j < SRC.length; j += 1) {
    if (SRC[j] === '{') d += 1;
    else if (SRC[j] === '}') { d -= 1; if (!d) return SRC.slice(i, j + 1); }
  }
  return '';
};

const toneSrc = (() => {
  const i = SRC.indexOf('const DIP_TONE = [');
  const j = SRC.indexOf('];', i);
  return i < 0 ? '' : SRC.slice(i, j + 2);
})();

const body = [grab('looseNeighbours'), grab('dipRows'), grab('dipTone'), grab('dipLabel')].join('\n\n');
const box = new Function('esc', toneSrc + '\n' + body
  + '\nreturn { looseNeighbours, dipRows };')((s) => String(s == null ? '' : s));
const { looseNeighbours, dipRows } = box;

console.log('=== 1. 各种写法都要认 ===');
const FMT = [
  ['[邻邦|灰岩镇|观望]', '灰岩镇', '观望'],
  ['[邻邦|灰岩镇]', '灰岩镇', ''],
  ['[邻邦: 黑骆驼商会]', '黑骆驼商会', ''],
  ['[邻邦：黑骆驼商会]', '黑骆驼商会', ''],
  ['邻邦：萨赫拉联邦（戒备）', '萨赫拉联邦', '戒备'],
  ['邻邦: 萨赫拉联邦', '萨赫拉联邦', ''],
  ['【邻邦】断角猎团', '断角猎团', ''],
  ['【邻邦：断角猎团】', '断角猎团', ''],
  ['[邻接|红丘省|友好]', '红丘省', '友好'],
  ['[接壤|诺德海姆公国]', '诺德海姆公国', ''],
  ['周边势力：精灵王庭', '精灵王庭', ''],
  ['邻近势力: 兽族联盟', '兽族联盟', ''],
];
for (const [text, wantName, wantTone] of FMT) {
  const got = looseNeighbours(text);
  const hit = got.find((x) => x.split('|')[0] === wantName);
  ok('认得 ' + JSON.stringify(text), !!hit, JSON.stringify(got));
  if (hit) {
    const tone = hit.split('|')[1] || '';
    ok('  态度对得上 ' + JSON.stringify(text), tone === wantTone, '得到「' + tone + '」');
  }
  console.log('  ' + (hit ? '✔' : '✘') + ' ' + text);
}

console.log('\n=== 2. 一行并列多个 ===');
{
  const got = looseNeighbours('邻邦：甲镇（友好）、乙城（敌对）、丙村');
  ok('三个都认出来', got.length === 3, JSON.stringify(got));
  ok('甲镇态度友好', got.some((x) => x === '甲镇|友好'), JSON.stringify(got));
  ok('乙城态度敌对', got.some((x) => x === '乙城|敌对'), JSON.stringify(got));
  ok('丙村没有态度', got.some((x) => x === '丙村'), JSON.stringify(got));
  console.log('  ' + JSON.stringify(got));
}

console.log('\n=== 3. 不该误报 ===');
{
  const NOISE = [
    '这里没有任何邻居',
    '邻邦国：诺德海姆公国',      // 「邻邦国」是另一个词
    '人口安置: 解救艾尔菲娅·苍羽',
    '外交与扩张: 待纳姆·碎角归部',
    '',
  ];
  for (const t of NOISE) {
    const got = looseNeighbours(t);
    ok('不误报 ' + JSON.stringify(t), got.length === 0, JSON.stringify(got));
  }
}

console.log('\n=== 4. 去重 ===');
{
  const got = looseNeighbours('[邻邦|灰岩镇|观望]\n邻邦：灰岩镇（敌对）');
  ok('同一个势力只留一条', got.length === 1, JSON.stringify(got));
}

console.log('\n=== 5. dipRows 端到端 ===');
{
  const d = {
    name: '先遣石滩哨垒',
    desc: '治理: 治安60｜民心50',
    meta: { desc: '邻邦：灰岩镇（观望）、黑骆驼商会（敌对）' },
    info: {},
    items: [],
  };
  const rows = dipRows(d);
  ok('拿到两条', rows.length === 2, JSON.stringify(rows.map((x) => x.name)));
  ok('有名字', rows.every((x) => x.name), '');
  ok('有中文标签', rows.every((x) => x.label), JSON.stringify(rows.map((x) => x.label)));
  for (const r of rows) console.log('  ' + r.name + ' / ' + r.note + ' / ' + r.label);
}

console.log('\n=== 6. 界面不能因为没数据就整块消失 ===');
{
  const ui = fs.readFileSync(path.join(ROOT, 'modules/diplo.ui.js'), 'utf8');
  ok('有「还没有记邻邦」的提示', ui.indexOf('还没有记邻邦') >= 0);
  ok('有 neighbourAsked 标记', ui.indexOf('neighbourAsked') >= 0);
  ok('setNeighbours 会置这个标记', /setNeighbours[\s\S]{0,300}neighbourAsked\s*=\s*true/.test(ui));
  ok('空态样式存在',
    fs.readFileSync(path.join(ROOT, 'modules/diplo.css.js'), 'utf8').indexOf('.fl-dw-empty') >= 0);
}

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
