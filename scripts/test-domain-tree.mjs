/**
 * 属地树测试：认领地 / 认归属 / 排层级。
 *
 * 起因：国家或位面开局时，领地难以判断是不是自己的——
 *   ① 只认 `类型:领地`，`类型:王国` 直接不显示
 *   ② `[拥有者:]` 只当小标签，不参与判断
 *   ③ `[上级资产:]` 能解析但没人用，几十块领地全平铺
 *   ④ 附属领地写在上级内部资产里，被当成一座建筑
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = fs.readFileSync(path.join(ROOT, 'modules/core.js'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass += 1; return; }
  fail += 1;
  console.log('  [!!] ' + name + '  ->  ' + (got === undefined ? '' : String(got).slice(0, 160)));
};

function cut(mark) {
  const at = CORE.indexOf(mark);
  if (at < 0) throw new Error('找不到 ' + mark);
  let i = CORE.indexOf('{', at);
  let depth = 0;
  for (; i < CORE.length; i += 1) {
    if (CORE[i] === '{') depth += 1;
    else if (CORE[i] === '}') { depth -= 1; if (depth === 0) return CORE.slice(at, i + 1) + ';'; }
  }
  throw new Error('括号没配平：' + mark);
}

const SRC = [
  cut('  function tagsText(v)'),
  cut('  function parseTags(str)'),
  cut('  function normalizeInner(raw)'),
  cut('  function isDomainAsset(asset)'),
  cut('  function nestedDomainsOf(asset)'),
  cut('  function isContainerAsset(asset)'),
  cut('  function myNames(stat)'),
  cut('  function ownershipOf(asset, names)'),
  cut('  function authorityMapOf(stat)'),
  cut('  function collectDomains(stat)'),
  cut('  function relationOf(d)'),
  cut('  function orderDomains(list)'),
].join('\n');

/* prefs / getCtx 是运行时的东西，这里给可控的替身 */
const P = new Function('getCtx', 'prefs', SRC + '\n; return { isDomainAsset, isContainerAsset, ownershipOf,'
  + ' myNames, collectDomains, relationOf, orderDomains, nestedDomainsOf, authorityMapOf };');

const make = (opts = {}) => {
  const prefs = { myNames: opts.myNames || '' };
  const ctx = opts.name1 === undefined ? { name1: '千星' } : (opts.name1 === null ? null : { name1: opts.name1 });
  return P(() => ctx, prefs);
};

const M = make();

/* ---------------- 1. 认领地 ---------------- */
console.log('=== 1. 什么算领地 ===');
{
  ok('类型:领地', M.isDomainAsset({ 类型: '领地' }));
  ok('类型:领地(前缀也算)', M.isDomainAsset({ 类型: '领地·行省' }));
  ok('类型:王国 + 领地规模标签', M.isDomainAsset({ 类型: '王国', 标签: ['领地规模:大国'] }));
  ok('类型:位面 + 领地规模标签', M.isDomainAsset({ 类型: '位面', 标签: ['领地规模:小国或帝国行省'] }));
  ok('只有 [规模:] 不算（世界书没这个标签）', !M.isDomainAsset({ 标签: ['规模:中型城镇'] }));
  ok('建筑写了「规模」也不变成领地', !M.isDomainAsset({ 类型: '经济', 标签: ['规模:小型', '类型:经济'] }));
  ok('普通建筑不算', !M.isDomainAsset({ 类型: '经济', 标签: ['类型:经济'] }));
  ok('资源点不算', !M.isDomainAsset({ 类型: '资源点', 标签: ['类型:资源点'] }));
  ok('空值不炸', !M.isDomainAsset(null) && !M.isDomainAsset(undefined));
}

/* ---------------- 2. 容器 ---------------- */
console.log('\n=== 2. 国家/位面是容器 ===');
{
  const plane = { 类型: '位面', 内部资产: { 白鸦领: { 类型: '领地', 标签: ['领地规模:中型城镇'] } } };
  ok('位面装着领地 → 容器', M.isContainerAsset(plane));
  ok('容器自己不算领地', !M.isDomainAsset(plane));
  ok('容器里有 1 块领地', M.nestedDomainsOf(plane).length === 1, M.nestedDomainsOf(plane).length);

  const plain = { 类型: '领地', 内部资产: { 铁匠铺: { 类型: '经济' } } };
  ok('领地本身不是容器', !M.isContainerAsset(plain));
  ok('只有建筑的不是容器', !M.isContainerAsset({ 类型: '王国', 内部资产: { 谷仓: { 类型: '民生' } } }));
}

/* ---------------- 3. 归属 ---------------- */
console.log('\n=== 3. 归属判定 ===');
{
  ok('拥有者含我的名 → mine', M.ownershipOf({ 标签: ['拥有者:千星'] }, ['千星']) === 'mine');
  ok('联姻共管也算我的', M.ownershipOf({ 标签: ['拥有者:千星、音凛·星月'] }, ['千星']) === 'mine');
  ok('别人 → other', M.ownershipOf({ 标签: ['拥有者:灰岩侯'] }, ['千星']) === 'other');
  ok('没写拥有者 → unmarked', M.ownershipOf({ 标签: ['领地规模:村庄'] }, ['千星']) === 'unmarked');
  ok('没有名号可比 → unmarked', M.ownershipOf({ 标签: ['拥有者:灰岩侯'] }, []) === 'unmarked');

  const A = make({ myNames: '音凛', name1: '千星' });
  ok('手填的名号也算', A.ownershipOf({ 标签: ['拥有者:音凛·星月'] }, A.myNames({})) === 'mine');
  ok('名号去重后两个', A.myNames({}).length === 2, JSON.stringify(A.myNames({})));

  const B = make({ name1: null });
  ok('读不到人设名时为空', B.myNames({}).length === 0, JSON.stringify(B.myNames({})));
  const C = make({ name1: null });
  ok('存档里的身份也能用', C.myNames({ 主角: { 身份: '白鹭浅滩男爵' } }).indexOf('白鹭浅滩男爵') >= 0);
}

/* ---------------- 4. 关系 ---------------- */
console.log('\n=== 4. 关系归类 ===');
{
  ok('没上级 → 直辖', M.relationOf({ own: 'mine', parentName: '' }) === '直辖');
  ok('有上级 → 下级', M.relationOf({ own: 'mine', parentName: '白鸦领' }) === '下级');
  ok('写在内部资产里 → 附属', M.relationOf({ own: 'mine', nested: true, parentName: '白鸦领' }) === '附属');
  ok('别人的 + 授封协议 → 授封', M.relationOf({ own: 'other', parentName: '白鸦领', proto: '授封' }) === '授封');
  ok('别人的 + 有上级 → 授封', M.relationOf({ own: 'other', parentName: '白鸦领', proto: '' }) === '授封');
  ok('别人的 + 没上级 → 外来', M.relationOf({ own: 'other', parentName: '', proto: '' }) === '外来');
  ok('容器单独一类', M.relationOf({ container: true }) === '容器');
}

/* ---------------- 4b. 代管：地是别人的，治权是我的 ---------------- */
console.log('\n=== 4b. 代管（省督/总督/督办）===');
{
  /* 世界书的凭证写法：领地名 规模档: 所属势力|治权来源|取得日期|当前状态 */
  const cert = { 类型: '凭证', 效果: { 凭证: '白鸦领 大型城市: 奥古斯提姆帝国|中央任命|2026-03-01|在任' } };
  const stat = {
    主角: {
      资产: {
        白鸦领: {
          类型: '领地',
          标签: ['拥有者:奥古斯提姆帝国', '领地规模:大型城市', '所属势力:奥古斯提姆帝国'],
          内部资产: { 治权凭证: cert },
        },
      },
    },
  };
  const got = M.collectDomains(stat);
  ok('凭证认出来了', !!got[0].auth, JSON.stringify(got[0].auth));
  ok('领地名从凭证里抠对', !!got[0].auth && got[0].auth.来源 === '中央任命', got[0].auth && got[0].auth.来源);
  ok('势力也对', !!got[0].auth && got[0].auth.势力 === '奥古斯提姆帝国', got[0].auth && got[0].auth.势力);
  ok('拥有者不是我 → 但判代管', got[0].own === 'governed', got[0].own);
  ok('关系是代管', M.relationOf(got[0]) === '代管', M.relationOf(got[0]));

  /* 授封方向相反：地是我的、封臣在管。就算描述里写着效忠我，也不能判成代管 */
  const fief = {
    主角: {
      资产: {
        封臣领: {
          类型: '领地',
          标签: ['拥有者:灰岩侯', '领地规模:中型城镇', '协议类型:授封', '上级资产:白鸦领'],
          描述: '封臣义务:岁贡与征召。效忠对象:千星。',
          内部资产: { 治权凭证: { 类型: '凭证', 效果: { 凭证: '封臣领 中型城镇: 千星家族|受封|2026-04-01|在任' } } },
        },
        白鸦领: { 类型: '领地', 标签: ['拥有者:千星', '领地规模:大型城市'] },
      },
    },
  };
  const gf = M.collectDomains(fief);
  const byName2 = {};
  for (const d of gf) byName2[d.name] = d;
  ok('授封不被凭证抢成代管', byName2['封臣领'].own === 'other', byName2['封臣领'].own);
  ok('授封关系还是授封', M.relationOf(byName2['封臣领']) === '授封', M.relationOf(byName2['封臣领']));

  /* 没凭证的别人领地，仍然是外来 */
  const noCert = M.collectDomains({ 主角: { 资产: { 灰岩镇: { 类型: '领地', 标签: ['拥有者:灰岩侯', '领地规模:中型城镇'] } } } });
  ok('没凭证 → 外来', noCert[0].own === 'other' && M.relationOf(noCert[0]) === '外来', noCert[0].own);

  /* 凭证是一级资产也要认 */
  const topCert = M.collectDomains({
    主角: {
      资产: {
        白鸦领: { 类型: '领地', 标签: ['拥有者:奥古斯提姆帝国', '领地规模:大型城市'] },
        治权凭证: { 类型: '凭证', 效果: { 凭证: '白鸦领 大型城市: 奥古斯提姆帝国|世袭|2026-01-01|在任' } },
      },
    },
  });
  const c1 = topCert.find((d) => d.name === '白鸦领');
  ok('一级资产里的凭证也认', c1 && c1.own === 'governed', c1 && c1.own);
  ok('凭证自己不当领地', topCert.length === 1, topCert.map((d) => d.name).join(','));
}

/* ---------------- 5. 排序与层级 ---------------- */
console.log('\n=== 5. 排成树 ===');
{
  const list = [
    { name: '哨所', parentName: '白鸦领', own: 'mine', relation: '下级', tier: { n: 2 } },
    { name: '白鸦领', parentName: '', own: 'mine', relation: '直辖', tier: { n: 4 } },
    { name: '灰岩镇', parentName: '', own: 'other', relation: '外来', tier: { n: 3 } },
    { name: '封臣领', parentName: '白鸦领', own: 'other', relation: '授封', proto: '授封', tier: { n: 3 } },
  ];
  const o = M.orderDomains(list);
  ok('父在前子在后', o[0].name === '白鸦领' && o[1].parentName === '白鸦领', o.map((x) => x.name).join(','));
  ok('直辖排最前', o[0].name === '白鸦领');
  ok('上级 depth=0', o[0].depth === 0, o[0].depth);
  ok('下级 depth=1', o.filter((x) => x.parentName === '白鸦领').every((x) => x.depth === 1));
  ok('外来排最后', o[o.length - 1].name === '灰岩镇', o[o.length - 1].name);
  ok('一个不少', o.length === 4, o.length);

  /* 环：A 上级是 B，B 上级是 A —— 不能死循环，也不能丢 */
  const cyc = [
    { name: 'A', parentName: 'B', own: 'mine', relation: '下级' },
    { name: 'B', parentName: 'A', own: 'mine', relation: '下级' },
  ];
  const oc = M.orderDomains(cyc);
  ok('环不死循环且都留着', oc.length === 2, oc.length);
}

/* ---------------- 5b. 归属只看自己，绝不按层级继承 ---------------- */
console.log('\n=== 5b. 归属不继承（每块地自己说了算）===');
{
  const stat = {
    主角: {
      资产: {
        西境行省: { 类型: '领地', 标签: ['拥有者:千星', '领地规模:小国或帝国行省'] },
        白鸦郡: { 类型: '领地', 标签: ['拥有者:千星', '领地规模:大型城市', '上级资产:西境行省'] },
        灰岩县: { 类型: '领地', 标签: ['拥有者:灰岩侯', '领地规模:中型城镇', '上级资产:白鸦郡', '协议类型:授封'] },
        黑石村: { 类型: '领地', 标签: ['拥有者:黑石长老', '领地规模:村庄', '上级资产:灰岩县'] },
        /* 帝国在我行省里塞的飞地：上级是我的，产权是帝国的 */
        御苑飞地: { 类型: '领地', 标签: ['拥有者:奥古斯提姆帝国', '领地规模:中型城镇', '上级资产:西境行省'] },
        东境行省: { 类型: '领地', 标签: ['拥有者:别家公爵', '领地规模:小国或帝国行省'] },
      },
    },
  };
  const tree = M.orderDomains(M.collectDomains(stat));
  for (const d of tree) if (!d.relation) d.relation = M.relationOf(d);
  const by = {};
  for (const d of tree) by[d.name] = d;

  ok('行省是我的', by['西境行省'].own === 'mine');
  ok('郡是我的', by['白鸦郡'].own === 'mine');
  ok('封臣的县是别人的', by['灰岩县'].own === 'other', by['灰岩县'].own);
  ok('孙辈的村也是别人的', by['黑石村'].own === 'other', by['黑石村'].own);
  ok('飞地不因上级是我的就被吞', by['御苑飞地'].own === 'other', by['御苑飞地'].own);
  ok('飞地不是直辖', by['御苑飞地'].relation !== '直辖', by['御苑飞地'].relation);
  ok('封臣县标授封', by['灰岩县'].relation === '授封', by['灰岩县'].relation);
  ok('层级照样排对：行省→郡→县→村', by['黑石村'].depth === 3, by['黑石村'].depth);
  ok('不再有 jurisdiction 字段', by['灰岩县'].jurisdiction === undefined, by['灰岩县'].jurisdiction);
  ok('源码里没有 markJurisdiction', !/markJurisdiction/.test(CORE));
}

/* ---------------- 5b2. 收个比自己档位高的人当封臣 ----------------
   世界书原来写「授封(6档+)」，等于不到 6 档不许有封臣；玩家要的是
   低档也能收高档的人。脚本这边从来不看档位，这里把这条锁住。 */
console.log('\n=== 5b2. 封臣档位可以高于封君 ===');
{
  const stat = {
    主角: {
      资产: {
        白鹭浅滩男爵领: { 类型: '领地', 标签: ['拥有者:千星', '领地规模:村庄'] },
        高门城: {
          类型: '领地',
          标签: ['拥有者:某公爵', '领地规模:超级城市', '上级资产:白鹭浅滩男爵领', '协议类型:授封'],
        },
      },
    },
  };
  const tree = M.orderDomains(M.collectDomains(stat));
  for (const d of tree) if (!d.relation) d.relation = M.relationOf(d);
  const by = {};
  for (const d of tree) by[d.name] = d;

  ok('高档受封者照常读出来', !!by['高门城']);
  ok('关系是授封', by['高门城'].relation === '授封', by['高门城'].relation);
  ok('排在封君下面', by['高门城'].depth === 1, by['高门城'].depth);
  ok('产权归受封者', by['高门城'].own === 'other', by['高门城'].own);
  ok('封君没被挤掉', !!by['白鹭浅滩男爵领'] && by['白鹭浅滩男爵领'].relation === '直辖');

  /* 世界书那一条也得跟上，否则 AI 不会写出这种授封 */
  let bookText = '';
  try {
    const { loadExtBook } = await import('./ext-book.mjs');
    bookText = loadExtBook().entries.map((e) => String(e.content || '')).join('\n');
  } catch (e) { /* 没有世界书就跳过这两条 */ }
  if (bookText) {
    ok('世界书不再卡 6 档', !/授封\(6档\+\)/.test(bookText));
    ok('世界书写明受封者可高于封君', /受封者规模档可高于/.test(bookText));
  }
}

/* ---------------- 5c. 大国开局顶栏不许被下级淹掉 ---------------- */
console.log('\n=== 5c. 几十块领地时顶栏只放顶层 ===');
{
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const factory = new Function('domselEl', 'data', 'domIdx', 'closeDrawer', 'render', 'esc',
    cut('  function renderTop(d)') + '\n; return renderTop;');

  /* 1 个自己的行省 + 1 个别人的行省 + 38 个下级 */
  const domains = [
    { name: '西境行省', parentName: '', relation: '直辖', own: 'mine', jurisdiction: true },
    { name: '东境行省', parentName: '', relation: '外来', own: 'other', jurisdiction: false },
  ];
  domains.push({ name: '白鸦郡', parentName: '西境行省', relation: '下级', own: 'mine', jurisdiction: true });
  for (let i = 1; i <= 37; i += 1) {
    domains.push({
      name: '县' + i,
      parentName: i <= 3 ? '西境行省' : '白鸦郡',
      relation: '授封', own: 'other', jurisdiction: true,
    });
  }
  const data = { domains };
  const at = domains.findIndex((x) => x.name === '县20');
  const box = { innerHTML: '', querySelectorAll: () => [] };
  const renderTop = factory(box, data, at, () => {}, () => {}, esc);
  renderTop(domains[at]);
  const html = box.innerHTML;

  const chips = (html.match(/fl-domchip/g) || []).length;
  ok('40 块领地只出 2 个顶层 chip', chips === 2, chips);
  ok('当前这块在面包屑里', /fl-crumb/.test(html) && html.indexOf('县20') >= 0);
  ok('面包屑带上了上级', html.indexOf('西境行省') >= 0 && html.indexOf('白鸦郡') >= 0);
  ok('下级不单独占 chip', !/fl-domchip[^>]*>县/.test(html));

  /* 只有一块领地时顶栏空着，跟以前一样 */
  const one = { domains: [{ name: '白鹭浅滩男爵领', parentName: '', relation: '直辖', own: 'mine' }] };
  const box2 = { innerHTML: 'x', querySelectorAll: () => [] };
  factory(box2, one, 0, () => {}, () => {}, esc)(one.domains[0]);
  ok('单块领地不渲染顶栏', box2.innerHTML === '', box2.innerHTML);
}

/* ---------------- 5d. 只在区块里出现的地名不占顶栏 ---------------- */
console.log('\n=== 5d. 仅区块的领地 ===');
{
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const factory = new Function('domselEl', 'data', 'domIdx', 'closeDrawer', 'render', 'esc',
    cut('  function renderTop(d)') + '\n; return renderTop;');

  /* 资产里只有一块行省；区块里另外记过 3 个郡（变量里其实没有） */
  const domains = [
    { name: '西境行省', parentName: '', relation: '直辖', own: 'mine' },
    { name: '旧郡甲', parentName: '', relation: '仅区块', fromBlock: true },
    { name: '旧郡乙', parentName: '', relation: '仅区块', fromBlock: true },
    { name: '旧郡丙', parentName: '', relation: '仅区块', fromBlock: true },
  ];
  const data = { domains };
  const box = { innerHTML: '', querySelectorAll: () => [] };
  factory(box, data, 0, () => {}, () => {}, esc)(domains[0]);
  ok('仅区块的不进顶栏', (box.innerHTML.match(/fl-domchip/g) || []).length === 0, box.innerHTML);
  ok('真领地照常', box.innerHTML.indexOf('西境行省') >= 0 || box.innerHTML === '');

  /* 整份存档只有区块、没有资产：退回全列，别让面板空着 */
  const onlyBlocks = {
    domains: [
      { name: '旧郡甲', parentName: '', relation: '仅区块', fromBlock: true },
      { name: '旧郡乙', parentName: '', relation: '仅区块', fromBlock: true },
    ],
  };
  const box2 = { innerHTML: '', querySelectorAll: () => [] };
  factory(box2, onlyBlocks, 0, () => {}, () => {}, esc)(onlyBlocks.domains[0]);
  ok('只有区块时退回全列', (box2.innerHTML.match(/fl-domchip/g) || []).length === 2,
    (box2.innerHTML.match(/fl-domchip/g) || []).length);

  /* 关系归类 */
  ok('区块补出来的标「仅区块」', M.relationOf({ fromBlock: true, own: 'unmarked' }) === '仅区块');
  ok('资产里的不会被误标', M.relationOf({ own: 'mine', parentName: '' }) === '直辖');
}

/* ---------------- 6. collectDomains 全流程 ---------------- */
console.log('\n=== 6. 一次收全 ===');
{
  const stat = {
    主角: {
      资产: {
        白鸦领: {
          类型: '领地',
          标签: ['拥有者:千星', '领地规模:大型城市'],
          内部资产: {
            铁匠铺: { 类型: '经济', 标签: ['类型:经济'], 数量: 1 },
            白石哨所: { 类型: '领地', 标签: ['拥有者:千星', '领地规模:小型村镇', '上级资产:白鸦领'] },
          },
        },
        灰岩镇: { 类型: '领地', 标签: ['拥有者:灰岩侯', '领地规模:中型城镇'] },
        王座位面: {
          类型: '位面',
          内部资产: { 云上城: { 类型: '领地', 标签: ['拥有者:千星', '领地规模:超级城市'] } },
        },
      },
    },
  };
  const got = M.collectDomains(stat);
  const names = got.map((d) => d.name);
  ok('收到 5 个节点', got.length === 5, names.join(','));
  ok('容器进来了', names.indexOf('王座位面') >= 0, names.join(','));
  ok('附属领地进来了', names.indexOf('白石哨所') >= 0, names.join(','));
  ok('建筑没被当成领地', names.indexOf('铁匠铺') < 0, names.join(','));

  const byName = {};
  for (const d of got) byName[d.name] = d;
  ok('白鸦领是我的', byName['白鸦领'].own === 'mine', byName['白鸦领'].own);
  ok('灰岩镇是别人的', byName['灰岩镇'].own === 'other', byName['灰岩镇'].own);
  ok('哨所挂在白鸦领下', byName['白石哨所'].parentName === '白鸦领', byName['白石哨所'].parentName);
  ok('云上城挂在位面下', byName['云上城'].parentName === '王座位面', byName['云上城'].parentName);
  ok('位面是容器', byName['王座位面'].container === true);
}

/* ---------------- 7. 真实存档 ---------------- */
console.log('\n=== 7. 真实存档（白鹭浅滩男爵领）===');
{
  const fxPath = path.join(ROOT, 'scripts/fixtures/fief-real.json');
  if (!fs.existsSync(fxPath)) {
    console.log('  样本不在，跳过');
  } else {
    const fx = JSON.parse(fs.readFileSync(fxPath, 'utf8'));
    const stat = { 主角: { ...fx.主角 } };
    const got = M.collectDomains(stat);
    ok('认出一块领地', got.length === 1, got.map((d) => d.name).join(','));
    ok('联姻共管算自己的', got[0].own === 'mine', got[0].own + ' / ' + JSON.stringify(got[0].asset.标签));
    ok('关系是直辖', M.relationOf(got[0]) === '直辖');
  }
}

/* ---------------- 8. 源码接线 ---------------- */
console.log('\n=== 8. 接进渲染了吗 ===');
{
  ok('建筑列表滤掉领地', /\.filter\(\(\{ item \}\) => !isDomainAsset\(item\)\)/.test(CORE));
  ok('数据里带上层级字段', /parentName: d\.parentName \|\| ''/.test(CORE));
  ok('重读后锚回原来那块', /keepDomainFocus\(\)/.test(CORE));
  ok('顶栏只放顶层领地', /const realRoots = list\.filter\(\(x\) => !x\.parentName && x\.relation !== '仅区块'\)/.test(CORE));
  ok('有面包屑', /fl-crumb/.test(CORE));
  ok('属地行可点', /\.fl-subrow\[data-dom\]/.test(CORE));
  ok('总览有属地一节', /section\('属 地'/.test(CORE));
  ok('设置里有我的名号', /id="fl-myname"/.test(CORE));
  ok('名号存进偏好', /myNames: typeof p\.myNames === 'string'/.test(CORE));
}

console.log('\n' + (fail ? fail + ' 项失败  ' : '全部通过 ✔  ') + (pass + fail) + ' 项');
process.exit(fail ? 1 : 0);
