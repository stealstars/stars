/**
 * 把「内部资产」（领地里的建筑）改成精简格式，写回卡片世界书。
 *
 * 现状：每座建筑要写 品质/标签/数量/效果/描述/总占用空间 六个字段，
 * 后期一个领地二十几座建筑，变量里全是长描述，每轮都占上下文。
 *
 * 改成：只写 品质/标签/数量/效果 四项，效果固定成 产物/产量/加成 三键。
 * 描述与总占用空间由领地档案脚本在首次生成时读走，变量里不再重复。
 *
 * 幂等：改过的再跑一次是空操作。
 */
import fs from 'node:fs';
import { findCard } from './card.mjs';

const path = findCard();
if (!path) {
  console.log('找不到命定卡片');
  process.exit(1);
}

const raw = fs.readFileSync(path, 'utf8');
const card = JSON.parse(raw);
const es = Object.values(card.data.character_book.entries);

const pick = (name) => {
  const e = es.find((x) => (x.comment || x.name) === name);
  if (!e) throw new Error('找不到条目：' + name);
  return e;
};

const GEN = pick('[本体][额外设定]技能装备道具生成规则');
const UPD = pick('[本体][变量][mvu_update]变量更新规则');

/** 依次替换，全部命中才算成功 */
function patch(entry, pairs, label) {
  let s = String(entry.content || '');
  let hit = 0;
  let skip = 0;
  for (const [from, to] of pairs) {
    if (s.indexOf(from) >= 0) {
      s = s.split(from).join(to);
      hit += 1;
    } else if (s.indexOf(to) >= 0) {
      skip += 1; // 已经是新写法
    } else {
      throw new Error(label + '：既没找到旧文本，也没有新文本 —— ' + from.slice(0, 60));
    }
  }
  entry.content = s;
  return { hit, skip };
}

/* ---------------- 1. 资产生成格式里的内部资产模板 ---------------- */

const OLD_ITEM = [
  '    内部资产名:',
  '      品质: 唯一/普通/优良/稀有/史诗/传说/神话',
  '      标签: [类型:][位置:X层/房间/分区][状态:]...',
  '      数量: number',
  '      效果: [每行1条"效果名: 效果"；按类型填写产出/生产加成/功能效果/基础属性；无实际效果填{}]',
  '      描述: [环境、区域、外观、用途与现状等叙事性描述；涉及协议时记录协议内容]',
  '      总占用空间: [字符串]',
].join('\n');

const NEW_ITEM = [
  '    内部资产名:',
  '      品质: 唯一/普通/优良/稀有/史诗/传说/神话',
  '      标签: [类型:][位置:X层/房间/分区][状态:]...',
  '      数量: number',
  '      效果: { 产物: 产出什么; 产量: 多少/周期; 加成: 加成(没有可省略) }',
].join('\n');

/* ---------------- 2. 「内部资产 (填写范围与效果)」整段 ---------------- */

const OLD_SECTION = [
  '## 内部资产 (填写范围与效果)',
  '  - 记录范围: 可独立计数、使用或产生实际作用的设施、物件、建筑等组成部分；资产本体及所有权由名称、标签与描述记录；无需追踪内部组成时填{}',
  '  - 总占用空间: 填写该内部资产自身布局与全部数量占用合计，普通设施填合计占用，建筑/建筑群可展开楼层、房间、附属土地及所含建筑的大小、类型与数量；标明单位，无法精确则写明规模',
  '  - 产出: 内部资产生产或提供的产品、资源及服务',
  '  - 生产加成: 重要内部资产提供的检定加成，参考<品质效果限定规则>',
  '  - 功能效果: 生产、经营、储存、防护、生活等实际功能',
  '  - 基础属性: 层级、属性模版、HP\\MP\\SP、装备品质攻防等(若类型为兵种，兵种数量填写在`数量`)',
].join('\n');

const NEW_SECTION = [
  '## 内部资产 (精简格式)',
  '  - 记录范围: 可独立计数、使用或产生实际作用的设施、物件、建筑等组成部分；无需追踪内部组成时填{}',
  '  - 每个内部资产**只写四个字段**：`品质`、`标签`、`数量`、`效果`。**不要写 `描述`，也不要写 `总占用空间`**',
  '  - `效果` 固定三键，全部写进同一个对象里:',
  '      产物: 生产或提供的产品、资源、服务。例：`铁器（农具、兵器）`、`面包`、`驻军`',
  '      产量: 产出量与周期。例：`20 件/月`、`150 条/日`；纯仓储/住宅写 `无`',
  '      加成: 检定、属性或功能加成。例：`驻军装备维护 +10%`、`储物 200 容积`；确实没有可省略此键',
  '  - 功能效果与基础属性一律并进 `加成`（如 `Lv.5 兵种 攻击 12`）；兵种数量仍填写在 `数量`',
  '  - 建筑的环境、外观、来历等描写**不要写进变量**：首次生成时由外部脚本从产出正文读取，变量里只留上面的结构化数据',
].join('\n');

/* ---------------- 3. 变量更新规则里的 schema ---------------- */

const OLD_SCHEMA = [
  '            内部资产: {',
  '              [内部资产名: string]: {',
  '                品质: string;',
  '                标签: string[];',
  '                数量: number;',
  '                效果: { [效果名: string]: string };',
  '                描述: string;',
  '                总占用空间: string; // 该内部资产自身布局及全部数量占用合计',
  '              }',
  '            }',
].join('\n');

const NEW_SCHEMA = [
  '            内部资产: {',
  '              [内部资产名: string]: {',
  '                品质: string;',
  '                标签: string[];',
  '                数量: number;',
  '                效果: { 产物: string; 产量: string; 加成?: string }; // 固定三键，无描述无总占用空间',
  '              }',
  '            }',
].join('\n');

const OLD_ONELINE = '内部资产: { [k: string]: { 品质: string; 标签: string[]; 数量: number; 效果: { [k2: string]: string }; 描述: string; 总占用空间: string } }';
const NEW_ONELINE = '内部资产: { [k: string]: { 品质: string; 标签: string[]; 数量: number; 效果: { 产物: string; 产量: string; 加成?: string } } }';

const OLD_CHECK = '        - 可随时修改内部资产效果与标签的内容';
const NEW_CHECK = '        - 内部资产只写 品质/标签/数量/效果 四项；效果固定 产物/产量/加成 三键；**不写描述与总占用空间**';

const a = patch(GEN, [[OLD_ITEM, NEW_ITEM], [OLD_SECTION, NEW_SECTION]], '资产生成规则');
const b = patch(UPD, [[OLD_SCHEMA, NEW_SCHEMA], [OLD_ONELINE, NEW_ONELINE], [OLD_CHECK, NEW_CHECK]], '变量更新规则');

fs.writeFileSync(path, JSON.stringify(card), 'utf8');

console.log('已改 ' + path);
console.log('  资产生成格式  改 ' + a.hit + ' 处，已是最新 ' + a.skip + ' 处');
console.log('  变量更新规则  改 ' + b.hit + ' 处，已是最新 ' + b.skip + ' 处');
