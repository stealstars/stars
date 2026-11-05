/**
 * 七档数值同步校验。
 *
 * 背景：世界书的「七档规模阶梯」被硬编码进两处——
 *   modules/core.js          TIERS 数组（面板显示「建筑槽 / 基础月结余」）
 *   modules/prompts/diplomacy.js  外交页建档提示词里的查表
 * 世界书改一版数值，这两处就过时一次。实测 v9 之前每一档的领地价值都错了几十倍。
 *
 * 这个测试直接读世界书，逐项比对，脱节就红。
 */
import fs from 'node:fs';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('  OK   ' + name); }
  else { fail += 1; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
}

/* ---------- 1. 从世界书解析七档表 ---------- */
/* 七档表在「领地扩展」世界书里，不在命定本体卡里 */
const EXT = JSON.parse(fs.readFileSync(
  'D:/223/领地开始/领地扩展-7合1-免递归-终极版-v9-含可选治世经验.json', 'utf8'));
const entries = Array.isArray(EXT.entries) ? EXT.entries : Object.values(EXT.entries);

let tableText = '';
for (const e of entries) {
  const body = String(e.content || '');
  if (/档\|名称\|品质\|领地价值/.test(body)) { tableText = body; break; }
}
if (!tableText) {
  console.log('✘ 世界书里找不到七档表（档|名称|品质|领地价值）');
  process.exit(1);
}

const BOOK = [];
for (const line of tableText.split('\n')) {
  const t = line.trim();
  if (!/^[1-7]\|/.test(t)) continue;
  const p = t.split('|').map((x) => x.trim());
  BOOK.push({
    n: Number(p[0]),
    name: p[1],
    value: p[3],        // 领地价值
    slot: p[4],         // 槽
    base: p[5],         // 基础月结余B
    delta: p[6],        // 修正块Δ
    lv: p[7],           // 实力下限
  });
}

console.log('=== 1. 世界书七档表 ===');
ok('解析出 7 档', BOOK.length === 7, BOOK.length);
for (const b of BOOK) {
  console.log('  ' + b.n + ' ' + b.name.padEnd(8) + b.value.padEnd(14) + '槽 ' + String(b.slot).padEnd(4) + b.base);
}

/* ---------- 2. core.js 的 TIERS ---------- */
const coreSrc = fs.readFileSync('D:/223/fief-ledger/modules/core.js', 'utf8');
const coreBlock = coreSrc.match(/const TIERS = \[([\s\S]*?)\n  \];/);
ok('core.js 找到 TIERS', !!coreBlock);

const CORE = [];
if (coreBlock) {
  const re = /\{ n: (\d+), name: '([^']+)', value: '([^']+)', slot: (\d+), base: '([^']+)'/g;
  let m;
  while ((m = re.exec(coreBlock[1])) !== null) {
    CORE.push({ n: Number(m[1]), name: m[2], value: m[3], slot: Number(m[4]), base: m[5] });
  }
}

console.log('\n=== 2. core.js TIERS 与世界书一致 ===');
ok('core.js 解析出 7 档', CORE.length === 7, CORE.length);

for (const b of BOOK) {
  const c = CORE.find((x) => x.n === b.n);
  if (!c) { ok(b.n + ' ' + b.name + ' 存在', false, '缺'); continue; }
  ok(b.n + ' ' + b.name + ' 名称', c.name === b.name, c.name);

  /* 领地价值：世界书写 200-500万Z，core 也应是 200-500万Z */
  const norm = (s) => String(s).replace(/[–—~～]/g, '-').replace(/\s/g, '');
  ok(b.n + ' ' + b.name + ' 领地价值 ' + b.value, norm(c.value) === norm(b.value), c.value);

  /* 建筑槽：世界书 60+ / 90+，core 存 60 / 90 */
  ok(b.n + ' ' + b.name + ' 建筑槽 ' + b.slot, String(c.slot) === String(b.slot).replace('+', ''), c.slot);

  /* 基础月结余：世界书 +50万Z，core 是 +50万Z/月 */
  ok(b.n + ' ' + b.name + ' 基础月结余 ' + b.base, norm(c.base) === norm(b.base) + '/月', c.base);
}

/* ---------- 3. 外交页提示词表格 ---------- */
const promptSrc = fs.readFileSync('D:/223/fief-ledger/modules/prompts/diplomacy.js', 'utf8');
const rows = [];
for (const line of promptSrc.split('\n')) {
  const m = line.match(/'\s+([1-7]) (\S+)\s+\S+\s+(\d+\+?)\s+(\+[^']+\/月)',/);
  if (m) rows.push({ n: Number(m[1]), name: m[2], slot: m[3], base: m[4] });
}

console.log('\n=== 3. 外交页提示词表格一致 ===');
ok('提示词解析出 7 行', rows.length === 7, rows.length);
for (const b of BOOK) {
  const r = rows.find((x) => x.n === b.n);
  if (!r) { ok(b.n + ' ' + b.name + ' 在提示词里', false, '缺'); continue; }
  const norm = (s) => String(s).replace(/[–—~～]/g, '-').replace(/\s/g, '');
  ok(b.n + ' ' + b.name + ' 月结余 ' + b.base, norm(r.base) === norm(b.base) + '/月', r.base);
  ok(b.n + ' ' + b.name + ' 槽 ' + b.slot, String(r.slot) === String(b.slot), r.slot);
}

/* ---------- 4. 旧的错误数值不许残留 ---------- */
console.log('\n=== 4. 旧数值不许残留 ===');
const STALE = ['400万–1500万Z', '5亿–10亿Z', '60亿–100亿Z', '400亿–800亿Z',
  '3000亿Z+', '2万亿–3万亿Z', '10万亿–12万亿Z',
  '+2万Z/月', '+60万Z/月', '+400万Z/月', '+2500万Z/月'];
const both = coreSrc + promptSrc;
const hit = STALE.filter((s) => both.includes(s));
ok('没有旧档位数值', hit.length === 0, hit.join(','));

console.log('\n' + (fail ? fail + ' 项失败  ' : '全部通过 ✔  ') + (pass + fail) + ' 项');
process.exit(fail ? 1 : 0);
