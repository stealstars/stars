/**
 * 手动修正：读错了能自己改，而且改了名之后还认得出是这一条。
 *
 * 语义：
 *   · 只覆盖面板显示，不动世界书、不动聊天变量
 *   · 索引键是「领地名::条目原名」，所以改名不会把修正弄丢
 *   · 字段留空表示不改
 *   · 撤销 = 删掉那条记录，回到读到的原样
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = fs.readFileSync(path.join(ROOT, 'modules/core.js'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (n, c, e) => {
  if (c) pass += 1;
  else { fail += 1; console.log('  [!!] ' + n + (e !== undefined ? '  -> ' + e : '')); }
};

function cut(mark) {
  const at = CORE.indexOf(mark);
  if (at < 0) throw new Error('找不到 ' + mark);
  let i = CORE.indexOf('{', at);
  let depth = 0;
  for (; i < CORE.length; i += 1) {
    if (CORE[i] === '{') depth += 1;
    else if (CORE[i] === '}') { depth -= 1; if (depth === 0) return CORE.slice(at, i + 1); }
  }
  throw new Error('括号没配平：' + mark);
}

/* 把 applyFixes 抠出来，配一个内存里的 fixes */
const F = new Function(
  'let fixes = {};\n'
  + 'function loadFixes() { return fixes; }\n'
  + cut('  function applyFixes(d) {')
  + '\n; return { applyFixes, set(o) { fixes = o; }, get() { return fixes; } };',
)();

const mk = () => ({
  domains: [{
    name: '灰谷',
    items: [
      { name: 'a军团', category: '军事', quantity: '8000', status: '驻防' },
      { name: '金穗粮仓', category: '资源点', quantity: '10', status: '正常' },
    ],
  }],
});

console.log('=== 1. 没有修正时原样不动 ===');
{
  F.set({});
  const d = mk();
  F.applyFixes(d);
  ok('名字没变', d.domains[0].items[0].name === 'a军团');
  ok('没打修正标记', !d.domains[0].items[0].fixed);
}

console.log('\n=== 2. 改名 ===');
{
  F.set({ '灰谷::a军团': { name: 'b军团' } });
  const d = mk();
  F.applyFixes(d);
  ok('名字改成了 b军团', d.domains[0].items[0].name === 'b军团', d.domains[0].items[0].name);
  ok('原名留下来了', d.domains[0].items[0].rawName === 'a军团', d.domains[0].items[0].rawName);
  ok('打上修正标记', d.domains[0].items[0].fixed === true);
  ok('别的条目没受影响', d.domains[0].items[1].name === '金穗粮仓');
}

console.log('\n=== 3. 改了名之后，修正还认得出来（用原名索引）===');
{
  F.set({ '灰谷::a军团': { name: 'b军团' } });
  const d = mk();
  F.applyFixes(d);
  /* 第二次扫描：源数据里还是 a军团 */
  const d2 = mk();
  F.applyFixes(d2);
  ok('第二次也改上了', d2.domains[0].items[0].name === 'b军团', d2.domains[0].items[0].name);
}

console.log('\n=== 4. 数量 / 类别 / 状态 ===');
{
  F.set({ '灰谷::a军团': { quantity: '5000', category: '军政', status: '残部' } });
  const d = mk();
  F.applyFixes(d);
  const it = d.domains[0].items[0];
  ok('数量改了', it.quantity === '5000', it.quantity);
  ok('类别改了', it.category === '军政', it.category);
  ok('状态改了', it.status === '残部', it.status);
  ok('名字没动', it.name === 'a军团');
}

console.log('\n=== 5. 空字段不算改 ===');
{
  F.set({ '灰谷::a军团': { name: '', quantity: '', category: '', status: '' } });
  const d = mk();
  F.applyFixes(d);
  const it = d.domains[0].items[0];
  ok('空名字不覆盖', it.name === 'a军团', it.name);
  ok('空数量不覆盖', it.quantity === '8000', it.quantity);
  ok('空类别不覆盖', it.category === '军事', it.category);
  ok('空状态不覆盖', it.status === '驻防', it.status);
}

console.log('\n=== 6. 撤销 ===');
{
  F.set({});
  const d = mk();
  F.applyFixes(d);
  ok('撤销后回到原样', d.domains[0].items[0].name === 'a军团' && !d.domains[0].items[0].fixed);
}

console.log('\n=== 7. 空数据不炸 ===');
{
  F.set({ '灰谷::a军团': { name: 'b' } });
  F.applyFixes({});
  F.applyFixes(null);
  ok('没有 domains 也不抛错', true);
}

console.log('\n=== 8. 源码里确实接上了 ===');
{
  ok('有 applyFixes 调用', /data = buildLedger\(\);\n\s*applyFixes\(data\);/.test(CORE));
  ok('抽屉里有修正区', /id="fl-fix-name"/.test(CORE) && /id="fl-fix-qty"/.test(CORE));
  ok('有保存和撤销按钮', /id="fl-fix-save"/.test(CORE) && /id="fl-fix-clear"/.test(CORE));
  ok('按聊天隔离', /FIX_KEY \+ ':' \+ currentChatId\(\)/.test(CORE));
  ok('批注框改成实底了', /\.fl-note \{[^}]*background: var\(--fl-bg2\)/.test(CORE));
}

console.log('\n' + (fail ? fail + ' 项失败  ' : '全部通过 ✔  ') + (pass + fail) + ' 项');
process.exit(fail ? 1 : 0);
