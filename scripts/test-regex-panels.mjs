/**
 * 正则补丁三个面板的渲染测试。
 *
 * 用极简 DOM 桩把 <script> 跑起来，喂符合世界书契约的样例，
 * 检查面板真的把字渲染出来了。
 *
 * 背景：世界书从 6合1 换到 7合1 时，[要事] 改名成了 [政务]，
 * 面板还在读旧名，整块静默消失——这种错语法检查发现不了，只有真跑才知道。
 */
import fs from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('  OK   ' + name); }
  else { fail += 1; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
}

const P = 'D:/223/领地开始/正则补丁-领地扩展6.json';
const j = JSON.parse(fs.readFileSync(P, 'utf8'));

/* ---------- 万能 DOM 桩 ---------- */
function makeEnv(sampleText, rawId) {
  const nodes = new Map();

  function mkNode(id) {
    const store = { _text: '', _html: '', _visible: true };
    let proxy;
    const target = {
      id,
      get _text() { return store._text; },
      set _text(v) { store._text = v; },
      get _html() { return store._html; },
      set _html(v) { store._html = v; },
      get length() { return 1; },
    };
    proxy = new Proxy(target, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'text') return (v) => { if (v === undefined) return store._text; store._text = String(v); return proxy; };
        if (k === 'html') return (v) => { if (v === undefined) return store._html; store._html = String(v); return proxy; };
        if (k === 'val') return (v) => (v === undefined ? '' : proxy);
        if (k === 'find') return (sel) => get(String(sel).replace(/^[#.]/, ''));
        if (k === 'show') return () => { store._visible = true; return proxy; };
        if (k === 'hide') return () => { store._visible = false; return proxy; };
        if (k === 'empty') return () => { store._html = ''; return proxy; };
        if (k === 'each' || k === 'get' || k === 'each') return () => proxy;
        if (k === 'parent' || k === 'closest' || k === 'next' || k === 'prev') return () => proxy;
        return () => proxy;
      },
    });
    return proxy;
  }

  function get(k) {
    if (!nodes.has(k)) nodes.set(k, mkNode(k));
    return nodes.get(k);
  }

  get(rawId)._text = sampleText;

  const body = mkNode('body');
  body.find = (sel) => get(String(sel).replace(/^[#.]/, ''));

  function $(a) {
    if (typeof a === 'function') { a(); return body; }
    if (a === 'body') return body;
    if (typeof a === 'string') return get(a.replace(/^[#.]/, ''));
    return body;
  }
  $.fn = {};

  const sb = {
    $, jQuery: $,
    document: {
      querySelector: (s) => get(String(s).replace(/^[#.]/, '')),
      querySelectorAll: () => [],
      dispatchEvent: () => {},
      createElement: () => mkNode('t'),
      body,
    },
    console, setTimeout, clearTimeout, JSON, Math, String, Number, Object, Array, RegExp,
    parseInt, parseFloat, isNaN, Date,
  };
  sb.window = sb;
  sb.TavernHelper = { getVariables: () => ({}) };
  vm.createContext(sb);
  return { sb, get };
}

function runRule(matchName, sample, rawId) {
  const r = j.find((x) => new RegExp(matchName).test(String(x.scriptName)));
  if (!r) return { err: '找不到规则 ' + matchName };
  const js = (String(r.replaceString).match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
  const { sb, get } = makeEnv(sample, rawId);
  try {
    vm.runInContext(js, sb, { filename: matchName });
    return { get };
  } catch (e) {
    return { err: e.message };
  }
}

const plain = (html) => String(html || '').replace(/<[^>]+>/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);

/* ================= 1. 领地总览 ================= */
/* 契约（v9）：[领地|名|七档名|势力] [状态|治安|民心|物资|人口] [钱|金库|月净额]
               [军事|编制|人数] [政务|一行一条] */
const DOMAIN = [
  '[领地|灰冠领|村庄|诺斯加德联盟]',
  '[状态|72|68|充足|数百人]',
  '[钱|1,250,000 Z|+500,000 Z]',
  '[军事|民兵巡逻队|120]',
  '[政务|在建工程：加固北侧木栅栏，工期还有1个月]',
  '[政务|派系博弈：本地猎户行会与谷物商争夺仓场]',
  '[政务|外部机遇：诺斯加德商队愿以三成溢价收购铁器]',
  '[政务|待决政务：是否减免今冬赋税以安民心]',
].join('\n');

console.log('=== 1. 领地总览 ===');
const a = runRule('领地总览', DOMAIN, 'fif-domain-raw');
if (a.err) {
  ok('脚本能跑', false, a.err);
} else {
  const keysHtml = a.get('fif-keys')._html;
  const rowsHtml = a.get('fif-rows')._html;
  const subline = a.get('fif-subline')._html;
  const keys = plain(keysHtml);

  ok('读到 [政务] 四条', /加固北侧木栅栏/.test(keysHtml) && /猎户行会/.test(keysHtml)
    && /三成溢价/.test(keysHtml) && /减免今冬赋税/.test(keysHtml));
  ok('页眉显示档位', /村庄/.test(subline));
  ok('页眉显示势力', /诺斯加德联盟/.test(subline));
  ok('金库显示', /1,250,000/.test(rowsHtml));
  ok('月净额显示', /\+500,000/.test(rowsHtml));
  ok('军事显示', /民兵巡逻队/.test(a.get('fif-army')._html));
  ok('规模行只显示档位名', /村庄/.test(rowsHtml));
  ok('没有硬编码旧数值', !/400万|10万亿|2万亿|3000亿Z\+|2万Z\/月/.test(rowsHtml));

  /* 分类：在建工程→工，外部机遇→邻 */
  ok('在建工程归「工」', /is-build/.test(keysHtml));
  ok('外部机遇归「邻」', /is-diplo/.test(keysHtml));

  for (const k of keys) if (k.length > 1) console.log('    ' + k);
}

/* ================= 2. 建设规划 ================= */
const BUILD = [
  '[建设|北门石垒|防务|180万Z|2个月|加厚城墙并增设箭楼]',
  '[建设|谷仓扩建|经济|60万Z|1个月|提升储粮上限]',
].join('\n');

console.log('\n=== 2. 建设规划 ===');
const b = runRule('建设规划', BUILD, 'fib-build-raw');
if (b.err) {
  ok('脚本能跑', false, b.err);
} else {
  let found = '';
  for (const id of ['fib-list', 'fib-cards', 'fib-body', 'fib-items']) {
    const h = b.get(id)._html;
    if (h && /北门石垒/.test(h)) { found = id; break; }
  }
  ok('渲染出建设卡片', !!found, '未找到容器');
  if (found) {
    const h = b.get(found)._html;
    ok('读到第一条', /北门石垒/.test(h));
    ok('读到第二条', /谷仓扩建/.test(h));
    ok('显示类别', /防务/.test(h));
    ok('显示估价', /180万Z/.test(h));
    ok('显示工期', /2个月/.test(h));
  }
}

/* ================= 3. 月度结算 ================= */
/* 契约（v9）：事件 = 1-2 条叙事 + 末条账务核定 */
const REPORT = [
  '[结算|灰冠领|村庄|复兴纪元488年-2月-新芽]',
  '[收入|商贸税|120000|Z]',
  '[支出|驻军军饷|40000|Z]',
  '[事件|内政：修缮北门，商队往来增多，治安升至72]',
  '[事件|外局：诺斯加德商队愿以三成溢价收购铁器]',
  '[事件|账务核定：期初1250000，本期净收支+80000，期末1330000]',
  '[待决|是否减免今冬赋税以安民心]',
].join('\n');

console.log('\n=== 3. 月度结算 ===');
const c = runRule('月度结算', REPORT, 'fir-report-raw');
if (c.err) {
  ok('脚本能跑', false, c.err);
} else {
  const recon = c.get('fir-recon-body')._html;
  ok('净额算出 +80,000', /80,000/.test(c.get('fir-net-v')._text));
  ok('对账标绿', /is-ok/.test(recon));
  ok('对账没标红', !/is-bad/.test(recon));
  console.log('    对账: ' + plain(recon).join(' | '));
}

/* ================= 4. 账目对不上必须标红 ================= */
console.log('\n=== 4. 账目对不上时 ===');
const BAD = REPORT.replace('本期净收支+80000', '本期净收支+95000');
const d = runRule('月度结算', BAD, 'fir-report-raw');
if (d.err) {
  ok('脚本能跑', false, d.err);
} else {
  const recon = d.get('fir-recon-body')._html;
  ok('标红', /is-bad/.test(recon));
  ok('没误标绿', !/is-ok/.test(recon));
  console.log('    ' + plain(recon).join(' | ').slice(0, 120));
}

console.log('\n' + (fail ? fail + ' 项失败  ' : '全部通过 ✔  ') + (pass + fail) + ' 项');
process.exit(fail ? 1 : 0);
