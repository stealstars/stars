/**
 * 外交页端到端测试
 *
 * 模拟酒馆环境（TavernHelper 返回真实命定世界书 + 假 AI 通道），
 * 检查：邻邦、势力卡、地点列表、AI 建档三条路径都通。
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
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    focus() {}, blur() {}, click() {}, scrollTop: 0, clientWidth: 800, clientHeight: 600,
    closest: () => null,
    dispatchEvent() { return true; },
    getContext: () => null,
  };
  // 每个元素都能再 querySelector 出元素，真实 DOM 里主脚本会直接对它们绑事件
  e.querySelector = () => mkEl('div');
  e.querySelectorAll = () => [];
  if (String(tag).toLowerCase() === 'style') {
    let v = '';
    Object.defineProperty(e, 'textContent', { set(x) { v = x; e._css = x; }, get() { return v; } });
  }
  return e;
};

const head = mkEl('head');
const body = mkEl('body');
const doc = {
  head, body,
  documentElement: mkEl('html'),
  createElement: mkEl,
  getElementById: () => mkEl('div'),
  querySelector: () => mkEl('div'),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  visibilityState: 'visible',
};
doc.documentElement.addEventListener = () => {};
doc.documentElement.removeEventListener = () => {};
doc.body.addEventListener = () => {};
doc.body.removeEventListener = () => {};

const origAppend = head.appendChild;
head.appendChild = function (c) {
  const r = origAppend.call(this, c);
  if (c.tagName === 'STYLE') styles.push({ id: c.id, len: (c._css || '').length, css: c._css || '' });
  return r;
};
head.addEventListener = () => {};
head.removeEventListener = () => {};

/* ---------------- 假 AI ---------------- */
const AI_REPLY = JSON.stringify({
  领地: '翠庭城',
  规模档: '大型城市',
  所属势力: '奥古斯提姆帝国',
  治理模式: '中央集权官僚 · 索莱尔省治所',
  状态: '承平',
  治安: '84',
  民心: '71',
  物资: '充裕',
  人口: '四千余户',
  金库: '约 22 万帝冕币',
  月净额: '+3.1 万',
  军事: [
    { 编制: '城卫军', 人数: '约一千八', 层级: '第三层级' },
    { 编制: '省属巡察队', 人数: '约三百', 层级: '第二层级' },
  ],
  营造: [
    { 名: '省督府', 数量: '1', 状态: '完好' },
    { 名: '翠庭大市', 数量: '1', 状态: '完好' },
  ],
  物产: [
    { 名: '谷物', 数量: '丰', 周期: '季', 状态: '外销' },
    { 名: '布匹', 数量: '中', 周期: '月', 状态: '外销' },
  ],
  要事: [
    '省督与魔法协会争夺矿税分配，账目已三月未结',
    '南境商队报称沼泽方向有魔族斥候出没，未见确证',
  ],
  治下: { 头衔: '省督', 主: '未记', 副: '巡察使', 态度: '配合' },
});

/* ---------------- 假 window ---------------- */
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
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  visualViewport: { width: 800, height: 600, addEventListener() {} },
  world_names: { '命定之诗与黄昏之歌v4.3': 1 },
  // ★ 酒馆助手的真实形状：getWorldbook 返回 Promise，条目字段是 name 不是 comment
  TavernHelper: {
    getWorldbookNames: () => ['命定之诗与黄昏之歌v4.3'],
    getCharWorldbookNames: () => ({ primary: '命定之诗与黄昏之歌v4.3', additional: [] }),
    getWorldbook: async (n) => {
      if (n !== '命定之诗与黄昏之歌v4.3') return [];
      return Object.keys(card.data.character_book.entries).map((k) => {
        const e = card.data.character_book.entries[k];
        return {
          uid: Number(k),
          name: e.comment,               // ← 酒馆助手叫 name
          enabled: true,
          content: e.content,
          strategy: { type: e.constant ? 'constant' : 'selective', keys: e.key || [] },
        };
      });
    },
    getVariables: () => ({
      stat_data: {
        主角: {
          资产: {
            晨星庄园: {
              类型: '领地', 品质: '优良',
              描述: [
                '<fief_domain>',
                '[领地|晨星庄园|1|奥古斯提姆帝国|仁政|承平]',
                '[核心|78|65|充裕|数百户]',
                '[府库|5.96万|帝冕币]',
                '[邻邦|索伦蒂斯王国|观望]',
                '[邻邦|诺斯加德联盟|戒备]',
                '</fief_domain>',
              ].join('\n'),
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
win.parent = win;
win.crypto = globalThis.crypto;
win.TextDecoder = TextDecoder;
win.AbortController = AbortController;
win.Blob = class { constructor(p) { this._c = p.join ? p.join('') : String(p); } };
win.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
win.Response = class {};
win.fetch = async () => ({ ok: false, status: 404 });

/* ---------------- 加载模块 ---------------- */
console.log('=== 按顺序加载模块 ===');
for (const m of manifest.modules) {
  const abs = path.join(ROOT, m.path);
  const code = fs.readFileSync(abs, 'utf8');
  try {
    new Function('window', 'document', 'console', 'setTimeout', 'setInterval', 'clearTimeout',
      'clearInterval', 'localStorage', 'navigator', 'crypto', 'fetch', 'AbortController',
      'Blob', 'URL', 'Response', 'TextDecoder', 'requestAnimationFrame', 'MutationObserver',
      'CustomEvent', 'Event', 'getComputedStyle', 'matchMedia', code)(
      win, doc, win.console, setTimeout, setInterval, clearTimeout, clearInterval,
      win.localStorage, win.navigator, win.crypto, win.fetch, AbortController,
      win.Blob, win.URL, win.Response, TextDecoder, win.requestAnimationFrame, win.MutationObserver,
      win.CustomEvent, win.Event, win.getComputedStyle, win.matchMedia,
    );
    console.log('  OK   ' + m.path);
  } catch (e) {
    console.log('  FAIL ' + m.path + '  ' + e.message);
    console.log('       ' + String(e.stack || '').split('\n').slice(1, 3).join('\n       '));
    fail += 1;
  }
}

/* ---------------- 挂载 ---------------- */
console.log('\n=== 模块挂载 ===');
ok('__fiefBook', !!win.__fiefBook);
ok('__fiefDiplo', !!win.__fiefDiplo);
ok('__fiefCssDiplo', !!win.__fiefCssDiplo);
ok('__fiefPrompts', !!win.__fiefPrompts);
ok('提示词是「外交档案」', !!(win.__fiefPrompts && win.__fiefPrompts['外交档案']));
ok('__fiefLedger', !!win.__fiefLedger);

/* ---------------- 邻邦 ---------------- */
console.log('\n=== 世界书扫描（异步） ===');
const dip = win.__fiefDiplo;
// 扫描是异步的，等它跑完
await win.__fiefBook.scan(false);
const sc = win.__fiefBook.scanSync();
dip.state.ready = !!(sc && sc.count);   // 正常由 ensureScan() 置位，测试里手动置
ok('扫到条目', !!sc && sc.count > 500, sc ? String(sc.count) : 'null');
ok('拆出势力', !!sc && Object.keys(sc.factions).length === 10, sc ? String(Object.keys(sc.factions).length) : '');
console.log('  条目 ' + sc.count + '，势力 ' + Object.keys(sc.factions).length);

console.log('\n=== 邻邦接入 ===');
dip.state.faction = '奥古斯提姆帝国';
dip.state.place = '';
// 主脚本在 renderDiplomacy 里塞邻邦；这里直接模拟
dip.setNeighbours([{ name: '索伦蒂斯王国', tone: '观望' }, { name: '诺斯加德联盟', tone: '戒备' }]);
dip.setOwnTier('村庄');
const dbg = dip.debug();
console.log('  邻邦: ' + dbg.邻邦.join(', '));
ok('邻邦被接收', dbg.邻邦.length === 2, String(dbg.邻邦.length));
ok('邻邦关联到世界书', dbg.邻邦.some((x) => /索伦蒂斯王国\(\d+\)/.test(x)), dbg.邻邦.join(','));

const html1 = dip.html();
ok('渲染出邻邦区块', html1.indexOf('邻 邦') >= 0);
ok('邻邦有索伦蒂斯', html1.indexOf('索伦蒂斯王国') >= 0);
ok('邻邦有态度标签', html1.indexOf('fl-dw-tone') >= 0 || html1.indexOf('观望') >= 0);

/* ---------------- 地点与原文 ---------------- */
console.log('\n=== 地点列表 ===');
ok('列出翠庭城', html1.indexOf('翠庭城') >= 0);
ok('有势力大卡', html1.indexOf('fl-dw-card') >= 0);

dip.state.place = '翠庭城';
const html2 = dip.html();
ok('显示原文档案', html2.indexOf('fl-pf') >= 0);
ok('有建档按钮', html2.indexOf('data-dw-act="build"') >= 0);
ok('显示世界书字数', html2.indexOf('世界书 ·') >= 0);

/* ---------------- AI 建档 ---------------- */
console.log('\n=== AI 建档 ===');
// 塞一个假 AI 通道
let captured = { system: '', user: '' };
win.__fiefAI = {
  chat(user, opts) {
    captured.user = user;
    captured.system = (opts && opts.system) || '';
    return Promise.resolve(AI_REPLY);
  },
  getConf: () => ({ model: 'glm-5.3-flash' }),
  loadAll: () => ({}), setConf: () => {}, maskKey: (x) => x,
};

dip.build();
await new Promise((r) => setTimeout(r, 60));

ok('提示词带了原文', captured.user.indexOf('世界书原文') >= 0);
ok('提示词带了地名', captured.user.indexOf('翠庭城') >= 0);
ok('提示词带了所属势力', captured.user.indexOf('奥古斯提姆帝国') >= 0);
ok('system 里有「照抄原文」', captured.system.indexOf('照抄') >= 0);
ok('system 里有「未见确证」', captured.system.indexOf('未见确证') >= 0);
ok('不是 busy 了', dip.state.busy === false, 'busy=' + dip.state.busy);
ok('没有报错', !dip.state.err, dip.state.err);
ok('拿到档案', !!dip.state.profile, '没有');

const html3 = dip.html();
ok('档案有规模', html3.indexOf('大型城市') >= 0);
ok('档案有治理', html3.indexOf('中央集权官僚') >= 0);
ok('档案有治安 84', html3.indexOf('84') >= 0);
ok('档案有军事', html3.indexOf('城卫军') >= 0);
ok('档案有要事', html3.indexOf('省督与魔法协会') >= 0);
ok('有重新建档按钮', html3.indexOf('data-dw-act="again"') >= 0);
ok('缓存写入了', !!win.localStorage.getItem('fief-ledger-diplo-cache-v1'));

/* ---------------- 缓存复用 ---------------- */
console.log('\n=== 缓存复用 ===');
dip.state.profile = null;
const html4 = dip.html();
ok('从缓存读回档案', html4.indexOf('城卫军') >= 0);
ok('列表标了已建档', html4.indexOf('已建档') >= 0);

/* ---------------- 失败路径 ---------------- */
console.log('\n=== 失败路径 ===');
dip.state.profile = null;
win.__fiefAI.chat = () => Promise.reject(new Error('模型返回空内容'));
dip.build();
await new Promise((r) => setTimeout(r, 60));
ok('报错被捕获', !!dip.state.err, '没有');
const html5 = dip.html();
ok('显示错误界面', html5.indexOf('建 档 失 败') >= 0);
ok('错误界面有重试', html5.indexOf('data-dw-act="build"') >= 0);

/* ---------------- CSS ---------------- */
console.log('\n=== CSS 注入 ===');
console.log('  ' + styles.map((s) => s.id + '(' + s.len + ')').join(', '));
const css = styles.find((s) => s.id === 'fief-ledger-css-diplo');
ok('外交样式注入', !!css);
if (css) {
  ok('有 .fl-dw-card', css.css.indexOf('.fl-dw-card') >= 0);
  ok('有 .fl-pf-metrics', css.css.indexOf('.fl-pf-metrics') >= 0);
  ok('无 color-mix', css.css.indexOf('color-mix') < 0);
}

console.log('\n' + (fail ? fail + ' 项失败 / ' + (fail + pass) : '全部通过 ✔  ' + pass + ' 项'));
process.exit(fail ? 1 : 0);
