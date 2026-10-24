/**
 * 加载器测试：在 Node 里模拟浏览器环境，跑完整的拉取 + 校验 + 执行链路
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let pass = 0, fail = 0;
const ok = (name, v, extra) => {
  if (v) { pass++; } else { fail++; console.log('[!!] ' + name + (extra ? '  → ' + extra : '')); }
};
const eq = (name, a, b) => ok(name, a === b, '期望 ' + JSON.stringify(b) + ' 实得 ' + JSON.stringify(a));

const PORT = 8787;
const BASE = 'http://127.0.0.1:' + PORT + '/';

/* ---------- 1. manifest 自身 ---------- */
console.log('=== 1. manifest ===');
const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
ok('有版本号', /^\d+\.\d+\.\d+/.test(mf.version));
ok('channel 是 stable', mf.channel === 'stable');
eq('模块数一致', mf.moduleCount, mf.modules.length);
ok('模块数 >= 7', mf.modules.length >= 7);
for (const m of mf.modules) {
  eq(m.path + ' sha256 格式', /^[a-f0-9]{64}$/.test(m.sha256), true);
  eq(m.path + ' bytes 是数字', typeof m.bytes, 'number');
}

/* ---------- 2. hash 与磁盘一致 ---------- */
console.log('\n=== 2. hash 与磁盘一致 ===');
for (const m of mf.modules) {
  const buf = fs.readFileSync(path.join(ROOT, m.path));
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  eq(m.path + ' hash', sha, m.sha256);
  eq(m.path + ' 大小', buf.length, m.bytes);
}

/* ---------- 3. 起服务器 ---------- */
const server = await serve(PORT);
console.log('\n=== 3. 服务已起 ' + BASE + ' ===');

const getBytes = async (p) => {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p);
  return new Uint8Array(await r.arrayBuffer());
};
const sha = async (b) => crypto.createHash('sha256').update(Buffer.from(b)).digest('hex');

/* ---------- 4. 逐个模块拉 + 校验 ---------- */
console.log('=== 4. 拉取与校验 ===');
const texts = {};
for (const m of mf.modules) {
  const bytes = await getBytes(m.path);
  const got = await sha(bytes);
  eq(m.path + ' 网络 hash 一致', got, m.sha256);
  texts[m.path] = new TextDecoder('utf-8').decode(bytes);
}

/* ---------- 5. 篡改必须被发现 ---------- */
console.log('\n=== 5. 篡改检测 ===');
{
  const m = mf.modules[0];
  const bytes = await getBytes(m.path);
  const bad = new Uint8Array(bytes);
  bad[bad.length - 1] = bad[bad.length - 1] ^ 1;  // 翻最后一位
  const got = await sha(bad);
  ok('改一个比特就 hash 不同', got !== m.sha256);
}

/* ---------- 6. 模块语法 ---------- */
console.log('\n=== 6. 模块语法 ===');
for (const [p, text] of Object.entries(texts)) {
  let good = true, msg = '';
  try { new Function(text); } catch (e) { good = false; msg = e.message; }
  ok(p + ' 可编译', good, msg);
}

/* ---------- 7. 模块契约 ---------- */
console.log('\n=== 7. 模块导出 ===');
// 在沙箱里跑一遍非 core 的模块，看它们挂到 window 上的东西对不对
const win = {
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  matchMedia: () => ({ matches: false }),
  addEventListener: () => {},
  dispatchEvent: () => {},
};
win.window = win;
win.globalThis = win;
win.fetch = fetch;
win.AbortController = AbortController;
win.console = { log: () => {}, error: () => {}, warn: () => {} };

const load = (p) => {
  const code = texts[p];
  new Function('window', 'document', 'console', 'setTimeout', 'clearTimeout', 'fetch', 'AbortController',
    code)(win, win.document, win.console, setTimeout, clearTimeout, fetch, AbortController);
};
win.document = { createElement: () => ({ style: {}, addEventListener: () => {} }) };

load('modules/policy.data.js');
ok('政令数据挂在 __fiefPolicy', !!win.__fiefPolicy);
eq('政令条数 108', win.__fiefPolicy.ORDER.length, 108);
eq('政令类别 6 个', win.__fiefPolicy.CATS.length, 6);

load('modules/policy.css.js');
ok('政策样式挂在 __fiefCssPolicy', !!win.__fiefCssPolicy);
ok('政策样式有 fl-pc', String(win.__fiefCssPolicy).indexOf('.fl-pc') >= 0);
ok('政策样式有 3D 关键帧', String(win.__fiefCssPolicy).indexOf('@keyframes fl-deal') >= 0);

load('modules/ai.css.js');
ok('AI 样式挂在 __fiefCssAi', !!win.__fiefCssAi);
ok('AI 样式有 fl-aic', String(win.__fiefCssAi).indexOf('.fl-aic') >= 0);
eq('AI 样式不含政策碎片', String(win.__fiefCssAi).indexOf('.fl-pc-in'), -1);

load('modules/policy.ui.js');
ok('抽卡界面挂在 __fiefPolicyUI', !!win.__fiefPolicyUI);

load('modules/ai.chan.js');
ok('AI 通道挂在 __fiefAI', !!win.__fiefAI);
eq('endpoint 拼接', win.__fiefAI._test.endpoint('https://x.dev/v1', '/models'), 'https://x.dev/v1/models');

load('modules/ai.settings.js');
ok('AI 面板挂在 __fiefAISettings', !!win.__fiefAISettings);

load('modules/prompts/diplomacy.js');
ok('外交提示词挂在 __fiefPrompts', !!win.__fiefPrompts && !!win.__fiefPrompts['外交']);
{
  const p = win.__fiefPrompts['外交'];
  ok('提示词有 system', typeof p.system === 'string' && p.system.length > 100);
  ok('提示词有 8 个字段', p.fields.length === 8);
  ok('提示词有示例', !!p.example && !!p.example.势力名);
  ok('示例字段齐全', p.fields.every((f) => p.example[f]));
  const built = p.build({ 势力: '瓦伦蒂亚', 方向: '军事部署' });
  ok('模板替换势力', built.indexOf('瓦伦蒂亚') >= 0);
  ok('模板替换方向', built.indexOf('军事部署') >= 0);
  ok('模板不再有占位符', built.indexOf('{势力}') < 0 && built.indexOf('{方向}') < 0);
  const empty = p.build({});
  ok('无参数也不崩', empty.indexOf('未指定') >= 0);
}

/* ---------- 8. core 完整性 ---------- */
console.log('\n=== 8. core 完整性 ===');
const core = texts['modules/core.js'];
for (const fn of ['resolveState', 'replayState', 'parseDomainBlock', 'renderPolicy',
  'diplomacyHtml', 'historyHtml', 'fillApiPane', 'injectModuleCss', 'buildUI']) {
  ok('core 有 ' + fn, core.indexOf(fn) >= 0);
}
ok('core 引用了 __fiefCssPolicy', core.indexOf('__fiefCssPolicy') >= 0);
ok('core 引用了 __fiefCssAi', core.indexOf('__fiefCssAi') >= 0);
ok('core 不再内联政策样式', core.indexOf('@keyframes fl-deal') < 0);
ok('core 不再内联 AI 样式', core.indexOf('.fl-aic-in {') < 0);
ok('core 版本号是 0.9.0', core.indexOf("const VERSION = '0.9.0'") >= 0);

/* ---------- 9. 体积 ---------- */
console.log('\n=== 9. 体积 ===');
const total = Object.values(texts).reduce((a, t) => a + Buffer.byteLength(t, 'utf8'), 0);
console.log('  模块合计 ' + (total / 1024).toFixed(1) + ' KB');
console.log('  core     ' + (Buffer.byteLength(core, 'utf8') / 1024).toFixed(1) + ' KB');
console.log('  loader   ' + (fs.statSync(path.join(ROOT, 'loader.js')).size / 1024).toFixed(1) + ' KB');
ok('core 比原单文件小', Buffer.byteLength(core) < 224047);

/* ---------- 10. 加载器 ---------- */
console.log('\n=== 10. 加载器 ===');
const loader = fs.readFileSync(path.join(ROOT, 'loader.js'), 'utf8');
ok('加载器可编译', (() => { try { new Function(loader); return true; } catch (e) { return false; } })());
ok('加载器有多源', loader.indexOf('jsdelivr') >= 0 && loader.indexOf('raw.githubusercontent') >= 0);
ok('加载器校验 SHA-256', loader.indexOf('SHA-256') >= 0);
ok('加载器用 Cache Storage', loader.indexOf('caches') >= 0);
ok('加载器暴露 status', loader.indexOf('state.status') >= 0);
ok('加载器有 reload', loader.indexOf('state.reload') >= 0);

server.close();
console.log('\n' + (fail ? fail + ' 项失败 / ' + (fail + pass) : '全部通过 ✔  ' + pass + ' 项'));
process.exit(fail ? 1 : 0);
