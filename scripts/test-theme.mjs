/**
 * 主题配色
 *
 * 之前的问题：换主题只换了按钮和描边的颜色，背景还是黑的。
 *
 * 原因：paletteOf 把所有底色都往近黑色里混，系数写成了 0.955，
 * 意思是「95.5% 是黑，主色只占 4.5%」。八个主题的 bg 全落在 #09~#0e，
 * 肉眼根本分不出来。
 *
 * 这个测试锁住三件事：
 *   ① 背景真的带上了主色（亮度不能低得像纯黑）
 *   ② 不同主题的背景确实不一样（色差要够）
 *   ③ 改了底色之后，文字还看得清（对比度够）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = fs.readFileSync(path.join(ROOT, 'modules/core.js'), 'utf8');
const POLICY_CSS = fs.readFileSync(path.join(ROOT, 'modules/policy.css.js'), 'utf8');
const AI_CSS = fs.readFileSync(path.join(ROOT, 'modules/ai.css.js'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (n, c, e) => {
  if (c) pass += 1;
  else { fail += 1; console.log('  [!!] ' + n + (e ? '  -> ' + e : '')); }
};

/* ---- 把 core.js 里的配色函数抠出来真跑 ---- */
const hexToRgb = (hex) => {
  let h = String(hex).replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
const mixHex = (col, to, t) => {
  const a = hexToRgb(col), b = hexToRgb(to);
  return rgbToHex(a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t, a[2] * (1 - t) + b[2] * t);
};
const lum = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const la = lum(a), lb = lum(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
};
const dist = (a, b) => {
  const A = hexToRgb(a), B = hexToRgb(b);
  return Math.sqrt((A[0] - B[0]) ** 2 + (A[1] - B[1]) ** 2 + (A[2] - B[2]) ** 2);
};

/** 从源码抠实际用的系数，避免测试和实现各写一套 */
function coeffs() {
  const seg = CORE.slice(CORE.indexOf('function paletteOf'));
  const body = seg.slice(0, seg.indexOf('\n  }'));
  const grab = (key) => {
    // 第一个参数是变量 accent，不是字面色值
    const m = body.match(new RegExp(key + ": mixHex\\([^,]+, '(#[0-9a-f]{6})', ([0-9.]+)\\)", 'i'));
    return m ? { to: m[1], t: parseFloat(m[2]) } : null;
  };
  return { bg: grab('bg'), bg2: grab('bg2'), surface: grab('surface'), surface2: grab('surface2') };
}

const C = coeffs();
console.log('=== 1. 配色系数（从源码读的实际值）===');
ok('抠到 bg 系数', !!C.bg, JSON.stringify(C.bg));
ok('抠到 bg2 系数', !!C.bg2);
ok('抠到 surface 系数', !!C.surface);
ok('抠到 surface2 系数', !!C.surface2);
console.log('    bg   t=' + (C.bg || {}).t + '  to=' + (C.bg || {}).to);
console.log('    bg2  t=' + (C.bg2 || {}).t + '  to=' + (C.bg2 || {}).to);
console.log('    s1   t=' + (C.surface || {}).t + '  to=' + (C.surface || {}).to);
console.log('    s2   t=' + (C.surface2 || {}).t + '  to=' + (C.surface2 || {}).to);

console.log('\n=== 2. 主色必须在背景里占够分量 ===');
{
  // 0.955 = 95.5% 是黑，主色只占 4.5%，这正是 bug 的根
  ok('bg 系数 <= 0.86', C.bg.t <= 0.86, String(C.bg.t));
  ok('bg2 系数 <= 0.84', C.bg2.t <= 0.84, String(C.bg2.t));
  ok('surface 系数 <= 0.78', C.surface.t <= 0.78, String(C.surface.t));
  ok('surface2 系数 <= 0.74', C.surface2.t <= 0.74, String(C.surface2.t));
  // 层次要递减：bg 最暗，surface2 最亮
  ok('层次递进 bg < bg2 < s1 < s2', C.bg.t > C.bg2.t && C.bg2.t > C.surface.t && C.surface.t > C.surface2.t,
    [C.bg.t, C.bg2.t, C.surface.t, C.surface2.t].join(' > '));
}

const THEMES = [
  ['琥珀', '#d4af5a'], ['青玉', '#6ec2a0'], ['朱砂', '#cf6a55'], ['靛蓝', '#7d9bd6'],
  ['紫檀', '#b184c9'], ['苔绿', '#9cb56a'], ['墨青', '#63a8b8'], ['霜银', '#c3ccd8'],
];

console.log('\n=== 3. 八个主题的背景都要真的不一样 ===');
{
  const bgs = THEMES.map(([, a]) => mixHex(a, C.bg.to, C.bg.t));
  let min = 999, pair = '';
  for (let i = 0; i < bgs.length; i += 1) {
    for (let j = i + 1; j < bgs.length; j += 1) {
      const d = dist(bgs[i], bgs[j]);
      if (d < min) { min = d; pair = THEMES[i][0] + '-' + THEMES[j][0]; }
    }
  }
  ok('两两色差 >= 6', min >= 6, '最小 ' + min.toFixed(1) + ' (' + pair + ')');
  // 旧的只有 1.4，等同于完全看不出区别
  ok('明显好于旧版', min > 3, '最小 ' + min.toFixed(1));
  console.log('    最小色差 ' + min.toFixed(1) + ' (' + pair + ')');
}

console.log('\n=== 4. 背景不能黑得像纯黑 ===');
{
  for (const [n, a] of THEMES) {
    const bg = mixHex(a, C.bg.to, C.bg.t);
    const L = lum(bg);
    ok(n + ' 亮度 > 0.008', L > 0.008, bg + ' L=' + L.toFixed(4));
  }
}

console.log('\n=== 5. 文字对比度要过 AA ===');
{
  for (const [n, a] of THEMES) {
    const text = mixHex('#ece2cc', a, 0.13);
    for (const key of ['bg', 'bg2', 'surface', 'surface2']) {
      const c = mixHex(a, C[key].to, C[key].t);
      const cr = contrast(text, c);
      ok(n + ' 正文/ ' + key + ' >= 4.5', cr >= 4.5, cr.toFixed(2));
    }
  }
}

console.log('\n=== 6. 描边和文字色也随主题走 ===');
{
  ok('--fl-text 用主色推', /text: mixHex\('#ece2cc', accent, 0\.13\)/.test(CORE));
  ok('--fl-bright 用主色推', /bright: mixHex\('#f8f1dd', accent, 0\.09\)/.test(CORE));
  ok('--fl-line 基于 accent-rgb', /--fl-line: rgba\(var\(--fl-accent-rgb\),0\.13\)/.test(CORE));
  const setCount = (CORE.match(/set\('--fl-/g) || []).length;
  ok('至少写了 14 个变量', setCount >= 14, String(setCount));
  ok('全屏层跟着变', /screen\.style\.backgroundColor = p\.bg/.test(CORE));
}

console.log('\n=== 7. 输入框底色不许写死暖黑 ===');
{
  // 写死的 #14110b 在青玉主题下会突兀
  ok('policy 输入框用变量', /background: var\(--fl-surface2/.test(POLICY_CSS));
  ok('policy autofill 用变量', /-webkit-box-shadow: 0 0 0 1000px var\(--fl-surface2/.test(POLICY_CSS));
  ok('ai option 用变量', /\.fl-aic-sel option \{ background: var\(--fl-surface2/.test(AI_CSS));
  ok('没有写死的 #14110b', !/background: #14110b/.test(POLICY_CSS));
  ok('没有写死的 #17120c', !/background: #17120c/.test(AI_CSS));
  ok('core 输入框用变量或深底', /background: #14110b|background: var\(--fl-surface2/.test(CORE));
}

console.log('\n=== 8. 背景层都在用变量 ===');
{
  const uses = (CORE.match(/background(-color)?:\s*var\(--fl-b/g) || []).length;
  ok('核心背景至少 12 处走变量', uses >= 12, String(uses));
  ok('没有写死的 #0e0c07 以外的黑底面板', !/background:\s*#0[0-9a-f]{5}[^;]*;/.test(CORE.replace(/--fl-bg:\s*#0e0c07/, '')));
}

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
