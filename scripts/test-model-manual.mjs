/**
 * 自定义模型名：拉不到列表时也要能配。
 *
 * 背景：`/v1/models` 在某些中转站被关掉或超时，玩家拉不到列表，
 * 而旧版下拉框在没有列表时是 disabled 的——等于根本没路填模型。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'modules/ai.settings.js'), 'utf8');

let pass = 0;
let fail = 0;
const ok = (n, c, e) => {
  if (c) pass += 1;
  else { fail += 1; console.log('  [!!] ' + n + (e ? '  -> ' + e : '')); }
};

console.log('=== 1. 手填框存在且独立 ===');
{
  ok('有 #fl-aic-model-manual', /id="fl-aic-model-manual"/.test(SRC));
  ok('是 text input', /id="fl-aic-model-manual" type="text"/.test(SRC));
  ok('独立成一节「自定义模型名」', /自定义模型名/.test(SRC));
  ok('有 placeholder 举例', /placeholder="例如 deepseek-chat/.test(SRC));
}

console.log('\n=== 2. 下拉不再因为没列表而禁用 ===');
{
  ok('select 不再带 disabled 条件', !/id="fl-aic-model"\$\{models\.length \? '' : ' disabled'\}/.test(SRC));
  ok('提示改成手填引导', /拉不到列表|手填/.test(SRC));
}

console.log('\n=== 3. 取值优先级 ===');
{
  ok('有 modelValue 函数', /function modelValue\(\)/.test(SRC));
  ok('手填优先', /if \(man && man\.value\.trim\(\)\) return man\.value\.trim\(\);/.test(SRC));
  ok('其次下拉', /if \(sel && sel\.value\) return sel\.value;/.test(SRC));
  ok('最后沿用已存值', /return conf\(\)\.model;/.test(SRC));
}

console.log('\n=== 4. 三处都用手填值 ===');
{
  ok('保存凭据用 modelValue', /model: modelValue\(\),/.test(SRC));
  ok('测试连接用 modelValue', /const m = modelValue\(\);/.test(SRC));
  ok('没有残留 pickModel', !/pickModel/.test(SRC));
}

console.log('\n=== 5. 两边互斥不打架 ===');
{
  ok('下拉选中时清空手填', /if \(man && sel\.value\) man\.value = '';/.test(SRC));
  ok('手填时清空下拉', /if \(v && sel\) sel\.value = '';/.test(SRC));
  ok('手填逐字落盘', /man\.addEventListener\('input'/.test(SRC));
}

console.log('\n=== 6. 空模型名要拦住 ===');
{
  ok('测试连接前检查', /if \(!m\) \{/.test(SRC));
  ok('提示怎么填', /手填框或下拉里选一个/.test(SRC));
}

console.log('\n=== 7. 显示逻辑 ===');
{
  ok('列表里有的不重复显示到手填框', /models\.some\(\(m\) => m\.id === c\.model\) \? '' : \(c\.model \|\| ''\)/.test(SRC));
  ok('「已选择模型」仍显示', /已选择模型/.test(SRC));
}

console.log('\n' + (fail ? fail + ' 项失败' : '全部通过 ✔') + '  ' + pass + ' 项');
process.exit(fail ? 1 : 0);
