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
    items: [{ name: 'b军团', category: '军事', quantity: '5000', quality: '精锐' }],
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
      { name: 'b军团', category: '军事', quantity: '5000' },
      { name: '金穗粮仓', category: '资源点', quantity: '10' },
    ],
    info: { 军事: [] },
  };
  const r = militaryOf(d);
  ok('只出军事条目', r.length === 1 && r[0].name === 'b军团', r.map((x) => x.name).join(','));
}

console.log('\n' + (fail ? fail + ' 项失败  ' : '全部通过 ✔  ') + (pass + fail) + ' 项');
process.exit(fail ? 1 : 0);
