/**
 * 重 roll 不该多记一条「读取」。
 *
 * 反馈：重 roll（重新生成回复）之后，日志里会多出一条读取记录。
 *
 * 根因：message_swiped → schedule → checkOnce，消息签名一变就 rescan，
 * 而 doRescan 末尾无条件 logPush('read', ...)。领地数据其实一个字没变。
 *
 * 修法：算一个数据指纹（领地名 + 每个条目的名字/数量/类别），
 * 和上次相同且不是手动读取，就跳过这条日志。
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

/* ---- 从源码里抠出 dataPrint 单独测 ---- */
const AT = '  function dataPrint(d) {';
const at = CORE.indexOf(AT);
if (at < 0) {
  console.log('[!!] 找不到 dataPrint');
  process.exit(1);
}
let i = CORE.indexOf('{', at);
let depth = 0;
let end = -1;
for (; i < CORE.length; i += 1) {
  if (CORE[i] === '{') depth += 1;
  else if (CORE[i] === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
}
const dataPrint = new Function(CORE.slice(at, end) + '\n; return dataPrint;')();

console.log('=== 1. 指纹能认出「没变」 ===');
{
  const a = {
    domains: [{ name: '灰谷', items: [{ name: 'b军团', quantity: '5000', category: '军事' }] }],
  };
  const b = {
    domains: [{ name: '灰谷', items: [{ name: 'b军团', quantity: '5000', category: '军事' }] }],
  };
  ok('同样的数据指纹相同', dataPrint(a) === dataPrint(b));
}

console.log('\n=== 2. 数据真变了要认出来 ===');
{
  const a = { domains: [{ name: '灰谷', items: [{ name: 'a军团', quantity: '8000', category: '军事' }] }] };
  const b = { domains: [{ name: '灰谷', items: [{ name: 'b军团', quantity: '5000', category: '军事' }] }] };
  ok('换了个军团指纹就变', dataPrint(a) !== dataPrint(b));

  const c = { domains: [{ name: '灰谷', items: [{ name: 'b军团', quantity: '6000', category: '军事' }] }] };
  ok('只改人数也算变', dataPrint(b) !== dataPrint(c));

  const d = { domains: [{ name: '灰谷', items: [{ name: 'b军团', quantity: '5000', category: '经济' }] }] };
  ok('只改类别也算变', dataPrint(b) !== dataPrint(d));

  const e = { domains: [{ name: '灰谷', items: [{ name: 'b军团', quantity: '5000', category: '军事', missing: true }] }] };
  ok('标记为丢失也算变', dataPrint(b) !== dataPrint(e));

  const f = { domains: [{ name: '灰谷', items: [] }, { name: '白石', items: [] }] };
  ok('多了一个领地也算变', dataPrint({ domains: [{ name: '灰谷', items: [] }] }) !== dataPrint(f));
}

console.log('\n=== 3. 空数据不炸 ===');
{
  ok('没有 domains 给空串', dataPrint({}) === '', JSON.stringify(dataPrint({})));
  ok('null 也安全', dataPrint(null) === '');
}

console.log('\n=== 4. 源码里确实把日志压住了 ===');
{
  ok('有 lastPrint 状态', /let lastPrint = '';/.test(CORE));
  ok('doRescan 里算了指纹', /const print = dataPrint\(data\);/.test(CORE));
  ok('自动读取重复时跳过日志', /const same = !manual && print === lastPrint;/.test(CORE));
  ok('logPush 被 !same 包住', /if \(!same\) logPush\('read'/.test(CORE));
  ok('手动读取照样记', /const same = !manual &&/.test(CORE));
}

console.log('\n' + (fail ? fail + ' 项失败  ' : '全部通过 ✔  ') + (pass + fail) + ' 项');
process.exit(fail ? 1 : 0);
