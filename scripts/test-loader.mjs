/**
 * 加载器端到端测试
 *
 * 用一个会记账的假 DOM 满足 core.js 的需求。
 *
 * 覆盖：
 *   正常加载 / manifest 结构坏 / manifest hash 被改
 *   模块内容被改 / 断网有缓存 / 断网无缓存
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 8788;
const REAL_BASE = 'http://127.0.0.1:' + PORT + '/';

let pass = 0, fail = 0;
const ok = (n, v, e) => { if (v) pass++; else { fail++; console.log('[!!] ' + n + (e ? '  -> ' + e : '')); } };
const eq = (n, a, b, e) => ok(n, a === b, '期望 ' + JSON.stringify(b) + ' 实得 ' + JSON.stringify(a) + (e ? ' | ' + e : ''));

function loaderSource() {
  const raw = fs.readFileSync(path.join(ROOT, 'loader.js'), 'utf8');
  const re = /const SOURCES = \[[\s\S]*?\];/;
  if (!re.test(raw)) throw new Error('加载器里找不到 SOURCES 数组');
  return raw.replace(re, "const SOURCES = ['" + REAL_BASE + "'];");
}

function makeDom(log) {
  function mkEl(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      style: {}, dataset: {},
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); },
        remove(c) { this._s.delete(c); },
        toggle(c, v) {
          if (v === undefined) { if (this._s.has(c)) this._s.delete(c); else this._s.add(c); } else if (v) this._s.add(c); else this._s.delete(c);
        },
        contains(c) { return this._s.has(c); },
      },
      children: [],
      appendChild(c) { this.children.push(c); return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
      remove() {},
      addEventListener() {}, removeEventListener() {},
      setAttribute() {}, getAttribute() { return null; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 150, right: 300, bottom: 150 }; },
      querySelector() { return mkEl('div'); },
      querySelectorAll() { return []; },
      focus() {}, blur() {}, click() {},
      innerHTML: '', textContent: '', value: '',
      clientWidth: 300, clientHeight: 150, scrollTop: 0, offsetWidth: 300,
      parentNode: null, isConnected: true,
    };
    if (String(tag).toLowerCase() === 'script') {
      let sv = null;
      Object.defineProperty(el, 'src', {
        set(v) {
          sv = v;
          el._src = v;
          const m = /blob:fake-(\d+)/.exec(String(v));
          el._code = m ? log.blobTable[Number(m[1])] : '';
        },
        get() { return sv; },
      });
    }
    return el;
  }

  const head = mkEl('head');
  const body = mkEl('body');
  head.appendChild = (c) => {
    head.children.push(c);
    if (c && c.tagName === 'SCRIPT' && typeof c._code === 'string') {
      log.scriptsRan.push(c._src);
      try {
        new Function('window', 'document', 'console', 'setTimeout', 'clearTimeout',
          c._code)(log.win, doc, log.win.console, setTimeout, clearTimeout,
          log.win.fetch, AbortController, log.win.localStorage, {});
      } catch (e) {
        if (c.onerror) c.onerror(e);
        return c;
      }
      setTimeout(() => { if (c.onload) c.onload(); }, 0);
    }
    return c;
  };
  head.removeChild = () => {};
  body.appendChild = (c) => { body.children.push(c); return c; };

  const doc = {
    head, body, documentElement: head,
    createElement: (t) => mkEl(t),
    createTextNode: (t) => ({ textContent: String(t) }),
    getElementById() { return null; },
    querySelector() { return mkEl('div'); },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    createEvent: () => ({ initEvent() {} }),
    visibilityState: 'visible',
  };
  return doc;
}

function makeBrowser(opts = {}) {
  const cacheStore = new Map();
  const blobTable = [];
  const scriptsRan = [];
  let fetchCount = 0;
  const netDown = opts.netDown || (() => false);
  const tamper = opts.tamper || (() => false);
  const listeners = {};

  const win = {
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent(ev) { (listeners[ev.type] || []).forEach((f) => f(ev)); return true; },
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;
  win.top = win;
  win.parent = win;
  win.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
  win.Event = class { constructor(t) { this.type = t; } };
  win.console = { log: () => {}, error: () => {}, warn: () => {}, info: () => {} };
  win.localStorage = {
    _d: {},
    getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
    key(i) { return Object.keys(this._d)[i]; },
    get length() { return Object.keys(this._d).length; },
  };
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  win.setInterval = setInterval;
  win.clearInterval = clearInterval;
  win.requestAnimationFrame = (f) => setTimeout(() => f(Date.now()), 8);
  win.cancelAnimationFrame = () => {};
  win.AbortController = AbortController;
  win.navigator = { userAgent: 'node-test' };
  win.location = { href: REAL_BASE };
  win.Blob = class { constructor(parts) { this._code = parts.join(''); } };
  win.URL = {
    createObjectURL(blob) { blobTable.push(blob._code); return 'blob:fake-' + (blobTable.length - 1); },
    revokeObjectURL() {},
  };
  win.Response = class { constructor(body) { this._b = body; } };
  win.MutationObserver = class { observe() {} disconnect() {} };
  win.IntersectionObserver = class { observe() {} disconnect() {} };
  win.ResizeObserver = class { observe() {} disconnect() {} };
  win.getComputedStyle = () => ({ getPropertyValue: () => '' });

  win.caches = {
    async open() {
      return {
        async match(key) {
          if (!cacheStore.has(key)) return null;
          const bytes = cacheStore.get(key);
          return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
        },
        async put(key, res) {
          const b = res._b;
          cacheStore.set(key, b instanceof Uint8Array ? b : new Uint8Array(b));
        },
        async delete(key) { return cacheStore.delete(key); },
        async keys() { return Array.from(cacheStore.keys()); },
      };
    },
  };

  win.fetch = async (url) => {
    fetchCount += 1;
    if (netDown()) throw new Error('Failed to fetch');
    const rel = String(url).replace(REAL_BASE, '').split('?')[0];
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      return { ok: false, status: 404, async arrayBuffer() { return new ArrayBuffer(0); } };
    }
    let buf = fs.readFileSync(abs);
    const mode = tamper(rel);
    if (mode === 'body') {
      buf = Buffer.from(buf.toString('utf8') + '\n// tampered\n', 'utf8');
    } else if (mode === 'hash') {
      const t = buf.toString('utf8').replace(/"sha256":\s*"([a-f0-9]{4})/, '"sha256": "dead');
      buf = Buffer.from(t, 'utf8');
    } else if (mode === 'broken') {
      buf = Buffer.from('{ not json at all', 'utf8');
    }
    return {
      ok: true, status: 200,
      async arrayBuffer() { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); },
    };
  };

  const log = { win, blobTable, scriptsRan };
  win.document = makeDom(log);
  return { win, cacheStore, scriptsRan, fetchCount: () => fetchCount, doc: win.document };
}

const SRC = loaderSource();

function boot(b) {
  new Function('window', 'document', 'console', 'setTimeout', 'clearTimeout',
    'fetch', 'AbortController', 'localStorage', 'navigator', 'URL', 'Blob', 'Response', 'caches',
    'CustomEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'setInterval', 'clearInterval',
    SRC)(b.win, b.doc, b.win.console, setTimeout, clearTimeout,
    b.win.fetch, AbortController, b.win.localStorage, b.win.navigator,
    b.win.URL, b.win.Blob, b.win.Response, b.win.caches, b.win.CustomEvent,
    b.win.MutationObserver, b.win.getComputedStyle, b.win.requestAnimationFrame, setInterval, clearInterval);
}

async function waitDone(b, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = b.win.__fiefLoader;
    if (st && (st.phase === 'ready' || st.phase === 'error')) return st.status();
    await new Promise((r) => setTimeout(r, 20));
  }
  return b.win.__fiefLoader ? b.win.__fiefLoader.status() : null;
}

const server = await serve(PORT);
console.log('服务已起 ' + REAL_BASE + '\n');

const MF = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

console.log('=== 1. 正常加载 ===');
let seedCache = new Map();
{
  const b = makeBrowser();
  boot(b);
  const st = await waitDone(b);
  ok('拿到 status', !!st);
  eq('phase 是 ready', st && st.phase, 'ready', st && st.error);
  eq('版本对上 manifest', st && st.version, MF.version);
  eq('模块数对上', b.scriptsRan.length, MF.modules.length);
  ok('主脚本起来了', !!b.win.__fiefLedger);
  ok('政令数据在', !!b.win.__fiefPolicy);
  ok('提示词在', !!b.win.__fiefPrompts && !!b.win.__fiefPrompts['外交']);
  ok('AI 通道在', !!b.win.__fiefAI);
  ok('政策样式在', !!b.win.__fiefCssPolicy);
  ok('AI 样式在', !!b.win.__fiefCssAi);
  ok('缓存写进去了', b.cacheStore.size > 0, '缓存 ' + b.cacheStore.size + ' 项');
  console.log('  网络 ' + b.fetchCount() + ' 次，执行 ' + b.scriptsRan.length + ' 个模块，缓存 ' + b.cacheStore.size + ' 项');
  seedCache = new Map(b.cacheStore);
}

console.log('\n=== 2. 断网 + 有缓存 ===');
{
  const b = makeBrowser({ netDown: () => true });
  seedCache.forEach((v, k) => b.cacheStore.set(k, v));
  boot(b);
  const st = await waitDone(b);
  eq('靠缓存起来了', st && st.phase, 'ready', st && st.error);
  ok('主脚本仍能跑', !!b.win.__fiefLedger);
  eq('模块全执行', b.scriptsRan.length, MF.modules.length);
}

console.log('\n=== 3. 断网 + 没缓存 ===');
{
  const b = makeBrowser({ netDown: () => true });
  boot(b);
  const st = await waitDone(b);
  eq('断网就报错', st && st.phase, 'error');
  ok('报错能看懂', /Failed to fetch|来源|缓存/.test(String(st.error)), String(st.error).slice(0, 120));
}

console.log('\n=== 4. manifest 结构坏 ===');
{
  const b = makeBrowser({ tamper: (rel) => (rel === 'manifest.json' ? 'broken' : false) });
  boot(b);
  const st = await waitDone(b);
  eq('坏了就报错', st && st.phase, 'error', st && st.error);
  eq('一个模块都没跑', b.scriptsRan.length, 0);
}

console.log('\n=== 4b. manifest 里 hash 被改 ===');
{
  const b = makeBrowser({ tamper: (rel) => (rel === 'manifest.json' ? 'hash' : false) });
  boot(b);
  const st = await waitDone(b);
  eq('hash 不对就报错', st && st.phase, 'error', st && st.error);
  ok('报错说明拿不到匹配版本', /拿不到匹配的版本|校验不符/.test(String(st.error)), String(st.error).slice(0, 160));
  eq('一个模块都没跑', b.scriptsRan.length, 0);
}

console.log('\n=== 5. core 内容被改 ===');
{
  const b = makeBrowser({ tamper: (rel) => (rel === 'modules/core.js' ? 'body' : false) });
  boot(b);
  const st = await waitDone(b);
  eq('core 被改就报错', st && st.phase, 'error', st && st.error);
  ok('报错说明拿不到匹配版本', /拿不到匹配的版本|校验不符/.test(String(st.error)), String(st.error).slice(0, 160));
  ok('报错列出了每个源', /127\.0\.0\.1/.test(String(st.error)), String(st.error).slice(0, 140));
  eq('整批都不执行', b.scriptsRan.length, 0);
}

console.log('\n=== 6. 提示词被改 ===');
{
  const b = makeBrowser({ tamper: (rel) => (rel === 'modules/prompts/diplomacy.js' ? 'body' : false) });
  boot(b);
  const st = await waitDone(b);
  eq('提示词被改也报错', st && st.phase, 'error', st && st.error);
  eq('整批都不执行', b.scriptsRan.length, 0);
}

server.close();
console.log('\n' + (fail ? fail + ' 项失败 / ' + (fail + pass) : '全部通过 ✔  ' + pass + ' 项'));
process.exit(fail ? 1 : 0);
