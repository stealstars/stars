/**
 * 军政人数：删掉的军团不能还挂在页上。
 *
 * 反馈：城市里原来有个 a 军团（内部资产，人数写在数量里），删掉重建为 b 军团后，
 * 内部资产里已经读不到 a 了，但「军政」页还挂着 a —— 吃空饷。
 *
 * 根因：军政名单有两个来源，内部资产明细 + 总览区块（fief_domain 的「军事」行）。
 * 明细删了、总览没同步时，旧编制就从总览那条路漏进来。
 * 修法：明细非空就以明细为准，总览里对不上号的编制一律不认。
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

/* ---- 从源码里抠出 militaryOf，单独编译来测 ---- */
const START = '  function militaryOf(d) {';
const at = CORE.indexOf(START);
if (at < 0) {
  console.log('[!!] 在 core.js 里找不到 militaryOf');
  process.exit(1);
}
let i = CORE.indexOf('{', at);
let depth = 0;
let end = -1;
for (; i < CORE.length; i += 1) {
  const ch = CORE[i];
  if (ch === '{') depth += 1;
  else if (ch === '}') {
    depth -= 1;
    if (depth === 0) { end = i + 1; break; }
  }
}
const SRC = CORE.slice(at, end);

/* numberOf 的近似实现：够测人数合并就行 */
const numberOf = (s) => {
  const m = String(s == null ? '' : s).replace(/,/g, '').match(/\d+/);
  return m ? Number(m[0]) : 0;
};

const militaryOf = new Function('numberOf', SRC + '\n; return militaryOf;')(numberOf);

console.log('=== 1. 明细删了，总览还挂着旧编制 ===');
{
  const d = {
    items: [{ name: 'b军团', category: '兵种', quantity: '5000', quality: '精锐' }],
    info: { 军事: [{ 编制: 'a军团', 人数: '8000' }, { 编制: 'b军团', 人数: '5000' }] },
  };
  const r = militaryOf(d);
  ok('删掉的 a 军团不再出现', r.length === 1 && r[0].name === 'b军团',
    r.map((x) => x.name).join(','));
  ok('b 军团人数还在', r[0] && r[0].n === 5000, r[0] && r[0].n);
  ok('b 军团标为明细来源', r[0] && r[0].from === '总览+内部资产', r[0] && r[0].from);
}

console.log('\n=== 2. 没有任何明细时才用总览兜底 ===');
{
  const d = { items: [], info: { 军事: [{ 编制: 'a军团', 人数: '8000', 层级: '第三层级' }] } };
  const r = militaryOf(d);
  ok('总览能兜底', r.length === 1 && r[0].name === 'a军团', r.length);
  ok('人数读到了', r[0] && r[0].n === 8000, r[0] && r[0].n);
  ok('标为总览来源', r[0] && r[0].from === '总览区块', r[0] && r[0].from);
}

console.log('\n=== 3. 名字写法不同不该算两条 ===');
{
  const d = {
    items: [{ name: '第三军团', category: '军政', quantity: '3000' }],
    info: { 军事: [{ 编制: '第三军团残部', 人数: '2800' }] },
  };
  const r = militaryOf(d);
  ok('写法不同只出一条', r.length === 1, r.length);
  ok('人数以总览为准', r[0] && r[0].n === 2800, r[0] && r[0].n);
}

console.log('\n=== 4. 全删干净 ===');
{
  ok('明细和总览都空时是空的', militaryOf({ items: [], info: { 军事: [] } }).length === 0);
  ok('没有 info 也不炸', militaryOf({ items: [] }).length === 0);
}

console.log('\n=== 5. 非军事类别不混进来 ===');
{
  const d = {
    items: [
      { name: 'b军团', category: '兵种', quantity: '5000' },
      { name: '金穗粮仓', category: '资源点', quantity: '10' },
    ],
    info: { 军事: [] },
  };
  const r = militaryOf(d);
  ok('只出军事条目', r.length === 1 && r[0].name === 'b军团', r.map((x) => x.name).join(','));
}

/* 真实存档（白鹭浅滩男爵领）：兵种是「类型:兵种」，营寨是「类型:军事」+数量1。
   世界书写明军事「供编制与训练(非兵员)」，所以营寨不能算成 1 个兵。 */
console.log('\n=== 5b. 兵种才算兵，军事是建筑 ===');
{
  const d = {
    items: [
      { name: '浅滩民兵巡逻队', category: '兵种', quantity: '30' },
      { name: '白鹭浅滩常备守备队', category: '兵种', quantity: '500' },
      { name: '白鹭浅滩常备守备军营寨', category: '军事', quantity: '1' },
    ],
    info: { 军事: [{ 编制: '浅滩民兵巡逻队', 人数: '30' }, { 编制: '白鹭浅滩常备守备队', 人数: '500' }] },
  };
  const r = militaryOf(d);
  const tot = r.reduce((a, x) => a + (x.n || 0), 0);
  ok('营寨不进军政', r.length === 2, r.map((x) => x.name).join(','));
  ok('合计 530 人', tot === 530, tot);
  ok('与总览合并', r.every((x) => x.from === '总览+内部资产'), r.map((x) => x.from).join(','));
}

/* ---------- 6. 人数写法 ---------- */
console.log('\n=== 6. 人数写法 ===');
{
  function cut(mark) {
    const at = CORE.indexOf(mark);
    let i = CORE.indexOf('{', at);
    let d = 0;
    for (; i < CORE.length; i += 1) {
      if (CORE[i] === '{') d += 1;
      else if (CORE[i] === '}') { d -= 1; if (!d) return CORE.slice(at, i + 1) + ';'; }
    }
    throw new Error('抠不出 ' + mark);
  }
  const src = [
    cut('  const CN_DIGIT = {'),
    cut('  const CN_UNIT = {'),
    'const UNIT_OF={千:1e3,万:1e4,亿:1e8,万亿:1e12};',
    cut('  function cnNumber(v) {'),
    cut('  function numberOf(v) {'),
  ].join('\n');
  const N = new Function(src + '; return numberOf;')();

  ok('阿拉伯数字', N('5000') === 5000);
  ok('带千分位', N('5,000') === 5000);
  ok('万作单位', N('1.5万') === 15000);
  ok('中文三千', N('三千') === 3000, N('三千'));
  ok('中文五百', N('五百') === 500, N('五百'));
  ok('中文十二', N('十二') === 12, N('十二'));
  ok('口语一万二', N('一万二') === 12000, N('一万二'));
  ok('一万五', N('一万五') === 15000, N('一万五'));
  ok('带说明也能读', N('约三千人') === 3000, N('约三千人'));
  ok('认不出给 null', N('无') === null, N('无'));
  /* 概数不能凭空变成精确值：真实存档的人口就是「数万人」「数千人」 */
  ok('数万人不猜', N('数万人') === null, N('数万人'));
  ok('数千人不猜', N('数千人') === null, N('数千人'));
  ok('数十人不猜', N('数十人') === null, N('数十人'));
  ok('千余人不猜', N('千余人') === null, N('千余人'));
  ok('万人还是万人', N('万人') === 10000, N('万人'));
}

console.log('\n' + (fail ? fail + ' 项失败  ' : '全部通过 ✔  ') + (pass + fail) + ' 项');
process.exit(fail ? 1 : 0);
