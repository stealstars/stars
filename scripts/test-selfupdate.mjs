/**
 * 加载器自更新
 *
 * 要守的事：
 *   ① 线上 loader.js 版本更高 → 装新的
 *   ② 版本相同或更低 → 不动
 *   ③ 网络全挂 → 不报错，继续用旧的
 *   ④ 线上给的是垃圾 → 不装
 *   ⑤ status() 暴露加载器版本
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'loader.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

let fail = 0;
const ok = (n, c, e) => {
  if (!c) fail += 1;
  console.log((c ? '  OK   ' : '  FAIL ') + n + (e ? '  -> ' + e : ''));
};

function makeWin(opts) {
  const o = opts || {};
  const injected = [];
  const win = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    TextDecoder, Blob, URL,
    CustomEvent: class {
      constructor(t, d) { this.type = t; this.detail = d && d.detail; }
    },
    dispatchEvent() { return true; },
    addEventListener() {}, removeEventListener() {},
    navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    caches: {
      async open() {
        return {
          async match() { return undefined; },
          async put() {},
          async delete() { return true; },
        };
      },
    },
    innerWidth: 800, innerHeight: 600,
  };
  win.window = win;
  win.self = win;
  win.fetch = async (url) => {
    const u = String(url);
    if (u.indexOf('loader.js') >= 0) {
      if (o.loaderFails) throw new Error('network down');
      if (!o.loaderText) return { ok: false, status: 404 };
      return { ok: true, status: 200, text: async () => o.loaderText };
    }
    if (u.indexOf('manifest.json') >= 0) {
      const buf = Buffer.from(JSON.stringify(MANIFEST), 'utf8');
      return {
        ok: true, status: 200,
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    }
    const m = u.match(/\/main\/(modules\/.+)$/);
    if (m) {
      const p = path.join(ROOT, decodeURIComponent(m[1]));
      if (!fs.existsSync(p)) return { ok: false, status: 404 };
      const buf = fs.readFileSync(p);
      return {
        ok: true, status: 200,
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    }
    return { ok: false, status: 404 };
  };
  win.document = {
    head: { appendChild(el) { injected.push(el); } },
    documentElement: { appendChild() {} },
    body: { appendChild() {} },
    createElement(tag) {
      const attrs = {};
      const el = {
        tagName: String(tag).toUpperCase(), style: {}, dataset: {}, id: '', src: '',
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        children: [], innerHTML: '', textContent: '',
        appendChild(c) { this.children.push(c); return c; },
        remove() {}, removeChild() {},
        addEventListener() {}, removeEventListener() {},
        setAttribute(k, v) { attrs[k] = v; },
        getAttribute(k) { return attrs[k] === undefined ? null : attrs[k]; },
        querySelector: () => null, querySelectorAll: () => [],
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      };
      if (el.tagName === 'SCRIPT') {
        setTimeout(() => { if (el.onload) el.onload(); }, 0);
      }
      return el;
    },
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  };
  win.__injected = injected;
  return win;
}

const run = (win) => {
  new Function('window', 'document', 'console', 'fetch', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'Blob', 'URL', 'caches', 'localStorage',
    'navigator', 'CustomEvent', 'TextDecoder',
    SRC)(win, win.document, console, win.fetch, setTimeout, clearTimeout,
    setInterval, clearInterval, Blob, URL, win.caches, win.localStorage,
    win.navigator, win.CustomEvent, TextDecoder);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const loaderScripts = (win) => win.__injected.filter(
  (e) => e.getAttribute && e.getAttribute('data-fief-loader'),
);

console.log('=== 1. 线上版本更高 → 应自更新 ===');
{
  const newer = SRC.replace(/LOADER_VERSION = '2'/, "LOADER_VERSION = '99'");
  const win = makeWin({ loaderText: newer });
  run(win);
  await wait(500);
  ok('注入了新加载器', loaderScripts(win).length === 1, String(loaderScripts(win).length));
  ok('注入的版本是 99',
    loaderScripts(win)[0] && loaderScripts(win)[0].getAttribute('data-fief-loader') === '99');
}

console.log('\n=== 2. 版本相同 → 不自更新 ===');
{
  const win = makeWin({ loaderText: SRC });
  run(win);
  await wait(500);
  ok('没有注入新加载器', loaderScripts(win).length === 0, String(loaderScripts(win).length));
  ok('正常加载完成', win.__fiefLoader && win.__fiefLoader.status().phase === 'ready',
    win.__fiefLoader ? win.__fiefLoader.status().phase : 'no instance');
}

console.log('\n=== 3. 版本更低 → 不自更新 ===');
{
  const older = SRC.replace(/LOADER_VERSION = '2'/, "LOADER_VERSION = '1'");
  const win = makeWin({ loaderText: older });
  run(win);
  await wait(500);
  ok('没有注入新加载器', loaderScripts(win).length === 0, String(loaderScripts(win).length));
  ok('正常加载完成', win.__fiefLoader && win.__fiefLoader.status().phase === 'ready',
    win.__fiefLoader ? win.__fiefLoader.status().phase : 'no instance');
}

console.log('\n=== 4. 网络全挂 → 继续用旧的 ===');
{
  const win = makeWin({ loaderFails: true });
  run(win);
  await wait(500);
  ok('没有把自己弄丢', !!win.__fiefLoader);
}

console.log('\n=== 5. 线上给的是坏文件 → 不更新 ===');
{
  const win = makeWin({ loaderText: 'this is not a loader at all' });
  run(win);
  await wait(500);
  ok('没注入垃圾', loaderScripts(win).length === 0, String(loaderScripts(win).length));
  ok('旧的照常干活', win.__fiefLoader && win.__fiefLoader.status().phase === 'ready',
    win.__fiefLoader ? win.__fiefLoader.status().phase : 'no instance');
}

console.log('\n=== 6. status() 暴露当前加载器版本 ===');
{
  const win = makeWin({});
  run(win);
  await wait(500);
  const st = win.__fiefLoader.status();
  ok('有 loaderVersion', !!st.loaderVersion, String(st.loaderVersion));
  ok('有 selfUpdated 标记', typeof st.selfUpdated === 'boolean', String(st.selfUpdated));
}

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔'));
process.exit(fail ? 1 : 0);
