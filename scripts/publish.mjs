/**
 * 一键发布：构建 → 推送 → 校验
 *
 *   $env:GH_TOKEN = '...'
 *   node scripts/publish.mjs              自动加版本号
 *   node scripts/publish.mjs --no-bump    不加版本号
 *
 * 跑完会核对线上 11 个模块的 sha256，对不上就红字报警。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'stealstars';
const REPO = 'stars';
const BRANCH = 'main';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.argv[2] || '';

if (!TOKEN) {
  console.error('缺 token。设环境变量：$env:GH_TOKEN = "..."; 再跑一次');
  process.exit(1);
}
if (TOKEN.length < 20) {
  console.error('token 看着不对（太短）');
  process.exit(1);
}

const bump = process.argv.indexOf('--no-bump') < 0;
const say = (...a) => console.log(...a);
const step = (n, t) => console.log('\n=== ' + n + '. ' + t + ' ===');

const run = (args, opts) => {
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { FORCE: '1' }),
    ...(opts || {}),
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

/* ---------- 1. 构建 ---------- */
step(1, '构建');
const build = run([path.join(ROOT, 'scripts/build.mjs')].concat(bump ? ['--bump'] : []));
say(build.out.trim().split('\n').slice(-4).join('\n'));
if (build.code !== 0) { console.error('构建失败'); process.exit(1); }

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
say('版本 ' + manifest.version + '，' + manifest.modules.length + ' 个模块');

/* ---------- 2. 泄漏检查 ---------- */
step(2, '泄漏检查');
const leak = run([path.join(ROOT, 'scripts/test-leak.mjs')]);
const leakTail = leak.out.trim().split('\n').slice(-1)[0];
say(leakTail);
if (leak.code !== 0) { console.error('有密钥泄漏，不推'); process.exit(1); }

/* ---------- 3. 推送 ---------- */
step(3, '推送模块');
const up = run([path.join(ROOT, 'scripts/upload.mjs'), TOKEN]);
const upKeep = up.out.split('\n').filter((l) => /新树|commit|分支|失败|错误/.test(l));
say(upKeep.join('\n') || '(无输出)');
if (!/分支已更新/.test(up.out)) { console.error('推送没成功'); process.exit(1); }

step(4, '推送根目录');
const root = run([path.join(ROOT, 'scripts/push-root.mjs'), TOKEN]);
say(root.out.split('\n').filter((l) => /更新|完成|失败/.test(l)).join('\n'));

/* ---------- 5. 核对线上 ---------- */
step(5, '核对线上 hash');
const gh = async (p) => {
  const res = await fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + p + '?ref=' + BRANCH, {
    headers: { 'User-Agent': 'x', 'Cache-Control': 'no-cache', Authorization: 'Bearer ' + TOKEN },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + p);
  return res.json();
};
const sha = async (bytes) => {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

let bad = 0;
try {
  const remote = await gh('manifest.json');
  const rj = JSON.parse(Buffer.from(remote.content, 'base64').toString('utf8'));
  if (rj.version !== manifest.version) {
    console.error('  线上版本 ' + rj.version + ' ≠ 本地 ' + manifest.version);
    bad += 1;
  } else {
    say('  线上版本 ' + rj.version + ' ✔');
  }
  for (const mod of manifest.modules) {
    const f = await gh(mod.path);
    const bytes = new Uint8Array(Buffer.from(f.content, 'base64'));
    const got = await sha(bytes);
    if (got !== mod.sha256.toLowerCase()) {
      console.error('  ✘ ' + mod.path + '  hash 不符');
      bad += 1;
    } else {
      say('  ✔ ' + mod.path);
    }
  }
} catch (e) {
  console.error('  核对失败: ' + e.message);
  bad += 1;
}

/* ---------- 6. 打包 ---------- */
step(6, '打包导入文件');
const pack = run([path.join(ROOT, 'scripts/pack.mjs')]);
say(pack.out.trim().split('\n').slice(0, 3).join('\n'));

console.log('\n' + '─'.repeat(50));
if (bad) {
  console.error('发布完成，但核对有 ' + bad + ' 处问题，先别刷新。');
  process.exit(1);
}
console.log('✔ 全部正常。刷新页面即可，不用重新导入。');
console.log('  版本 ' + manifest.version);
