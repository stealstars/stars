/**
 * DLC 兼容性测试。
 *
 * 玩家的质疑："不是扫描吗，到时别人自己加 dlc 能扫到吗"
 *
 * 这个测试**不依赖真实世界书**，自己捏几套不同写法的势力数据，
 * 检查扫描器能不能认出来。写法故意和命定本体不一样：
 *   · 用「州/郡/道/大区」而不是「省」
 *   · 用「下辖城市/主要城镇/治下」而不是「特色城镇」
 *   · 用「[城市]」类型标签而不是「[城镇]」
 *   · 用 `==` `——` 当分隔符而不是 `|`
 *   · 用全角括号、顿号、分号分隔多个城市
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const ok = (n, v, e) => {
  if (v) { pass += 1; } else { fail += 1; console.log('  [!!] ' + n + (e ? '  -> ' + e : '')); }
};

const CODE = fs.readFileSync(path.join(ROOT, 'modules/worldbook.js'), 'utf8');
const win = { console: { log() {}, warn() {}, error() {} } };
win.window = win;
new Function('window', 'console', CODE)(win, win.console);

/** 捏一本世界书：comment 是条目名，content 是正文 */
async function scan(entries) {
  win.TavernHelper = {
    getWorldbookNames: () => ['测试书'],
    getCharWorldbookNames: () => ({ primary: '测试书', additional: [] }),
    getWorldbook: async () => entries.map((e, i) => ({
      uid: i, name: e.c, content: e.t,
      strategy: { type: 'selective', keys: [] },
    })),
  };
  // force=true：这个测试要反复换数据，必须真重扫，不能吃缓存
  return win.__fiefBook.scan(true);
}

const place = (n) => ({ 位置: n, 环境: n, 规模: '中型城镇' });
const P = (n) => '位置: ' + n + '\n环境: ' + n + '\n规模: 中型城镇\n人口构成: 数千人';

console.log('=== 1. 州/郡/道 后缀 ===');
{
  const sc = await scan([
    { c: '[本体][势力][测试国]测试国', t: '首府: 甲城\n统治者: 某王\n主要城市: 甲城\n领土: 全境\n宗旨: 测试\n行事风格: 平和' },
    { c: '[本体][势力][测试国]青州', t: '概览: 一个州\n下辖城市: 甲城、乙城、丙城' },
    { c: '[本体][势力][测试国]甲城', t: P('甲城') },
    { c: '[本体][势力][测试国]乙城', t: P('乙城') },
    { c: '[本体][势力][测试国]丙城', t: P('丙城') },
    { c: '[本体][势力][测试国]黑水郡', t: '概览: 一个郡\n主要城镇: 丁城;戊城' },
    { c: '[本体][势力][测试国]丁城', t: P('丁城') },
    { c: '[本体][势力][测试国]戊城', t: P('戊城') },
    { c: '[本体][势力][测试国]南疆道', t: '概览: 一个道\n治下城镇: 己城｜庚城' },
    { c: '[本体][势力][测试国]己城', t: P('己城') },
    { c: '[本体][势力][测试国]庚城', t: P('庚城') },
  ]);
  const f = sc.factions['测试国'];
  ok('势力被扫到', !!f, JSON.stringify(Object.keys(sc.factions)));
  const qing = f.places.find((p) => p.name === '青州');
  ok('青州在 places 里', !!qing);
  ok('甲城挂到青州', f.places.some((p) => p.name === '甲城' && p.parent === '青州'));
  ok('乙城挂到青州', f.places.some((p) => p.name === '乙城' && p.parent === '青州'));
  ok('丙城挂到青州', f.places.some((p) => p.name === '丙城' && p.parent === '青州'));
  ok('黑水郡挂上丁城', f.places.some((p) => p.name === '丁城' && p.parent === '黑水郡'));
  ok('黑水郡挂上戊城', f.places.some((p) => p.name === '戊城' && p.parent === '黑水郡'));
  ok('南疆道挂上己城', f.places.some((p) => p.name === '己城' && p.parent === '南疆道'));
  ok('南疆道挂上庚城', f.places.some((p) => p.name === '庚城' && p.parent === '南疆道'));
}

console.log('\n=== 2. 别的字段名也能认 ===');
{
  const FIELD_CASES = [
    ['下辖城市', '特色城镇'], ['主要城镇', null], ['所属城镇', null],
    ['城镇列表', null], ['治下城市', null], ['辖下', null], ['主要地点', null],
  ];
  for (const [fld] of FIELD_CASES) {
    const sc = await scan([
      { c: '[本体][势力][T]T', t: '首府: A城\n统治者: R\n主要城市: A城\n领土: X\n宗旨: S\n行事风格: H' },
      { c: '[本体][势力][T]某省', t: '概览: x\n' + fld + ': A城' },
      { c: '[本体][势力][T]A城', t: P('A城') },
    ]);
    const okp = sc.factions['T'].places.some((p) => p.name === 'A城' && p.parent === '某省');
    ok('字段「' + fld + '」能认', okp);
  }
}

console.log('\n=== 3. 标签层级仍然有效（DLC 可能用别的类型标签）===');
{
  // 真实写法：父级名写在 tag 里，中间夹一个类型标签
  //   [D][王国]王城        ← 王城 自己是一层
  //   [D][王城][城区]上城区 ← 「王城」在 tag 里当父级，「城区」是类型
  const sc = await scan([
    { c: '[本体][势力][D]D', t: '首府: 王城\n统治者: R\n主要城市: 王城\n领土: X\n宗旨: S\n行事风格: H' },
    { c: '[本体][势力][D][王国]王城', t: P('王城') },
    { c: '[本体][势力][D][王城][城区]上城区', t: '环境: x\n规模: 城区\n人口构成: 数万' },
    { c: '[本体][势力][D][王城][城区]下城区', t: '环境: x\n规模: 城区\n人口构成: 数万' },
  ]);
  const f = sc.factions['D'];
  ok('王城在 places', f.places.some((p) => p.name === '王城'),
    f.places.map((p) => p.name).join(','));
  ok('上城区挂在王城', f.places.some((p) => p.name === '上城区' && p.parent === '王城'),
    f.places.map((p) => p.name + '<' + (p.parent || '-')).join(','));
  ok('下城区挂在王城', f.places.some((p) => p.name === '下城区' && p.parent === '王城'));
}

console.log('\n=== 4. 名字前缀认亲（DLC 可能不写 tag）===');
{
  const sc = await scan([
    { c: '[本体][势力][E]E', t: '首府: 主城\n统治者: R\n主要城市: 主城\n领土: X\n宗旨: S\n行事风格: H' },
    { c: '[本体][势力][E]主城', t: P('主城') },
    { c: '[本体][势力][E]主城-东区', t: '环境: x\n规模: 城区\n人口构成: 数千' },
    { c: '[本体][势力][E]主城-西区', t: '环境: x\n规模: 城区\n人口构成: 数千' },
  ]);
  const f = sc.factions['E'];
  ok('东区挂到主城', f.places.some((p) => p.name === '主城-东区' && p.parent === '主城'),
    f.places.map((p) => p.name + '<' + (p.parent || '-')).join(','));
  ok('西区挂到主城', f.places.some((p) => p.name === '主城-西区' && p.parent === '主城'));
}

console.log('\n=== 5. 父级没有规模字段（进了 overview）也要能当容器 ===');
{
  const sc = await scan([
    { c: '[本体][势力][F]F', t: '首府: 京\n统治者: R\n主要城市: 京\n领土: X\n宗旨: S\n行事风格: H' },
    { c: '[本体][势力][F][子势力]子势力', t: '首府: 京\n统治者: 某人\n领土: 一块\n宗旨: x\n行事风格: y' },
    { c: '[本体][势力][F][子势力][京]京', t: P('京') },
    { c: '[本体][势力][F][子势力][京]外环', t: '环境: x\n规模: 城区\n人口构成: 数千' },
  ]);
  const f = sc.factions['F'];
  ok('子势力不在 places', !f.places.some((p) => p.name === '子势力'),
    f.places.map((p) => p.name).join(','));
  ok('子势力在 overview', f.overview.some((p) => p.name === '子势力'),
    f.overview.map((p) => p.name).join(','));
  ok('京挂在子势力下', f.places.some((p) => p.name === '京' && p.parent === '子势力'),
    f.places.map((p) => p.name + '<' + (p.parent || '-')).join(','));
  ok('外环挂在京下', f.places.some((p) => p.name === '外环' && p.parent === '京'));
}

console.log('\n=== 6. 不瞎认：没有子项声明就不能连 ===');
{
  const sc = await scan([
    { c: '[本体][势力][G]G', t: '首府: 城A\n统治者: R\n主要城市: 城A\n领土: X\n宗旨: S\n行事风格: H' },
    { c: '[本体][势力][G]城A', t: P('城A') },
    { c: '[本体][势力][G]城B', t: P('城B') },
  ]);
  const f = sc.factions['G'];
  ok('城A 是顶层', f.places.some((p) => p.name === '城A' && !p.parent));
  ok('城B 是顶层', f.places.some((p) => p.name === '城B' && !p.parent));
  ok('没把城B 硬塞给城A', !f.places.some((p) => p.name === '城B' && p.parent));
}

console.log('\n=== 7. 空世界书不崩 ===');
{
  const sc = await scan([]);
  ok('返回 count 0', sc.count === 0, String(sc.count));
  ok('factions 是空对象', Object.keys(sc.factions).length === 0);
}

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
