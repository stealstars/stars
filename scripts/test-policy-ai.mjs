/**
 * 政策合成 / 自创
 *
 * 政策页原来只能抽卡。现在多两条路：
 *   合成  选中的几条政策 → 一条上位新政策（合不成要说合不成）
 *   自创  一句话想法 → 一条正式政令
 *
 * 两条路都走 AI，产出不进牌库，单独放在 custom 里，
 * 所以选/删/填指令都要能同时处理「牌库政策」和「AI 政策」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PR_SRC = P('modules/prompts/policy.js');
const UI_SRC = P('modules/policy.ui.js');
const CSS_SRC = P('modules/policy.css.js');
const CHAN_SRC = P('modules/ai.chan.js');
const BUILD_SRC = P('scripts/build.mjs');

let pass = 0;
let fail = 0;
const ok = (n, c, e) => {
  if (c) pass += 1;
  else { fail += 1; console.log('  [!!] ' + n + (e ? '  -> ' + e : '')); }
};

// 把提示词模块真的跑起来
const win = { console };
win.window = win;
new Function('window', PR_SRC)(win);
const PR = win.__fiefPolicyAI;

console.log('=== 1. 提示词模块能加载 ===');
ok('导出 __fiefPolicyAI', !!PR);
ok('有 systemSynth', typeof PR.systemSynth === 'string' && PR.systemSynth.length > 200);
ok('有 systemCreate', typeof PR.systemCreate === 'string' && PR.systemCreate.length > 200);
ok('类别表是 6 个', PR.CAT_KEYS.length === 6, String(PR.CAT_KEYS.length));

console.log('\n=== 2. 系统提示词的核心口径 ===');
{
  const s = PR.systemSynth;
  ok('要求严格 JSON', /严格 JSON/.test(s));
  ok('禁止数值加成', /不写.*数值加成|绝对不写/.test(s));
  ok('要求合不成时说合不成', /合不成/.test(s));
  ok('类别限定 6 类', /民生\/经济\/军事\/法度\/外交\/人事/.test(s));
  ok('有 ok 字段', /"ok"/.test(s));
  ok('要求点出牵制', /牵制/.test(s));
}
{
  const c = PR.systemCreate;
  ok('自创也禁止数值加成', /绝对不写数值加成/.test(c));
  ok('要求贴合领地实际', /贴合玩家领地/.test(c));
  ok('行不通时要直说', /行不通/.test(c));
}

console.log('\n=== 3. 拼提示词 ===');
{
  const t = PR.buildSynth({
    picked: [{ name: '兴修水利', cat: '民生', desc: '疏浚河道' }, { name: '设立义仓', cat: '民生', desc: '丰年储粮' }],
    domain: '青石村',
    faction: '奥古斯提姆帝国',
    scale: '村庄',
  });
  ok('带上了领地名', /青石村/.test(t));
  ok('带上了势力', /奥古斯提姆帝国/.test(t));
  ok('列了两条政策', /兴修水利/.test(t) && /设立义仓/.test(t));
  ok('带了类别', /民生/.test(t));
}
{
  const t = PR.buildCreate({ idea: '让商队愿意常驻', domain: '霜镜港', scale: '中型城镇', pop: '数千', treasury: '12万Z' });
  ok('带上了想法', /让商队愿意常驻/.test(t));
  ok('带上了人口', /数千/.test(t));
  ok('带上了金库', /12万Z/.test(t));
}

console.log('\n=== 4. 解析：模型爱包代码块 ===');
{
  const a = PR.parse('```json\n{"name":"治水备荒"}\n```');
  ok('剥掉 json 代码块', a.name === '治水备荒', String(a.name));
  const b = PR.parse('好的，结果如下：\n{"name":"x"}\n以上。');
  ok('从废话里抠出 JSON', b.name === 'x', String(b.name));
  let threw = false;
  try { PR.parse('这不是 JSON'); } catch (e) { threw = true; }
  ok('不是 JSON 会抛错', threw);
}

console.log('\n=== 5. 归一化：合成 ===');
{
  const bad = PR.normalizeSynth({ ok: false, why: '这几条互相拉扯' });
  ok('合不成时 ok 是 false', bad.ok === false);
  ok('合不成时带上了原因', /互相拉扯/.test(bad.why), bad.why);

  const good = PR.normalizeSynth({
    ok: true, name: '《治水备荒》', cat: '民生',
    desc: '疏浚河道并设义仓。需常年看管。',
    why: '都指向备荒', cost: '征徭役两月', risk: '豪强反对',
  });
  ok('ok 是 true', good.ok === true);
  ok('去掉书名号', good.name === '治水备荒', good.name);
  ok('类别保留', good.cat === '民生', good.cat);
  ok('代价保留', good.cost === '征徭役两月', good.cost);

  // 类别不在表里 → 落到民生
  const weird = PR.normalizeSynth({ ok: true, name: '乱来', cat: '玄学' });
  ok('非法类别落到民生', weird.cat === '民生', weird.cat);

  // 名字太长会被截
  const long = PR.normalizeSynth({ ok: true, name: '一二三四五六七八九十十一十二', cat: '经济' });
  ok('名字截到 10 字', long.name.length <= 10, String(long.name.length));

  // 说明太长会被截
  const longDesc = PR.normalizeSynth({ ok: true, name: 'x', desc: 'あ'.repeat(200) });
  ok('说明截到 80 字', longDesc.desc.length <= 80, String(longDesc.desc.length));

  // 没名字就算失败
  const noName = PR.normalizeSynth({ ok: true, name: '', cat: '民生' });
  ok('没名字算合不成', noName.ok === false);
}
{
  const c = PR.normalizeCreate({ name: '招徕商队', cat: '经济', desc: '设驿馆。', cost: '一年开销', risk: '' });
  ok('自创归一化', c.name === '招徕商队' && c.cat === '经济', JSON.stringify(c));
  let threw = false;
  try { PR.normalizeCreate({ name: '' }); } catch (e) { threw = true; }
  ok('自创没名字会抛错', threw);
}

console.log('\n=== 6. 政策 UI：AI 状态与统一取项 ===');
ok('有 custom 数组', /let custom = \[\]/.test(UI_SRC));
ok('有 itemOf', /function itemOf\(id\)/.test(UI_SRC));
ok('itemOf 先查牌库', /if \(lib && lib\.BY_ID\[id\]\) return lib\.BY_ID\[id\]/.test(UI_SRC));
ok('itemOf 再查 custom', /custom\[i\]\.id === id/.test(UI_SRC));

console.log('\n=== 7. 选 / 互斥要兼容 AI 政策 ===');
{
  const body = (UI_SRC.match(/function pick\(id\)[\s\S]*?\n  \}/) || [''])[0];
  ok('只在牌库政策上判互斥', /if \(lib\.BY_ID\[id\]\)/.test(body));
  const blk = (UI_SRC.match(/function isBlocked\(id\)[\s\S]*?\n  \}/) || [''])[0];
  ok('isBlocked 跳过 AI 政策', /if \(!lib\.BY_ID\[id\]\) return null/.test(blk));
  ok('isBlocked 跳过 AI 对方', /if \(!lib\.BY_ID\[other\]\) continue/.test(blk));
}

console.log('\n=== 8. 关系与指令 ===');
{
  const rel = (UI_SRC.match(/function relations\(\)[\s\S]*?\n  \}/) || [''])[0];
  ok('relations 跳过非牌库项', /if \(!lib\.BY_ID\[a\] \|\| !lib\.BY_ID\[b\]\) continue/.test(rel));
  const cmd = (UI_SRC.match(/function buildCommand\(\)[\s\S]*?\n  \}/) || [''])[0];
  ok('指令用 itemOf 取名', /itemOf\(id\) \|\| \{\}\)\.name/.test(cmd));
  ok('指令里标出新拟政策', /\[新拟\]/.test(cmd));
  ok('新拟里带代价', /代价：/.test(cmd));
}

console.log('\n=== 9. 界面元素 ===');
ok('有合成按钮', /id="fl-synth"/.test(UI_SRC));
ok('有自创输入框', /id="fl-idea"/.test(UI_SRC));
ok('有自创按钮', /id="fl-create"/.test(UI_SRC));
ok('合成要两条以上', /picked\.length < 2/.test(UI_SRC));
ok('提示文案一致', /选两条以上才能合成/.test(UI_SRC));
ok('没配接口时给提示', /设置 → API/.test(UI_SRC));
ok('合成失败会告诉玩家', /合不成：/.test(UI_SRC));
ok('有忙碌态', /aiBusy/.test(UI_SRC));
ok('AI 政策可点选', /data-made=/.test(UI_SRC));
ok('AI 政策可删除', /data-drop=/.test(UI_SRC));
ok('回车能提交想法', /e\.key === 'Enter'/.test(UI_SRC));

console.log('\n=== 9b. 按钮不许静默失效 ===');
{
  // 之前用 disabled，点了毫无反馈，玩家以为坏了
  ok('自创不用 disabled', !/id="fl-create"'\s*\+\s*\(canCreate \? '' : ' disabled'\)/.test(UI_SRC));
  ok('自创用 aria-disabled', /\(canCreate \? '' : ' aria-disabled="true"'"\)/.test(UI_SRC)
    || /canCreate \? '' : ' aria-disabled="true"/.test(UI_SRC));
  ok('合成用 aria-disabled', /canSynth \? '' : ' aria-disabled="true"/.test(UI_SRC));
  ok('点自创没写想法会提示', /先在左边写一句想法/.test(UI_SRC));
  ok('点合成不够两条会提示', /要合成，先选两条以上/.test(UI_SRC));
  ok('没配 API 点按钮也提示', /AI 没配好/.test(UI_SRC));
  ok('输入时同步按钮状态', /syncBtns/.test(UI_SRC));
  ok('同步用 aria-disabled', /cr2\.removeAttribute\('aria-disabled'\)/.test(UI_SRC));
}

console.log('\n=== 9c. 输入框不许白底白字 ===');
{
  ok('自创框不透明底', /background: var\(--fl-surface2/.test(CSS_SRC));
  ok('自创框用 text-rgb', /color: rgb\(var\(--fl-text-rgb\)\)/.test(CSS_SRC));
  ok('自创框有 fill-color', /-webkit-text-fill-color/.test(CSS_SRC));
  ok('自创框有 caret-color', /caret-color/.test(CSS_SRC));
  ok('挡住自动填充白底', /-webkit-autofill/.test(CSS_SRC));
  ok('placeholder 用低透明度文字色', /\.fl-pai-in::placeholder \{ color: rgba\(var\(--fl-text-rgb\)/.test(CSS_SRC));
  ok('不再用半透明黑底', !/\.fl-pai-in \{[\s\S]{0,300}background: rgba\(0,0,0,\.18\)/.test(CSS_SRC));
  ok('底色跟随主题', /--fl-surface2/.test(CSS_SRC));
  ok('aria-disabled 有样式', /\.fl-pai-btn\[aria-disabled="true"\]/.test(CSS_SRC));
}

console.log('\n=== 10. AI 调用 ===');
ok('调用 __fiefAI', /window\.__fiefAI/.test(UI_SRC));
ok('合成传 system', /system: pr\.systemSynth/.test(UI_SRC));
ok('自创传 system', /system: pr\.systemCreate/.test(UI_SRC));
ok('module 是 policy', /module: 'policy'/.test(UI_SRC));
ok('合成失败不改 custom', /if \(!norm\.ok\)[\s\S]{0,120}return;/.test(UI_SRC));
ok('成功后自动选上', /chosen\.push\(item\.id\)/.test(UI_SRC));

console.log('\n=== 11. 导出 ===');
ok('导出 setContext', /setContext\(o\)/.test(UI_SRC));
ok('导出 custom()', /custom: \(\) => custom\.slice\(\)/.test(UI_SRC));
ok('导出 itemOf 给测试', /itemOf, allItems/.test(UI_SRC));

console.log('\n=== 12. 通道别名：政策复用外交凭据 ===');
ok('policy → 外交', /policy: '外交'/.test(CHAN_SRC));
ok('政令 → 外交', /政令: '外交'/.test(CHAN_SRC));

console.log('\n=== 13. 构建与上传清单 ===');
ok('build 里有 prompts/policy.js', /modules\/prompts\/policy\.js/.test(BUILD_SRC));
ok('prompts/policy 排在 core 前', BUILD_SRC.indexOf('prompts/policy.js') < BUILD_SRC.indexOf('modules/core.js'));

console.log('\n=== 14. 样式 ===');
ok('有 .fl-pai', /\.fl-pai \{/.test(CSS_SRC));
ok('有 .fl-made', /\.fl-made \{/.test(CSS_SRC));
ok('有忙碌动画', /fl-pai-blink/.test(CSS_SRC));

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
