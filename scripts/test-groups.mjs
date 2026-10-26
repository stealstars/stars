/**
 * 外交页地点树：真实数据下渲染出来是什么样
 *
 * 玩家的问题：「十个国家点进去直接就是城市了，没有大国啊」
 * 期望：势力 → 子势力/大区 → 城市 → 城区 → 建筑
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
let fail = 0;
const ok = (n, c, e) => {
  if (c) pass += 1;
  else { fail += 1; console.log('  [!!] ' + n + (e ? '  -> ' + e : '')); }
};

// 1. worldbook 层
const win = { console };
win.window = win;
new Function('window', fs.readFileSync(path.join(ROOT, 'modules/worldbook.js'), 'utf8'))(win);
const B = win.__fiefBook;

const CARD = process.env.FIEF_CARD || path.resolve(ROOT, '..', '命定之诗与黄昏之歌v4.31.json');
if (!fs.existsSync(CARD)) { console.log('跳过：没有卡片'); process.exit(0); }
const card = JSON.parse(fs.readFileSync(CARD, 'utf8'));
const raw = card.data.character_book.entries || [];
const entries = raw.map((e) => ({
  uid: e.id, name: e.comment, content: e.content,
  strategy: { type: e.constant ? 'constant' : 'selective', keys: e.key || e.keys || [] },
}));
const tree = B.buildFactionTree(B.normalize(entries));

console.log('=== 1. 每个势力都有 groups 字段 ===');
for (const k of Object.keys(tree)) {
  ok(k + ' 有 groups', Array.isArray(tree[k].groups), typeof tree[k].groups);
}

console.log('\n=== 2. 声明过的主要城市被抽出来了 ===');
const EXPECT = {
  索伦蒂斯王国: ['潮汐王座', '珍珠湾', '风暴堡', '银帆城', '赛瑞利亚'],
  奥古斯提姆帝国: ['艾瑟嘉德', '铁炉堡', '金谷城', '时钟塔城'],
  萨赫拉联邦: ['阿兹哈尔', '阿勒穆特', '拜特·纳尔', '达尔·苏克', '巴哈尔港'],
  兽族联盟: ['巡天王庭', '风信子城', '龙渊京'],
};
for (const f of Object.keys(EXPECT)) {
  const d = tree[f].declared || [];
  for (const nm of EXPECT[f]) {
    ok(f + ' 声明了「' + nm + '」', d.indexOf(nm) >= 0, '声明列表: ' + d.join('/'));
  }
}

console.log('\n=== 3. 诺斯加德的疆域大区 ===');
{
  const d = tree['诺斯加德联盟'].declared || [];
  console.log('  ' + d.join(' / '));
  ok('抽到了雾凇海岸', d.indexOf('雾凇海岸') >= 0);
  ok('抽到了风切半岛（无尾逗号）', d.indexOf('风切半岛') >= 0, d.join('/'));
  ok('没有带逗号的脏名字', d.every((x) => !/[，,、]$/.test(x)), d.join('/'));
}

console.log('\n=== 4. 虚拟节点（原文无条目但被声明） ===');
{
  const gs = tree['兽族联盟'].groups || [];
  const empties = gs.filter((g) => g.kind === 'declared-empty').map((g) => g.name);
  console.log('  兽族联盟的 declared-empty: ' + empties.join(' / '));
  ok('巡天王庭被标为原文无条目', empties.indexOf('巡天王庭') >= 0, empties.join('/'));
}

console.log('\n=== 5. 有实体条目的城市是 node 而不是虚拟 ===');
{
  const gs = tree['兽族联盟'].groups || [];
  const nodes = gs.filter((g) => g.kind === 'node').map((g) => g.name);
  console.log('  兽族联盟的 node: ' + nodes.join(' / '));
  ok('风信子城是实体节点', nodes.indexOf('风信子城') >= 0, nodes.join('/'));
}

console.log('\n=== 6. 类型标签没被当成城市 ===');
for (const k of Object.keys(tree)) {
  const gs = tree[k].groups || [];
  const bad = gs.filter((g) => /^(地块|城镇|城市|村庄|势力|本体)$/.test(g.name));
  ok(k + ' 没有类型标签冒充城市', bad.length === 0, bad.map((x) => x.name).join('/'));
}

console.log('\n=== 7. 用真实 worldbook 数据渲染整棵树 ===');
{
  // 把 diplo.ui 里 placeTree 的逻辑单独跑一遍（它不依赖 DOM，但要连带 duchyTree）
  const src = fs.readFileSync(path.join(ROOT, 'modules/diplo.ui.js'), 'utf8');
  const m1 = src.match(/function duchyTree[\s\S]*?\n  \}\n/);
  const m2 = src.match(/function placeTree[\s\S]*?\n  \}\n/);
  ok('能抽出 placeTree', !!m2);
  if (m1 && m2) {
    const fn = new Function('esc', m1[0] + m2[0] + '; return placeTree;')(
      (s) => String(s == null ? '' : s));
    const f = tree['兽族联盟'];
    const flat = fn(f);
    console.log('  兽族联盟展开 ' + flat.length + ' 行:');
    for (const r of flat.slice(0, 30)) {
      const tag = r.node.ghost ? (r.node.empty ? '(无条目)' : '(虚拟)') : '';
      console.log('    ' + '  '.repeat(r.depth) + (r.depth ? '└ ' : '') + r.node.name + ' ' + tag);
    }
    ok('出现了虚拟节点', flat.some((r) => r.node.ghost));
    ok('风信子城是根', flat.some((r) => r.node.name === '风信子城' && r.depth === 0));
    ok('枢机厅有缩进', flat.some((r) => r.node.name === '枢机厅' && r.depth >= 2),
      'depth=' + (flat.find((r) => r.node.name === '枢机厅') || {}).depth);
  }
}

console.log('\n=== 7. 公国层：中层是政治实体而不是城市 ===');
{
  const duchies = tree['诺斯加德联盟'].duchies || [];
  console.log('  诺斯加德联盟 ' + duchies.length + ' 个公国:');
  for (const d of duchies) {
    console.log('    ' + d.name + ' | 首府 ' + d.capital + ' | 核心 ' + d.core
      + (d.enclaves.length ? ' | 飞地 ' + d.enclaves.join('、') : ''));
  }
  ok('抽到 6 个公国', duchies.length === 6, String(duchies.length));

  const byName = {};
  for (const d of duchies) byName[d.name] = d;
  const CASES = [
    ['埃吉尔海德公国', '凛风渡', '雾凇海岸'],
    ['斯卡尔公国', '龙吼堡垒', '风切半岛'],
    ['维斯格拉德公国', '挽歌堡', '长夜之境'],
    ['诺德海姆公国', '琥珀加德', '鎏金沃土'],
    ['乌尔芬公国', '林歌城', '霜叶之森'],
    ['联盟直辖区', '白曜城', '云息盆地'],
  ];
  for (const [dn, cap, core] of CASES) {
    const d = byName[dn];
    ok(dn + ' 首府是' + cap, d && d.capital === cap, d ? d.capital : '不存在');
    ok(dn + ' 核心领土是' + core, d && d.core === core, d ? d.core : '不存在');
  }
  // 「风切半岛全境，不含霜镜港与白港」不该整句留着
  ok('核心领土没有「不含」尾巴', byName['斯卡尔公国'].core === '风切半岛',
    byName['斯卡尔公国'].core);
  ok('埃吉尔海德的飞地含霜镜港', byName['埃吉尔海德公国'].enclaves.indexOf('霜镜港') >= 0,
    byName['埃吉尔海德公国'].enclaves.join('/'));
  ok('埃吉尔海德的飞地含白港', byName['埃吉尔海德公国'].enclaves.indexOf('白港') >= 0,
    byName['埃吉尔海德公国'].enclaves.join('/'));

  // 大区被标成 region
  const regions = tree['诺斯加德联盟'].places.filter((p) => p.region).map((p) => p.name);
  console.log('  被标为疆域: ' + regions.join('、'));
  ok('雾凇海岸标为疆域', regions.indexOf('雾凇海岸') >= 0, regions.join('/'));
  ok('至少 5 个疆域', regions.length >= 5, String(regions.length));

  // 首府被标成 capital
  const caps = tree['诺斯加德联盟'].places.filter((p) => p.capital).map((p) => p.name);
  ok('凛风渡标为首府', caps.indexOf('凛风渡') >= 0, caps.join('/'));
}

console.log('\n=== 8. 有公国的势力，渲染出来是三层 ===');
{
  const src2 = fs.readFileSync(path.join(ROOT, 'modules/diplo.ui.js'), 'utf8');
  const g1 = src2.match(/function duchyTree[\s\S]*?\n  \}\n/);
  const g2 = src2.match(/function placeTree[\s\S]*?\n  \}\n/);
  ok('能抽出 duchyTree', !!g1);
  ok('能抽出 placeTree', !!g2);
  if (g1 && g2) {
    const fn = new Function('esc', g1[0] + g2[0] + '; return placeTree;')(
      (s) => String(s == null ? '' : s));
    const f = tree['诺斯加德联盟'];
    const flat = fn(f);
    console.log('  68 → ' + flat.length + ' 行，前 20 行:');
    for (const r of flat.slice(0, 20)) {
      const tag = r.node.duchyNode ? '【公国】'
        : r.node.region ? '〔疆域〕' : r.node.capital ? '〔首府〕' : '';
      console.log('    ' + '  '.repeat(r.depth) + (r.depth ? '└ ' : '') + r.node.name + ' ' + tag);
    }
    const dn3 = flat.filter((r) => r.node.duchyNode);
    ok('顶层有公国节点', dn3.length === 6, String(dn3.length));
    ok('公国下面挂城市', flat.some((r) => r.depth === 1), '没有第二层');
    ok('城市下面挂城区', flat.some((r) => r.depth === 2), '没有第三层');
    // 联盟直辖区同时是公国和地点，不该出现两次
    const lz = flat.filter((r) => r.node.name === '联盟直辖区');
    ok('联盟直辖区只出现一次', lz.length === 1, String(lz.length));
    // 不同城市下的同名「下城区」都要留
    const xc = flat.filter((r) => r.node.name === '下城区');
    ok('两个下城区都保留', xc.length === 2, String(xc.length));
  }
}

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
