/**
 * 拿真实条目实际跑一次，看输出尺度对不对
 *   需要 FIEF_LIVE=1 且本地 API 在跑
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = { console };
win.window = win;
win.__fiefPrompts = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'modules/prompts/diplomacy.js'), 'utf8'))(win);
const P = win.__fiefPrompts['外交档案'];

const CARD = process.env.FIEF_CARD || path.resolve(ROOT, '..', '命定之诗与黄昏之歌v4.31.json');
const WANT = process.env.FIEF_ENTRY || '风车镇';
if (!fs.existsSync(CARD)) { console.log('跳过：没有卡片文件'); process.exit(0); }

const card = JSON.parse(fs.readFileSync(CARD, 'utf8'));
const e = (card.data.character_book.entries || []).find((x) => String(x.comment || '').includes(WANT));
if (!e) { console.log('跳过：没找到条目 ' + WANT); process.exit(0); }
console.log('条目: ' + e.comment);
console.log('原文 ' + e.content.length + ' 字\n');

const BASE = process.env.FIEF_BASE || '';
const KEY = process.env.FIEF_KEY || '';
const MODEL = process.env.FIEF_MODEL || '';
if (process.env.FIEF_LIVE !== '1' || !BASE) {
  console.log('（没设 FIEF_LIVE=1 / FIEF_BASE，只打印提示词长度）');
  const msg = P.build({ 领地: WANT, 规模档: '中型城镇', 原文: e.content });
  console.log('用户消息 ' + msg.length + ' 字');
  console.log('系统提示词 ' + P.system.length + ' 字');
  process.exit(0);
}

const userText = P.build({ 领地: WANT, 规模档: '中型城镇', 原文: e.content });
const t0 = Date.now();
const res = await fetch(BASE.replace(/\/+$/, '') + '/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
  body: JSON.stringify({
    model: MODEL,
    temperature: 0.5,
    max_tokens: 3000,
    messages: [
      { role: 'system', content: P.system },
      { role: 'user', content: userText },
    ],
  }),
});
const data = await res.json();
const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
console.log('用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's，' + text.length + ' 字');

let obj = null;
try { obj = P.normalize(P.parse(text)); } catch (err) {
  console.log('解析失败: ' + err.message);
  console.log(text.slice(0, 600));
  process.exit(1);
}

console.log('\n=== 清洗后 ===');
console.log('规模档  ' + obj.规模档);
console.log('人口    ' + obj.人口 + '        ← 城镇应是「数万人」');
console.log('治安    ' + obj.治安 + '  民心 ' + obj.民心 + '  物资 ' + obj.物资);
console.log('金库    ' + obj.金库 + '  月净额 ' + obj.月净额);
console.log('军事:');
for (const u of obj.军事) console.log('  ' + u.编制 + '  ' + u.人数 + '  ' + u.层级 + '   ← 不该超过第三层级');
console.log('营造: ' + obj.营造.map((b) => b.名).join('、'));
console.log('物产: ' + obj.物产.map((g) => g.名 + '(' + g.数量 + ')').join('、'));
console.log('要事:');
for (const x of obj.要事) console.log('  · ' + x);

let bad = 0;
if (obj.人口 !== '数万人') { console.log('\n[!!] 人口不是「数万人」而是「' + obj.人口 + '」'); bad += 1; }
// 层级允许区间写法（第二至第三层级），取其中最高的那个比对
const MAX = 3;
const RANK = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
for (const u of obj.军事) {
  const ns = [...String(u.层级).matchAll(/第\s*([一二三四五六1-6])/g)]
    .map((m) => RANK[m[1]] || Number(m[1]) || 0);
  const top = ns.length ? Math.max(...ns) : 0;
  if (!top || top > MAX) { console.log('[!!] 层级越档: ' + u.编制 + ' ' + u.层级); bad += 1; }
}
console.log('\n' + (bad ? bad + ' 处越档' : '尺度正常 ✔'));
process.exit(bad ? 1 : 0);
