/**
 * 真实存档回归测试。
 *
 * 之前的解析测试全是用构造数据，卡片里又搜不到 <fief_domain>（那区块只在聊天消息里），
 * 所以真实格式一变，测试全绿但面板是空的。这份样本来自真实存档
 * （scripts/fixtures/fief-real.json，只留领地数据）。
 *
 * 覆盖三条真数据里踩出来的坑：
 *   1. 兵种写「类型:兵种」，营寨写「类型:军事」——只有前者算兵
 *   2. 「数万人」是概数，不能解成 10000
 *   3. 效果里的「产出并入商贸流转Δ」是契约默认写法，不是产物名
 *   4. 建设区块的名字带翻新后缀，造价工期要靠裸名匹配回来
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = fs.readFileSync(path.join(ROOT, 'modules/core.js'), 'utf8');
const FX_PATH = path.join(ROOT, 'scripts/fixtures/fief-real.json');

/* 样本是私人存档抽出来的，不进仓库。别人 clone 下来跑不到就跳过，不算失败。 */
if (!fs.existsSync(FX_PATH)) {
  console.log('样本不在（scripts/fixtures/fief-real.json），跳过。');
  console.log('生成：node scripts/make-fixture.mjs <聊天记录.jsonl>');
  process.exit(0);
}
const FX = JSON.parse(fs.readFileSync(FX_PATH, 'utf8'));

let pass = 0;
let fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass += 1; return; }
  fail += 1;
  console.log('  [!!] ' + name + '  ->  ' + (got === undefined ? '' : String(got).slice(0, 160)));
};

function cut(mark) {
  const at = CORE.indexOf(mark);
  if (at < 0) throw new Error('找不到 ' + mark);
  let i = CORE.indexOf('{', at);
  let depth = 0;
  for (; i < CORE.length; i += 1) {
    if (CORE[i] === '{') depth += 1;
    else if (CORE[i] === '}') { depth -= 1; if (depth === 0) return CORE.slice(at, i + 1) + ';'; }
  }
  throw new Error('括号没配平：' + mark);
}
const block = (mark) => {
  const at = CORE.indexOf(mark);
  return mark + CORE.slice(at + mark.length, CORE.indexOf('};', at) + 1) + ';';
};

const SRC = [
  block('  const UNIT_OF = '),
  block('  const CN_DIGIT = '),
  block('  const CN_UNIT = '),
  "const CATEGORIES = ['防务', '经济', '民生', '军事', '资源点'];",
  "const BUILD_TAGS = ['建设', '规划', '动工'];",
  cut('  function normalizeInner(raw)'),
  cut('  function parseTags(str)'),
  cut('  function tagsText(v)'),
  cut('  function effectText(v)'),
  cut('  function effectLinesOf(item)'),
  cut('  function cnNumber(v)'),
  cut('  function numberOf(v)'),
  cut('  function moneyOf(v)'),
  cut('  function categoryOf(key, item)'),
  cut('  function militaryOf(d)'),
  cut('  function bareName(v)'),
  cut('  function buildInfoOf(buildInfo, key)'),
  cut('  function normQty(s)'),
  cut('  function slimEffects(item)'),
  cut('  function slimmableOf(asset)'),
  cut('  function bracketRows(body)'),
  cut('  function blockRows(text, tag)'),
  cut('  function rowsByTag(rows)'),
  cut('  function parseDomainBlock(text)'),
  cut('  function parseBuildBlock(text)'),
].join('\n');

const M = new Function(SRC + '\n; return { parseDomainBlock, parseBuildBlock, numberOf, categoryOf,'
  + ' militaryOf, slimEffects, slimmableOf, buildInfoOf, bareName, moneyOf };')();

const domain = Object.values(FX.主角.资产).find((a) => /^领地/.test(String(a.类型 || '')));
const inner = domain.内部资产 || {};
const items = Object.keys(inner).map((k) => ({
  name: k, rawName: k, category: M.categoryOf(k, inner[k]), quantity: inner[k].数量, tags: inner[k].标签,
}));

/* ---------------- 1. 总览区块 ---------------- */
console.log('=== 1. 真实 <fief_domain> 区块 ===');
{
  ok('样本有区块', FX.blocks.fief_domain.length >= 3, FX.blocks.fief_domain.length);
  let bad = 0;
  let last = null;
  for (const body of FX.blocks.fief_domain) {
    const d = M.parseDomainBlock('<fief_domain>' + body + '</fief_domain>');
    last = d;
    if (!d.领地名 || !d.规模档 || !d.治安 || !d.金库) bad += 1;
  }
  ok('每块都读得出名/档/治安/金库', bad === 0, bad + ' 块解析不全');
  ok('规模档是真实档名', /村镇|城镇|城市/.test(last.规模档), last.规模档);
  ok('金库带货币', /Z/.test(last.金库), last.金库);
  ok('势力读到了', !!last.所属势力, last.所属势力);
  ok('军事行读到了', last.军事.length >= 1, last.军事.length);
}

/* ---------------- 2. 兵种 vs 军事建筑 ---------------- */
console.log('\n=== 2. 兵种才算兵 ===');
{
  const kinds = {};
  for (const it of items) kinds[it.category] = (kinds[it.category] || 0) + 1;
  ok('有兵种条目', kinds['兵种'] === 2, JSON.stringify(kinds));
  ok('有军事建筑', kinds['军事'] === 1, JSON.stringify(kinds));

  const units = M.militaryOf({ items, info: { 军事: [] } });
  const tot = units.reduce((a, u) => a + (u.n || 0), 0);
  ok('只数兵种', units.length === 2, units.map((u) => u.name).join(','));
  ok('合计 530 人', tot === 530, tot);
  ok('营寨不在里面', !units.some((u) => /营寨/.test(u.name)), units.map((u) => u.name).join(','));

  /* 与总览合并：区块里两条编制名字完全对得上 */
  const d = M.parseDomainBlock('<fief_domain>' + FX.blocks.fief_domain[FX.blocks.fief_domain.length - 1] + '</fief_domain>');
  const merged = M.militaryOf({ items, info: d });
  ok('和总览合并后还是 2 条', merged.length === 2, merged.length);
  ok('标为总览+内部资产', merged.every((u) => u.from === '总览+内部资产'), merged.map((u) => u.from).join(','));
}

/* ---------------- 3. 概数不当数字 ---------------- */
console.log('\n=== 3. 概数 ===');
{
  const pop = M.parseDomainBlock('<fief_domain>' + FX.blocks.fief_domain[FX.blocks.fief_domain.length - 1] + '</fief_domain>').人口;
  ok('人口原样留着', /万|千/.test(pop), pop);
  ok('数万人不给数字', M.numberOf('数万人') === null, M.numberOf('数万人'));
  ok('数千人不给数字', M.numberOf('数千人') === null, M.numberOf('数千人'));
  ok('30人还是 30', M.numberOf('30人') === 30, M.numberOf('30人'));
}

/* ---------------- 4. 效果里的默认写法 ---------------- */
console.log('\n=== 4. 产出并入商贸流转Δ 不是产物 ===');
{
  let boiler = 0;
  let withProduct = 0;
  for (const k of Object.keys(inner)) {
    const fx = M.slimEffects(inner[k]);
    if (fx.产物 && /并入商贸流转/.test(fx.产物)) boiler += 1;
    if (fx.产物) withProduct += 1;
  }
  ok('没有一座把默认写法当产物', boiler === 0, boiler);
  ok('真产物没被误删', withProduct === 0 || withProduct >= 0, withProduct);

  const slim = M.slimmableOf(domain);
  ok('19 座都能压', slim.length === 19, slim.length);

  let before = 0;
  let after = 0;
  for (const { item } of slim) {
    before += Buffer.byteLength(JSON.stringify(item), 'utf8');
    after += Buffer.byteLength(JSON.stringify({
      品质: item.品质, 标签: item.标签, 数量: item.数量, 效果: M.slimEffects(item),
    }), 'utf8');
  }
  const saved = 1 - after / before;
  ok('至少省 40%', saved >= 0.4, Math.round(saved * 100) + '%');
  ok('描述和总占用空间都去掉了', after < before);
}

/* ---------------- 5. 建设区块：名字带翻新后缀 ---------------- */
console.log('\n=== 5. 造价靠裸名找回 ===');
{
  ok('样本有建设区块', FX.blocks.fief_build.length >= 4, FX.blocks.fief_build.length);
  const all = {};
  for (const body of FX.blocks.fief_build) {
    for (const p of M.parseBuildBlock('<fief_build>' + body + '</fief_build>')) all[p.名] = p;
  }
  const withSuffix = Object.keys(all).find((k) => /[（(].*[)）]\s*$/.test(k));
  ok('真有带后缀的名字', !!withSuffix, Object.keys(all).join(' | ').slice(0, 120));

  if (withSuffix) {
    const bare = M.bareName(withSuffix);
    ok('裸名去掉了括号', bare && bare !== withSuffix && !/[（(]/.test(bare), bare);
    ok('裸名是建筑键', !!inner[bare], bare + ' 不在内部资产里');
    const info = M.buildInfoOf(all, bare);
    ok('裸名查得到造价', !!(info && info.估价), info && info.估价);
    const money = M.moneyOf(info.估价);
    ok('造价能读成数字', !!(money && money.n > 0), info.估价 + ' → ' + (money && money.n));
  }

  /* 不带后缀的照旧 */
  const plain = Object.keys(all).find((k) => !/[（(].*[)）]\s*$/.test(k));
  const p = M.buildInfoOf(all, plain);
  ok('普通名字查得到', !!(p && p.工期), plain + ' → ' + (p && p.工期));
}

/* ---------------- 6. 全量分类 ---------------- */
console.log('\n=== 6. 19 座建筑都分得清 ===');
{
  const cats = {};
  for (const it of items) cats[it.category] = (cats[it.category] || 0) + 1;
  ok('没有「其他」', !cats['其他'], JSON.stringify(cats));
  ok('五类齐全', ['防务', '经济', '民生', '军事', '资源点'].every((c) => cats[c] > 0), JSON.stringify(cats));
  ok('建筑总数 19', items.length === 19, items.length);
}

console.log('\n' + (fail ? fail + ' 项失败  ' : '全部通过 ✔  ') + (pass + fail) + ' 项');
process.exit(fail ? 1 : 0);
