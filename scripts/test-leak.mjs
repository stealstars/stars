/**
 * 泄漏检查
 *
 * 仓库是公开的。地址和密钥不能出现在任何会被推送的文件里。
 *
 * 这个测试守的是真出过的事：test-prompt.mjs 里硬编码了真实 API 密钥，
 * 已经推到公开仓库上了。
 *
 * 只扫会被推送的文件（upload.mjs 的 FILES + push-root.mjs 的清单），
 * 不扫 node_modules、临时产出的导入 JSON。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let pass = 0, fail = 0;
const ok = (n, v, e) => { if (v) { pass++; console.log('  OK   ' + n); } else { fail++; console.log('  FAIL ' + n + (e ? ' -> ' + e : '')); } };

/* ------------------------------------------------------------ 收集要推的文件 */

function listedInUpload() {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/upload.mjs'), 'utf8');
  const m = src.match(/const FILES\s*=\s*\[([\s\S]*?)\];/);
  if (!m) return [];
  const out = [];
  const re = /\[\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/g;
  let x;
  while ((x = re.exec(m[1])) !== null) out.push(x[1]);
  return out;
}

function listedInPushRoot() {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/push-root.mjs'), 'utf8');
  // 抓所有 'xxx.json' / 'xxx.js' / 'README.md' 之类的字符串
  const out = [];
  const re = /'((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:js|mjs|json|md|css|html|txt|yml|yaml))'/g;
  let x;
  while ((x = re.exec(src)) !== null) {
    const p = x[1];
    if (p.indexOf('/') < 0 && fs.existsSync(path.join(ROOT, p))) out.push(p);
  }
  return out;
}

const files = Array.from(new Set(listedInUpload().concat(listedInPushRoot())))
  .filter((p) => fs.existsSync(path.join(ROOT, p)));

console.log('要推的文件 ' + files.length + ' 个：');
files.forEach((f) => console.log('  ' + f));
console.log('');

/* ------------------------------------------------------------ 规则 */

const RULES = [
  {
    name: '真实 API 密钥',
    // sk- 后面跟 20 位以上的十六进制/字母数字组合
    re: /\bsk-[A-Za-z0-9]{20,}/g,
    hint: '把密钥换成 process.env.XXX，或在测试里用 sk-test-123 这种假值',
  },
  {
    name: 'gg- 开头的中转密钥',
    re: /\bgg-[A-Za-z0-9-]{12,}/g,
    hint: '同上',
  },
  {
    name: '真实中转域名',
    re: /\b(?:[\w-]+\.)*(?:ggchan\.dev|gcli\.[\w.-]+)/gi,
    hint: '注释里也不要写，用 https://你的中转地址 代替',
  },
  {
    name: '本机 API 地址',
    re: /\b127\.0\.0\.1:\d{4,5}\/v1\b/g,
    hint: '测试里用 https://example.test/v1',
  },
  {
    name: 'GitHub token',
    re: /\bghp_[A-Za-z0-9]{20,}/g,
    hint: '不要提交 token',
  },
  {
    name: 'Bearer + 长串',
    re: /Bearer\s+[A-Za-z0-9_-]{30,}/g,
    hint: '不要硬编码完整 Authorization',
  },
];

/* ------------------------------------------------------------ 扫 */

for (const rule of RULES) {
  const hits = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      rule.re.lastIndex = 0;
      const m = lines[i].match(rule.re);
      if (m) {
        for (const hit of m) {
          hits.push({ file: f, line: i + 1, text: hit });
        }
      }
    }
  }
  ok('没有' + rule.name, hits.length === 0,
    hits.length ? hits.map((h) => h.file + ':' + h.line + ' → ' + h.text).join(' | ') : '');
  if (hits.length) console.log('       修法：' + rule.hint);
}

/* ------------------------------------------------------------ 反向验证规则本身有用 */

console.log('\n=== 规则自检（故意喂样本，必须命中）===');
// 样本按片段拼出来，免得这个文件自己就成了泄漏源
const P = (...xs) => xs.join('');
const SAMPLES = [
  [P('sk-', '4b7a54e48b24894e9b9892a19f03b57a0b2dd21c82aa0a'), '真实 API 密钥'],
  [P('gg-', 'gcli-pO5zJnyBXn91smqU2v6xLyQ6nc'), 'gg- 开头的中转密钥'],
  [P('gcli', '.ggchan', '.dev'), '真实中转域名'],
  [P('127', '.0.0.1:8790', '/v1'), '本机 API 地址'],
  [P('ghp_', 'dp9Sdv0DNmToA4DP1AUBUkWFfE0ZcH4A'), 'GitHub token'],
];
for (const [sample, label] of SAMPLES) {
  const rule = RULES.find((r) => r.name === label);
  rule.re.lastIndex = 0;
  ok('能抓到 ' + label, rule.re.test(sample), sample.slice(0, 40));
}

/* 假值不该被误报 */
console.log('\n=== 不该误报 ===');
const SAFE = [
  'const KEY = process.env.FIEF_KEY;',
  "AI.setConf('外交', { base: 'https://example.test/v1', key: 'sk-test-123456' });",
  '端点只填 host（例如 https://你的中转地址）',
  "placeholder=\"sk-...\"",
];
for (const s of SAFE) {
  let bad = null;
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    if (rule.re.test(s)) { bad = rule.name + ' → ' + s; break; }
  }
  ok('放行：' + s.slice(0, 46), !bad, bad);
}

console.log('\n' + (fail ? fail + ' 项失败 / ' + (fail + pass) : '全部通过 ✔  ' + pass + ' 项'));
process.exit(fail ? 1 : 0);
