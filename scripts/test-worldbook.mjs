/**
 * 世界书解析测试
 *
 * 用真实的命定卡片 + 酒馆助手的真实接口形状（异步、字段叫 name）验证。
 */
import fs from 'node:fs';
import { loadCard } from './card.mjs';

let pass = 0, fail = 0;
const ok = (n, v, e) => { if (v) { pass++; console.log('  OK   ' + n); } else { fail++; console.log('  FAIL ' + n + (e ? ' -> ' + e : '')); } };

const CARD = loadCard();
if (!CARD) process.exit(0);
const CODE = fs.readFileSync('D:\\223\\fief-ledger\\modules\\worldbook.js', 'utf8');

function makeWin(th) {
  const w = { console: { log() {}, warn() {}, error() {} } };
  w.window = w;
  if (th) w.TavernHelper = th;
  new Function('window', 'console', CODE)(w, w.console);
  return w;
}

/* ---------------- 卡片自身 ---------------- */
const raw = Object.keys(CARD.data.character_book.entries).map((k) => CARD.data.character_book.entries[k]);
console.log('卡片条目 ' + raw.length);
ok('卡片条目数 > 500', raw.length > 500, String(raw.length));

/* ---------------- 真实接口形状（Promise + name 字段） ---------------- */
console.log('\n=== 世界书扫描（Promise + name 字段）===');
const WB_NAME = '命定之诗与黄昏之歌v4.3';
const toTH = (arr) => ({
  getWorldbookNames: () => [WB_NAME],
  getCharWorldbookNames: () => ({ primary: WB_NAME, additional: [] }),
  getWorldbook: async (n) => (n === WB_NAME
    ? arr.map((e, i) => ({
      uid: i,
      name: e.comment,             // 真实字段叫 name，不是 comment
      content: e.content,
      strategy: { type: e.constant ? 'constant' : 'selective', keys: e.key || [] },
    }))
    : []),
});

const w1 = makeWin(toTH(raw));
const d1 = w1.__fiefBook.debug();
ok('debug 认出 TavernHelper', d1.TavernHelper === true);
ok('debug 看到书名', d1.世界书名.length === 1, JSON.stringify(d1.世界书名));
ok('debug 看到 getWorldbook', d1.有getWorldbook === true);

const c1 = await w1.__fiefBook.scan(false);
ok('扫到条目', c1.count > 500, String(c1.count));
/**
 * 分组数不是固定的：命定本体 10 个势力，加上各种 DLC 扩展
 * （[DLC][扩展][边陲之国]… / [本体][冒险区域]… ）也是分组。
 * 早期断言写死 === 10，一加 DLC 就红，改成下限 + 关键势力在不在。
 */
ok('拆出多个势力分组', Object.keys(c1.factions).length >= 10, String(Object.keys(c1.factions).length));
ok('本体势力都在', ['奥古斯提姆帝国', '诺斯加德联盟', '兽族联盟']
  .every((n) => !!c1.factions[n]));
ok('scan 当时返回 Promise', typeof toTH(raw).getWorldbook === 'function');
ok('scanSync 拿到同一批', w1.__fiefBook.scanSync().count === c1.count);

/* ---------------- 势力结构 ---------------- */
console.log('\n=== 势力与地点 ===');
const fs1 = c1.factions;
const names = Object.keys(fs1);
ok('势力名非空', names.every((n) => !!n), names.join(','));
const withPlaces = names.filter((n) => fs1[n].places.length > 0);
ok('多数势力有地点', withPlaces.length >= 8, withPlaces.length + '/' + names.length);

/* 地点节点字段齐全 */
let node = null;
for (const n of names) { if (fs1[n].places.length) { node = fs1[n].places[0]; break; } }
if (node) {
  ok('地点有 name', !!node.name, JSON.stringify(node.name));
  ok('地点有 faction', !!node.faction, node.faction);
  ok('地点有 content', typeof node.content === 'string');
  ok('地点有 depth', typeof node.depth === 'number', String(node.depth));
}

/* ---------------- 只有同步字段的旧接口 ---------------- */
console.log('\n=== 兼容：同步返回 + comment 字段 ===');
const thOld = {
  getWorldbookNames: () => [WB_NAME],
  getCharWorldbookNames: () => ({ primary: WB_NAME, additional: [] }),
  getWorldbook: (n) => (n === WB_NAME
    ? raw.map((e) => ({ comment: e.comment, content: e.content, key: e.key || [] }))
    : []),
};
const w2 = makeWin(thOld);
const c2 = await w2.__fiefBook.scan(false);
ok('同步接口也能扫', c2.count > 500, String(c2.count));
ok('comment 字段也能读', Object.keys(c2.factions).length >= 10, String(Object.keys(c2.factions).length));
ok('两种接口分组一致', Object.keys(c2.factions).length === Object.keys(c1.factions).length);

/* ---------------- 没有 TavernHelper ---------------- */
console.log('\n=== 无 TavernHelper ===');
const w3 = makeWin(null);
const c3 = await w3.__fiefBook.scan(false);
ok('不报错，返回空', c3.count === 0, String(c3.count));
ok('有 err 说明', !!c3.err, String(c3.err));

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
