/**
 * 规模档归并：原文那些五花八门的写法，到底能不能落进七档
 *
 * 玩家报的问题：「层级数量不合实际」。
 * 根因是 placeScale 原样返回原文，外交页把「庞大城邦」「远古生态区级」
 * 「30人以内」直接当档位标签显示了。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = { console };
win.window = win;
new Function('window', fs.readFileSync(path.join(ROOT, 'modules/worldbook.js'), 'utf8'))(win);
const B = win.__fiefBook;

let pass = 0;
let fail = 0;
const ok = (n, c, e) => {
  if (c) pass += 1;
  else { fail += 1; console.log('  [!!] ' + n + (e ? '  -> ' + e : '')); }
};

console.log('=== 1. 原文写法 → 七档 ===');
const CASES = [
  // 原词
  ['村庄', '村庄'],
  ['小型村镇', '小型村镇'],
  ['中型城镇', '中型城镇'],
  ['大型城市', '大型城市'],
  ['超级城市', '超级城市'],
  ['小国或帝国行省', '小国或帝国行省'],
  ['大国', '大国'],

  // 带括号
  ['大型城市(港口)', '大型城市'],
  ['大型城市(要塞)', '大型城市'],
  ['大型城市(刺客圣地)', '大型城市'],
  ['超级城市（宗教圣地）', '超级城市'],
  ['小型村镇(矿业)', '小型村镇'],
  ['中型城镇(军港)', '中型城镇'],
  ['中型城镇(龙裔自由邦)', '中型城镇'],

  // 变体
  ['庞大城邦', '超级城市'],
  ['巨型城市', '超级城市'],
  ['远古生态区级', '超级城市'],
  ['首都级', '超级城市'],
  ['大型港市', '超级城市'],
  ['中型圣所城镇', '中型城镇'],
  ['小村', '村庄'],
  ['小镇', '小型村镇'],

  // 区间
  ['村庄-小型村镇(规模不定)', '小型村镇'],

  // 根本不是规模 → 留空
  ['30人以内', ''],
  ['50人以内', ''],
  ['高度: 平均高度240米，最高点达320米', ''],
];
for (const [raw, want] of CASES) {
  const got = B.cleanTier7(raw);
  ok(JSON.stringify(raw) + ' → ' + JSON.stringify(want || '(留空)'),
    got === want, '得到「' + got + '」');
}

console.log('\n=== 2. 真实卡片的归并结果 ===');
const CARD = process.env.FIEF_CARD || path.resolve(ROOT, '..', '命定之诗与黄昏之歌v4.31.json');
if (!fs.existsSync(CARD)) { console.log('  跳过：没卡片文件'); }
else {
  const card = JSON.parse(fs.readFileSync(CARD, 'utf8'));
  const raw = card.data.character_book.entries || [];
  const entries = raw.map((e) => ({
    uid: e.id, name: e.comment, content: e.content,
    strategy: { type: e.constant ? 'constant' : 'selective', keys: e.key || e.keys || [] },
  }));
  const tree = B.buildFactionTree(B.normalize(entries));

  let withScale = 0;
  let nonTier = 0;
  const dist = {};
  for (const k of Object.keys(tree)) {
    for (const p of tree[k].places) {
      if (!p.scale) continue;
      withScale += 1;
      if (B.TIER7.indexOf(p.scale) < 0) {
        nonTier += 1;
        console.log('  ✘ 非七档: ' + p.name + ' → ' + JSON.stringify(p.scale));
      }
      dist[p.scale] = (dist[p.scale] || 0) + 1;
    }
  }
  console.log('  有规模档的地点数: ' + withScale);
  console.log('  档位分布: ' + JSON.stringify(dist));
  ok('全部落进七档', nonTier === 0, String(nonTier) + ' 个例外');

  // 归并不了的（原文写了规模但七档比不中）应当留空，而不是原样显示
  let rawHasButEmpty = 0;
  for (const k of Object.keys(tree)) {
    for (const p of tree[k].places) {
      const r = B.placeScaleRaw(p.content);
      if (r && !p.scale) {
        rawHasButEmpty += 1;
        if (rawHasButEmpty <= 8) console.log('  归并不了 → 留空: ' + JSON.stringify(r));
      }
    }
  }
  console.log('  原文有规模但归并不了的: ' + rawHasButEmpty + ' 个（留空是对的）');
}

console.log('\n=== 3. 边界输入不能崩 ===');
for (const bad of ['', null, undefined, '   ', '[]', '???', 123, {}]) {
  let got;
  try { got = B.cleanTier7(bad); ok('不崩 ' + JSON.stringify(bad), got === '', JSON.stringify(got)); }
  catch (e) { ok('不崩 ' + JSON.stringify(bad), false, e.message); }
}

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
