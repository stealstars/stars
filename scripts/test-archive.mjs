/**
 * 归档 / 真删
 *
 * 玩家要能清掉「只在档案里活着的旧设施和决议」，但这和快照有冲突：
 * 档案库是为了留历史，删了历史就断。
 *
 * 两级：
 *   归档  hidden=true，列表不显示，数据留着，快照照常读
 *   真删  只能对已归档的做；删完还要
 *          ① 清掉快照里的同名建筑
 *          ② 记住名字，挡住下一条消息把它带回来
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'modules/core.js'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (n, c, e) => {
  if (c) pass += 1;
  else { fail += 1; console.log('  [!!] ' + n + (e ? '  -> ' + e : '')); }
};

console.log('=== 1. 三个函数都在 ===');
for (const fn of ['hideItem', 'unhideItem', 'purgeItem', 'archivedItems', 'purgeFromSnapshot']) {
  ok('有 ' + fn, new RegExp('function ' + fn + '\\s*\\(').test(SRC));
}

console.log('\n=== 2. 真删必须先进归档（第二道确认）===');
ok('purgeItem 检查 hidden', /if \(!sd\.items\[name\]\.hidden\) return \{ ok: false, why: '先归档才能删' \}/.test(SRC));

console.log('\n=== 3. 归档只打标记，不删数据 ===');
{
  const body = (SRC.match(/function hideItem[\s\S]*?\n  \}/) || [''])[0];
  ok('设置了 hidden', /\.hidden = true/.test(body));
  ok('记录了 hiddenAt', /\.hiddenAt = Date\.now\(\)/.test(body));
  ok('没有 delete', !/delete\s+sd\.items/.test(body));
}

console.log('\n=== 4. 恢复会清掉标记 ===');
{
  const body = (SRC.match(/function unhideItem[\s\S]*?\n  \}/) || [''])[0];
  ok('delete hidden', /delete sd\.items\[name\]\.hidden/.test(body));
  ok('delete hiddenAt', /delete sd\.items\[name\]\.hiddenAt/.test(body));
}

console.log('\n=== 5. 真删会清快照 + 挡回流 ===');
{
  const body = (SRC.match(/function purgeItem[\s\S]*?\n  \}/) || [''])[0];
  ok('从 items 删掉', /delete sd\.items\[name\]/.test(body));
  ok('调用了 purgeFromSnapshot', /purgeFromSnapshot\(domain, name\)/.test(body));
  ok('记进了 deletedNames', /loadDeletedNames\(domain\)/.test(body));
  ok('写回了 deletedNames', /saveDeletedNames\(domain, set\)/.test(body));
}

console.log('\n=== 6. 归档的条目不进常规列表 ===');
ok('mergeStore 跳过 hidden', /if \(rec\.hidden\) continue;/.test(SRC));
ok('restoreFromStore 过滤 hidden',
  /\.filter\(\(bn\) => !sd\.items\[bn\]\.hidden\)/.test(SRC));

console.log('\n=== 7. 被真删的名字会挡住新消息回流 ===');
ok('mergeStore 读了 gone 集合', /const gone = loadDeletedNames\(d\.name\)/.test(SRC));
ok('遇到 gone 就跳过建档', /if \(gone\.has\(it\.name\)\)/.test(SRC));

console.log('\n=== 8. 界面 ===');
ok('有归档面板', /id="fl-pane-arch"/.test(SRC));
ok('有归档 tab', /data-pane="arch"/.test(SRC));
ok('showPane 会填充归档', /if \(cur === 'arch'\) fillArchPane\(\)/.test(SRC));
ok('有 fillArchPane', /function fillArchPane/.test(SRC));
ok('有真删二次确认', /purgePending !== key/.test(SRC));
ok('确认态文案是「确定删？」', /确定删？/.test(SRC));
ok('卡片有收起按钮', /data-hide-dom=/.test(SRC));
ok('收起不会打开抽屉', /if \(x\) \{[\s\S]{0,80}stopPropagation/.test(SRC));

console.log('\n=== 9. 只给档案条目标题显示收起按钮 ===');
{
  const body = (SRC.match(/function buildingCardHtml[\s\S]*?\n  \}/) || [''])[0];
  ok('有 canHide 判据', /const canHide = !!\(it\.missing \|\| it\.archived\)/.test(body));
  ok('用 canHide 控制按钮', /canHide \? `/.test(body));
}
ok('archived 标记在快照来源时设置',
  /if \(!it\.fromStore\) \{ it\.fromSnapshot = true; it\.archived = true; \}/.test(SRC));

console.log('\n=== 10. 导出了三个接口 ===');
ok('导出 hide', /hide: \(domain, name\) => hideItem/.test(SRC));
ok('导出 unhide', /unhide: \(domain, name\) => unhideItem/.test(SRC));
ok('导出 purge', /purge: \(domain, name\) => purgeItem/.test(SRC));
ok('导出 archived', /archived: \(domain\) => archivedItems/.test(SRC));

console.log('\n=== 11. 快照清理只在真有删除时才写 ===');
{
  const body = (SRC.match(/function purgeFromSnapshot[\s\S]*?\n  \}/) || [''])[0];
  ok('找到才写回', /if \(n\) \{/.test(body));
  ok('深度有上限', /depth > 6/.test(body));
}

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
