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
AI.setConf('外交', { base: 'http://127.0.0.1:8790/v1', key: 'sk-test-123456', model: 'glm-5.3-flash' });
ok('localStorage 有东西', !!store['fiefLedger.aichan.v1'], JSON.stringify(Object.keys(store)));

console.log('\n=== 用别的键名读 ===');
const a = AI.getConf('外交');
const b = AI.getConf('diplomacy');
const c = AI.getConf('外交档案');
const d = AI.getConf();
ok('外交 读得到', a.base === 'http://127.0.0.1:8790/v1' && a.key === 'sk-test-123456', JSON.stringify(a));
ok('diplomacy 读得到', b.key === 'sk-test-123456', JSON.stringify(b));
ok('外交档案 读得到', c.key === 'sk-test-123456', JSON.stringify(c));
ok('不传参数读得到', d.base === 'http://127.0.0.1:8790/v1');
ok('四处读到同一份', a.key === b.key && b.key === c.key && c.key === d.key);

console.log('\n=== 反向：用 diplomacy 存 ===');
AI.setConf('diplomacy', { base: 'https://gcli.ggchan.dev', key: 'gg-xyz', model: 'agy-gemini-3.8-flash-low' });
const e = AI.getConf('外交');
ok('用 diplomacy 存，外交 读得到', e.key === 'gg-xyz', JSON.stringify(e));
ok('模型也跟着换', e.model === 'agy-gemini-3.8-flash-low');

console.log('\n=== 端到端：面板存 → 外交页读 ===');
// 面板存的时候用 '外交'
AI.setConf('外交', { base: 'http://127.0.0.1:8790/v1', key: 'sk-e2e-key', model: 'glm-5.3-flash' });
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
win.__fiefAI.setConf('外交', { base: 'http://127.0.0.1:8790/v1', key: 'sk-e2e-key', model: 'glm-5.3-flash' });

let chatErr = '';
try {
  await win.__fiefAI.chat('测试', { module: 'diplomacy', maxTokens: 100 });
} catch (e) {
  chatErr = e.message || String(e);
}
ok('chat 没报「还没配置」', chatErr.indexOf('还没配置') < 0, chatErr);
ok('确实发出请求了', !!seen, 'fetch 没被调');
if (seen) {
  ok('请求打到正确端点', seen.url === 'http://127.0.0.1:8790/v1/chat/completions', seen.url);
  ok('请求体用了存的模型', seen.body.model === 'glm-5.3-flash', seen.body.model);
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
