/**
 * Проверка жизненного цикла проекта и черчения пальцем.
 *
 * Два состояния редактора обязаны быть строго разделены: «создать дизайн» — это
 * всегда чистый лист, «открыть проект» — всегда сохранённая комната. Между ними
 * ходят десятки раз, и ни один из переходов не имеет права ни потерять
 * сохранённое, ни наплодить копий проекта.
 *
 * Заодно проверяется рисование на касании: тап ставит точку, щипок меняет
 * масштаб, и одно не превращается в другое.
 *
 * Запуск: node scripts/verify/verify-project.mjs [baseUrl]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { shotsDir } from '../lib/paths.mjs';
import { findBrowser } from '../lib/browser.mjs';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function newPage(browser, { width, height, touch }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, hasTouch: touch, isMobile: touch });
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.evaluateOnNewDocument(() => {
    const style = document.createElement('style');
    style.textContent = 'nextjs-portal,[data-next-badge-root]{display:none !important}';
    document.addEventListener('DOMContentLoaded', () => document.head.append(style));
  });
  return page;
}

/**
 * Идентификаторы проектов из списка.
 *
 * Считаем именно множество, а не количество: список отдаёт последние
 * пятьдесят, и на насыщенной базе счётчик перестаёт расти, хотя проект
 * создался. Появление нового id виден при любом размере базы — новые проекты
 * всегда наверху списка.
 */
const projectIds = (page) =>
  page.evaluate(async () =>
    (await (await fetch('/api/projects')).json()).projects.map((p) => p.id),
  );

async function main() {
  await fs.mkdir(shotsDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: await findBrowser(),
    headless: true,
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1440,900',
    ],
  });

  /* --- 1. чистый лист на новом проекте ---------------------------------- */

  const page = await newPage(browser, { width: 1440, height: 900, touch: false });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  // Черновик прошлой сессии: именно его новый проект не должен унаследовать.
  await page.goto(`${BASE}/editor`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => {
    localStorage.setItem(
      'botcraft.plan.v1',
      JSON.stringify({
        room: {
          points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }],
          closed: false,
          wallHeight: 2.7,
          wallThickness: 0.15,
          openings: [],
        },
        projectName: 'Вчерашний черновик',
        projectId: null,
      }),
    );
  });

  await page.goto(`${BASE}/editor?new=1`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('canvas');
  await sleep(700);

  const fresh = await page.evaluate(function () {
    const s = JSON.parse(window.localStorage.getItem('botcraft.plan.v1'));
    return {
      points: s.room.points.length,
      name: s.projectName,
      id: s.projectId,
      url: location.pathname + location.search,
    };
  });
  check('новый проект: холст пуст', fresh.points === 0, `${fresh.points} точек`);
  check('новый проект: чужое название не унаследовано', fresh.name === 'Новый проект', fresh.name);
  check('новый проект: ни с каким проектом не связан', fresh.id === null);
  check('новый проект: параметр убран из адреса', fresh.url === '/editor', fresh.url);

  /* --- 2. чертёж и переход в 3D ----------------------------------------- */

  const idsBefore = await projectIds(page);
  const box = await page.$eval('canvas', (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const at = (fx, fy) => [box.x + box.w * fx, box.y + box.h * fy];

  for (const [x, y] of [at(0.3, 0.25), at(0.7, 0.25), at(0.7, 0.65), at(0.3, 0.65), at(0.3, 0.25)]) {
    await page.mouse.move(x, y);
    await sleep(60);
    await page.mouse.click(x, y);
    await sleep(220);
  }
  await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Название проекта"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Спальня для проверки');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 120000 }),
    page.evaluate(() =>
      [...document.querySelectorAll('button')].find((b) => /В 3D/.test(b.textContent)).click(),
    ),
  ]);
  const id = page.url().split('/').pop();
  check('переход в 3D создаёт проект', /\/studio\/[0-9a-f-]{36}/.test(page.url()), page.url());
  const idsAfter = await projectIds(page);
  const added = idsAfter.filter((x) => !idsBefore.includes(x));
  check('создан ровно один проект', added.length === 1, `новых записей: ${added.length}`);

  await page.waitForFunction(() => !!window.__studioStore, { timeout: 60000 });
  await sleep(3000);
  const inStudio = await page.evaluate(() => {
    const s = window.__studioStore.getState();
    return { points: s.room.points.length, name: s.projectName };
  });
  check('3D получает нарисованную комнату', inStudio.points === 4, `${inStudio.points} точек`);
  check('название проекта перенеслось', inStudio.name === 'Спальня для проверки', inStudio.name);

  /* --- 3. сохранение и возврат к чертежу -------------------------------- */

  await page.evaluate(() => {
    const s = window.__studioStore.getState();
    Object.keys(s.catalog)
      .slice(0, 2)
      .forEach((furnitureId) => s.add(furnitureId));
  });
  await sleep(2000);
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => /Сохранить/.test(b.textContent)).click(),
  );
  let saved = false;
  for (let i = 0; i < 40; i++) {
    saved = await page.evaluate(() => document.body.innerText.includes('Сохранено'));
    if (saved) break;
    await sleep(300);
  }
  check('расстановка сохраняется', saved);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
    page.evaluate(() => document.querySelector('a[aria-label="Назад к чертежу"]').click()),
  ]);
  await page.waitForSelector('canvas');
  // Редактор подтягивает проект из базы асинхронно, и в dev-режиме маршрут
  // /editor вдобавок компилируется при первом заходе. Ждём саму загрузку, а не
  // фиксированную паузу: иначе проверка читает черновик, который ещё не успели
  // заменить сохранённой комнатой.
  const readPlan = () =>
    page.evaluate(function () {
      const raw = window.localStorage.getItem('botcraft.plan.v1');
      if (!raw) return null;
      const s = JSON.parse(raw);
      return { points: s.room.points.length, closed: s.room.closed, id: s.projectId };
    });
  let back = null;
  for (let i = 0; i < 60; i++) {
    back = await readPlan();
    if (back && back.id) break;
    await sleep(250);
  }
  back = back ?? { points: 0, closed: false, id: null };
  check(
    'возврат к чертежу восстанавливает комнату',
    back.points === 4 && back.closed === true,
    JSON.stringify(back),
  );
  check('чертёж помнит, какому проекту принадлежит', back.id === id, `${back.id}`);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 120000 }),
    page.evaluate(() =>
      [...document.querySelectorAll('button')].find((b) => /В 3D/.test(b.textContent)).click(),
    ),
  ]);
  const idsRepeat = await projectIds(page);
  const addedTwice = idsRepeat.filter((x) => !idsBefore.includes(x));
  check(
    'повторный переход в 3D не создаёт второй проект',
    addedTwice.length === 1 && page.url().endsWith(id),
    `новых записей: ${addedTwice.length}, ${page.url()}`,
  );
  await page.waitForFunction(() => !!window.__studioStore, { timeout: 60000 });
  await sleep(3500);
  const restored = await page.evaluate(() => window.__studioStore.getState().placements.length);
  check('сохранённая мебель на месте после возврата', restored === 2, `${restored} предметов`);

  /* --- 4. новый проект не трогает сохранённый --------------------------- */

  await page.goto(`${BASE}/editor?new=1`, { waitUntil: 'networkidle2' });
  await sleep(700);
  const afterNew = await page.evaluate(function () {
    const s = JSON.parse(window.localStorage.getItem('botcraft.plan.v1'));
    return { points: s.room.points.length, id: s.projectId };
  });
  check(
    'следующий новый проект снова начинается с пустого холста',
    afterNew.points === 0 && afterNew.id === null,
    JSON.stringify(afterNew),
  );
  const survived = await page.evaluate(async (id) => {
    const r = await fetch(`/api/projects/${id}`);
    return (await r.json()).project?.placements?.length ?? -1;
  }, id);
  check('сохранённый проект остался нетронутым', survived === 2, `${survived} предметов в базе`);

  await page.evaluate(async (id) => {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  }, id);
  await page.close();

  /* --- 5. черчение пальцем ---------------------------------------------- */

  const phone = await newPage(browser, { width: 390, height: 844, touch: true });
  phone.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await phone.goto(`${BASE}/editor?new=1`, { waitUntil: 'networkidle2' });
  await phone.waitForSelector('canvas');
  await sleep(700);

  const pbox = await phone.$eval('canvas', (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const pat = (fx, fy) => [pbox.x + pbox.w * fx, pbox.y + pbox.h * fy];
  for (const [x, y] of [pat(0.25, 0.22), pat(0.75, 0.22), pat(0.75, 0.62), pat(0.25, 0.62), pat(0.25, 0.22)]) {
    await phone.touchscreen.tap(x, y);
    await sleep(260);
  }
  const drawn = await phone.evaluate(function () {
    const s = JSON.parse(window.localStorage.getItem('botcraft.plan.v1'));
    return { points: s.room.points.length, closed: s.room.closed };
  });
  check('пальцем: четыре стены построены', drawn.points === 4, `${drawn.points}`);
  check('пальцем: контур замкнулся на первой точке', drawn.closed === true);

  const zoomLabel = () => phone.evaluate(() => +document.body.innerText.match(/(\d+)%/)[1]);
  const zoomBefore = await zoomLabel();
  const cdp = await phone.createCDPSession();
  const cx = pbox.x + pbox.w / 2;
  const cy = pbox.y + pbox.h / 2;
  const pinch = (d) => [
    { x: cx - d, y: cy, id: 1 },
    { x: cx + d, y: cy, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pinch(60) });
  for (const d of [80, 110, 140, 170]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pinch(d) });
    await sleep(40);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
  const zoomAfter = await zoomLabel();
  const afterPinch = await phone.evaluate(function () {
    return JSON.parse(window.localStorage.getItem('botcraft.plan.v1')).room.points.length;
  });
  check('щипок двумя пальцами меняет масштаб чертежа', zoomAfter > zoomBefore, `${zoomBefore}% -> ${zoomAfter}%`);
  check('щипок не ставит лишних точек', afterPinch === 4, `${afterPinch} точек`);

  const exact = await phone.evaluate(async function () {
    const label = document.querySelector('button[title="Изменить длину стены"]');
    label.click();
    await new Promise((r) => setTimeout(r, 300));
    const input = document.querySelector('input[aria-label="Длина стены в метрах"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '4.5');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const p = JSON.parse(window.localStorage.getItem('botcraft.plan.v1')).room.points;
    return Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
  });
  check('точный размер стены применяется и на телефоне', Math.abs(exact - 4.5) < 0.02, `${exact.toFixed(2)} м`);

  const layout = await phone.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    tools: [...document.querySelectorAll('[role="toolbar"] button')].map((b) =>
      Math.round(b.getBoundingClientRect().height),
    ),
  }));
  check('в редакторе на телефоне нет горизонтального переполнения', layout.overflow <= 1);
  check(
    'инструменты плана — цели под палец',
    layout.tools.length === 5 && layout.tools.every((h) => h >= 44),
    `высоты ${layout.tools.join(', ')}`,
  );

  await phone.screenshot({ path: path.join(shotsDir, '13-editor-mobile.png') });
  await browser.close();

  const real = errors.filter((e) => !/favicon|DevTools/.test(e));
  check('за весь сценарий нет ошибок в консоли', real.length === 0, real.slice(0, 3).join(' | '));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`);
  if (failed.length) process.exitCode = 1;
}

main();
