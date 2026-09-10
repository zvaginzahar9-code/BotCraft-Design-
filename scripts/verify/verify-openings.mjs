/**
 * Проверяет, что нарисованные на плане двери и окна становятся настоящими
 * дырами в сгенерированных 3D-стенах, и что непрямоугольная комната всё так же
 * порождает стены, следующие за нарисованным полигоном.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { shotsDir } from '../lib/paths.mjs';
import { findBrowser } from '../lib/browser.mjs';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const SHOTS = shotsDir;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

// Г-образная комната с дверью и двумя окнами.
const ROOM = {
  points: [
    { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 3 },
    { x: 3.5, y: 3 }, { x: 3.5, y: 5 }, { x: 0, y: 5 },
  ],
  closed: true,
  wallHeight: 2.7,
  wallThickness: 0.15,
  openings: [
    { id: 'd1', kind: 'door', wall: 0, t: 0.5, width: 0.9, height: 2.1, sill: 0 },
    { id: 'w1', kind: 'window', wall: 1, t: 0.5, width: 1.4, height: 1.4, sill: 0.9 },
    { id: 'w2', kind: 'window', wall: 5, t: 0.4, width: 1.6, height: 1.5, sill: 0.85 },
  ],
};

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });

  const created = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Проверка проёмов', roomGeometry: ROOM, wallHeight: 2.7 }),
  }).then((r) => r.json());
  check('api: Г-образная комната с проёмами принята', !!created.project?.id, created.project?.id);

  // Та же комната без единого проёма: эталон сплошной стены, с которым мы
  // сравним кадр с дверью и окнами. Абсолютный порог «структурности» пришлось
  // бы подбирать под освещение и цвет фона, а разница двух кадров одной и той
  // же геометрии говорит ровно то, что нужно проверить.
  const plain = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Проверка проёмов: контроль',
      roomGeometry: { ...ROOM, openings: [] },
      wallHeight: 2.7,
    }),
  }).then((r) => r.json());

  const browser = await puppeteer.launch({
    executablePath: await findBrowser(),
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${BASE}/studio/${created.project.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('canvas');
  await sleep(6000);

  const geometry = await page.evaluate(async (id) => {
    const r = await fetch(`/api/projects/${id}`);
    const d = await r.json();
    return {
      points: d.project.roomGeometry.points.length,
      openings: d.project.roomGeometry.openings.length,
    };
  }, created.project.id);
  check('3D: шестиугольный полигон проходит цикл через базу данных', geometry.points === 6);
  check('3D: три проёма проходят цикл через базу данных', geometry.openings === 3);

  const stats = await page.evaluate(() =>
    document.body.innerText.match(/Площадь\s*([\d.]+)/)?.[1],
  );
  // 6x3 плюс 3.5x2 = 18 + 7 = 25 м2.
  check('3D: площадь Г-образной комнаты посчитана верно', stats === '25.0', `${stats} m²`);

  await page.screenshot({ path: path.join(SHOTS, '06-openings.png') });

  // В стене с дверью обязана быть дыра: берём вертикальную полосу рендера и
  // убеждаемся, что стена — не одна сплошная плита.
  const box = await page.$eval('canvas', (c) => {
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  // Полосу берём по стенам, а не по всему вьюпорту: пол и фон занимают
  // большую часть кадра ровной заливкой и размывают любую метрику.
  const wallStrip = {
    x: box.x + box.w * 0.12,
    y: box.y + box.h * 0.15,
    width: Math.round(box.w * 0.66),
    height: Math.round(box.h * 0.42),
  };
  const withOpenings = await page.screenshot({ clip: wallStrip, encoding: 'base64' });

  await page.goto(`${BASE}/studio/${plain.project.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('canvas');
  await sleep(6000);
  const withoutOpenings = await page.screenshot({ clip: wallStrip, encoding: 'base64' });

  // Сравниваем по каналам, а не по яркости: интерьер белый на белом, дыра в
  // стене показывает светлый фон, а стекло — холодный голубой оттенок. В
  // градациях серого и то и другое почти совпадает со стеной, и метрика
  // измеряла бы шум вместо проёмов.
  const rgb = (b64) =>
    sharp(Buffer.from(b64, 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = await rgb(withOpenings);
  const c = await rgb(withoutOpenings);
  let changed = 0;
  const n = Math.min(a.data.length, c.data.length);
  for (let i = 0; i < n; i += 3) {
    const d = Math.max(
      Math.abs(a.data[i] - c.data[i]),
      Math.abs(a.data[i + 1] - c.data[i + 1]),
      Math.abs(a.data[i + 2] - c.data[i + 2]),
    );
    if (d > 6) changed++;
  }
  const changedPct = (changed / (n / 3)) * 100;
  check(
    '3D: проёмы действительно вырезаны в стенах (кадр отличается от глухой комнаты)',
    changedPct > 1,
    `${changedPct.toFixed(1)}% пикселей стен отличаются`,
  );

  check('3D: ошибок времени выполнения нет', errors.length === 0, errors.slice(0, 2).join(' // '));

  // Проверка не имеет права оставлять мусор в списке проектов пользователя:
  // две служебные комнаты создаются на один прогон и на нём же заканчиваются.
  for (const id of [created.project?.id, plain.project?.id].filter(Boolean)) {
    await fetch(`${BASE}/api/projects/${id}`, { method: 'DELETE' }).catch(() => {});
  }

  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} проверок пройдено`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
