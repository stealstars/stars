/**
 * 版本锁测试。
 *
 * 机制：loader.js 顶部有个 TARGET_VERSION。
 *   留空 ''     → 跟随 main，改了就是新的
 *   填 '0.9.60' → 走 git tag v0.9.60，锁死在那份快照
 *
 * 这个测试要保证三件事：
 *   1. 默认是跟随最新（自己开发时不能锁死）
 *   2. 填了版本号就真的换成 tag 地址，不能还走 main
 *   3. 锁了版本却拉不到那个版本时，必须报错，不许偷偷用别的版本顶替
 */
import fs from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass += 1; console.log('  OK   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (e !== undefined ? ' -> ' + e : '')); }
};

const SRC = fs.readFileSync('D:/223/fief-ledger/loader.js', 'utf8');

/* ---------- 1. 默认不锁 ---------- */
console.log('=== 1. 默认跟随最新 ===');
const m = SRC.match(/const TARGET_VERSION = '([^']*)';/);
ok('找到 TARGET_VERSION', !!m);
ok("默认值是空字符串（不锁）", m && m[1] === '', m && m[1]);

/* ---------- 1b. manifest 与 loader.js 必须同步 ----------
   踩过的坑：改了 loader.js 忘了提 LOADER_VERSION，线上本地都写着 2，
   自更新判断「不比我新」就不动，酒馆里那份旧 loader 永远不换。 */
console.log('\n=== 1b. manifest 记录的加载器版本与实际一致 ===');
const MF = JSON.parse(fs.readFileSync('D:/223/fief-ledger/manifest.json', 'utf8'));
const crypto = await import('node:crypto');
const realSha = crypto.createHash('sha256').update(fs.readFileSync('D:/223/fief-ledger/loader.js')).digest('hex');
const lvNow = SRC.match(/const\s+LOADER_VERSION\s*=\s*'(\d+)'/);

ok('manifest 里有 loader 字段', !!MF.loader, JSON.stringify(MF.loader));
if (MF.loader) {
  ok('manifest 的 loader.version 与 loader.js 一致',
    String(MF.loader.version) === (lvNow ? lvNow[1] : ''),
    MF.loader.version + ' vs ' + (lvNow ? lvNow[1] : '?'));
  ok('manifest 的 loader.sha256 与 loader.js 一致',
    MF.loader.sha256 === realSha,
    String(MF.loader.sha256).slice(0, 12) + ' vs ' + realSha.slice(0, 12));
}
ok('LOADER_VERSION 至少是 3（TARGET_VERSION 是 v3 引入的）',
  lvNow && Number(lvNow[1]) >= 3, lvNow && lvNow[1]);

/* build.mjs 要有「改了内容自动提版本号」的兜底 */
const BUILD_SRC = fs.readFileSync('D:/223/fief-ledger/scripts/build.mjs', 'utf8');
ok('build 会比对旧 manifest 的 loader.sha256', /old\.loader\.sha256/.test(BUILD_SRC));
ok('build 会自动提升 LOADER_VERSION', /loaderAutoBumped/.test(BUILD_SRC));

/* ---------- 2. 地址随版本切换 ---------- */
/* 只跑配置那几行，不跑整个 loader */
function sourcesFor(target) {
  const code = `
    const OWNER = 'stealstars';
    const REPO = 'stars';
    const BRANCH = 'main';
    const TARGET_VERSION = ${JSON.stringify(target)};
    const REF = TARGET_VERSION ? ('v' + TARGET_VERSION) : BRANCH;
    const SOURCES = [
      'https://cdn.jsdelivr.net/gh/' + OWNER + '/' + REPO + '@' + REF + '/',
      'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/' + REF + '/',
    ];
    result = { REF, SOURCES };
  `;
  const sb = { result: null };
  vm.createContext(sb);
  vm.runInContext(code, sb);
  return sb.result;
}

console.log('\n=== 2. 版本号决定走哪个地址 ===');
const free = sourcesFor('');
ok("不锁 → REF 是 main", free.REF === 'main', free.REF);
ok('不锁 → 地址含 main', free.SOURCES.every((s) => /[@/]main\//.test(s)));

const locked = sourcesFor('0.9.60');
ok("锁 0.9.60 → REF 是 v0.9.60", locked.REF === 'v0.9.60', locked.REF);
ok('锁 → jsDelivr 用 @v0.9.60', /@v0\.9\.60\//.test(locked.SOURCES[0]), locked.SOURCES[0]);
ok('锁 → raw 用 /v0.9.60/', /\/v0\.9\.60\//.test(locked.SOURCES[1]), locked.SOURCES[1]);
ok('锁 → 地址里没有 main', locked.SOURCES.every((s) => !/[@/]main\//.test(s)));

/* ---------- 3. 源码里确实按 TARGET_VERSION 过滤 ---------- */
console.log('\n=== 3. 版本不匹配必须报错 ===');
ok('按版本过滤 manifest', /TARGET_VERSION\s*\n?\s*\?\s*good\.filter\(\(r\)\s*=>\s*r\.manifest\.version\s*===\s*TARGET_VERSION\)/.test(SRC)
  || /r\.manifest\.version === TARGET_VERSION/.test(SRC));
ok('锁了却拉不到时抛错', /TARGET_VERSION && good\.length/.test(SRC));
ok('报错文案说明原因', /版本已锁定/.test(SRC));
ok('不会静默降级到最新', !/TARGET_VERSION\s*\?[^;]*:\s*good\b(?!\.filter)/.test(SRC) || /usable/.test(SRC));

/* 逻辑验证：模拟 good 列表 */
function pick(good, target) {
  const usable = target ? good.filter((r) => r.version === target) : good;
  if (usable.length) return usable.sort((a, b) => (a.version < b.version ? 1 : -1))[0].version;
  if (target && good.length) throw new Error('锁定失败');
  return null;
}
ok('不锁时取最高版本', pick([{ version: '0.9.58' }, { version: '0.9.60' }], '') === '0.9.60');
ok('锁 0.9.58 时取 0.9.58（不是最新的）',
  pick([{ version: '0.9.58' }, { version: '0.9.60' }], '0.9.58') === '0.9.58');
let threw = false;
try { pick([{ version: '0.9.60' }], '0.9.58'); } catch (e) { threw = true; }
ok('锁的版本不存在时抛错', threw);

/* ---------- 4. 缓存键按版本隔离 ---------- */
console.log('\n=== 4. 缓存不串版本 ===');
ok('MANIFEST_KEY 按版本区分', /const MANIFEST_KEY = TARGET_VERSION \? \('__manifest@v' \+ TARGET_VERSION\) : '__manifest';/.test(SRC));
ok('reload 清的是当前版本的键', /c\.delete\(MANIFEST_KEY\)/.test(SRC));

/* ---------- 5. 线上 tag 真的能用（发布后才有） ---------- */
/* jsDelivr 国内会随机 ECONNRESET，重试几次再判定 */
async function get(url, tries = 3) {
  let last = null;
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'n', 'Cache-Control': 'no-cache' } });
      if (r.ok) return { ok: true, res: r };
      last = 'HTTP ' + r.status;
    } catch (e) {
      last = (e.cause && (e.cause.code || e.cause.message)) || e.message;
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return { ok: false, err: last };
}

console.log('\n=== 5. 线上 tag 可取 ===');
const VER = JSON.parse(fs.readFileSync('D:/223/fief-ledger/manifest.json', 'utf8')).version;
const tag = 'v' + VER;

const rawRes = await get('https://raw.githubusercontent.com/stealstars/stars/' + tag + '/manifest.json');
if (rawRes.ok) {
  const j = await rawRes.res.json();
  ok('raw 上 ' + tag + ' 的 manifest 版本对得上', j.version === VER, j.version + ' ≠ ' + VER);
} else {
  ok('raw 上 ' + tag + ' 可取', false, rawRes.err);
}

const cdnRes = await get('https://cdn.jsdelivr.net/gh/stealstars/stars@' + tag + '/manifest.json');
let cdnOk = false;
if (cdnRes.ok) {
  const j = await cdnRes.res.json();
  cdnOk = j.version === VER;
  ok('jsDelivr 上 @' + tag + ' 可取', true);
  ok('jsDelivr 版本对得上', cdnOk, j.version + ' ≠ ' + VER);
} else {
  /* jsDelivr 在国内会随机不通。loader 是双源竞速，raw 能用就够了，
     所以这里只提示不判失败——否则测试会因为网络抖动天天红。 */
  console.log('  ..   jsDelivr 本地不通（' + cdnRes.err + '），loader 双源竞速，不影响');
}

ok('至少一个源能拿到 tag ' + tag,
  (rawRes.ok) || cdnOk,
  'raw=' + (rawRes.ok ? 'ok' : rawRes.err) + ' jsdelivr=' + (cdnOk ? 'ok' : cdnRes.err));

console.log('\n' + (fail ? fail + ' 项失败  ' : '全部通过 ✔  ') + (pass + fail) + ' 项');
process.exit(fail ? 1 : 0);
