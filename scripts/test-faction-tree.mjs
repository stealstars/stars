/**
 * 势力层级与总览。
 *
 * 玩家反馈两条：
 *   ① "行省好像有单独条目了，看看能不能子条目分"
 *   ② "你这还是没有国家总览，还是一堆城市"
 *
 * ① 世界书里省和城是平的（tag 都只到国家），但省条目自己写了
 *    `特色城镇: 翠庭城(省会)|渡鸦港`，用它反查就能挂上去。
 * ② 每家都有一条总述条目，被归进 overview 后再没显示过。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCard } from './card.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const ok = (n, v, e) => {
  if (v) { pass += 1; } else { fail += 1; console.log('  [!!] ' + n + (e ? '  -> ' + e : '')); }
};

const CARD = loadCard();
if (!CARD) { console.log('找不到卡片，跳过'); process.exit(0); }

const WB = '命定之诗与黄昏之歌v4.3';
const win = { console: { log() {}, warn() {}, error() {} } };
win.window = win;
new Function('window', 'console', fs.readFileSync(path.join(ROOT, 'modules/worldbook.js'), 'utf8'))(win, win.console);
win.TavernHelper = {
  getWorldbookNames: () => [WB],
  getCharWorldbookNames: () => ({ primary: WB, additional: [] }),
  getWorldbook: async () => Object.values(CARD.data.character_book.entries).map((e, i) => ({
    uid: i, name: e.comment, content: e.content,
    strategy: { type: e.constant ? 'constant' : 'selective', keys: e.key || [] },
  })),
};

const CODE = fs.readFileSync(path.join(ROOT, 'modules/worldbook.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'modules/diplo.ui.js'), 'utf8');

const sc = await win.__fiefBook.scan(false);

console.log('=== 1. 行省挂城市 ===');
{
  const ag = sc.factions['奥古斯提姆帝国'];
  ok('有这个势力', !!ag);
  const provs = ag.places.filter((p) => /省$/.test(p.name));
  ok('认出 7 个省', provs.length === 7, String(provs.length));

  const sol = ag.places.find((p) => p.name === '索莱尔省');
  ok('索莱尔省在 places 里', !!sol);
  if (sol) {
    ok('索莱尔省是顶层', !sol.parent, sol.parent);
    const kids = ag.places.filter((p) => p.parent === '索莱尔省');
    ok('翠庭城挂在索莱尔省下', kids.some((p) => p.name === '翠庭城'), kids.map((k) => k.name).join(','));
    ok('渡鸦港挂在索莱尔省下', kids.some((p) => p.name === '渡鸦港'), kids.map((k) => k.name).join(','));
  }

  const bishuang = ag.places.find((p) => p.name === '碧霜省');
  if (bishuang) {
    const k = ag.places.filter((p) => p.parent === '碧霜省').map((p) => p.name);
    ok('碧霜省有 4 个子项', k.length === 4, k.join(','));
  }
}

console.log('\n=== 2. depth 按真实层级 ===');
{
  const ag = sc.factions['奥古斯提姆帝国'];
  const sol = ag.places.find((p) => p.name === '索莱尔省');
  const cui = ag.places.find((p) => p.name === '翠庭城');
  const xiu = ag.places.find((p) => p.name === '圣艾瑟拉姐妹会修道院');
  ok('省 depth=1', sol && sol.depth === 1, sol && String(sol.depth));
  ok('城 depth=2', cui && cui.depth === 2, cui && String(cui.depth));
  ok('城下的建筑 depth=3', xiu && xiu.depth === 3, xiu && String(xiu.depth));
  ok('不再是死板的 1/2', /node\.depth = parent \? 2 : 1;/.test(CODE) === false
    || /fixDepth/.test(CODE), '有 fixDepth 覆盖就行');
  ok('有重算 depth 的逻辑', /fixDepth/.test(CODE));
}

console.log('\n=== 3. 名字前缀认亲 ===');
{
  const elf = sc.factions['精灵王庭'];
  ok('艾尔文海姆有子项', elf.places.some((p) => p.parent === '艾尔文海姆'),
    elf.places.filter((p) => p.parent === '艾尔文海姆').map((p) => p.name).join(','));
  ok('根心圣域挂上去了', elf.places.some((p) => p.name === '艾尔文海姆-根心圣域' && p.parent === '艾尔文海姆'));

  // 兽族联盟用「地块-XXX」，前面的「地块」不是地名，不能当成父级
  const orc = sc.factions['兽族联盟'];
  const kuai = orc.places.find((p) => p.name === '地块-天镜湖湿地');
  ok('「地块-」不被误认父级', kuai && !kuai.parent, kuai && String(kuai.parent));
  ok('地块本身还在列表里', !!kuai);
}

console.log('\n=== 4. 总览能取到 ===');
{
  const ag = sc.factions['奥古斯提姆帝国'];
  ok('overview 非空', ag.overview.length > 0, String(ag.overview.length));
  const main = ag.overview.find((o) => o.name === '奥古斯提姆帝国');
  ok('有以势力名命名的总述', !!main);
  if (main) {
    ok('总述有内容', String(main.content || '').length > 100, String((main.content || '').length));
    ok('总述写了首都', /首都\s*[:：]/.test(main.content));
    ok('总述写了统治者', /统治者\s*[:：]/.test(main.content));
    ok('总述写了主要城市', /主要城市\s*[:：]/.test(main.content));
  }
}

console.log('\n=== 5. 界面渲染总览 ===');
{
  ok('有 renderOverview', /function renderOverview\(\)/.test(UI));
  ok('用了 f.overview', /f\.overview/.test(UI));
  ok('渲染在 places 之前', UI.indexOf('renderOverview()') < UI.indexOf('renderPlaces()'));
  ok('取 首都 字段', /'首都'/.test(UI));
  ok('取 统治者 字段', /'统治者'/.test(UI));
  ok('有 fl-ov 容器', /fl-ov/.test(UI));
  ok('只显示原文有的字段', /if \(!m\) continue;/.test(UI));
}

console.log('\n=== 6. 各势力都有层级结构 ===');
{
  // 数据本身就是平级条目、没有可挂的父条目，不算错
  const FLAT_OK = [
    '萨赫拉联邦',      // 6 个平级聚落
    '边陲之国',        // DLC 写法 [DLC][扩展][边陲之国]王国都城-地牢，无独立父条目
    '无尽地城扩展',    // 无尽地城-详情 / 无尽地城-控制，两条平级
    '史莱姆扩展',      // 只有一条
  ];
  const names = Object.keys(sc.factions);
  const noHier = [];
  for (const n of names) {
    const f = sc.factions[n];
    if (!f.places.length) continue;
    if (FLAT_OK.indexOf(n) >= 0) continue;
    const withParent = f.places.filter((p) => p.parent).length;
    if (!withParent) noHier.push(n);
  }
  ok('除已知扁平势力外都有层级', noHier.length === 0, noHier.join(','));
  ok('萨赫拉联邦确实无层级（数据如此）', sc.factions['萨赫拉联邦'].places.every((p) => !p.parent));
}

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
