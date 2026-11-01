/**
 * 命定卡片的定位器。
 *
 * 卡片文件名会变（改名、加 (1)、升版本号），写死路径的测试每次都得手动改，
 * 一改就整个套件 ENOENT。这里统一按目录扫。
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'D:\\223';

/** 返回卡片路径；找不到返回 ''。 */
export function findCard() {
  const direct = path.join(DIR, '命定之诗与黄昏之歌v4.31.json');
  if (fs.existsSync(direct)) return direct;
  const list = fs.readdirSync(DIR).filter((n) => /^命定.*\.json$/.test(n));
  if (!list.length) return '';
  // 优先挑看起来是最新的：版本号大、不带「改」「备份」字样的
  const score = (n) => (/改|备份|旧/.test(n) ? -1 : 0) + (Number((n.match(/v(\d+)\.(\d+)/) || [0, 0, 0])[1]) || 0);
  list.sort((a, b) => score(b) - score(a));
  return path.join(DIR, list[0]);
}

/** 读卡片；找不到就打印提示并返回 null（调用方自行 process.exit(0)）。 */
export function loadCard() {
  const p = findCard();
  if (!p) {
    console.log('找不到命定卡片，跳过');
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
