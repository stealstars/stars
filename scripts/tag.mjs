/**
 * 给当前 HEAD 打一个版本 tag：v<version>
 *
 * 为什么要有 tag：loader 的版本锁靠它。
 *   别人脚本里写 TARGET_VERSION = '0.9.60'
 *   → loader 去拉 https://.../stars/v0.9.60/manifest.json
 *   → 拿到的是那一刻的完整快照，永远不变
 *
 * 所以我这边之后把 main 改成什么样，都影响不到锁在旧版本的人。
 * 没 tag 就没法锁——只能跟着 main 跑，一发布所有人都吃。
 *
 *   $env:GH_TOKEN = 'ghp_...'
 *   node scripts/tag.mjs            # 用 manifest.json 里的版本号
 *   node scripts/tag.mjs 0.9.60     # 手动指定
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.argv[2] || '';
if (!TOKEN) {
  console.error('缺 token：$env:GH_TOKEN = \'ghp_...\'');
  process.exit(1);
}

const OWNER = 'stealstars';
const REPO = 'stars';
const BRANCH = 'main';
const API = 'https://api.github.com';
const HEADERS = {
  Authorization: 'Bearer ' + TOKEN,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'fief-tag',
  'Content-Type': 'application/json',
};

async function api(p, opts = {}) {
  const r = await fetch(API + p, { ...opts, headers: { ...HEADERS, ...(opts.headers || {}) } });
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch (e) { j = { raw: text }; }
  if (!r.ok) {
    const err = new Error(r.status + ' ' + (j && j.message ? j.message : text.slice(0, 200)));
    err.status = r.status;
    err.body = j;
    throw err;
  }
  return j;
}

/* 版本号：命令行优先，其次 manifest */
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const argVer = process.argv.slice(2).find((a) => /^\d+\.\d+\.\d+/.test(a));
const version = argVer || manifest.version;
const tag = 'v' + version;

if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error('版本号不合法：' + version);
  process.exit(1);
}

console.log('=== 打 tag ===');
console.log('  版本 ' + version + '  →  tag ' + tag);

const ref = await api('/repos/' + OWNER + '/' + REPO + '/git/ref/heads/' + BRANCH);
const headSha = ref.object.sha;
console.log('  HEAD ' + headSha.slice(0, 8));

/* 已存在就先删：同版本号重发是允许的（改错了重推同一个版本） */
let existed = false;
try {
  const old = await api('/repos/' + OWNER + '/' + REPO + '/git/ref/tags/' + tag);
  existed = true;
  if (old.object.sha === headSha) {
    console.log('  tag 已存在且指向同一 commit，跳过');
    process.exit(0);
  }
  console.log('  tag 已存在但指向 ' + old.object.sha.slice(0, 8) + '，删除重建');
  await api('/repos/' + OWNER + '/' + REPO + '/git/refs/tags/' + tag, { method: 'DELETE' });
} catch (e) {
  if (e.status !== 404) throw e;
}

await api('/repos/' + OWNER + '/' + REPO + '/git/refs', {
  method: 'POST',
  body: JSON.stringify({ ref: 'refs/tags/' + tag, sha: headSha }),
});

console.log('  ' + (existed ? '已重建' : '已创建') + ' ' + tag + ' → ' + headSha.slice(0, 8));
console.log('\n锁定这个版本的方法：');
console.log("  loader.js 里把 TARGET_VERSION 改成 '" + version + "'");
