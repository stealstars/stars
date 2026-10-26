/**
 * 真实数据里，生命层级到底怎么分布
 *
 * 玩家说提示词的层级设定不对。不猜，把原文全扫一遍。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARD = process.env.FIEF_CARD || path.resolve(ROOT, '..', '命定之诗与黄昏之歌v4.31.json');
if (!fs.existsSync(CARD)) { console.log('没有卡片文件'); process.exit(0); }

const card = JSON.parse(fs.readFileSync(CARD, 'utf8'));
const raw = card.data.character_book.entries || [];

const RANK_CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
function ranksIn(text) {
  const out = [];
  const s = String(text || '');
  // 「第三层级」「第3层」「Lv.13-16」
  const re = /第\s*([一二三四五六1-6])\s*(?:层级|层|阶)|Lv\.?\s*(\d+)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[1]) out.push(RANK_CN[m[1]] || Number(m[1]) || 0);
    else if (m[2]) {
      const lv = Number(m[2]);
      out.push(Math.max(1, Math.min(6, Math.floor((lv - 1) / 4) + 2)));
    }
  }
  return out.filter((x) => x > 0);
}

// 规模档
const SCALE_RE = /(^|[\s|｜,，])(?:规模|地点类别|城市规模|等级规模)\s*[:：]\s*([^\n|｜]{1,24})/m;
const TIER7 = ['村庄', '小型村镇', '中型城镇', '大型城市', '超级城市', '小国或帝国行省', '大国'];

console.log('=== 1. 每个条目里出现的最高层级 ===');
const perEntry = [];
for (const e of raw) {
  const rs = ranksIn(e.content);
  if (!rs.length) continue;
  const sm = String(e.content || '').match(SCALE_RE);
  perEntry.push({
    name: String(e.comment || '').replace(/^\[本体\]\[势力\]/, '').slice(0, 40),
    rank: Math.max(...rs),
    all: [...new Set(rs)].sort(),
    scale: sm ? sm[2].trim() : '',
  });
}
console.log('  有条目提到层级的: ' + perEntry.length);

console.log('\n=== 2. 层级分布 ===');
const dist = {};
for (const x of perEntry) dist[x.rank] = (dist[x.rank] || 0) + 1;
for (const k of Object.keys(dist).sort()) {
  console.log('  最高第' + k + '层级: ' + dist[k] + ' 条');
}

console.log('\n=== 3. 高层级(4+)都在哪种条目里 ===');
for (const x of perEntry.filter((y) => y.rank >= 4).slice(0, 30)) {
  console.log('  [' + x.rank + '] ' + (x.scale || '(无规模)').padEnd(14, ' ') + ' ' + x.name);
}

console.log('\n=== 4. 按规模档看层级上限（真实数据） ===');
const byScale = {};
for (const x of perEntry) {
  if (!x.scale) continue;
  // 归并
  let t = x.scale;
  for (const t7 of TIER7) if (t.indexOf(t7) >= 0) { t = t7; break; }
  if (!byScale[t]) byScale[t] = [];
  byScale[t].push(x.rank);
}
for (const k of Object.keys(byScale)) {
  const arr = byScale[k];
  console.log('  ' + k.padEnd(16, ' ') + ' 条目 ' + String(arr.length).padStart(2)
    + '  层级范围 ' + Math.min(...arr) + '-' + Math.max(...arr));
}

console.log('\n=== 5. 我提示词里写的上限 vs 真实最高 ===');
const MY = { 村庄: 2, 小型村镇: 3, 中型城镇: 3, 大型城市: 4, 超级城市: 4, 小国或帝国行省: 5, 大国: 6 };
for (const k of Object.keys(byScale)) {
  const real = Math.max(...byScale[k]);
  const mine = MY[k];
  if (!mine) continue;
  const flag = real > mine ? '  ✘ 真实更高' : '';
  console.log('  ' + k.padEnd(16, ' ') + ' 我写 ' + mine + ' / 真实最高 ' + real + flag);
}
