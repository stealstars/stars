/**
 * 政体（历史页）
 *
 * 在原来的变更流水之上加一块，不是取代。
 * 五套参考 + AI 定制。
 *
 * 口径：
 *   政体不是 buff，是「谁说了算、怎么决定、卡在哪」的结构
 *   每套都要能说清 掌权/来源/受限/需要/失效 五件事
 *   不让 AI 写数值加成，不让写古风骈文
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOV = fs.readFileSync(path.join(ROOT, 'modules/gov.js'), 'utf8');
const CORE = fs.readFileSync(path.join(ROOT, 'modules/core.js'), 'utf8');
const BUILD = fs.readFileSync(path.join(ROOT, 'scripts/build.mjs'), 'utf8');
const UPLOAD = fs.readFileSync(path.join(ROOT, 'scripts/upload.mjs'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (n, c, e) => {
  if (c) pass += 1;
  else { fail += 1; console.log('  [!!] ' + n + (e ? '  -> ' + e : '')); }
};

// 真的加载 gov.js
const win = { console };
win.window = win;
new Function('window', GOV)(win);
const G = win.__fiefGov;

console.log('=== 1. 模块能加载 ===');
ok('导出 __fiefGov', !!G);
ok('有五套参考', Array.isArray(G.PRESETS) && G.PRESETS.length === 5, String((G.PRESETS || []).length));
ok('有 SYSTEM', typeof G.SYSTEM === 'string' && G.SYSTEM.length > 300);
ok('有 buildUser', typeof G.buildUser === 'function');
ok('有 normalize', typeof G.normalize === 'function');

console.log('\n=== 2. 五套政体各自完整 ===');
{
  const need = ['who', 'how', 'limit', 'need', 'fail'];
  for (const g of G.PRESETS) {
    ok(g.name + ' 有名字', !!g.name);
    ok(g.name + ' 有标签', !!g.tag, String(g.tag));
    ok(g.name + ' 有核心矛盾', !!g.axis, String(g.axis));
    ok(g.name + ' 有描述', !!g.desc && g.desc.length > 20);
    for (const k of need) ok(g.name + ' 有 ' + k, !!g[k] && g[k].length > 4, String(g[k]));
    ok(g.name + ' 有适合规模', Array.isArray(g.fit) && g.fit.length > 0);
  }
  const keys = G.PRESETS.map((x) => x.key);
  ok('key 不重复', new Set(keys).size === 5, keys.join('/'));
  ok('含封建', keys.indexOf('封建') >= 0);
  ok('含集权', keys.indexOf('集权') >= 0);
  ok('含共和', keys.indexOf('共和') >= 0);
  ok('含神权', keys.indexOf('神权') >= 0);
  ok('含自治', keys.indexOf('自治') >= 0);
}

console.log('\n=== 3. 提示词口径 ===');
{
  const s = G.SYSTEM;
  ok('说明政体不是加成', /不是加成/.test(s));
  ok('要求说清谁说了算', /谁说了算/.test(s));
  ok('禁止数值加成', /绝对不写数值加成/.test(s));
  ok('禁止古风堆砌', /不要古风骈文/.test(s));
  ok('要求贴合规模', /贴合这块地的规模/.test(s));
  ok('矛盾时要指出来', /矛盾/.test(s));
  ok('limit 不许空话', /不能写空话/.test(s));
  ok('要求严格 JSON', /严格 JSON/.test(s));
  ok('字段含 who/how/limit/need/fail',
    /"who"/.test(s) && /"how"/.test(s) && /"limit"/.test(s) && /"need"/.test(s) && /"fail"/.test(s));
}

console.log('\n=== 4. 拼用户提示词 ===');
{
  const t = G.buildUser({
    domain: '青石村', faction: '奥古斯提姆帝国', scale: '村庄',
    pop: '数百', treasury: '3万Z', buildings: 7, idea: '让贵族别那么横',
  });
  ok('带上了领地名', /青石村/.test(t));
  ok('带上了规模', /村庄/.test(t));
  ok('带上了人口', /数百/.test(t));
  ok('带上了建筑数', /7/.test(t));
  ok('带上了诉求', /让贵族别那么横/.test(t));
  const t2 = G.buildUser({ domain: 'x', idea: '' });
  ok('没诉求时给默认话术', /没有特别说明/.test(t2));
}

console.log('\n=== 5. 解析与归一化 ===');
{
  const a = G.parse('```json\n{"name":"长老推举"}\n```');
  ok('剥代码块', a.name === '长老推举', a.name);
  const b = G.parse('结果：\n{"name":"x"}\n完');
  ok('从废话里抠 JSON', b.name === 'x', b.name);

  const n = G.normalize({
    name: '《长老推举制》', tag: '推举 · 长者议事', axis: '谁活得久谁说话',
    desc: '村中长者推举主事。任期不定，出事就换。',
    who: '村中长者', how: '推举', limit: '受制于族老', need: '需要老人还在', fail: '年轻人不认',
  });
  ok('去掉书名号', n.name === '长老推举制', n.name);
  ok('标了 custom', n.custom === true);
  ok('key 是 custom', n.key === 'custom');
  ok('保留了 who', n.who === '村中长者');
  ok('保留了 fail', n.fail === '年轻人不认');

  let threw = false;
  try { G.normalize({ name: '' }); } catch (e) { threw = true; }
  ok('没名字会抛错', threw);

  // 超长要截
  const long = G.normalize({ name: 'x', desc: 'あ'.repeat(300), who: 'い'.repeat(100) });
  ok('desc 截到 100', long.desc.length <= 100, String(long.desc.length));
  ok('who 截到 40', long.who.length <= 40, String(long.who.length));
}

console.log('\n=== 6. 是「加」不是「取代」===');
{
  ok('historyHtml 里有 govHtml', /let html = govHtml\(d\)/.test(CORE));
  ok('政体在流水之前', CORE.indexOf('govHtml(d)') < CORE.indexOf('变 更 流 水'));
  ok('没有流水时也返回政体', /return html;\s*\}\s*const names = new Set/.test(CORE));
  ok('流水标题还在', /变 更 流 水/.test(CORE));
  ok('流水统计还在', /涉及 <b>\$\{names\.size\}<\/b> 座建筑/.test(CORE));
  ok('绑了 bindGov', /bindView\(d\); bindGov\(\)/.test(CORE));
}

console.log('\n=== 7. 五套参考都能渲染 ===');
{
  ok('渲染 PRESETS', /for \(const g of mod\.PRESETS\)/.test(CORE));
  ok('当前选中高亮', /g\.key === cur \? ' on' : ''/.test(CORE));
  ok('可展开详情', /data-gov=/.test(CORE));
  ok('有「用这套」', /data-gov-set=/.test(CORE));
  ok('有取消', /data-gov-clear/.test(CORE));
  ok('详情列出五件事', /'掌权', g\.who/.test(CORE) && /'失效', g\.fail/.test(CORE));
  ok('显示适合规模', /g\.fit\.join/.test(CORE));
}

console.log('\n=== 8. AI 定制 ===');
{
  ok('有输入框', /id="fl-gov-idea"/.test(CORE));
  ok('有生成按钮', /id="fl-gov-make"/.test(CORE));
  ok('回车能提交', /e\.key === 'Enter'[\s\S]{0,40}buildGov/.test(CORE));
  ok('没接口时禁用', /\(ai \? '' : ' disabled'\)/.test(CORE));
  ok('没接口时给提示', /设置 → API/.test(CORE));
  ok('调 __fiefAI', /window\.__fiefAI/.test(CORE));
  ok('传 system', /system: mod\.SYSTEM/.test(CORE));
  ok('module 复用 policy', /module: 'policy'/.test(CORE));
  ok('成功后选中', /govWrite\('custom'\)/.test(CORE));
  ok('失败有错误提示', /govErr = String/.test(CORE));
}

console.log('\n=== 9. 存到聊天变量 ===');
{
  ok('有 fief_gov', /fief_gov/.test(CORE));
  ok('读变量', /v\.fief_gov\.key/.test(CORE));
  ok('写变量', /v\.fief_gov = \{ key/.test(CORE));
  ok('存了 AI 那套', /built: govBuilt/.test(CORE));
  ok('重启后能恢复 AI 那套', /v\.fief_gov\.built && v\.fief_gov\.built\.name/.test(CORE));
}

console.log('\n=== 10. 构建与上传 ===');
ok('build 含 gov.js', /modules\/gov\.js/.test(BUILD));
ok('gov 排在 core 前', BUILD.indexOf('modules/gov.js') < BUILD.indexOf("'modules/core.js'"));
ok('upload 含 gov.js', /modules\/gov\.js/.test(UPLOAD));

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
