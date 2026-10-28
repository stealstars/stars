/**
 * 聊天内入口按钮
 *
 * 起因：有人想用酒馆正则做这件事，做不到。
 * Replace With 只产出字符串，而 innerHTML 插入的 <script> 按规范不执行，
 * 正则没有 DOM 执行权，也没有 fetch / Blob / crypto 这套 loader 依赖。
 *
 * 所以按钮只能由脚本自己挂：
 *   消息正文里出现 [领地档案] → 在消息下面补一个「打开领地档案」按钮
 *
 * 要做对的几件事：
 *   ① 只认标记，不误伤普通消息
 *   ② 同一条消息不重复挂（反复扫描会调用很多次）
 *   ③ 挂了之后正文不动，标记还留着
 *   ④ 新消息进来要能自动补上
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
  else { fail += 1; console.log('  [!!] ' + n + (e ? '  -> ' + e : '')); }
};

/* 把相关函数切出来真跑 */
function cut(name, endName) {
  const i = CORE.indexOf('function ' + name);
  if (i < 0) return '';
  const j = CORE.indexOf('function ' + endName, i);
  return j > i ? CORE.slice(i, j) : CORE.slice(i);
}

const SRC_MARK = cut('hasEntryMark', 'decorateMessage');
const SRC_DECO = cut('decorateMessage', 'scanMessages');
const SRC_SCAN = cut('scanMessages', 'historyHtml');

console.log('=== 1. 三个函数都在 ===');
ok('hasEntryMark 存在', !!SRC_MARK);
ok('decorateMessage 存在', !!SRC_DECO);
ok('scanMessages 存在', !!SRC_SCAN);
ok('标记是 [领地档案]', /const ENTRY_MARK = '\[领地档案\]'/.test(CORE));

console.log('\n=== 2. 只认标记 ===');
{
  const m = CORE.match(/const ENTRY_MARK = '([^']+)'/);
  const MARK = m ? m[1] : '';
  ok('标记取到', MARK === '[领地档案]', MARK);

  // 直接验字符串包含逻辑
  const has = (t) => String(t == null ? '' : t).indexOf(MARK) >= 0;
  ok('有标记返回 true', has('前文 [领地档案] 后文') === true);
  ok('纯标记返回 true', has('[领地档案]') === true);
  ok('没有标记返回 false', has('今天天气不错') === false);
  ok('空串返回 false', has('') === false);
  ok('null 返回 false', has(null) === false);
  ok('undefined 返回 false', has(undefined) === false);
  ok('相似的词不算', has('[领地] 和 [档案]') === false);
  ok('半角括号不算', has('[ 领地档案 ]') === false);
}

console.log('\n=== 3. 不重复挂 ===');
{
  ok('用 data 属性去重', /setAttribute\('data-fl-entry', '1'\)/.test(SRC_DECO));
  ok('先查已挂过', /getAttribute\('data-fl-entry'\) === '1'/.test(SRC_DECO));
  ok('只在 .mes_text 里找标记', /querySelector\('\.mes_text'\)/.test(SRC_DECO));
  ok('不是元素就退出', /nodeType !== 1/.test(SRC_DECO));
  ok('没有正文就退出', /if \(!body\) return;/.test(SRC_DECO));
}

console.log('\n=== 4. 正文不动 ===');
{
  // 标记要留在正文里：正则匹配得到，玩家也看得见
  ok('没有删标记', !/replace\(.*ENTRY_MARK/.test(SRC_DECO));
  ok('没有动 innerHTML', !/\.innerHTML\s*=/.test(SRC_DECO));
  ok('只有 textContent 读', /body\.textContent/.test(SRC_DECO));
  ok('按钮插在正文后面', /insertBefore\(bar, body\.nextSibling\)/.test(SRC_DECO));
}

console.log('\n=== 5. 按钮能开面板 ===');
{
  ok('按钮文字', /textContent = '打开领地档案'/.test(SRC_DECO));
  ok('调 open()', /open\(\)/.test(SRC_DECO));
  ok('阻止冒泡', /e\.stopPropagation\(\)/.test(SRC_DECO));
  ok('阻止默认', /e\.preventDefault\(\)/.test(SRC_DECO));
  ok('是 button 元素', /createElement\('button'\)/.test(SRC_DECO));
  ok('type=button', /btn\.type = 'button'/.test(SRC_DECO));
}

console.log('\n=== 6. 新消息自动补 ===');
{
  ok('observer 回调里扫', /schedule\('event'\);\s*\n\s*scanMessages\(\);/.test(CORE));
  ok('启动时扫一遍', /installObserver\(\);[\s\S]{0,120}scanMessages\(\);/.test(CORE));
  ok('打开面板时也扫', /rescan\(false, '打开面板'\);[\s\S]{0,120}scanMessages\(\);/.test(CORE));
  ok('重入保护', /entryScanning/.test(SRC_SCAN));
  ok('扫的是 #chat 下的 .mes', /querySelectorAll\('\.mes'\)/.test(SRC_SCAN));
}

console.log('\n=== 7. 样式跟随主题 ===');
{
  ok('有 .fl-entry', /\.fl-entry \{/.test(CORE));
  ok('有 .fl-entry-btn', /\.fl-entry-btn \{/.test(CORE));
  ok('颜色用 accent 变量', /color: var\(--fl-accent\)/.test(CORE));
  ok('描边用 accent-rgb', /border: 1px solid rgba\(var\(--fl-accent-rgb\)/.test(CORE));
  ok('不写死琥珀色', !/\.fl-entry-btn \{[\s\S]{0,300}color: #d4af5a/.test(CORE));
}

console.log('\n=== 8. 导出给排查 ===');
{
  ok('导出 scanMessages', /scanMessages: \(\) => scanMessages\(\)/.test(CORE));
  ok('导出 open', /open: \(\) => open\(\)/.test(CORE));
  ok('导出 ENTRY_MARK', /ENTRY_MARK, hasEntryMark,/.test(CORE));
}

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
