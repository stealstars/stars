/**
 * 世界书里各势力到底写了多少个高层级强者
 *
 * 不要自己编数量。把原文里「XX为第N层级」这种句子全捞出来数。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARD = process.env.FIEF_CARD || path.resolve(ROOT, '..', '命定之诗与黄昏之歌v4.31.json');
const card = JSON.parse(fs.readFileSync(CARD, 'utf8'));
const raw = card.data.character_book.entries || [];

const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7 };

/** 数一个条目里「提到某层级的次数」 */
function rankHits(text) {
  const out = {};
  const re = /第\s*([一二三四五六七])\s*(?:层级|层|阶)/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const n = CN[m[1]];
    if (n) out[n] = (out[n] || 0) + 1;
  }
  return out;
}

/** 找出「某人/某职 为 第N层级」这种指名道姓的 */
function namedRanks(text) {
  const out = [];
  const s = String(text || '');
  const re = /([\u4e00-\u9fa5·\w]{2,14})\s*(?:为|达到|已达|已是|即)\s*第\s*([一二三四五六七])\s*(?:层级|层|阶)/g;
  let m;
  while ((m = re.exec(s)) !== null) out.push({ who: m[1].trim(), rank: CN[m[2]] });
  return out;
}

// 按势力归
const byFaction = {};
for (const e of raw) {
  const nm = String(e.comment || '');
  const c = String(e.content || '');
  const fm = nm.match(/^\[本体\]\[势力\]\[([^\]]+)\]/);
  const fac = fm ? fm[1] : '(非势力条目)';
  const h = rankHits(c);
  if (!Object.keys(h).length) continue;
  if (!byFaction[fac]) byFaction[fac] = { entries: 0, hits: {}, named: [] };
  byFaction[fac].entries += 1;
  for (const k of Object.keys(h)) {
    byFaction[fac].hits[k] = (byFaction[fac].hits[k] || 0) + h[k];
  }
  for (const nr of namedRanks(c)) byFaction[fac].named.push(nr);
}

console.log('=== 各势力原文里提到各层级的总次数 ===');
console.log('势力'.padEnd(22) + '条目  一层  二层  三层  四层  五层  六层  七层');
const order = ['一', '二', '三', '四', '五', '六', '七'];
for (const f of Object.keys(byFaction).sort()) {
  const d = byFaction[f];
  const row = order.map((_, i) => String(d.hits[i + 1] || 0).padStart(4)).join('  ');
  console.log(f.padEnd(20) + String(d.entries).padStart(4) + '  ' + row);
}

console.log('\n=== 指名道姓的高层级（4 层以上） ===');
for (const f of Object.keys(byFaction).sort()) {
  const hi = byFaction[f].named.filter((n) => n.rank >= 4);
  if (!hi.length) continue;
  console.log('\n· ' + f + '  (' + hi.length + ' 人)');
  for (const h of hi.slice(0, 12)) console.log('    ' + h.who + '  第' + h.rank + '层级');
}

console.log('\n=== 全卡合计 ===');
const total = {};
let allNamed = 0;
for (const f of Object.keys(byFaction)) {
  for (const k of Object.keys(byFaction[f].hits)) {
    total[k] = (total[k] || 0) + byFaction[f].hits[k];
  }
  allNamed += byFaction[f].named.length;
}
for (let i = 1; i <= 7; i += 1) {
  console.log('  第' + i + '层级提及 ' + String(total[i] || 0).padStart(4) + ' 次');
}
console.log('  指名道姓的强者 ' + allNamed + ' 人');
