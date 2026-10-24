/**
 * 外交页端到端测试
 *
 * 模拟酒馆环境（TavernHelper 返回真实命定世界书），
 * 加载全部模块，检查外交页能不能真的渲染出 10 个势力与地点列表。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let pass = 0, fail = 0;
const ok = (n, v, e) => { if (v) { pass++; console.log('  OK   ' + n); } else { fail++; console.log('  FAIL ' + n + (e ? ' -> ' + e : '')); } };

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const card = JSON.parse(fs.readFileSync('D:\\223\\命定之诗与黄昏之歌v4.31.json', 'utf8'));

/* ---------------- 假 DOM ---------------- */
const styles = [];
const mkEl = (tag) => {
  const e = {
    tagName: String(tag).toUpperCase(),
    style: {}, dataset: {}, id: '', textContent: '', innerHTML: '',
    value: '', checked: false, disabled: false, type: '',
    children: [], parentNode: null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) { this.dataset[k] = v; }, getAttribute(k) { return this.dataset[k] ?? null; },
    querySelector: () => mkEl('div'), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    focus() {}, blur() {}, click() {}, scrollTop: 0, clientWidth: 800, clientHeight: 600,
    closest: () => null,
    dispatchEvent() { return true; },
    getContext: () => null,
  };
  if (String(tag).toLowerCase() === 'style') {
    let v = '';
    Object.defineProperty(e, 'textContent', { set(x) { v = x; e._css = x; }, get() { return v; } });
  }
  return e;
};

const head = mkEl('head');
const body = mkEl('body');
head.addEventListener = () => {};
head.removeEventListener = () => {};
body.addEventListener = () => {};
body.removeEventListener = () => {};
// 测试桩：每个元素都能再 querySelector 出元素，且能点能绑事件。
// 真实 DOM 里这些节点都在，主脚本会直接对它们 .addEventListener，
// 返回 null 就会崩——这是桩的问题，不是脚本的问题。
const stubEl = () => {
  const e = mkEl('div');
  e.querySelector = () => stubEl();
  e.querySelectorAll = () => [];
  e.addEventListener = () => {};
  e.removeEventListener = () => {};
  e.closest = () => null;
  e.getContext = () => null;
  return e;
};
const doc = {
  head, body, documentElement: head,
  createElement: mkEl,
  getElementById: () => stubEl(),
  querySelector: () => stubEl(),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  visibilityState: 'visible',
};
doc.documentElement = Object.assign(mkEl('html'), {
  addEventListener() {}, removeEventListener() {}, clientWidth: 800, clientHeight: 600,
  querySelector: () => stubEl(),
});
doc.body = Object.assign(mkEl('body'), {
  addEventListener() {}, removeEventListener() {}, querySelector: () => stubEl(),
});

/* 记录 style 注入 */
const origAppend = head.appendChild;
head.appendChild = function (c) {
  const r = origAppend.call(this, c);
  if (c.tagName === 'STYLE') styles.push({ id: c.id, len: (c._css || '').length, css: c._css || '' });
  return r;
};

/* ---------------- 假 window，带真实世界书 ---------------- */
const win = {
  document: doc,
  localStorage: {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  },
  navigator: { clipboard: { writeText: async () => {} } },
  console: { log() {}, warn() {}, error() {} },
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (f) => setTimeout(() => f(0), 1),
  innerWidth: 800, innerHeight: 600,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  MutationObserver: class { observe() {} disconnect() {} },
  Event: class { constructor(t) { this.type = t; } },
  CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
  // ★ 关键：假 TavernHelper 返回真实世界书
  TavernHelper: {
    getWorldbookNames: () => ['命定之诗与黄昏之歌v4.3'],
    getWorldbook: (name) => (name === '命定之诗与黄昏之歌v4.3' ? card.data.character_book : null),
    getVariables: () => ({
      stat_data: {
        主角: {
          资产: {
            '晨星庄园': {
              类型: '领地', 品质: '优良',
              描述: [
                '<fief_domain>',
                '[领地|晨星庄园|1|奥古斯提姆帝国|仁政|承平]',
                '[核心|78|65|充裕|数百户]',
                '[府库|5.96万|帝冕币]',
                '[邻邦|索伦蒂斯王国|观望]',
                '[邻邦|诺斯加德联盟|戒备]',
                '[要事|边境出现不明商队]',
                '</fief_domain>',
              ].join('\n'),
            },
          },
        },
        关系列表: {
          '莉莉娅・利桑德': {
            名字: '莉莉娅・利桑德',
            身份: ['利桑德家族继承人'],
            资产: {
              '迷雾庄园': { 类型: '领地', 品质: '精良', 描述: '[领地|迷雾庄园|3|瓦伦蒂亚|封建|承平]' },
            },
          },
        },
      },
    }),
    insertOrAssignVariables: () => {},
  },
};
win.window = win;
win.globalThis = win;
win.crypto = globalThis.crypto;
win.TextDecoder = TextDecoder;
win.AbortController = AbortController;
win.Blob = class { constructor(p) { this._c = p.join ? p.join('') : String(p); } };
win.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
win.Response = class {};
win.fetch = async () => ({ ok: false, status: 404 });
win.addEventListener = () => {};
win.removeEventListener = () => {};
win.dispatchEvent = () => true;
win.visualViewport = { width: 800, height: 600, addEventListener() {} };
win.SillyTavern = undefined;
win.parent = win;
win.world_names = { '命定之诗与黄昏之歌v4.3': 1 };

/* ---------------- 加载模块（按 manifest 顺序） ---------------- */
console.log('=== 按顺序加载模块 ===');
for (const m of manifest.modules) {
  const abs = path.join(ROOT, m.path);
  if (!fs.existsSync(abs)) { ok(m.path, false, '文件不存在'); continue; }
  const code = fs.readFileSync(abs, 'utf8');
  try {
    new Function('window', 'document', 'console', 'setTimeout', 'setInterval', 'clearTimeout',
      'clearInterval', 'localStorage', 'navigator', 'crypto', 'fetch', 'AbortController',
      'Blob', 'URL', 'Response', 'TextDecoder', 'requestAnimationFrame', 'MutationObserver',
      'CustomEvent', 'Event', 'getComputedStyle', 'matchMedia',
      code)(
      win, doc, win.console, setTimeout, setInterval, clearTimeout, clearInterval,
      win.localStorage, win.navigator, win.crypto, win.fetch, AbortController,
      win.Blob, win.URL, win.Response, TextDecoder, win.requestAnimationFrame, win.MutationObserver,
      win.CustomEvent, win.Event, win.getComputedStyle, win.matchMedia,
    );
    console.log('  OK   ' + m.path);
  } catch (e) {
    console.log('  FAIL ' + m.path + '  ' + e.message);
    console.log('       ' + String(e.stack || '').split('\n').slice(0, 4).join('\n       '));
    fail += 1;
  }
}

/* ---------------- 检查 ---------------- */
console.log('\n=== 模块挂载 ===');
ok('__fiefBook 存在', !!win.__fiefBook);
ok('__fiefDiplo 存在', !!win.__fiefDiplo);
ok('__fiefCssDiplo 存在', !!win.__fiefCssDiplo);
ok('__fiefLedger 存在', !!win.__fiefLedger);

console.log('\n=== 世界书扫描 ===');
const dbg = win.__fiefBook.debug();
console.log('  条目 ' + dbg.条目数 + ' 条，势力 ' + dbg.势力数 + ' 个');
ok('读到世界书', dbg.条目数 > 500, String(dbg.条目数));
ok('拆出 10 个势力', dbg.势力数 === 10, String(dbg.势力数));
dbg.势力.forEach((x) => console.log('    ' + x));

console.log('\n=== 外交页渲染 ===');
const html = win.__fiefDiplo.html();
console.log('  HTML 长度 ' + html.length);
ok('渲染出 HTML', html.length > 2000, String(html.length));
ok('有势力大卡', html.indexOf('fl-dw-card') >= 0);
ok('有天下势力标题', html.indexOf('天 下 势 力') >= 0);
ok('列出了诺斯加德', html.indexOf('诺斯加德联盟') >= 0);
ok('列出了奥古斯提姆', html.indexOf('奥古斯提姆帝国') >= 0);
ok('不是错误页', html.indexOf('读 不 到 世 界 书') < 0);

console.log('\n=== 选择势力后 ===');
const dstate = win.__fiefDiplo.state;
dstate.faction = '奥古斯提姆帝国';
const html2 = win.__fiefDiplo.html();
ok('显示地点列表', html2.indexOf('fl-dp-row') >= 0);
ok('列出翠庭城', html2.indexOf('翠庭城') >= 0, '');
ok('显示规模标签', html2.indexOf('大型城市') >= 0);

console.log('\n=== 选择地点后 ===');
dstate.place = '翠庭城';
const html3 = win.__fiefDiplo.html();
ok('显示档案卡', html3.indexOf('fl-pf') >= 0);
ok('档案有地名', html3.indexOf('翠庭城') >= 0);
ok('档案有摘要', html3.indexOf('摘 要') >= 0 || html3.indexOf('原 文') >= 0);
ok('有动作按钮', html3.indexOf('data-dw-act="send"') >= 0);
ok('引文里没有未转义的尖括号', html3.indexOf('<script') < 0);

console.log('\n=== CSS 注入 ===');
console.log('  注入的 style: ' + styles.map((s) => s.id + '(' + s.len + ')').join(', '));
const diplo = styles.find((s) => s.id === 'fief-ledger-css-diplo');
ok('外交样式已注入', !!diplo, '没有');
if (diplo) {
  ok('样式有 .fl-dw-card', diplo.css.indexOf('.fl-dw-card') >= 0);
  ok('样式有 .fl-pf', diplo.css.indexOf('.fl-pf') >= 0);
  ok('样式有手机端媒体查询', diplo.css.indexOf('@media (max-width: 760px)') >= 0);
  ok('无 color-mix', diplo.css.indexOf('color-mix') < 0);
}

console.log('\n=== 兜底：世界书读不到时 ===');
const win2 = { window: null, console: { log() {}, error() {}, warn() {} }, document: doc };
win2.window = win2;
win2.localStorage = win.localStorage;
win2.navigator = win.navigator;
win2.TavernHelper = { getWorldbook: () => null, getWorldbookNames: () => [] };
new Function('window', 'console', fs.readFileSync(path.join(ROOT, 'modules/worldbook.js'), 'utf8'))(win2, win2.console);
const empty = win2.__fiefBook.debug();
ok('读不到时条目为 0', empty.条目数 === 0, String(empty.条目数));

console.log('\n' + (fail ? fail + ' 项失败 / ' + (fail + pass) : '全部通过 ✔  ' + pass + ' 项'));
process.exit(fail ? 1 : 0);
