/**
 * 世界书解析测试
 *
 * 用真实的命定卡片 + 酒馆助手的真实接口形状（异步、字段叫 name）验证。
 */
import fs from 'node:fs';

let pass = 0, fail = 0;
const ok = (n, v, e) => { if (v) { pass++; console.log('  OK   ' + n); } else { fail++; console.log('  FAIL ' + n + (e ? ' -> ' + e : '')); } };

const CARD = JSON.parse(fs.readFileSync('D:\\223\\命定之诗与黄昏之歌v4.31.json', 'utf8'));
const CODE = fs.readFileSync('D:\\223\\fief-ledger\\modules\\worldbook.js', 'utf8');

function makeWin(th) {
  const w = { console: { log() {}, warn() {}, error() {} } };
  w.window = w;
  if (th) w.TavernHelper = th;
  new Function('window', 'console', CODE)(w, w.console);
  return w;
}

/* 卡片里确实有这些条目 */
const raw = Object.keys(CARD.data.character_book.entries).map((k) => CARD.data.character_book.entries[k]);
console.log('卡片原始条目 ' + raw.length);
ok('卡片有 597 条', raw.length === 597, String(raw.length));

/* ---------------- ① 酒馆助手异步形状 ---------------- */
console.log('\n=== 酒馆助手（Promise + name 字段） ===');
const thAsync = {
  getWorldbookNames: () => ['命定之诗与黄昏之歌v4.3'],
  getCharWorldbookNames: () => ({ primary: '命定之诗与黄昏之歌v4.3', additional: [] }),
  getWorldbook: async (n) => (n === '命定之诗与黄昏之歌v4.3'
    ? raw.map((e, i) => ({
      uid: i,
      name: e.comment,             // ← 关键：字段叫 name
      content: e.content,
      strategy: { type: e.constant ? 'constant' : 'selective', keys: e.key || [] },
    }))
    : []),
};
const w1 = makeWin(thAsync);
ok('debug 能跑', (() => { try { w1.__fiefBook.debug(); return true; } catch (e) { return false; } })());
const d1 = w1.__fiefBook.debug();
ok('debug 报酒馆助手可用', d1.TavernHelper === true);
ok('debug 报书名', d1.世界书名.length === 1, JSON.stringify(d1.世界书名));
ok('debug 报能调 getWorldbook', d1.有getWorldbook === true);

const c1 = await w1.__fiefBook.scan(false);
ok('异步扫到条目', c1.count > 500, String(c1.count));
ok('异步读出 10 个势力', Object.keys(c1.factions).length === 10, String(Object.keys(c1.factions).length));
ok('scan 返回 Promise', typeof w1.__fiefBook.scan(false).then === 'function');
ok('scanSync 拿到缓存', w1.__fiefBook.scanSync().count === c1.count);

const places1 = Object.keys(c1.factions).reduce((s, f) => s + c1.factions[f].places.length, 0);
// 不钉死精确数字：判据会随命定更新而变化。
// 钉死的是「数量在合理区间」+「该算的算了、不该算的没算」，这才是真正要守的东西。
ok('地点数在合理区间', places1 > 150 && places1 < 260, String(places1));
console.log('  条目 ' + c1.count + '，势力 ' + Object.keys(c1.factions).length + '，地点 ' + places1);

/* 每个势力都要有地点，永夜盟约除外（它确实没有地点条目） */
const NO_PLACE = new Set(['永夜盟约']);
for (const f of Object.keys(c1.factions)) {
  const n = c1.factions[f].places.length;
  const total = n + c1.factions[f].overview.length;
  ok(f + ' 有事可看', total > 0, String(total));
  if (!NO_PLACE.has(f)) ok(f + ' 有地点', n > 0, String(n));
}

/* 不该算地点的条目，逐条点名验证 */
{
  const allPlaces = [];
  for (const f of Object.keys(c1.factions)) {
    for (const p of c1.factions[f].places) allPlaces.push(f + ' · ' + p.name);
  }
  const allNames = allPlaces.join('\n');
  const SHOULD_NOT = [
    '政治与社会', '地理与文化', '地理概览', '社会结构', '总览', '概述',
    '游牧部落', '蝾螈王朝', '鼠族王国', '天霜王国',
    '埃吉尔海德公国', '斯卡尔公国', '维斯格拉德公国', '诺德海姆公国',
    '改革线', '圣光技艺与圣纹体系', '归港节',
  ];
  for (const bad of SHOULD_NOT) {
    ok('「' + bad + '」不算地点', allNames.indexOf(bad) < 0);
  }
  // 该算的
  const SHOULD = ['翠庭城', '银帆城', '珍珠湾'];
  for (const good of SHOULD) {
    ok('「' + good + '」算地点', allNames.indexOf(good) >= 0);
  }
}

/* 抽查一个地点 */
const aug = c1.factions['奥古斯提姆帝国'];
const cit = aug.places.find((p) => p.name === '翠庭城');
ok('翠庭城被识别为地点', !!cit);
if (cit) {
  ok('翠庭城规模是大型城市', cit.scale === '大型城市', cit.scale);
  ok('翠庭城有正文', cit.content.length > 100, String(cit.content.length));
  ok('翠庭城有位置字段', !!cit.where, cit.where);
}

/* 总述不该被当成地点 */
const augOverview = aug.overview.map((o) => o.name);
ok('奥古斯提姆帝国总述没混进地点', aug.places.every((p) => p.scale || p.name !== '奥古斯提姆帝国'));
console.log('  奥古斯提姆总述 ' + augOverview.length + ' 条：' + augOverview.slice(0, 4).join('、'));

/* ---------------- ② 同步返回也要能接 --------------- */
console.log('\n=== 同步返回（旧实现） ===');
const thSync = {
  getWorldbookNames: () => ['命定之诗与黄昏之歌v4.3'],
  getWorldbook: () => raw,
};
const c2 = await makeWin(thSync).__fiefBook.scan(false);
ok('同步返回值也能扫到', c2.count > 500, String(c2.count));
ok('同步结果势力数一致', Object.keys(c2.factions).length === 10);

/* ---------------- ③ 原生全局 --------------- */
console.log('\n=== 原生全局 world_info ===');
const w3 = { console: { log() {}, warn() {}, error() {} } };
w3.window = w3;
w3.world_info = CARD.data.character_book;
new Function('window', 'console', CODE)(w3, w3.console);
const c3 = await w3.__fiefBook.scan(false);
ok('原生 world_info 能扫到', c3.count > 500, String(c3.count));

/* ---------------- ④ 什么都没有 --------------- */
console.log('\n=== 读不到时 ===');
const w4 = { console: { log() {}, warn() {}, error() {} } };
w4.window = w4;
new Function('window', 'console', CODE)(w4, w4.console);
const c4 = await w4.__fiefBook.scan(false);
ok('不崩，返回 0 条', c4.count === 0, String(c4.count));
ok('给出可读的错误', !!c4.err, c4.err);
ok('debug 报酒馆助手不可用', w4.__fiefBook.debug().TavernHelper === false);

/* ---------------- ⑤ 拆名函数 --------------- */
console.log('\n=== 标签拆分 ===');
const w5 = makeWin(null);
const sp = w5.__fiefBook.splitFactionTag;
const a = sp('[本体][势力][诺斯加德联盟][城镇]灰岩镇');
ok('带标签的拆出势力', a && a.faction === '诺斯加德联盟', JSON.stringify(a));
ok('带标签的拆出地名', a && a.name === '灰岩镇', a && a.name);
ok('带标签的保留 tags', a && a.tags.join('/') === '城镇', a && a.tags.join('/'));

const b = sp('[本体][势力][奥古斯提姆帝国]翠庭城');
ok('裸地名也能拆', b && b.faction === '奥古斯提姆帝国' && b.name === '翠庭城', JSON.stringify(b));

const c = sp('[本体][势力][奥古斯提姆帝国]翠庭城(快乐柠萌茶)');
ok('剥掉作者签名', c && c.name === '翠庭城', c && c.name);

const dd = sp('[本体][势力][兽族联盟][鼠族王国][风信子城][主城区]主城区');
ok('多层嵌套拆得开', dd && dd.faction === '兽族联盟' && dd.tags.length === 3, JSON.stringify(dd && dd.tags));

ok('非势力条目返回 null', sp('[本体][变量][mvu_update]变量更新规则') === null);

console.log('\n' + (fail ? fail + ' 项失败 / ' + (fail + pass) : '全部通过 ✔  ' + pass + ' 项'));
process.exit(fail ? 1 : 0);
