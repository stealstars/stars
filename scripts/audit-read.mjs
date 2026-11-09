/**
 * 读取链路体检：拿真实卡片里的 <fief_domain> 区块过一遍解析器，
 * 把「明显不对」的地方打出来（空名、零数量、重名、类别不认识、字段被吞）。
 *
 *   node scripts/audit-read.mjs
 *
 * 只读不写。用来在发布前扫一眼，不是单元测试。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCard } from './card.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = fs.readFileSync(path.join(ROOT, 'modules/core.js'), 'utf8');

/* ---- 从源码里切出解析用的几个纯函数 ---- */
function cut(startMark) {
  const at = CORE.indexOf(startMark);
  if (at < 0) throw new Error('找不到 ' + startMark);
  let i = CORE.indexOf('{', at);
  let depth = 0;
  for (; i < CORE.length; i += 1) {
    if (CORE[i] === '{') depth += 1;
    else if (CORE[i] === '}') { depth -= 1; if (depth === 0) return CORE.slice(at, i + 1); }
  }
  throw new Error('括号没配平：' + startMark);
}

const SRC = [
  cut('  function normalizeInner(raw) {'),
  cut('  function bracketRows(body) {'),
  cut('  function blockRows(text, tag) {'),
  'const UNIT_OF = { 千: 1e3, 万: 1e4, 亿: 1e8, 万亿: 1e12 };',
  cut('  function numberOf(v) {'),
  cut('  function rowsByTag(rows) {'),
  cut('  function parseDomainBlock(text) {'),
].join('\n');

const P = new Function(SRC + '\n; return { parseDomainBlock, numberOf, normalizeInner };')();

const card = loadCard();
if (!card) {
  console.log('找不到卡片，跳过');
  process.exit(0);
}

const entries = Object.values(card.data.character_book.entries);
const withDomain = entries.filter((e) => String(e.content || '').indexOf('<fief_domain>') >= 0);
console.log('卡片条目 ' + entries.length + '，含 <fief_domain> 的 ' + withDomain.length);
console.log('');

let problems = 0;
const bad = (where, what) => { problems += 1; console.log('  [!!] ' + where + ' — ' + what); };

for (const e of withDomain) {
  const info = P.parseDomainBlock(e.content);
  const tag = e.comment || e.name || '(无名)';
  if (!info) { bad(tag, '解析返回 null（连领地名都没读到）'); continue; }

  const n = (info.营造 || []).length;
  const mil = (info.军事 || []).length;
  console.log('· ' + info.领地名 + '　营造 ' + n + '　军事 ' + mil
    + '　物产 ' + (info.物产 || []).length + '　要事 ' + (info.要事 || []).length);

  if (!info.领地名) bad(tag, '领地名是空的');
  if (!info.规模档) bad(tag, '规模档是空的');

  for (const x of info.营造 || []) {
    if (!x.名) bad(tag, '营造有条目没名字');
    if (!String(x.数量 || '').trim()) bad(tag, '营造「' + x.名 + '」没有数量');
  }
  for (const u of info.军事 || []) {
    if (!u.编制) bad(tag, '军事有条目没编制名');
    if (P.numberOf(u.人数) == null) bad(tag, '军事「' + u.编制 + '」人数读不出数字：' + JSON.stringify(u.人数));
  }

  /* 同一个领地里重名条目 */
  const seen = new Map();
  for (const x of info.营造 || []) {
    const k = String(x.名 || '');
    if (seen.has(k)) bad(tag, '营造重名：' + k);
    seen.set(k, 1);
  }
}

/* ---- numberOf 的边界 ---- */
console.log('');
console.log('=== numberOf 边界 ===');
const cases = [
  ['5000', 5000], ['5,000', 5000], ['1.5万', 15000], ['3万', 30000],
  ['约 1200 人', 1200], ['0', 0], ['', null], ['无', null],
  ['三千', null], ['1,200-1,500', 1200], ['2.5亿', 250000000],
];
for (const [input, want] of cases) {
  const got = P.numberOf(input);
  const okk = got === want;
  if (!okk) problems += 1;
  console.log('  ' + (okk ? 'OK  ' : '[!!]') + ' ' + JSON.stringify(input) + ' → ' + got
    + (okk ? '' : '（期望 ' + want + '）'));
}

console.log('');
console.log(problems ? problems + ' 处可疑' : '没发现明显问题 ✔');
