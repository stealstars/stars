// 用真实 API 跑一遍外交提示词
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const KEY = 'sk-4b7a54e48b24894e9b9892a19f03b57a0b2dd21c82aa0a891eba88951de366e3';
const BASE = 'http://127.0.0.1:8790/v1';
const MODEL = process.argv[2] || 'glm-5.3-flash';

// 加载提示词模块
const win = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'modules/prompts/diplomacy.js'), 'utf8'))(win);
const P = win.__fiefPrompts['外交'];

const TARGETS = [
  { 势力: '瓦伦蒂亚', 方向: '军事部署' },
  { 势力: '索伦蒂斯王国', 方向: '财政与税收' },
  { 势力: '伯伦斯法环', 方向: '内部政治' },
];

(async () => {
  console.log('模型 ' + MODEL);
  console.log('提示词 system ' + P.system.length + ' 字，userBrief ' + P.userBrief.length + ' 字\n');

  for (const t of TARGETS) {
    console.log('=== ' + t.势力 + ' / ' + t.方向 + ' ===');
    const user = P.build(t);
    const t0 = Date.now();
    const r = await fetch(BASE + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: P.system },
          { role: 'user', content: user },
        ],
        temperature: 0.6,
        max_tokens: 800,
      }),
    });
    const j = await r.json();
    if (!j.choices) { console.log('  ERR: ' + JSON.stringify(j).slice(0, 300)); continue; }
    const raw = String(j.choices[0].message.content);
    const ms = Date.now() - t0;
    console.log('  ' + ms + 'ms  ' + raw.length + ' 字');

    // 用和脚本一样的逻辑解析
    let txt = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    if (txt.indexOf('{') > 0) txt = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1);
    let obj = null;
    try { obj = JSON.parse(txt); } catch (e) { console.log('  解析失败: ' + e.message); console.log('  原文: ' + raw.slice(0, 300)); continue; }

    const missing = P.fields.filter((f) => !obj[f]);
    const extra = Object.keys(obj).filter((k) => P.fields.indexOf(k) < 0);
    console.log('  字段 ' + Object.keys(obj).length + '/' + P.fields.length
      + (missing.length ? '  缺: ' + missing.join(',') : '  齐全')
      + (extra.length ? '  多: ' + extra.join(',') : ''));
    P.fields.forEach((f) => {
      const v = String(obj[f] || '');
      console.log('    ' + f.padEnd(6) + ' ' + (v.length > 60 ? v.slice(0, 58) + '…' : v));
    });
    console.log('  usage: prompt=' + j.usage.prompt_tokens + ' completion=' + j.usage.completion_tokens);
    console.log('');
  }
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
