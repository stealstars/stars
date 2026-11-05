#!/usr/bin/env node
/**
 * 构建：算 SHA-256、生成 manifest.json
 *
 *   node scripts/build.mjs            正常打包
 *   node scripts/build.mjs --bump     版本号末位 +1
 *
 * 模块顺序在 MANIFEST 里写死：先数据与样式，再界面，最后主脚本。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MOD = path.join(ROOT, 'modules');

/**
 * 加载顺序很重要：
 *   数据 → 样式 → 界面 → 通道 → 主脚本
 * 主脚本最后跑，因为它在启动时要读 window.__fiefPolicy 之类。
 */
const MANIFEST = [
  { path: 'modules/worldbook.js', desc: '世界书读取' },
  { path: 'modules/policy.data.js', desc: '政令数据表' },
  { path: 'modules/policy.css.js', desc: '政令样式' },
  { path: 'modules/policy.ui.js', desc: '政令抽卡界面' },
  { path: 'modules/ai.css.js', desc: 'AI 面板样式' },
  { path: 'modules/ai.chan.js', desc: 'AI 通道' },
  { path: 'modules/ai.settings.js', desc: 'AI 凭据面板' },
  { path: 'modules/diplo.css.js', desc: '外交页样式' },
  { path: 'modules/diplo.ui.js', desc: '外交页逻辑' },
  { path: 'modules/prompts/diplomacy.js', desc: '外交提示词' },
  { path: 'modules/prompts/policy.js', desc: '政策提示词' },
  { path: 'modules/prompts/focus.js', desc: '国策提示词' },
  { path: 'modules/focus.data.js', desc: '国策树数据' },
  { path: 'modules/focus.css.js', desc: '国策树样式' },
  { path: 'modules/focus.ui.js', desc: '国策树界面' },
  { path: 'modules/gov.js', desc: '政体' },
  { path: 'modules/core.js', desc: '主脚本' },
];

const args = process.argv.slice(2);
const bump = args.includes('--bump');

/* ---------------- 版本 ---------------- */
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

function bumpVersion(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!m) return v;
  return m[1] + '.' + m[2] + '.' + (Number(m[3]) + 1);
}

if (bump) {
  pkg.version = bumpVersion(pkg.version);
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log('版本 → ' + pkg.version);
}

/* ---------------- 加载器版本自检 ----------------
   踩过的坑：改了 loader.js 却忘了把 LOADER_VERSION 往上提，结果线上和本地
   版本号一样，酒馆里那份旧 loader 判断「不比我的新」，永远不更新——改了等于
   没改。用户会直接问「你好像没改还」。
   所以这里兜底：内容变了但版本号没变，自动 +1。 */
const loaderPath = path.join(ROOT, 'loader.js');
const loaderSrc = fs.readFileSync(loaderPath, 'utf8');
const shaOf = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

let loaderSha = shaOf(loaderSrc);
const lvMatch = loaderSrc.match(/const\s+LOADER_VERSION\s*=\s*'(\d+)'/);
let loaderVersion = lvMatch ? Number(lvMatch[1]) : 0;
let loaderAutoBumped = false;

if (lvMatch) {
  const oldPath = path.join(ROOT, 'manifest.json');
  if (fs.existsSync(oldPath)) {
    try {
      const old = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
      if (old.loader && old.loader.sha256 && old.loader.sha256 !== loaderSha
        && Number(old.loader.version) === loaderVersion) {
        loaderVersion += 1;
        const fixed = loaderSrc.replace(
          /(const\s+LOADER_VERSION\s*=\s*')\d+(')/,
          '$1' + loaderVersion + '$2',
        );
        fs.writeFileSync(loaderPath, fixed, 'utf8');
        loaderSha = shaOf(fixed);
        loaderAutoBumped = true;
        console.log('[自动] loader.js 内容变了但 LOADER_VERSION 没变 → 提到 ' + loaderVersion);
      }
    } catch (e) { /* 旧 manifest 坏了就算了 */ }
  }
}

/* ---------------- 逐模块算 hash ---------------- */
const modules = [];
let totalBytes = 0;
let hasError = false;

for (const item of MANIFEST) {
  const abs = path.join(ROOT, item.path);
  if (!fs.existsSync(abs)) {
    console.error('[!!] 缺文件：' + item.path);
    hasError = true;
    continue;
  }
  const buf = fs.readFileSync(abs);
  const text = buf.toString('utf8');
  // 语法自检：能被 Function 编译就算过
  try {
    new Function(text);
  } catch (e) {
    console.error('[!!] ' + item.path + ' 语法错误：' + e.message);
    hasError = true;
    continue;
  }
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  modules.push({
    path: item.path,
    desc: item.desc,
    bytes: buf.length,
    sha256: sha,
  });
  totalBytes += buf.length;
  console.log('  ' + item.path.padEnd(30) + String(buf.length).padStart(8) + ' B  ' + sha.slice(0, 16) + '…');
}

if (hasError) {
  console.error('\n有模块没过，manifest 未生成');
  process.exit(1);
}

/* ---------------- 写 manifest ---------------- */
const manifest = {
  name: 'fief-ledger',
  displayName: '领地档案',
  version: pkg.version,
  channel: 'stable',
  schemaVersion: 1,
  loaderMin: '0.1.0',
  publishedAt: new Date().toISOString().slice(0, 10),
  /* 加载器自身的版本与指纹：build 靠它判断「改了内容却没提版本号」 */
  loader: { version: loaderVersion, sha256: loaderSha },
  moduleCount: modules.length,
  totalBytes,
  modules,
};

fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log('\nmanifest.json 已生成');
console.log('  版本   ' + manifest.version);
console.log('  加载器 v' + loaderVersion + (loaderAutoBumped ? '（已自动提升）' : ''));
console.log('  模块   ' + modules.length + ' 个');
console.log('  合计   ' + (totalBytes / 1024).toFixed(1) + ' KB');
console.log('  发布   ' + manifest.publishedAt);
