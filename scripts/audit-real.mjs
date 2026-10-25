/**
 * 拿真实的命定世界书跑一遍，看地点数有没有因为判据收紧而变少
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = { console, Promise };
win.window = win;
new Function('window', 'console', fs.readFileSync(ROOT + '\\modules\\worldbook.js', 'utf8'))(win, console);
const B = win.__fiefBook;

// 真实卡片是本地参考文件，不在仓库里；找不到就跳过
const CARD = process.env.FIEF_CARD || path.resolve(ROOT, '..', '命定之诗与黄昏之歌v4.31.json');
if (!fs.existsSync(CARD)) {
  console.log('跳过：没找到卡片文件 ' + CARD);
  console.log('  设置环境变量 FIEF_CARD 指向命定卡片 json 即可运行');
  process.exit(0);
}
const card = JSON.parse(fs.readFileSync(CARD, 'utf8'));
const raw = (card.data && card.data.character_book && card.data.character_book.entries) || [];
console.log('卡片条目总数: ' + raw.length);

// 卡片导出格式是 comment/key，转成酒馆助手的 name/strategy.keys 形状
const entries = raw.map((e) => ({
  uid: e.id,
  name: e.comment,
  content: e.content,
  strategy: { type: e.constant ? 'constant' : 'selective', keys: e.key || e.keys || [] },
}));

const norm = B.normalize(entries);
console.log('非空条目: ' + norm.length);

const tree = B.buildFactionTree(norm);
const rows = Object.keys(tree).map((k) => ({
  势力: k,
  地点: tree[k].places.length,
  总述: tree[k].overview.length,
}));
rows.sort((a, b) => b.地点 - a.地点);
console.log('\n势力                  地点   总述');
for (const r of rows) {
  console.log(r.势力.padEnd(22, ' ') + String(r.地点).padStart(4) + String(r.总述).padStart(7));
}
const tp = rows.reduce((s, r) => s + r.地点, 0);
console.log('\n合计: ' + rows.length + ' 势力, ' + tp + ' 地点');

// 对比新旧判据：旧的是 (!!scale || !!sp.name)
const oldIsPlace = (e) => {
  const sp = B.splitFactionTag(e.comment);
  if (!sp) return false;
  const scale = B.placeScale(e.content);
  const NOT = /(政治与社会|地理与文化|地理与治理|地理概览|地理|文化|贵族|军事|经济|历史|总览|派系|分割线|势力概况|简介|概述|社会结构|制度|宗教|信仰|习俗|节庆|语言|货币|贸易|产业|活动|派阀)/;
  const NOTT = /^(派系|节庆|分割线|组织|制度|人物|角色|传说)$/;
  return !NOT.test(sp.name) && !sp.tags.some((t) => NOTT.test(t))
    && sp.name !== sp.faction && (!!scale || !!sp.name);
};

let onlyOld = [];
let onlyNew = [];
for (const e of norm) {
  const sp = B.splitFactionTag(e.comment);
  if (!sp) continue;
  const nowPlace = tree[sp.faction]
    && tree[sp.faction].places.some((p) => p.comment === e.comment);
  const wasPlace = oldIsPlace(e);
  if (wasPlace && !nowPlace) onlyOld.push(sp.faction + ' · ' + sp.name);
  if (!wasPlace && nowPlace) onlyNew.push(sp.faction + ' · ' + sp.name);
}
console.log('\n旧判据算地点、新判据不算的（' + onlyOld.length + ' 条）:');
for (const x of onlyOld.slice(0, 40)) console.log('  ' + x);
if (onlyOld.length > 40) console.log('  ...');
console.log('\n新判据算地点、旧判据不算的（' + onlyNew.length + ' 条）:');
for (const x of onlyNew.slice(0, 20)) console.log('  ' + x);
const ov = [];
for (const k of Object.keys(tree)) {
  for (const o of tree[k].overview) ov.push({ f: k, o });
}
console.log('\n归为总述、但可能其实是地点的条目:');
const suspicious = ov.filter((x) => {
  const nm = x.o.name;
  return /区|街|巷|店|铺|院|营|团|岛|岭|湾|港|城|镇|村|堡|塔|门|桥|道/.test(nm)
    && !/政治与社会|地理|文化|总览|概览|家族|廷臣|学塔|骑团|同盟|侍院/.test(nm);
});
for (const x of suspicious.slice(0, 60)) {
  const hasScale = !!x.o.scale;
  console.log('  ' + (x.f + ' · ' + x.o.name).padEnd(34, ' ')
    + ' 规模=' + (hasScale ? x.o.scale : '无')
    + '  标签=' + JSON.stringify(x.o.tags)
    + '  长=' + x.o.len);
}
console.log('  ...可疑共 ' + suspicious.length + ' 条 / 总述共 ' + ov.length + ' 条');
