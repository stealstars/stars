/**
 * 属性（等级 / 五维）：等级 → 层级 / 乘数，以及上限按公式重算。
 *
 * 公式抄自卡片「[本体][额外设定]角色生成」：
 *   HP = 体质×100×HP乘数 + 五维总和
 *   MP = (智+精)×50×MP/SP乘数
 *   SP = (力+敏)×50×MP/SP乘数
 * 乘数抄自「[本体][额外设定]核心数值表」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = fs.readFileSync(path.join(ROOT, 'modules/core.js'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (n, c, e) => {
  if (c) pass += 1;
  else { fail += 1; console.log('  [!!] ' + n + (e !== undefined ? '  -> ' + e : '')); }
};

/* ---- 把这段纯函数切出来 ---- */
const START = CORE.indexOf('  const LEVEL_TIERS = [');
const END = CORE.indexOf('  /** 当前角色的等级 / 五维 / 上限');
if (START < 0 || END < 0 || END <= START) {
  console.log('[!!] 切不出 LEVEL_TIERS..capsOf 这一段');
  process.exit(1);
}
const P = new Function(
  CORE.slice(START, END)
  + '\n; return { tierOfLevel, capsOf, clampLevel, FIVE_ATTR };',
)();

console.log('=== 1. 等级 → 层级（照核心数值表）===');
{
  const cases = [
    [1, '第一层级/普通'], [4, '第一层级/普通'],
    [5, '第二层级/优良'], [8, '第二层级/优良'],
    [9, '第三层级/稀有'], [12, '第三层级/稀有'],
    [13, '第四层级/史诗'], [16, '第四层级/史诗'],
    [17, '第五层级/传说'], [20, '第五层级/传说'],
    [21, '第六层级/神话'], [24, '第六层级/神话'],
    [25, '第七层级/半神'],
  ];
  for (const [lv, want] of cases) {
    const got = P.tierOfLevel(lv).name;
    ok(lv + ' 级 → ' + want, got === want, got);
  }
}

console.log('\n=== 2. 越界钳制 ===');
{
  ok('0 级钳到 1', P.clampLevel(0) === 1, P.clampLevel(0));
  ok('30 级钳到 25', P.clampLevel(30) === 25, P.clampLevel(30));
  ok('负数钳到 1', P.clampLevel(-5) === 1, P.clampLevel(-5));
  ok('小数四舍五入', P.clampLevel(7.6) === 8, P.clampLevel(7.6));
  ok('非数字给 1', P.clampLevel('abc') === 1, P.clampLevel('abc'));
}

console.log('\n=== 3. 上限公式 ===');
{
  const attr = { 力量: 10, 敏捷: 10, 体质: 20, 智力: 15, 精神: 15 };
  /* 20 级 = 五层：HP 乘数 20，MP/SP 乘数 35 */
  const c = P.capsOf(attr, 20);
  ok('HP = 20×100×20 + 70 = 40070', c.hp === 40070, c.hp);
  ok('MP = (15+15)×50×35 = 52500', c.mp === 52500, c.mp);
  ok('SP = (10+10)×50×35 = 35000', c.sp === 35000, c.sp);

  /* 1 级 = 一层：乘数都是 1 */
  const c1 = P.capsOf({ 力量: 1, 敏捷: 2, 体质: 3, 智力: 4, 精神: 5 }, 1);
  ok('一层 HP = 3×100×1 + 15 = 315', c1.hp === 315, c1.hp);
  ok('一层 MP = (4+5)×50×1 = 450', c1.mp === 450, c1.mp);
  ok('一层 SP = (1+2)×50×1 = 150', c1.sp === 150, c1.sp);

  /* 25 级 = 七层：HP 100，MP/SP 160 */
  const c7 = P.capsOf({ 力量: 100, 敏捷: 100, 体质: 100, 智力: 100, 精神: 100 }, 25);
  ok('七层 HP = 100×100×100 + 500 = 1000500', c7.hp === 1000500, c7.hp);
  ok('七层 MP = 200×50×160 = 1600000', c7.mp === 1600000, c7.mp);

  ok('空属性不炸', P.capsOf(null, 5).hp === 0, P.capsOf(null, 5).hp);
}

console.log('\n=== 4. 五维清单 ===');
{
  ok('正好五项', P.FIVE_ATTR.length === 5, P.FIVE_ATTR.length);
  ok('是力敏体智精', P.FIVE_ATTR.join('') === '力量敏捷体质智力精神', P.FIVE_ATTR.join(''));
}

console.log('\n=== 5. 源码接线 ===');
{
  ok('有写入函数', /function writeHeroStat\(idx, patch\)/.test(CORE));
  ok('优先用酒馆助手接口', /th\.insertOrAssignVariables\(\{ stat_data: patch \}/.test(CORE));
  ok('有回退写消息变量', /merge\(bag\.stat_data, patch\)/.test(CORE));
  ok('回退会保存聊天', /S\.saveChat\(\)/.test(CORE));
  ok('入口是「关于」里的灰字', /id="fl-dev-link"/.test(CORE));
  ok('面板容器在', /id="fl-dev-body"/.test(CORE));
  ok('点开才渲染', /if \(!devOpen\) \{ box\.innerHTML = ''; return; \}/.test(CORE));
  ok('写入后重扫', /if \(ok\) \{ rescan\(true, '属性'\); renderDev\(box\); \}/.test(CORE));
}

console.log('\n' + (fail ? fail + ' 项失败  ' : '全部通过 ✔  ') + (pass + fail) + ' 项');
process.exit(fail ? 1 : 0);
