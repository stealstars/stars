/**
 * DLC 扩展条目进外交页的回归测试。
 *
 * 背景：玩家两次报同一个问题——
 *   "你咋把外交页面定死了，比如边陲之国这种dlc就进不去"
 *   "主要是有些dlc不写势力标签啊"
 *
 * 第一版放宽了入口但用黑名单过滤（排除体质/寿命/抽卡），
 * 结果 34 个分组、240 个地点，种族和功能条目全挤进势力列表，把页面看崩了。
 *
 * 现在的规则：[DLC][扩展][X] 必须真有地理字段才算地点，
 * 没有的连分组都不建。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { loadCard } from './card.mjs';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('  OK   ' + name); }
  else { fail += 1; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
}

/* 载入模块 */
const src = fs.readFileSync('D:/223/fief-ledger/modules/worldbook.js', 'utf8');
const sb = { console, setTimeout, clearTimeout };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(src, sb, { filename: 'worldbook.js' });
const FIEF = sb.window.__fiefBook;

const CARD = loadCard();
const all = Object.values(CARD.data.character_book.entries);
const tree = FIEF.buildFactionTree(all);
const names = Object.keys(tree);

console.log('=== 1. 解析 [DLC][扩展] ===');
{
  const r = FIEF.splitFactionTag('[DLC][扩展][边陲之国]外围村落-白教区');
  ok('能拆开', !!r);
  ok('分组名是扩展名', r && r.faction === '边陲之国', r && r.faction);
  ok('标记 isExt', r && r.isExt === true);
  ok('名字取到', r && r.name === '外围村落-白教区', r && r.name);
}

console.log('\n=== 2. 不该收的分类 ===');
{
  ok('[DLC][角色] 不收', !FIEF.splitFactionTag('[DLC][角色][丝特拉]丝特拉(x)'));
  ok('[DLC][事件] 不收', !FIEF.splitFactionTag('[DLC][事件][冰之歌]冰之歌(x)'));
  ok('[DLC][扩展][种族-X] 不收', !FIEF.splitFactionTag('[DLC][扩展][种族-山妖]山妖(x)'));
  ok('mvu_update 不收', !FIEF.splitFactionTag('[DLC][扩展][边陲之国][mvu_update]莉莉变量更新规则'));
  ok('[本体][势力] 照常收', !!FIEF.splitFactionTag('[本体][势力][奥古斯提姆帝国]索莱尔省'));
  ok('[本体][种族] 不收', !FIEF.splitFactionTag('[本体][种族]精灵'));
}

console.log('\n=== 3. 边陲之国进来了 ===');
{
  const f = tree['边陲之国'];
  ok('分组存在', !!f);
  ok('有地点', f && f.places.length > 0, f && f.places.length);
  const nm = (f ? f.places : []).map((p) => p.name);
  ok('含 白教区', nm.some((x) => x.indexOf('白教区') >= 0), nm.join(','));
  ok('含 王国都城', nm.some((x) => x.indexOf('王国都城') >= 0));
}

console.log('\n=== 4. 非地理条目一个都不许进 ===');
{
  const BAD = ['种族-山妖', '男娘扮演功能', '命运抽卡', '假小子扮演功能',
    '汐海妖精', '迷宫经济生态与冒险产业', '种族-奶龙', '种族-诗灵'];
  for (const b of BAD) ok('没有 ' + b, !tree[b]);
}

console.log('\n=== 5. 空壳分组被剔掉 ===');
{
  let empty = 0;
  for (const n of names) {
    if (!tree[n].places.length && !tree[n].overview.length) empty += 1;
  }
  ok('没有 0地点0总述 的分组', empty === 0, empty);
  ok('分组数在合理范围', names.length >= 10 && names.length <= 16, names.length);
}

console.log('\n=== 6. 本体势力不受影响 ===');
{
  const BASE = {
    诺斯加德联盟: 62, 奥古斯提姆帝国: 30, 兽族联盟: 30, 翼民圣国梵尼亚: 24,
    精灵王庭: 18, 瓦伦蒂亚: 18, 伯伦斯法环: 10, 索伦蒂斯王国: 9, 萨赫拉联邦: 6,
  };
  for (const k of Object.keys(BASE)) {
    const f = tree[k];
    ok(k + ' 地点数 ' + BASE[k], !!f && f.places.length === BASE[k], f ? f.places.length : 'missing');
  }
}

console.log('\n=== 7. 扩展地点必须有地理字段 ===');
{
  const GEO = /(?:^|[\n|｜>])\s*(位置|地点|环境|地理|地形|地貌|气候|生态|行政区划|区域划分|标识)\s*[:：]/;
  /* 只看扩展分组：[DLC][扩展] 进来的那些。
     本体势力（诺斯加德联盟等）靠 tag 层级和行省认亲，很多城区条目
     本来就不单写「位置:」，那是 0.9.49 既有行为，不在这里约束。 */
  const extNames = [];
  for (const e of all) {
    const sp = FIEF.splitFactionTag(e.comment);
    if (sp && sp.isExt) extNames.push(sp.faction);
  }
  const uniq = [...new Set(extNames)];
  ok('有扩展分组', uniq.length > 0, uniq.join(','));

  let noGeo = 0;
  const leak = [];
  for (const n of uniq) {
    if (!tree[n]) continue;
    for (const p of tree[n].places) {
      if (!GEO.test(String(p.content || ''))) { noGeo += 1; leak.push(n + '/' + p.name); }
    }
  }
  ok('扩展地点都带地理字段', noGeo === 0, leak.join(','));

  const f = tree['边陲之国'];
  ok('边陲之国 地点 >= 8', !!f && f.places.length >= 8, f && f.places.length);
}

console.log('\n' + (fail ? fail + ' 项失败  ' : '全部通过 ✔  ') + (pass + fail) + ' 项');
process.exit(fail ? 1 : 0);
