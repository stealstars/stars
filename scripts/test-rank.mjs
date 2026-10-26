/**
 * 生命层级：数字和规则都要对得上命定卡
 *
 * 玩家报的问题：「一个城市生命层级的数量不对」。
 *
 * 真实设定（命定卡《生命层级与社会阶级》）：
 *   第一层级 普通 Lv.1-4    第二层级 中坚 Lv.5-8    第三层级 精英 Lv.9-12
 *   第四层级 史诗 Lv.13-16  第五层级 传说 Lv.17-20  第六层级 神话 Lv.21-24
 *   第七层级 神祗 Lv.25
 * 共**七层**，不是六层。
 *
 * 而且层级衡量的是**个体**，与领地规模无关。锚定值是「至少要有一个」，
 * 不是「最多只能有」。以前拿它当天花板压，把对的改错了。
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

console.log('=== 1. 层级写法归一 ===');
const NORM = [
  ['第四层级', '第四层级'],
  ['第4层', '第四层级'],
  ['第四层', '第四层级'],
  ['Lv.13-16', '第四层级'],
  ['Lv.5', '第二层级'],
  ['Lv.1', '第一层级'],
  ['Lv.25', '第七层级'],
  ['第二至第三层级', '第二层级至第三层级'],
  ['第二至第四层级', '第二层级至第四层级'],
  ['', ''],
];
for (const [inp, want] of NORM) {
  const r = P.normalize({
    领地: 'X', 规模档: '中型城镇',
    军事: [{ 编制: '守备队', 人数: '约百', 层级: inp }],
  });
  const got = r.军事[0] ? r.军事[0].层级 : '';
  ok('「' + inp + '」→「' + want + '」', got === want, '得到「' + got + '」');
}

console.log('\n=== 2. 不许压低原文里合理的层级 ===');
const KEEP = [
  ['中型城镇', '第四层级'],   // 城里有个史诗强者，正常
  ['中型城镇', '第五层级'],   // 枢机厅原文就是第五层级
  ['村庄', '第四层级'],       // 村里住着退隐强者
  ['村庄', '第六层级'],
  ['小型村镇', '第五层级'],
  ['超级城市', '第六层级'],
];
for (const [tier, inp] of KEEP) {
  const r = P.normalize({
    领地: 'X', 规模档: tier,
    军事: [{ 编制: '甲', 人数: '约百', 层级: inp }],
  });
  ok(tier + ' 的「' + inp + '」不被压', r.军事[0].层级 === inp, '被改成了「' + r.军事[0].层级 + '」');
}

console.log('\n=== 3. 超出七层的夹回来 ===');
const OVER = [
  ['第九层级', '第七层级'],
  ['第八层级', '第七层级'],
  ['第12层', '第七层级'],
];
for (const [inp, want] of OVER) {
  const r = P.normalize({
    领地: 'X', 规模档: '大国',
    军事: [{ 编制: '甲', 人数: '约百', 层级: inp }],
  });
  ok('「' + inp + '」→「' + want + '」', r.军事[0].层级 === want, '得到「' + r.军事[0].层级 + '」');
}

console.log('\n=== 4. 提示词里有完整的七层定义 ===');
const S = P.system;
ok('写了第一层级', S.indexOf('第一层级') >= 0);
ok('写了第七层级', S.indexOf('第七层级') >= 0, '以前只有六层');
ok('写了 Lv.25', S.indexOf('Lv.25') >= 0);
ok('说了七层', /共七层|共七/.test(S), '');
ok('说明层级衡量个体', S.indexOf('衡量**个体**') >= 0 || S.indexOf('个体') >= 0);
ok('说明与领地规模无关', S.indexOf('与领地规模无关') >= 0);
ok('说明锚定是下限', S.indexOf('这是**下限**，不是上限') >= 0 || S.indexOf('下限') >= 0);
ok('有地位锚定四条', /帝国\/大国\s+需\s+第六层级/.test(S) && /基层村庄\s+需\s+第二层级/.test(S));
ok('明确不许改原文层级', S.indexOf('原文写了更高的层级就是更高的') >= 0
  || S.indexOf('不要因为领地小就压低层级') >= 0);

console.log('\n=== 5. 反例不该再说「越档」 ===');
ok('没有「不得高于该档」的旧说法', S.indexOf('不得高于') < 0, '旧规则是错的');
ok('没有把锚定当上限', S.indexOf('领主实力下限') < 0 || S.indexOf('下限**，不是上限') >= 0);

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
