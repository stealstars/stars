/**
 * 成就素材：现在到底能推出几条？
 *
 * 结论用真实数据说话，不猜。
 *
 * 现有可用的：
 *   ① 建筑流水     add / change / remove，每个领地下每座建筑
 *   ② 领地现状     治安、民心、物资、人口、金库、军事、要事
 *   ③ 世界书旧事   势力总述里的历史段落
 * 现在没有的：
 *   ④ 领地层面数字的历史快照（治安从 40 涨到 70 这种）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'modules/core.js'), 'utf8');

console.log('=== 1. 现有流水能产出什么 ===');

// 建筑流水是唯一的「历史」来源
const hasAdd = src.indexOf("kind: 'add'") >= 0;
const hasChange = src.indexOf("kind: 'change'") >= 0;
const hasRemove = src.indexOf("kind: 'remove'") >= 0;
console.log('  建筑建档 add   ' + (hasAdd ? '✔' : '✘'));
console.log('  建筑变动 change ' + (hasChange ? '✔' : '✘'));
console.log('  建筑消失 remove ' + (hasRemove ? '✔' : '✘'));

console.log('\n=== 2. 流水记的是什么字段 ===');
const fp = (src.match(/function itemFp[\s\S]*?\n  \}/) || [''])[0];
const diff = (src.match(/function diffItem[\s\S]*?\n  \}/) || [''])[0];
const fpFields = [...fp.matchAll(/it\.(\w+)/g)].map((m) => m[1]);
console.log('  指纹字段: ' + fpFields.join(', '));
const diffText = [...diff.matchAll(/'([\u4e00-\u9fa5]+)\s/g)].map((m) => m[1]);
console.log('  变动条目类型: ' + [...new Set(diffText)].join(', '));

console.log('\n=== 3. 领地层面的数字有没有被追踪 ===');
const TRACK = {
  治安: /store[\s\S]{0,80}治安|治安[\s\S]{0,20}log/,
  民心: /store[\s\S]{0,80}民心|民心[\s\S]{0,20}log/,
  金库: /store[\s\S]{0,80}金库|金库[\s\S]{0,20}log/,
  人口: /store[\s\S]{0,80}人口|人口[\s\S]{0,20}log/,
  军事: /store[\s\S]{0,80}军事|军事[\s\S]{0,20}log/,
};
for (const k of Object.keys(TRACK)) {
  console.log('  ' + k + '  ' + (TRACK[k].test(src) ? '有' : '✘ 没有历史'));
}

console.log('\n=== 4. 按真实领地估一下能出几条 ===');
// 拿命定卡里的一个城镇条目当样本：看它有几个建筑
const CARD = path.resolve(ROOT, '..', '命定之诗与黄昏之歌v4.31.json');
if (!fs.existsSync(CARD)) { console.log('  跳过：没卡片文件'); process.exit(0); }

const win = { console };
win.window = win;
new Function('window', fs.readFileSync(path.join(ROOT, 'modules/worldbook.js'), 'utf8'))(win);
const B = win.__fiefBook;
const card = JSON.parse(fs.readFileSync(CARD, 'utf8'));
const raw = card.data.character_book.entries || [];
const norm = B.normalize(raw.map((e) => ({
  uid: e.id, name: e.comment, content: e.content,
  strategy: { type: e.constant ? 'constant' : 'selective', keys: e.key || e.keys || [] },
})));
const tree = B.buildFactionTree(norm);

// 数一条地点正文里能识别出的建筑
let sample = 0;
for (const k of Object.keys(tree)) {
  for (const p of tree[k].places) {
    const hits = (String(p.content || '').match(/(?:^|\n)\s{2,}[\u4e00-\u9fa5·\-]{2,12}\s*[:：]/g) || []).length;
    if (hits >= 3 && sample < 3) {
      sample += 1;
      console.log('  ' + p.name + '  可识别子项 ' + hits + ' 个  (' + p.len + ' 字)');
    }
  }
}
console.log('\n  一条地点通常 3-10 个子项 → 建档时就是 3-10 条 add 流水');
console.log('  玩家玩 20 轮，如果改建 5 次，就有 5 条 change');
console.log('  一个领地累积下来：约 10-30 条流水');
console.log('\n  10-30 条流水 → 合成 3-6 条成就，够一页。');
console.log('  但如果只建了档、没改建过 → 只有 add，写不出戏剧性。');
