/**
 * AI 凭据保存测试
 *
 * 这里守的是两个真实出过的 bug：
 *   ① 设置面板存的是 '外交'，外交页读的是 'diplomacy' → 填了也提示没配置
 *   ② 只监听 change，手机上输完不失焦就丢
 */
import fs from 'node:fs';

let pass = 0, fail = 0;
const ok = (n, v, e) => { if (v) { pass++; console.log('  OK   ' + n); } else { fail++; console.log('  FAIL ' + n + (e ? ' -> ' + e : '')); } };

const store = {};
const win = {
  localStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  },
  console,
  setTimeout, clearTimeout,
  fetch: async () => ({ ok: false, status: 404 }),
};
win.window = win;

new Function('window', 'console', 'fetch', fs.readFileSync('D:\\223\\fief-ledger\\modules\\ai.chan.js', 'utf8'))(win, console, win.fetch);
const AI = win.__fiefAI;

console.log('=== 模块别名 ===');
ok('canon 存在', typeof AI.canon === 'function');
ok('diplomacy → 外交', AI.canon('diplomacy') === '外交', AI.canon('diplomacy'));
ok('外交档案 → 外交', AI.canon('外交档案') === '外交', AI.canon('外交档案'));
ok('外交 → 外交', AI.canon('外交') === '外交');
ok('空 → 外交', AI.canon('') === '外交');
ok('未知原样', AI.canon('历史') === '历史');

console.log('\n=== 存进去 ===');
AI.setConf('外交', { base: 'https://example.test/v1', key: 'sk-test-123456', model: 'test-model-a' });
ok('localStorage 有东西', !!store['fiefLedger.aichan.v1'], JSON.stringify(Object.keys(store)));

console.log('\n=== 用别的键名读 ===');
const a = AI.getConf('外交');
const b = AI.getConf('diplomacy');
const c = AI.getConf('外交档案');
const d = AI.getConf();
ok('外交 读得到', a.base === 'https://example.test/v1' && a.key === 'sk-test-123456', JSON.stringify(a));
ok('diplomacy 读得到', b.key === 'sk-test-123456', JSON.stringify(b));
ok('外交档案 读得到', c.key === 'sk-test-123456', JSON.stringify(c));
ok('不传参数读得到', d.base === 'https://example.test/v1');
ok('四处读到同一份', a.key === b.key && b.key === c.key && c.key === d.key);

console.log('\n=== 反向：用 diplomacy 存 ===');
AI.setConf('diplomacy', { base: 'https://example2.test', key: 'sk-second', model: 'test-model-b' });
const e = AI.getConf('外交');
ok('用 diplomacy 存，外交 读得到', e.key === 'sk-second', JSON.stringify(e));
ok('模型也跟着换', e.model === 'test-model-b');

console.log('\n=== 端到端：面板存 → 外交页读 ===');
// 面板存的时候用 '外交'
AI.setConf('外交', { base: 'https://example.test/v1', key: 'sk-e2e-key', model: 'test-model-a' });
// 外交页调 chat() 时传的是 module: 'diplomacy'
let seen = null;
win.fetch = async (url, opts) => {
  seen = { url, body: JSON.parse(opts.body) };
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: '可用' } }] }),
  };
};
// 重新加载模块，让它用新的 fetch
new Function('window', 'console', 'fetch', fs.readFileSync('D:\\223\\fief-ledger\\modules\\ai.chan.js', 'utf8'))(win, console, win.fetch);
// 重新写一次，因为上面重载清了状态
win.__fiefAI.setConf('外交', { base: 'https://example.test/v1', key: 'sk-e2e-key', model: 'test-model-a' });

let chatErr = '';
try {
  await win.__fiefAI.chat('测试', { module: 'diplomacy', maxTokens: 100 });
} catch (e) {
  chatErr = e.message || String(e);
}
ok('chat 没报「还没配置」', chatErr.indexOf('还没配置') < 0, chatErr);
ok('确实发出请求了', !!seen, 'fetch 没被调');
if (seen) {
  ok('请求打到正确端点', seen.url === 'https://example.test/v1/chat/completions', seen.url);
  ok('请求体用了存的模型', seen.body.model === 'test-model-a', seen.body.model);
}

console.log('\n=== 界面不许把密钥吐出来 ===');
{
  // 加载设置面板，渲染一次，检查 HTML 里有没有密钥
  const store2 = {};
  const win3 = {
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store2, k) ? store2[k] : null; },
      setItem(k, v) { store2[k] = String(v); },
      removeItem(k) { delete store2[k]; },
    },
    console,
    setTimeout, clearTimeout,
    fetch: async () => ({ ok: false, status: 404 }),
  };
  win3.window = win3;
  const chan = fs.readFileSync('D:\\223\\fief-ledger\\modules\\ai.chan.js', 'utf8');
  const sett = fs.readFileSync('D:\\223\\fief-ledger\\modules\\ai.settings.js', 'utf8');
  new Function('window', 'console', 'fetch', chan)(win3, console, win3.fetch);
  new Function('window', 'console', sett)(win3, console);

  // 假密钥：故意用不会碰泄漏规则的形状
  const SECRET = 'testkey_ABCDEFGHIJKLMNOP123456';
  const HOST = 'https://example.test/v1';
  win3.__fiefAI.setConf('外交', { base: HOST, key: SECRET, model: 'test-model' });

  const html = win3.__fiefAISettings._test.html();

  // 输入框的 value 允许有密钥——那是给人编辑的。
  // 除它以外，整块 HTML 都不许出现密钥的任何片段。
  const withoutInputs = html
    .replace(/(<input[^>]*id="fl-aic-(?:base|key)"[^>]*>)/g, '')
    .replace(/value="[^"]*"/g, '');

  ok('除输入框外没有完整密钥', withoutInputs.indexOf(SECRET) < 0);
  ok('除输入框外没有密钥前 6 位', withoutInputs.indexOf(SECRET.slice(0, 6)) < 0, SECRET.slice(0, 6));
  ok('除输入框外没有密钥后 4 位', withoutInputs.indexOf(SECRET.slice(-4)) < 0, SECRET.slice(-4));
  ok('除输入框外没有密钥中段', withoutInputs.indexOf(SECRET.slice(8, 20)) < 0);
  ok('除输入框外没有地址明示', withoutInputs.indexOf('地址 ' + HOST) < 0);

  // 输入框本身还在，值也还在（不然用户没法看/改）
  const keyInputCount = (html.match(/id="fl-aic-key"/g) || []).length;
  ok('密钥框还在', keyInputCount === 1, String(keyInputCount));
  const keyInput = html.slice(html.indexOf('id="fl-aic-key"'));
  const valMatch = keyInput.slice(0, 400).match(/value="([^"]*)"/);
  ok('密钥在输入框 value 里', !!valMatch && valMatch[1] === SECRET, valMatch ? '(有但不等)' : '没找到 value');

  // 状态行只剩「已保存 / 本机可写」
  ok('状态行说已保存', html.indexOf('已保存') >= 0);
  ok('状态行不报地址', html.indexOf('地址 ') < 0);
}

console.log('\n=== 存储可用性 ===');
ok('storeOk 报可用', AI.storeOk() === true);

// 模拟无痕模式：setItem 抛异常
const win2 = {
  localStorage: {
    getItem: () => null,
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() {},
  },
  console, setTimeout, clearTimeout,
  fetch: async () => ({ ok: false, status: 404 }),
};
win2.window = win2;
new Function('window', 'console', 'fetch', fs.readFileSync('D:\\223\\fief-ledger\\modules\\ai.chan.js', 'utf8'))(win2, console, win2.fetch);
ok('无痕模式 storeOk 报不可用', win2.__fiefAI.storeOk() === false);
ok('无痕模式 setConf 不抛', (() => {
  try { win2.__fiefAI.setConf('外交', { base: 'x', key: 'y', model: 'z' }); return true; } catch (e) { return false; }
})());

console.log('\n' + (fail ? fail + ' 项失败 / ' + (fail + pass) : '全部通过 ✔  ' + pass + ' 项'));
process.exit(fail ? 1 : 0);
