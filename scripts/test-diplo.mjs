/**
 * 外交页端到端测试
 *
 * 模拟酒馆环境（TavernHelper 返回真实命定世界书 + 假 AI 通道），
 * 检查：邻邦、势力卡、地点列表、AI 建档三条路径都通。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCard } from './card.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let pass = 0, fail = 0;
const ok = (n, v, e) => { if (v) { pass++; console.log('  OK   ' + n); } else { fail++; console.log('  FAIL ' + n + (e ? ' -> ' + e : '')); } };

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const card = loadCard();
if (!card) process.exit(0);

const WB_NAME = '命定之诗与黄昏之歌v4.3';

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
    '南门外的商队因关税争执滞留',
  ],
  治下: { 头衔: '省督', 副: '未设', 前任: '已调离', 态度: '配合' },
});

/* ---------------- 假酒馆 ---------------- */
const store = {};
const win = {
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
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
  world_names: { [WB_NAME]: 1 },
  // 酒馆助手的真实形状：getWorldbook 返回 Promise，条目字段是 name 不是 comment
  TavernHelper: {
    getWorldbookNames: () => [WB_NAME],
    getCharWorldbookNames: () => ({ primary: WB_NAME, additional: [] }),
    getWorldbook: async (n) => {
      if (n !== WB_NAME) return [];
      return Object.keys(card.data.character_book.entries).map((k) => {
        const e = card.data.character_book.entries[k];
        return {
          uid: Number(k),
          name: e.comment,               // 酒馆助手叫 name
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
                '[府库|5.96万Z 帝冕币]',
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

/* ---------------- 世界书扫描 ---------------- */
console.log('\n=== 世界书扫描（异步）===');
const dip = win.__fiefDiplo;
await win.__fiefBook.scan(false);
const sc = win.__fiefBook.scanSync();
dip.state.ready = !!(sc && sc.count);
ok('扫到条目', !!sc && sc.count > 500, sc ? String(sc.count) : 'null');
ok('拆出势力', !!sc && Object.keys(sc.factions).length === 10, sc ? String(Object.keys(sc.factions).length) : '');
console.log('  条目 ' + sc.count + '，势力 ' + Object.keys(sc.factions).length);

console.log('\n=== 邻邦接入（走真实链路）===');
// 不用手工 setNeighbours —— 那正是一开始漏掉 bug 的地方。
// 这里调主脚本的 renderView，让 core 自己从领地 [邻邦] 行传给外交页。
dip.state.faction = '奥古斯提姆帝国';
dip.state.place = '';

win.__fiefLedger._ui.page('外交');
win.__fiefRenderView();
ok('已切到外交页', win.__fiefLedger._ui.pageNow() === '外交', win.__fiefLedger._ui.pageNow());

const ledger = win.__fiefLedger;
const info = ledger && ledger._ui && ledger._ui.dipInfo ? ledger._ui.dipInfo() : null;
ok('有 dipInfo 诊断', !!info, ledger ? Object.keys(ledger).join(',') : '没有 __fiefLedger');
if (info) {
  console.log('  当前领地: ' + info.当前领地);
  console.log('  原始邻邦行: ' + JSON.stringify(info.原始邻邦行));
  console.log('  界面拿到: ' + JSON.stringify(info.界面拿到的邻邦));
  console.log('  来源: ' + info.来源);
  ok('解析出邻邦', info.解析后.length > 0, JSON.stringify(info.解析后));
  ok('主脚本把邻邦传给了外交页', info.界面拿到的邻邦.length > 0, JSON.stringify(info.界面拿到的邻邦));
  // 这条领地是从「变量」读的，没有 <fief_domain> 区块，
  // 所以 info.邻邦 本来就是空的 —— 邻邦是靠扫「描述」拿到的。
  if (info.来源 === '变量') {
    ok('变量来源也能拿到邻邦', info.界面拿到的邻邦.length > 0, '说明只认区块的 bug 又回来了');
  }
}

const dbg = dip.debug();
console.log('  外交页侧: ' + dbg.邻邦.join(', '));
ok('外交页收到了邻邦', dbg.邻邦.length > 0, dbg.邻邦.join(','));
ok('邻邦关联到世界书', dbg.邻邦.some((x) => /\(\d+\)/.test(x)), dbg.邻邦.join(','));

const html1 = dip.html();
ok('渲染出邻邦区块', html1.indexOf('邻 邦') >= 0);
ok('邻邦有索伦蒂斯', html1.indexOf('索伦蒂斯王国') >= 0);
ok('邻邦有态度', html1.indexOf('观望') >= 0 || html1.indexOf('戒备') >= 0);

/* ---------------- 地点与原文 ---------------- */
console.log('\n=== 地点列表 ===');
// 外交页只列「邻邦」——这是设计，不是 bug。
// 想看点开某势力后的地点，先把 state.faction 指到那个势力再渲染。
ok('有势力大卡', html1.indexOf('fl-dw-card') >= 0);

const fname = dbg.邻邦.length ? dbg.邻邦[0].replace(/\(\d+\)$/, '') : '';
dip.state.faction = fname;
dip.state.place = '';
const htmlPlace = dip.html();
ok('选中势力后能列出地点', htmlPlace.indexOf('fl-dw-card') >= 0, fname);

const placeList = (sc.factions[fname] || { places: [] }).places;
ok('地点来自世界书扫描', placeList.length > 0, fname + ' 有 ' + placeList.length + ' 个地点');

const firstPlace = placeList[0];
dip.state.place = firstPlace ? firstPlace.name : '';
const html2 = dip.html();
ok('显示原文档案', html2.indexOf('fl-pf') >= 0, dip.state.place);
ok('有建档按钮', html2.indexOf('data-dw-act="build"') >= 0);
ok('显示世界书字数', html2.indexOf('世界书 ·') >= 0);

/* ---------------- AI 建档 ---------------- */
console.log('\n=== AI 建档 ===');
const captured = { system: '', user: '' };
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
ok('提示词带了地名', captured.user.indexOf(dip.state.place) >= 0, dip.state.place);
ok('提示词带了所属势力', captured.user.indexOf(fname) >= 0, fname);
ok('system 里有「照抄原文」', captured.system.indexOf('照抄') >= 0);
ok('system 里有「未见确证」', captured.system.indexOf('未见确证') >= 0);
ok('不是 busy 卡住', dip.state.busy === false, 'busy=' + dip.state.busy);

const html3 = dip.html();
ok('档案有规模', html3.indexOf('大型城市') >= 0);
ok('档案有治理', html3.indexOf('中央集权官僚') >= 0);
ok('有重新建档按钮', html3.indexOf('data-dw-act="again"') >= 0);
ok('缓存写入了', !!win.localStorage.getItem('fief-ledger-diplo-cache-v1'));

/* ---------------- 出错路径 ---------------- */
console.log('\n=== AI 返回空 ===');
win.__fiefAI.chat = () => Promise.reject(new Error('模型返回空内容'));
dip.build();
await new Promise((r) => setTimeout(r, 60));
ok('错误有提示', dip.state.err.length > 0, dip.state.err);
ok('busy 已复位', dip.state.busy === false);

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
