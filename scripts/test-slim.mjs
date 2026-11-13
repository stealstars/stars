/**
 * 建筑变量瘦身：把 内部资产 从六字段压成四字段。
 *
 * 抽取原则（用户定的）：先看 效果 里已有的键，抽不到才去 描述 正文里找，
 * 两处都没有就留空，绝不编数。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = fs.readFileSync(path.join(ROOT, 'modules/core.js'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (n, c, e) => {
  if (c) pass += 1;
  else { fail += 1; console.log('  [!!] ' + n + (e !== undefined ? '  -> ' + e : '')); }
};

/* ---------------- 切出瘦身那一段 ---------------- */
const S = CORE.indexOf('  /* ------------------------------------------------ 建筑变量瘦身 */');
const E = CORE.indexOf('  /** 展开前的警告');
if (S < 0 || E < 0 || E <= S) {
  console.log('[!!] 切不出瘦身那一段');
  process.exit(1);
}

const store = {};
const HOST = {
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  },
};

const SRC = CORE.slice(S, E);

const M = new Function(
  'const host = arguments[0];\n'
  + 'const window = {};\n'
  + 'const currentChatId = () => "chat-A";\n'
  + 'const getMessages = () => globalThis.__msgs;\n'
  + 'const parseTags = (s) => { const o={}; String(s||"").split(/[;；,，]/).forEach((seg)=>{ const t=seg.trim(); const i=t.search(/[:：]/); if(i>0) o[t.slice(0,i).trim()]=t.slice(i+1).trim(); }); return o; };\n'
  + 'const tagsText = (v) => Array.isArray(v) ? v.join(";") : String(v||"");\n'
  + 'const normalizeInner = (raw) => { const out=[]; if(!raw) return out; if(Array.isArray(raw)){ raw.forEach((it,i)=>{ if(it&&typeof it==="object") out.push({key:String(it.名称||it.name||("#"+i)),item:it}); }); return out; } if(typeof raw==="object"){ for(const k of Object.keys(raw)) if(raw[k]&&typeof raw[k]==="object") out.push({key:k,item:raw[k]}); } return out; };\n'
  + 'const effectLinesOf = ' + (() => {
    const a = CORE.indexOf('  function effectLinesOf(item) {');
    const b = CORE.indexOf('  /** 领地资产的元信息');
    return CORE.slice(a, b).trim();
  })() + '\n'
  + SRC
  + '\n; return { normQty, slimEffects, slimmableOf, slimStats, slimAssets, loadSlims };',
)(HOST);

/* ---------------- 1. 产量写法归一 ---------------- */
console.log('=== 1. 产量写法归一 ===');
{
  ok('每月 20 件 → 20 件/月', M.normQty('每月 20 件') === '20 件/月', M.normQty('每月 20 件'));
  ok('每日 150 条 → 150 条/日', M.normQty('每日 150 条') === '150 条/日', M.normQty('每日 150 条'));
  ok('每周 3 套 → 3 套/周', M.normQty('每周 3 套') === '3 套/周', M.normQty('每周 3 套'));
  ok('已经是 20 件/月 就原样', M.normQty('20 件/月') === '20 件/月', M.normQty('20 件/月'));
  ok('空串给空串', M.normQty('') === '', M.normQty(''));
  ok('无就原样', M.normQty('无') === '无', M.normQty('无'));
}

/* ---------------- 2. 从 效果 里抽 ---------------- */
console.log('\n=== 2. 从 效果 里抽 ===');
{
  const a = M.slimEffects({
    效果: { 产出: '铁器（农具、兵器）', 产能: '每月 20 件', 加成: '驻军装备维护 +10%' },
    描述: '东南角的老铁匠铺。',
  });
  ok('产物抽到了', a.产物 === '铁器（农具、兵器）', a.产物);
  ok('产量归一了', a.产量 === '20 件/月', a.产量);
  ok('加成抽到了', a.加成 === '驻军装备维护 +10%', a.加成);

  const b = M.slimEffects({ 效果: { 产物: '面包', 产量: '150 条/日' } });
  ok('直接写 产物/产量 也认', b.产物 === '面包' && b.产量 === '150 条/日');

  const c = M.slimEffects({ 效果: { 月产: '30 桶', 增益: '储水 +50' } });
  ok('月产/增益 别名也认', c.产量 === '30 桶' && c.加成 === '储水 +50');

  /* 效果里没有产出键，但有个别的键 —— 全部并进加成 */
  const d = M.slimEffects({ 效果: { 训练速度: '+10%', 防御: '+5' } });
  ok('其余键并成加成', d.加成 === '训练速度: +10%；防御: +5', d.加成);
  ok('没产物就是空', d.产物 === undefined, JSON.stringify(d));
}

/* ---------------- 3. 从 描述 里抽 ---------------- */
console.log('\n=== 3. 从 描述 里抽 ===');
{
  const a = M.slimEffects({ 描述: '这里每月产出 200 块砖，供应全城。加成：营造速度 +5%' });
  ok('描述里的产量抽到了', !!a.产量, a.产量);
  ok('描述里的加成抽到了', a.加成 === '营造速度 +5%', a.加成);

  const b = M.slimEffects({ 描述: '一座普通的谷仓，储存粮食。' });
  ok('抽不出就不写键', !b.产物 && !b.产量 && !b.加成, JSON.stringify(b));

  const c = M.slimEffects({ 效果: {}, 描述: '' });
  ok('空对象给空对象', Object.keys(c).length === 0, JSON.stringify(c));
}

/* ---------------- 2b. 契约里的默认写法不算产物 ---------------- */
console.log('\n=== 2b. 「产出并入商贸流转Δ」不是产物名 ===');
{
  /* 真实存档（白鹭浅滩男爵领）：19 座里 14 座这么写 */
  const a = M.slimEffects({ 效果: { 产出: '产出并入商贸流转Δ', 秘银高速排锯: '大幅提升造船板材加工效率' } });
  ok('默认写法不当产物', a.产物 === undefined, JSON.stringify(a));
  ok('特色键还是加成', a.加成 === '秘银高速排锯: 大幅提升造船板材加工效率', a.加成);

  const b = M.slimEffects({ 效果: { 产出: '产出并入商贸流转Δ' } });
  ok('只有默认写法就是空', Object.keys(b).length === 0, JSON.stringify(b));

  const c = M.slimEffects({ 效果: { 产物: '未知' } });
  ok('「未知」是有效值，保留', c.产物 === '未知', JSON.stringify(c));

  const d = M.slimEffects({ 效果: { 产出: '铁器' } });
  ok('真产物照旧', d.产物 === '铁器', JSON.stringify(d));
}

/* ---------------- 4. 该压哪些 ---------------- */
console.log('\n=== 4. 该压哪些 ===');
{
  const asset = {
    类型: '领地',
    内部资产: {
      铁匠铺: { 品质: '优良', 数量: 1, 描述: '老铁匠铺', 总占用空间: '200 平' },
      谷仓: { 品质: '普通', 数量: 1 },
      菜地: { 品质: '普通', 数量: 1, 总占用空间: '1 亩' },
    },
  };
  const list = M.slimmableOf(asset);
  ok('三座里只有两座要压', list.length === 2, list.length);
  ok('铁匠铺在名单里', list.some((x) => x.key === '铁匠铺'));
  ok('菜地也算（有总占用空间）', list.some((x) => x.key === '菜地'));

  const stat = {
    主角: {
      资产: {
        白鸦堡: asset,
        随身钱袋: { 类型: '权益', 内部资产: { 铜板: { 描述: 'x' } } },
      },
    },
  };
  const sm = M.slimStats(stat);
  ok('只统计领地', sm.n === 2, sm.n);
  ok('领地一块', sm.domain === 1, sm.domain);
  ok('空存档不炸', M.slimStats(null).n === 0);
}

/* ---------------- 5. 真删字段 ---------------- */
console.log('\n=== 5. 真删字段 ===');
{
  const msg = {
    variables: {
      stat_data: {
        主角: {
          资产: {
            白鸦堡: {
              类型: '领地',
              内部资产: {
                铁匠铺: {
                  品质: '优良',
                  标签: ['用途:生产'],
                  数量: 1,
                  效果: { 产出: '铁器', 产能: '每月 20 件', 加成: '装备维护 +10%' },
                  描述: '东南角的老铁匠铺，青石垒的墙被炉火熏得发黑。',
                  总占用空间: '占地约 200 平',
                },
              },
            },
          },
        },
      },
    },
  };
  globalThis.__msgs = [msg];
  const r = M.slimAssets(0);
  const it = msg.variables.stat_data.主角.资产.白鸦堡.内部资产.铁匠铺;

  ok('压了一座', r.done === 1, r.done);
  ok('存了一份原文', r.saved === 1, r.saved);
  ok('描述删了', !('描述' in it), Object.keys(it).join(','));
  ok('总占用空间删了', !('总占用空间' in it));
  ok('品质留着', it.品质 === '优良');
  ok('标签留着', Array.isArray(it.标签) && it.标签.length === 1);
  ok('数量留着', it.数量 === 1);
  ok('产物写进去了', it.效果.产物 === '铁器', JSON.stringify(it.效果));
  ok('产量归一了', it.效果.产量 === '20 件/月', it.效果.产量);
  ok('加成写进去了', it.效果.加成 === '装备维护 +10%');

  /* 再跑一次应该是空操作 */
  const r2 = M.slimAssets(0);
  ok('第二次不重复压', r2.done === 0, r2.done);
}

/* ---------------- 6. 原文存在本地 ---------------- */
console.log('\n=== 6. 原文留档 ===');
{
  const raw = store['fief-ledger-slims-v1'];
  ok('写进了 localStorage', !!raw);
  const all = JSON.parse(raw || '{}');
  const rec = (all['chat-A'] || {})['chat-A::白鸦堡::铁匠铺'];
  ok('按 聊天::领地::建筑 存', !!rec, Object.keys(all['chat-A'] || {}).join(','));
  ok('原文保住了', !!rec && rec.描述.indexOf('青石垒的墙') >= 0, rec && rec.描述);
  ok('占用也保住了', !!rec && rec.总占用空间 === '占地约 200 平');
}

/* ---------------- 7. 源码接线 ---------------- */
console.log('\n=== 7. 源码接线 ===');
{
  ok('调试面板有瘦身按钮', /id="fl-dev-slim"/.test(CORE));
  ok('按钮调 slimAssets', /const r = slimAssets\(ms\.idx\)/.test(CORE));
  ok('改完重扫', /rescan\(true, '精简'\)/.test(CORE));
  ok('删描述用 delete', /delete item\.描述;/.test(CORE));
  ok('删占用用 delete', /delete item\.总占用空间;/.test(CORE));
  ok('效果整对象换掉', /item\.效果 = slimEffects\(item\);/.test(CORE));
  ok('压之前先读本地', /loadSlims\(\);   \/\/ 先读回来/.test(CORE));
}

console.log('\n' + (fail ? fail + ' 项失败  ' : '全部通过 ✔  ') + (pass + fail) + ' 项');
process.exit(fail ? 1 : 0);
