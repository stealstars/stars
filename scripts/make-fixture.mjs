/**
 * 把真实存档里跟领地有关的部分抽成测试样本（不含剧情正文）。
 *
 *   node scripts/make-fixture.mjs <jsonl 路径>
 *
 * 产物：scripts/fixtures/fief-real.json
 * 里面只有 <fief_domain>/<fief_report>/<fief_build> 三种区块，
 * 以及一份领地资产（19 座建筑），主角只留等级/经验/金钱三个字段。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2];
if (!SRC) { console.log('给个 jsonl 路径'); process.exit(1); }

const msgs = fs.readFileSync(SRC, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const statOf = (m) => {
  const bags = [];
  if (m.variables != null) bags.push(m.variables);
  if (m.extra && m.extra.variables != null) bags.push(m.extra.variables);
  for (const bag of bags) {
    const list = Array.isArray(bag) ? bag : [bag];
    for (const c of list) {
      if (c && typeof c === 'object') {
        if (c.stat_data && typeof c.stat_data === 'object') return c.stat_data;
        if (c.主角 && typeof c.主角 === 'object') return c;
      }
    }
  }
  return null;
};

let stat = null;
for (const m of msgs) { const s = statOf(m); if (s) stat = s; }
if (!stat) { console.log('没有 stat_data'); process.exit(1); }

const grab = (tag) => {
  const re = new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>', 'g');
  const found = [];
  for (const m of msgs) {
    if (!m.mes) continue;
    const t = String(m.mes);
    let r;
    while ((r = re.exec(t))) found.push(r[1].trim());
  }
  return found;
};

/* 区块只留长度正常、确实以 [领地] 行开头的（正文里提到的裸标签会带进杂质）
   取前 3 块（早期小村）和后 3 块（后期大城市），两头都覆盖到 */
const clean = (tag, keep) => {
  const all = grab(tag).filter((b) => b.indexOf('[') === 0);
  if (all.length <= keep) return all;
  const head = all.slice(0, Math.ceil(keep / 2));
  const tail = all.slice(-Math.floor(keep / 2));
  return head.concat(tail);
};

const assets = (stat.主角 && stat.主角.资产) || {};
const domainKey = Object.keys(assets).find((k) => /^领地/.test(String(assets[k].类型 || '')));
const asset = assets[domainKey];

const fixture = {
  note: '真实存档脱敏样本：只保留领地数据，用于 scripts/test-real.mjs',
  主角: {
    等级: stat.主角.等级,
    累计经验值: stat.主角.累计经验值,
    升级所需经验: stat.主角.升级所需经验,
    金钱: stat.主角.金钱,
    资产: { [domainKey]: asset },
  },
  blocks: {
    fief_domain: clean('fief_domain', 6),
    fief_report: clean('fief_report', 2),
    fief_build: clean('fief_build', 20),
  },
};

const dir = path.join(ROOT, 'scripts/fixtures');
fs.mkdirSync(dir, { recursive: true });
const dst = path.join(dir, 'fief-real.json');
fs.writeFileSync(dst, JSON.stringify(fixture, null, 1), 'utf8');

console.log('样本：' + dst);
console.log('  ' + (fs.statSync(dst).size / 1024).toFixed(1) + ' KB');
console.log('  区块 domain ' + fixture.blocks.fief_domain.length
  + ' / report ' + fixture.blocks.fief_report.length
  + ' / build ' + fixture.blocks.fief_build.length);
console.log('  建筑 ' + Object.keys(asset.内部资产 || {}).length + ' 座');
