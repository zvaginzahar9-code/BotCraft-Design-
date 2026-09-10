/**
 * Загрузка переменных окружения для standalone-скриптов.
 *
 * Next читает `.env.local` сам, а обычный `node scripts/...` — нет, поэтому без
 * этого сид не знал бы, куда подключаться. Формат намеренно простой: `KEY=value`
 * с необязательными кавычками, комментарии со `#`. Уже заданное в окружении
 * значение приоритетнее файла — так CI и контейнеры переопределяют настройки,
 * не правя файлы в репозитории.
 */
import fs from 'node:fs';
import path from 'node:path';
import { root } from './paths.mjs';

export function loadEnv(files = ['.env.local', '.env']) {
  for (const file of files) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;

    for (const raw of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;

      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
