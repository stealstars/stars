/**
 * 找领地扩展世界书。
 *
 * 文件名会变（用户在酒馆里导出一次就多一个后缀：…-1.json、…-2.json），
 * 所以按目录扫，认「领地扩展」开头的 JSON，跳过改前备份。
 * 找不到就返回 null，调用方自己决定是跳过还是报错。
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'D:/223/领地开始';

export function findExtBook() {
  let names = [];
  try { names = fs.readdirSync(DIR); } catch (e) { return null; }

  const cands = names
    .filter((n) => /^领地扩展.*\.json$/i.test(n))
    .filter((n) => !/改前|备份|backup/i.test(n))
    .map((n) => path.join(DIR, n));

  if (!cands.length) return null;
  // 多个版本时取最新修改的那个
  cands.sort((a, b) => {
    const ta = fs.statSync(a).mtimeMs;
    const tb = fs.statSync(b).mtimeMs;
    return tb - ta;
  });
  return cands[0];
}

export function loadExtBook() {
  const p = findExtBook();
  if (!p) return null;
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const entries = Array.isArray(raw.entries) ? raw.entries : Object.values(raw.entries || {});
  return { path: p, raw, entries };
}

export default findExtBook;
