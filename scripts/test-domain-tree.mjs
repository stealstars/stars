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
  cut('  function markJurisdiction(tree)'),
].join('\n');

/* prefs / getCtx 是运行时的东西，这里给可控的替身 */
const P = new Function('getCtx', 'prefs', SRC + '\n; return { isDomainAsset, isContainerAsset, ownershipOf,'
  + ' myNames, collectDomains, relationOf, orderDomains, nestedDomainsOf, authorityMapOf, markJurisdiction };');

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
  ok('只有规模标签也认', M.isDomainAsset({ 标签: ['规模:中型城镇'] }));
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

/* ---------------- 5b. 辖区：按层级，不按拥有者 ---------------- */
console.log('\n=== 5b. 辖区（行省/大国视角）===');
{
  const stat = {
    主角: {
      资产: {
        西境行省: { 类型: '领地', 标签: ['拥有者:千星', '领地规模:小国或帝国行省'] },
        白鸦郡: { 类型: '领地', 标签: ['拥有者:千星', '领地规模:大型城市', '上级资产:西境行省'] },
        灰岩县: { 类型: '领地', 标签: ['拥有者:灰岩侯', '领地规模:中型城镇', '上级资产:白鸦郡', '协议类型:授封'] },
        黑石村: { 类型: '领地', 标签: ['拥有者:黑石长老', '领地规模:村庄', '上级资产:灰岩县'] },
        东境行省: { 类型: '领地', 标签: ['拥有者:别家公爵', '领地规模:小国或帝国行省'] },
      },
    },
  };
  const tree = M.orderDomains(M.collectDomains(stat));
  for (const d of tree) if (!d.relation) d.relation = M.relationOf(d);
  M.markJurisdiction(tree);
  const by = {};
  for (const d of tree) by[d.name] = d;

  ok('行省是我的', by['西境行省'].jurisdiction === true);
  ok('郡是我的', by['白鸦郡'].jurisdiction === true);
  ok('封臣的县也算我辖区', by['灰岩县'].jurisdiction === true, by['灰岩县'].jurisdiction);
  ok('孙辈的村也算', by['黑石村'].jurisdiction === true, by['黑石村'].jurisdiction);
  ok('别人的行省不算', by['东境行省'].jurisdiction === false, by['东境行省'].jurisdiction);
  ok('封臣县仍标授封', by['灰岩县'].relation === '授封', by['灰岩县'].relation);
  ok('层级排对：行省→郡→县→村', by['黑石村'].depth === 3, by['黑石村'].depth);
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
  ok('顶栏用 depth 缩进', /margin-left:\$\{depth \* 11\}px/.test(CORE));
  ok('总览有属地一节', /section\('属 地'/.test(CORE));
  ok('设置里有我的名号', /id="fl-myname"/.test(CORE));
  ok('名号存进偏好', /myNames: typeof p\.myNames === 'string'/.test(CORE));
}

console.log('\n' + (fail ? fail + ' 项失败  ' : '全部通过 ✔  ') + (pass + fail) + ' 项');
process.exit(fail ? 1 : 0);
