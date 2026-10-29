/**
 * 规划页只显示已选定的
 *
 * 背景：<fief_build> 是菜单，不是已建。
 * 正则把它渲染成多选界面（22KB HTML，带「动工」按钮），
 * 玩家点动工后正则往输入框回填【动工】xx，
 * AI 再用 <UpdateVariable> 写成内部资产，状态: 建设中。
 *
 * 所以判据只有一个：内部资产里有没有这个同名项。
 * 菜单里列了但没选的，不该出现在规划页。
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
  else { fail += 1; console.log('  [!!] ' + n + (e ? '  -> ' + e : '')); }
};

function cut(name, endName) {
  const i = CORE.indexOf('function ' + name);
  if (i < 0) return '';
  const j = CORE.indexOf('function ' + endName, i);
  return j > i ? CORE.slice(i, j) : CORE.slice(i);
}

const SRC = cut('chosenPlans', 'plansHtml');
const PLAN = cut('plansHtml', 'renderDiplomacy');

console.log('=== 1. 函数都在 ===');
ok('chosenPlans 存在', !!SRC);
ok('plansHtml 存在', !!PLAN);
ok('plansHtml 收 d 参数', /function plansHtml\(d\)/.test(PLAN));
ok('调用处传了 d', /plansHtml\(d\)/.test(CORE));

console.log('\n=== 2. 判据是内部资产，不是菜单 ===');
{
  ok('按名字建索引', /byName\[it\.name\] = it/.test(SRC));
  ok('在 items 里查', /for \(const it of \(d && d\.items\)/.test(SRC));
  ok('查不到就跳过', /if \(!hit\) continue;/.test(SRC));
  ok('注释说明了为什么', /菜单.*不是已建/.test(CORE));
  ok('注释点名了动工流程', /动工/.test(CORE));
}

console.log('\n=== 3. 也要带上状态 ===');
{
  ok('取 status', /状态: hit\.status \|\| hit\.状态/.test(SRC));
  ok('保留原菜单字段', /Object\.assign\(\{\}, p,/.test(SRC));
  ok('带上实况', /实况: hit/.test(SRC));
}

console.log('\n=== 4. 空态文案要说清 ===');
{
  ok('没有「没有建设方案」', !/没有建设方案/.test(PLAN));
  ok('改成「还没有选定工程」', /还没有选定工程/.test(PLAN));
  ok('提示去聊天里选', /选中项目、点「动工」/.test(PLAN));
  ok('说明菜单不占位置', /不占这里的位置/.test(PLAN));
  ok('标题写「已选定」', /<span class="fl-tag">已选定<\/span>/.test(PLAN));
}

console.log('\n=== 5. 卡片要能点开抽屉 ===');
{
  ok('data-k 用 域::名 格式', /data-k="\$\{esc\(\(d && d\.name\) \|\| ''\)\}::/.test(PLAN));
  ok('不再写死 data-k="plan"', !/data-k="plan"/.test(PLAN));
  // bindView 按 :: 拆
  ok('bindView 按 :: 拆', /String\(n\.dataset\.k\)\.split\('::'\)/.test(CORE));
}

console.log('\n=== 6. 状态徽章 ===');
{
  ok('用 bucketOf 归类', /bucketOf\(p\.状态\)/.test(PLAN));
  ok('运营中 st-ok', /'st-ok'/.test(PLAN));
  ok('建设中 st-build', /'st-build'/.test(PLAN));
  ok('有 fl-pill', /fl-pill \$\{cls\}/.test(PLAN));
  // 原来的品质标签换成状态，因为状态才是这张卡的用处
  ok('不再只显示品质', !/\$\{p\.品质 \? `<span class="fl-tag">/.test(PLAN));
}

console.log('\n=== 7. 别把菜单当已建 ===');
{
  // latestPlans 仍然读菜单，那是数据来源，没错；错的是直接铺出来
  ok('latestPlans 保留', /function latestPlans/.test(CORE));
  ok('规划页不再直接铺 plans', !/const plans = data\.plans \|\| \[\];/.test(PLAN));
  ok('走 chosenPlans', /const plans = chosenPlans\(d\);/.test(PLAN));
}

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
