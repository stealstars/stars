/**
 * 世界书解析边界审计
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const ok = (name, cond, info) => {
  if (!cond) fail += 1;
  console.log((cond ? '  OK   ' : '  BUG  ') + name + (info ? '  -> ' + info : ''));
};

const win = { console, Promise };
win.window = win;
const load = (p) => {
  const src = fs.readFileSync(ROOT + '\\' + p, 'utf8');
  new Function('window', 'console', src)(win, console);
};
load('modules\\worldbook.js');
const B = win.__fiefBook;

console.log('=== 1. name / comment 优先级 ===');
{
  const r = B.normalize([{ name: '真名', comment: '', content: '规模: 村庄' }]);
  ok('comment 为空时取 name', r.length === 1 && r[0].comment === '真名', JSON.stringify(r[0] && r[0].comment));
}
{
  const r = B.normalize([{ name: 'A', comment: 'B', content: '规模: 村庄' }]);
  ok('两者都有时用 name（酒馆助手的正式字段）', r[0].comment === 'A', r[0].comment);
}
{
  const r = B.normalize([{ comment: '只有comment', content: '规模: 村庄' }]);
  ok('只有 comment 时用它', r[0].comment === '只有comment', r[0].comment);
}

console.log('\n=== 2. 地点判定 ===');
{
  // 一个带名字、但不含规模、也不像总述的条目 —— 它其实是「人物」
  const entries = [
    { comment: '[本体][势力][甲王国][人物]某某将军', content: '这是一位将军的传记，打了许多仗。' },
    { comment: '[本体][势力][甲王国]甲城', content: '规模: 中型城镇' },
  ];
  const norm = B.normalize(entries);
  const tree = B.buildFactionTree(norm);
  const f = tree['甲王国'];
  console.log('  地点: ' + f.places.map((x) => x.name).join('、'));
  console.log('  总述: ' + f.overview.map((x) => x.name).join('、'));
  ok('人物条目不算地点', !f.places.some((x) => /将军/.test(x.name)));
  ok('真地点算地点', f.places.some((x) => x.name === '甲城'));
}
{
  // 地点条目没有规模，但有「地点类别」或其他地理线索
  const entries = [
    { comment: '[本体][势力][甲王国][城镇]无规模城', content: '这是一座城镇，城墙很高。' },
  ];
  const tree = B.buildFactionTree(B.normalize(entries));
  const f = tree['甲王国'];
  console.log('  地点: ' + f.places.map((x) => x.name).join('、'));
  console.log('  总述: ' + f.overview.map((x) => x.name).join('、'));
}

console.log('\n=== 3. 势力名带特殊字符 ===');
{
  const entries = [
    { comment: '[本体][势力][甲.王国(南部)][城镇]城', content: '规模: 村庄' },
  ];
  const tree = B.buildFactionTree(B.normalize(entries));
  ok('带点号括号的势力名能拆', !!tree['甲.王国(南部)'], Object.keys(tree).join(','));
}

console.log('\n=== 4. 同名地点 ===');
{
  const entries = [
    { comment: '[本体][势力][甲王国][城镇]同名城', content: '规模: 村庄' },
    { comment: '[本体][势力][甲王国][城区]同名城', content: '城东区' },
  ];
  const tree = B.buildFactionTree(B.normalize(entries));
  const names = tree['甲王国'].places.map((x) => x.name);
  ok('同名地点不丢', names.length === 2, names.join(','));
}

console.log('\n=== 5. 空内容条目 ===');
{
  const r = B.normalize([{ name: 'x', content: '   ' }, { name: 'y', content: null }]);
  ok('空内容被跳过', r.length === 0, String(r.length));
}

console.log('\n=== 6. getWorldbook 抛错 ===');
{
  win.TavernHelper = {
    getWorldbookNames: () => ['坏书'],
    getWorldbook: () => { throw new Error('boom'); },
    getLorebook: async () => [{ name: 'x', content: '规模: 村庄' }],
    getCharWorldbookNames: () => ({ primary: '', additional: [] }),
  };
  const list = await B.readAll();
  ok('换下一个接口函数', list.length === 1, String(list.length));
}

console.log('\n=== 7. 所有接口都不给 ===');
{
  win.TavernHelper = {
    getWorldbookNames: () => ['书'],
    getWorldbook: async () => { throw new Error('no'); },
    getCharWorldbookNames: () => ({ primary: '', additional: [] }),
  };
  const list = await B.readAll();
  ok('全失败时返回空数组', Array.isArray(list) && list.length === 0, String(list.length));
  const c = await B.scan(true);
  ok('scan 给出错误信息', !!c.err, c.err);
}

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过'));
process.exit(fail ? 1 : 0);
