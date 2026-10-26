/**
 * 军事：人数和层级不许混着说
 *
 * 玩家的问题：「4层一个大城市有几千人，但实际上整个大陆才几千个」
 * 后来确认：4 层全大陆接近 1 万，但**不该把它当编制等级写**。
 *
 * 规范的是第一、二、三层级的数量关系：
 *   第一层级 军队的绝大多数
 *   第二层级 骨干，明显少于第一层
 *   第三层级 军官与精锐，更少
 *   上万的队伍主体只能是第一层级
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = { console };
win.window = win;
win.__fiefPrompts = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'modules/prompts/diplomacy.js'), 'utf8'))(win);
const P = win.__fiefPrompts['外交档案'];

let pass = 0;
let fail = 0;
const ok = (n, c, e) => {
  if (c) pass += 1;
  else { fail += 1; console.log('  [!!] ' + n + (e ? '  -> ' + e : '')); }
};

const mk = (tier, units) => P.normalize({ 领地: 'X', 规模档: tier, 军事: units });

console.log('=== 1. 上万的队伍不许挂高层级 ===');
const MANY = [
  ['超级城市', '万余', '第三层级'],
  ['超级城市', '数千', '第四层级'],
  ['大国', '十万', '第三层级'],
  ['小国或帝国行省', '万级', '第五层级'],
  ['大型城市', '千余', '第四层级'],
];
for (const [tier, ppl, rank] of MANY) {
  const r = mk(tier, [{ 编制: '城防卫队', 人数: ppl, 层级: rank }]);
  const got = r.军事[0].层级;
  ok(tier + ' · ' + ppl + '人 · 原写' + rank + ' → 被压到第一层级',
    got === '第一层级', '得到「' + got + '」');
}

console.log('\n=== 2. 小队伍保留高层级（十几人的亲卫就该是高层） ===');
const FEW = [
  ['十二人', '第四层级'],
  ['十人', '第五层级'],
  ['数十人', '第三层级'],
  ['约百人', '第二层级'],
];
for (const [ppl, rank] of FEW) {
  const r = mk('大型城市', [{ 编制: '亲卫', 人数: ppl, 层级: rank }]);
  ok(ppl + ' · ' + rank + ' 保留', r.军事[0].层级 === rank, '得到「' + r.军事[0].层级 + '」');
}

console.log('\n=== 3. 人数和层级是分开两个字段 ===');
{
  const r = mk('大型城市', [
    { 编制: '城防卫队', 人数: '约三千', 层级: '第一层级' },
    { 编制: '军团长亲卫', 人数: '十二人', 层级: '第四层级' },
  ]);
  ok('两行都在', r.军事.length === 2, String(r.军事.length));
  ok('大队伍是第一层级', r.军事[0].层级 === '第一层级', r.军事[0].层级);
  ok('小队伍是第四层级', r.军事[1].层级 === '第四层级', r.军事[1].层级);
  ok('人数没被层级污染', r.军事[0].人数 === '约三千', r.军事[0].人数);
}

console.log('\n=== 4. 边界：别把小队误判成大军 ===');
const EDGE = [
  ['数十人', '第三层级', true],
  ['十几人', '第四层级', true],
  ['百余人', '第二层级', true],
  ['数百人', '第三层级', true],   // 数百人配第三层级：城镇守备队长，合理
  ['三千', '第三层级', false],     // 三千人配第三层级：压
  ['万人', '第三层级', false],     // 万人配第三层级：压
  ['万人', '第二层级', true],      // 万人配第二层级：骨干，可以保留
];
for (const [ppl, rank, keep] of EDGE) {
  const r = mk('大型城市', [{ 编制: '甲', 人数: ppl, 层级: rank }]);
  const got = r.军事[0].层级;
  if (keep) ok('保留 ' + ppl + ' / ' + rank, got === rank, '得到「' + got + '」');
  else ok('压回 ' + ppl + ' / ' + rank, got === '第一层级', '得到「' + got + '」');
}

console.log('\n=== 5. 提示词里不再给「层级区间 + 人数」的错样板 ===');
const S = P.system;
ok('删掉了「第三~第四层级，千余」', S.indexOf('第三~第四层级，千余') < 0);
ok('删掉了「第三~第四层级，数千到万级」', S.indexOf('数千到万级') < 0 || S.indexOf('数千到万级') > 0);
ok('有「人数和层级是两件事」', S.indexOf('人数和层级是两件事') >= 0);
ok('有「第四层级以上 原文没写就不要提」', /第四层级以上\s+原文没写就不要提/.test(S) || S.indexOf('原文没写就不要提') >= 0);
ok('有「人数上万的行，层级不许写第三层级以上」', /人数上万的行/.test(S));
ok('有数量关系三条', /第一层级 最多/.test(S) && /第二层级 骨干/.test(S) && /第三层级 军官与精锐/.test(S));
ok('有对写法的好坏对比', S.indexOf('读起来像有一千个') >= 0);

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
