/**
 * Поиск установленного Chromium для headless-рендеринга.
 *
 * Проект использует puppeteer-core, который намеренно не тащит с собой сборку
 * браузера, — поэтому нужный бинарник ищем среди уже установленных. Раньше этот
 * список был скопирован в четыре скрипта, и добавление нового пути приходилось
 * повторять в каждом.
 */
import fs from 'node:fs/promises';

const CANDIDATES = [
  `${process.env['ProgramFiles']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['LOCALAPPDATA']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env['ProgramFiles']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

/**
 * Путь к первому найденному браузеру.
 *
 * Переменная окружения CHROME_PATH имеет приоритет: это единственный способ
 * указать нестандартную установку, не правя код.
 */
export async function findBrowser() {
  const override = process.env.CHROME_PATH;
  if (override) return override;

  for (const c of CANDIDATES) {
    try {
      await fs.access(c);
      return c;
    } catch {
      /* пробуем следующий */
    }
  }
  throw new Error(
    'Не найден бинарник Chrome/Edge для headless-рендеринга. ' +
      'Укажите его явно через переменную окружения CHROME_PATH.',
  );
}
