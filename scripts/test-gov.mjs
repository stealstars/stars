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
  ok('禁止数值加成', /绝对不写数值加成/.test(s));
  ok('禁止古风堆砌', /不要古风骈文/.test(s));
  ok('要求贴合规模', /贴合这块地的规模/.test(s));
  ok('矛盾时要指出来', /矛盾/.test(s));
  ok('limit 不许空话', /不能写空话/.test(s));
  ok('要求严格 JSON', /严格 JSON/.test(s));

  console.log('  -- 出发点必须是领地，不是国家 --');
  ok('写明「不是国家」', /不是国家/.test(s));
  ok('写明玩家不是皇帝', /他不是皇帝/.test(s));
  ok('写明尺度是村子到超级城市', /村庄.*超级城市|超级城市/.test(s));
  ok('禁止写国体主权民族宪法', /不要写国家的国体/.test(s));
  ok('禁止写举国之力', /举国之力/.test(s));
  ok('要求想具体有什么', /几个家族.*教堂.*市集/.test(s));
  ok('who 要具体的人或小团体', /具体的人或小团体/.test(s));

  console.log('  -- 主义要翻译成本地的事 --');
  ok('有「关于主义」一节', /【关于「主义」】/.test(s));
  ok('点名格式塔', /格式塔/.test(s));
  ok('点名蜂巢', /蜂巢/.test(s));
  ok('点名共产', /共产/.test(s));
  ok('给出翻译规则', /翻译/.test(s));
  ok('要求用本地说法', /这块地上的叫法/.test(s));
  ok('禁止直接搬政治学术语', /不要用政治学术语/.test(s));
}

console.log('\n=== 3b. 五套参考必须是领地尺度 ===');
{
  // 旧版写的是「君主」「教皇」「贵族」「议会」「小国或帝国行省」
  const BIG = ['帝国', '王国', '大国', '小国', '行省', '君主', '教皇', '贵族', '议会', '邦国'];
  for (const g of G.PRESETS) {
    const all = [g.name, g.tag, g.axis, g.desc, g.who, g.how, g.limit, g.need, g.fail].join(' ');
    const hit = BIG.filter((w) => all.indexOf(w) >= 0);
    ok(g.name + ' 没有国家尺度词', hit.length === 0, hit.join('、'));
  }
  // 适合规模都得落在城市以下
  for (const g of G.PRESETS) {
    ok(g.name + ' 不声称适合大国', g.fit.indexOf('大国') < 0 && g.fit.indexOf('小国或帝国行省') < 0,
      g.fit.join('/'));
  }
  ok('封建改叫领主分封', G.get('封建').name === '领主分封', G.get('封建').name);
  ok('集权改叫流官直辖', G.get('集权').name === '流官直辖', G.get('集权').name);
  ok('共和改叫市集共议', G.get('共和').name === '市集共议', G.get('共和').name);
  ok('神权改叫教权治所', G.get('神权').name === '教权治所', G.get('神权').name);
  ok('自治改叫城社自理', G.get('自治').name === '城社自理', G.get('自治').name);
}

console.log('\n=== 3c. 大词要拦下来 ===');
{
  ok('有 bigWordIn', typeof G.bigWordIn === 'function');
  ok('拦住格式塔', G.bigWordIn('格式塔共治') === '格式塔', G.bigWordIn('格式塔共治'));
  ok('拦住蜂巢', G.bigWordIn('蜂巢体制') === '蜂巢', G.bigWordIn('蜂巢体制'));
  ok('拦住共产', G.bigWordIn('共产共治') === '共产', G.bigWordIn('共产共治'));
  ok('放行长老议事', !G.bigWordIn('长老议事'));
  ok('放行一家独断', !G.bigWordIn('一家独断'));
  ok('放行市集共管', !G.bigWordIn('市集共管'));

  let threw = false, msg = '';
  try { G.normalize({ name: '格式塔蜂巢' }); } catch (e) { threw = true; msg = e.message; }
  ok('归一化会拒绝大词', threw);
  ok('错误信息说清了原因', /国家或文明尺度/.test(msg), msg.slice(0, 40));
  ok('错误信息给了出路', /换个说法/.test(msg));

  const good = G.normalize({ name: '长老议事', who: '三位族老' });
  ok('本地说法能通过', good.name === '长老议事');
}

console.log('\n=== 4. 拼用户提示词 ===');
{
  const t = G.buildUser({
    domain: '青石村', faction: '奥古斯提姆帝国', scale: '村庄',
    pop: '数百', treasury: '3万Z', buildings: 7,
    buildingNames: ['村公所', '磨坊', '水井', '祠堂'],
    idea: '让贵族别那么横',
  });
  ok('带上了领地名', /青石村/.test(t));
  ok('带上了规模', /村庄/.test(t));
  ok('带上了人口', /数百/.test(t));
  ok('带上了建筑数', /7 \u5904/.test(t));
  ok('带上了建筑名', /磨坊/.test(t) && /村公所/.test(t));
  ok('带上了诉求', /让贵族别那么横/.test(t));
  ok('标明归属是上级不是本地结构', /这是上级，不是本地的治理结构/.test(t) || /上级，不是本地/.test(t));
  ok('标题是「这块地」', /【这块地】/.test(t));
  ok('要求是治理结构不是政体', /治理结构/.test(t));

  // 带大词时要额外提醒
  const t2 = G.buildUser({ domain: 'x', idea: '我想搞格式塔蜂巢' });
  ok('大词诉求会额外提醒', /不要照搬名词/.test(t2));
  ok('提醒里点了共产格式塔', /共产/.test(t2) && /格式塔/.test(t2));

  const t3 = G.buildUser({ domain: 'x', idea: '' });
  ok('没诉求时给默认话术', /没有特别说明/.test(t3));
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
  ok('没接口时标 aria-disabled', /\(ai \? '' : ' aria-disabled="true"'\)/.test(CORE));
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
  ok('写变量', /writeChatVars\(\{ fief_gov: \{ key/.test(CORE));
  ok('存了 AI 那套', /built: govBuilt/.test(CORE));
  ok('重启后能恢复 AI 那套', /v\.fief_gov\.built && v\.fief_gov\.built\.name/.test(CORE));
}

console.log('\n=== 10. 构建与上传 ===');
ok('build 含 gov.js', /modules\/gov\.js/.test(BUILD));
ok('gov 排在 core 前', BUILD.indexOf('modules/gov.js') < BUILD.indexOf("'modules/core.js'"));
ok('upload 含 gov.js', /modules\/gov\.js/.test(UPLOAD));

console.log('\n=== 11. 输入框不许白底白字 ===');
{
  const css = CORE;
  ok('政体框不透明底', /\.fl-gov-in \{[\s\S]{0,400}background: #14110b/.test(css));
  ok('政体框用 fl-text', /\.fl-gov-in \{[\s\S]{0,400}color: var\(--fl-text\)/.test(css));
  ok('政体框有 fill-color', /\.fl-gov-in \{[\s\S]{0,400}-webkit-text-fill-color/.test(css));
  ok('政体框有 caret-color', /\.fl-gov-in \{[\s\S]{0,400}caret-color/.test(css));
  ok('挡住自动填充', /\.fl-gov-in:-webkit-autofill/.test(css));
  ok('不再用半透明黑底', !/\.fl-gov-in \{[\s\S]{0,300}background: rgba\(0, 0, 0, \.18\)/.test(css));
  ok('aria-disabled 有样式', /#fl-gov-make\[aria-disabled="true"\]/.test(css));
}

console.log('\n=== 12. 按钮不许静默失效 ===');
{
  ok('政体按钮不用 disabled', /\(ai \? '' : ' aria-disabled="true"'\)/.test(CORE));
  ok('buildGov 以输入框为准', /const el = viewEl && viewEl\.querySelector\('#fl-gov-idea'\)/.test(CORE));
}

console.log('\n=== 13. 选了要能用：填进聊天框 ===');
{
  // 之前一个字都没有：选了只能看着，发不出去
  ok('有 govCommand', /function govCommand\(\)/.test(CORE));
  ok('有 govCurrent', /function govCurrent\(\)/.test(CORE));
  ok('拼了 [政体] 段', /'\[政体\] '/.test(CORE));
  ok('拼了 [核心矛盾]', /\[核心矛盾\]/.test(CORE));
  ok('拼了 [掌权]', /'掌权', g\.who/.test(CORE));
  ok('拼了 [失效]', /'失效', g\.fail/.test(CORE));
  ok('调 fillComposer', /fillComposer\(txt\)/.test(CORE));
  ok('有发送按钮', /id="fl-gov-send"/.test(CORE));
  ok('详情里也能发', /id="fl-gov-send2"/.test(CORE));
  ok('没选时会提示', /先选一套政体/.test(CORE));
}

console.log('\n=== 14. 取消要真的能取消 ===');
{
  ok('取消是 button 不是 span', /<button[^>]*data-gov-clear/.test(CORE));
  ok('取消调 govWrite 空串', /govWrite\(''\)/.test(CORE));
  ok('取消后清展开态', /govWrite\(''\);[\s\S]{0,80}govOpen = ''/.test(CORE));
  ok('取消阻止冒泡', /e\.stopPropagation\(\)/.test(CORE));
  ok('取消有反馈', /已取消政体/.test(CORE));
  // 旧写法是 span，点了可能在移动端没反应
  ok('不再是 span', !/<span class="fl-gov-cur-x"/.test(CORE));
}

console.log('\n=== 15. 点「已选」不该没反应 ===');
{
  ok('已选时给提示', /已经是这套了/.test(CORE));
  ok('已选时不重复写', /if \(k === govRead\(\)\)/.test(CORE));
}

console.log('\n=== 16. 存储链路没有死代码 ===');
{
  ok('govWrite 不再读一遍又丢掉', !/const v = readChatVars\(\) \|\| \{\};\s*\n\s*v\.fief_gov/.test(CORE));
  ok('govWrite 直接写 patch', /writeChatVars\(\{ fief_gov:/.test(CORE));
}

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
