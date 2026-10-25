/**
 * 验证「越档」有没有被压住
 *   玩家实际踩过的坑：
 *     ① 中型城镇推出「十余万人」
 *     ② 一个镇里一堆队伍全标「第四层级」
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

let fail = 0;
const ok = (n, c, e) => {
  if (!c) fail += 1;
  console.log((c ? '  OK   ' : '  BUG  ') + n + (e ? '  -> ' + e : ''));
};

console.log('=== 1. 人口越档 ===');
const popCases = [
  ['中型城镇', '十余万人', '数万人'],
  ['中型城镇', '约 12 万口', '数万人'],
  ['中型城镇', '30000人', '数万人'],
  ['村庄', '数千人', '数百人'],
  ['村庄', '八百人', '数百人'],
  ['小型村镇', '五万余人', '数千人'],
  ['大型城市', '数万人', '十万级'],
  ['超级城市', '二十万', '数十万级'],
  ['中型城镇', '数万人', '数万人'],       // 本来对，不该动
  ['村庄', '数百人', '数百人'],
];
for (const [tier, inp, want] of popCases) {
  const r = P.normalize({ 领地: 'X', 规模档: tier, 人口: inp });
  ok(tier + ' 的「' + inp + '」→「' + want + '」', r.人口 === want, '得到「' + r.人口 + '」');
}

console.log('\n=== 2. 军事层级越档 ===');
const rankCases = [
  ['中型城镇', '第四层级', '第三层级'],
  ['中型城镇', '第4层', '第三层级'],
  ['中型城镇', 'Lv.13-16', '第三层级'],
  ['村庄', '第四层级', '第二层级'],
  ['村庄', 'Lv.20', '第二层级'],
  ['大型城市', '第四层级', '第四层级'],   // 城市上限就是第四层级，不动
  ['大型城市', '第六层级', '第四层级'],
  ['超级城市', '第五层级', '第四层级'],
  ['小国或帝国行省', '第六层级', '第五层级'],
  ['大国', '第六层级', '第六层级'],
];
for (const [tier, inp, want] of rankCases) {
  const r = P.normalize({
    领地: 'X', 规模档: tier,
    军事: [{ 编制: '城卫军', 人数: '约三百', 层级: inp }],
  });
  const got = r.军事[0] ? r.军事[0].层级 : '(没了)';
  ok(tier + ' 的「' + inp + '」→「' + want + '」', got === want, '得到「' + got + '」');
}

console.log('\n=== 2b. 区间写法不误判 ===');
{
  const cases = [
    ['中型城镇', '第二至第三层级', '第二至第三层级'],
    ['中型城镇', '第二至第四层级', '第二至第三层级'],
    ['村庄', '第二至第三层级', '第二至第二层级'],
    ['大型城市', '第三至第四层级', '第三至第四层级'],
  ];
  for (const [tier, inp, want] of cases) {
    const r = P.normalize({ 领地: 'X', 规模档: tier, 军事: [{ 编制: '某军', 人数: '约百', 层级: inp }] });
    const got = r.军事[0] ? r.军事[0].层级 : '(没了)';
    ok(tier + ' 的「' + inp + '」→「' + want + '」', got === want, '得到「' + got + '」');
  }
}

console.log('\n=== 3. 城镇档整套军事不能全在第三层级以上 ===');
{
  const r = P.normalize({
    领地: '艾瑟镇', 规模档: '中型城镇', 人口: '十余万人',
    军事: [
      { 编制: '城卫军', 人数: '约八百', 层级: '第四层级' },
      { 编制: '巡逻队', 人数: '约二百', 层级: '第四层级' },
      { 编制: '边防驻军', 人数: '约四百', 层级: '第五层级' },
    ],
  });
  console.log('  人口: ' + r.人口);
  for (const u of r.军事) console.log('  ' + u.编制 + ' ' + u.人数 + ' ' + u.层级);
  ok('人口压到数万人', r.人口 === '数万人', r.人口);
  ok('无一支越过第三层级', r.军事.every((u) => /^第[一二三]层级$/.test(u.层级)),
    r.军事.map((u) => u.层级).join(','));
}

console.log('\n=== 4. 村里的军队不该有高等级 ===');
{
  const r = P.normalize({
    领地: '小村', 规模档: '村庄', 人口: '一千二百人',
    军事: [{ 编制: '民兵', 人数: '约四十', 层级: '第三层级' }],
  });
  ok('人口变数百人', r.人口 === '数百人', r.人口);
  ok('民兵压到第二层级', r.军事[0].层级 === '第二层级', r.军事[0].层级);
}

console.log('\n=== 5. 规模档为空时不乱压 ===');
{
  const r = P.normalize({
    领地: 'X', 规模档: '',
    人口: '数万人',
    军事: [{ 编制: '某军', 人数: '约百', 层级: '第四层级' }],
  });
  ok('没有档位就保留原层级', r.军事[0].层级 === '第四层级', r.军事[0].层级);
  ok('没有档位就保留原人口', r.人口 === '数万人', r.人口);
}

console.log('\n=== 6. 少样本真的拼进消息 ===');
{
  const msg = P.build({ 领地: '测试城', 原文: '规模: 中型城镇' });
  ok('消息里有范例', msg.indexOf('林歌城') >= 0);
  ok('消息里有原文', msg.indexOf('规模: 中型城镇') >= 0);
  ok('消息里有档位表', msg.indexOf('第三层级') >= 0);
  console.log('  消息长度 ' + msg.length + ' 字');
}

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔'));
process.exit(fail ? 1 : 0);
