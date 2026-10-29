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
  ok('从 items 出发', /const items = \(d && d\.items\) \|\| \[\]/.test(SRC));
  ok('按 name 遍历资产', /for \(const it of items\)/.test(SRC));
  ok('用资产的 name', /名: it\.name/.test(SRC));
  ok('资源点不算工程', /资源点.*test\(String\(it\.category/.test(SRC));
  ok('菜单只做补充', /buildInfoAll\(\)/.test(SRC));
  ok('注释说明了为什么', /候选清单/.test(CORE));
  ok('点名了动工流程', /动工/.test(CORE));
}

console.log('\n=== 3. 状态与补充字段 ===');
{
  ok('取 status', /状态: it\.status \|\| ''/.test(SRC));
  ok('类别回落到资产', /类别: it\.category \|\| p\.类别/.test(SRC));
  ok('估价回落到菜单', /估价: p\.估价 \|\| it\.cost/.test(SRC));
  ok('工期回落到菜单', /工期: p\.工期 \|\| it\.span/.test(SRC));
  ok('带上实况', /实况: it/.test(SRC));
}

console.log('\n=== 3.5 菜单换了也不影响已建的 ===');
{
  // 核心回归：不再从"最新一条菜单"求交集
  ok('不再读 latestPlans 的结果', !/d\.plans \|\| data\.plans/.test(SRC));
  ok('不因菜单没列就跳过', !/if \(!hit\) continue;/.test(SRC));
}

console.log('\n=== 4. 空态文案要说清 ===');
{
  ok('没有「没有建设方案」', !/没有建设方案/.test(PLAN));
  ok('改成「这块领地还没有工程」', /这块领地还没有工程/.test(PLAN));
  ok('提示去聊天里选', /选中项目、点「动工」/.test(PLAN));
  ok('说明菜单不算已建', /只是菜单，不算已建/.test(PLAN));
  ok('标题写「已建成／在建」', /已建成／在建/.test(PLAN));
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
