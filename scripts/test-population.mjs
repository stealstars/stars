/**
 * 人口是实况，不是档位换算。
 *
 * 反馈：正文写"就几个人"，面板却显示"数百人"。
 * 根因是世界书里那句「参考: 村庄 数百 | 乡镇 数千 …」——
 * 档位一旦是村庄，模型就按表把人改成几百，正文写了也没用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = fs.readFileSync(path.join(ROOT, 'modules/core.js'), 'utf8');
const WB = JSON.parse(fs.readFileSync('D:/223/领地开始/领地扩展-5合1-免递归.json', 'utf8'));
const all = Object.values(WB.entries).map((e) => String(e.content || '')).join('\n');

let pass = 0;
let fail = 0;
const ok = (n, c, e) => {
  if (c) pass += 1;
  else { fail += 1; console.log('  [!!] ' + n + (e ? '  -> ' + e : '')); }
};

console.log('=== 1. 世界书不再把档位写成人口答案 ===');
{
  ok('删掉「村庄 数百 | 乡镇 数千」这张固定对照', !/参考: 村庄 数百 \| 乡镇 数千/.test(all));
  ok('明确写了「人口是实况」', /人口是实况/.test(all));
  ok('明确档位不决定住多少人', /不决定住着多少人/.test(all));
  ok('认可低于常见范围', /低于该档常见范围\*\*不视为错误\*\*|不视为错误/.test(all));
  ok('禁止按应有数改写正文人数', /禁止.*改写正文已经写明的人数|改写正文已经写明的人数/.test(all));
  ok('禁止升档就凭空变多', /禁止因为升档就把人凭空变多/.test(all));
  ok('保留了「几个人」这种极小量级', /「几个人」「十余人」/.test(all));
}

console.log('\n=== 2. 升档判定不反推人口 ===');
{
  ok('条目4 说了按实况算', /人口按实况算/.test(all));
  ok('提到了哨所也能是村庄档', /几口人的哨所也能是「村庄」档/.test(all));
  ok('七档表后也补了同一句', /人口按实况，不靠档位反推/.test(all));
}

console.log('\n=== 3. 脚本不再用档位画人口条 ===');
{
  ok('不再有 tier.n * 13 那种宽度', !/d\.tier \? d\.tier\.n \* 13/.test(CORE));
  ok('人口格改成一行动态说明', /实况人数，与档位无关/.test(CORE));
  ok('有 fl-metric-note 样式', /\.fl-metric \.fl-metric-note/.test(CORE));
}

console.log('\n=== 4. 正则只原样显示，不做换算 ===');
{
  const rx = JSON.parse(fs.readFileSync('D:/223/领地开始/正则补丁-领地扩展6.json', 'utf8'));
  const dom = String(rx[0].replaceString || '');
  ok('正则里有 row 人口', /rows \+= row\('人口'/.test(dom));
  ok('只是取 st[4] 显示', /row\('人口', txt\(st\[4\]\)\)/.test(dom));
  ok('没有按档位算人口的代码', !/人口[^;\]]{0,30}\*\s*13/.test(dom));
}

console.log('\n=== 5. 其他指标没被牵连 ===');
{
  ok('治安仍是 0~100 数字', /scoreOf\(g\.治安\)/.test(CORE));
  ok('物资仍是四档 pips', /stockOf\(g\.物资\)/.test(CORE));
  ok('军事仍是人数合计', /units\.reduce/.test(CORE));
}

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
