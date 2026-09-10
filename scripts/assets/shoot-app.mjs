/**
 * Снимает работающее приложение и кладёт кадры туда, где их ждёт лендинг.
 *
 * Секция «Конструктор» на главной показывает не рисунок и не мокап, а
 * настоящий снимок студии: скрипт проходит сценарий целиком — рисует комнату,
 * генерирует 3D, ставит несколько предметов из каталога — и снимает результат.
 * Пока снимок делается отсюда, он физически не может разойтись с продуктом.
 *
 * Запуск: node scripts/assets/shoot-app.mjs [baseUrl]
 * Требуется работающий dev- или prod-сервер.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { root, shotsDir } from '../lib/paths.mjs';
import { findBrowser } from '../lib/browser.mjs';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const PUBLIC_SHOTS = path.join(root, 'public', 'shots');

const W = 1600;
const H = 950;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await fs.mkdir(PUBLIC_SHOTS, { recursive: true });
  await fs.mkdir(shotsDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: await findBrowser(),
    headless: true,
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      `--window-size=${W},${H}`,
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1.5 });

  // Значок дев-режима Next рисуется поверх страницы и попадал бы в кадр,
  // который потом уезжает на лендинг.
  await page.evaluateOnNewDocument(() => {
    const style = document.createElement('style');
    style.textContent = 'nextjs-portal,[data-next-badge-root]{display:none !important}';
    document.addEventListener('DOMContentLoaded', () => document.head.append(style));
    // Подсказка о жестах показывается один раз новому пользователю и на
    // витрине закрывала бы собой сам кадр.
    try {
      localStorage.setItem('botcraft.studio.hint.v2', '1');
    } catch {
      /* приватный режим */
    }
  });

  /* --- редактор плана -------------------------------------------------- */
  await page.goto(`${BASE}/editor?new=1`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('canvas');
  await sleep(600);

  const box = await page.$eval('canvas', (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  // Комната буквой L: прямоугольник выглядел бы как заготовка, а ломаный
  // контур сразу показывает, что план строится произвольной формы.
  const pts = [
    [0.24, 0.2],
    [0.72, 0.2],
    [0.72, 0.56],
    [0.5, 0.56],
    [0.5, 0.82],
    [0.24, 0.82],
    [0.24, 0.2],
  ].map(([fx, fy]) => [box.x + box.w * fx, box.y + box.h * fy]);

  for (const [x, y] of pts) {
    await page.mouse.move(x, y);
    await sleep(90);
    await page.mouse.click(x, y);
    await sleep(160);
  }
  await sleep(500);
  await page.screenshot({ path: path.join(PUBLIC_SHOTS, 'editor.png') });

  /* --- 3D-студия -------------------------------------------------------- */
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 180000 }),
    page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .find((b) => /В 3D/.test(b.textContent))
        .click(),
    ),
  ]);
  await page.waitForSelector('canvas', { timeout: 30000 });
  await sleep(5000);

  // Несколько предметов из разных категорий: пустая комната не показывает,
  // ради чего вообще открывают студию.
  const picks = ['Диван Cloud', 'Столик Round Oak', 'Кресло Boucle', 'Лампа Noir', 'Стеллаж Frame'];
  for (const q of picks) {
    const clicked = await page.evaluate((needle) => {
      const card = [...document.querySelectorAll('button')].find(
        (b) => b.querySelector('img[src^="/thumbs/"]') && b.textContent.includes(needle),
      );
      card?.click();
      return !!card;
    }, q);
    if (clicked) await sleep(3500);
  }
  // Снимаем выделение с последнего предмета: гизмо поверх модели на витрине
  // читается мусором.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Снять выделение',
    );
    btn?.click();
  });
  await sleep(2500);

  await page.screenshot({ path: path.join(PUBLIC_SHOTS, 'studio.png') });
  await page.screenshot({ path: path.join(shotsDir, 'studio-full.png') });

  await browser.close();
  console.log(`снимки записаны в ${PUBLIC_SHOTS}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
