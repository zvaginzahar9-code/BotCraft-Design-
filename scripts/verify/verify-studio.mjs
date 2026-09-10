/**
 * Проверка модели взаимодействия 3D-конструктора.
 *
 * Здесь проверяется не «страница открылась», а инварианты, ради которых
 * конструктор вообще переписан: мебель не в стене, мебель вплотную к стене,
 * высота над полом, отмена, и главное — разделение жестов. «Палец на предмете
 * двигает предмет, палец на пустоте крутит камеру» — это обещание продукта, и
 * оно должно проверяться числами, а не на глаз.
 *
 * Состояние сцены читается из стора, который клиент выставляет в
 * `window.__studioStore` только в дев-сборке: по пикселям невозможно проверить,
 * что диван стоит ровно в 64.4 см от осевой линии стены.
 *
 * Запуск: node scripts/verify/verify-studio.mjs [baseUrl]
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

/** Комната 5x4 с толщиной стен 15 см: внутренняя грань лежит на 7.5 см внутрь. */
const ROOM = {
  points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }],
  closed: true,
  wallHeight: 2.7,
  wallThickness: 0.15,
  openings: [],
};
const FACE = ROOM.wallThickness / 2;

async function openStudio(browser, { width, height, touch }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, hasTouch: touch, isMobile: touch });
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const models = [];
  page.on('response', (r) => {
    if (r.url().endsWith('.glb')) models.push(r.url());
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const id = await page.evaluate(async (room) => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Проверка конструктора', roomGeometry: room }),
    });
    return (await res.json()).project.id;
  }, ROOM);

  await page.goto(`${BASE}/studio/${id}`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction(() => !!window.__studioStore, { timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await sleep(3500);
  return { page, id, errors, models };
}

const state = (page) =>
  page.evaluate(() => {
    const s = window.__studioStore.getState();
    return {
      placements: s.placements,
      selected: s.selected,
      past: s.past.length,
      catalog: Object.keys(s.catalog).length,
    };
  });

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

  /* --- 1. мышь: расстановка, стены, высота, история -------------------- */

  const desktop = await openStudio(browser, { width: 1440, height: 900, touch: false });
  const page = desktop.page;

  await page.evaluate(() => {
    const s = window.__studioStore.getState();
    const sofa = Object.values(s.catalog).find((i) => i.name === 'Диван Cloud');
    s.add((sofa ?? Object.values(s.catalog)[0]).id);
  });
  await sleep(2500);

  let s = await state(page);
  check('каталог доступен целиком', s.catalog >= 70, `${s.catalog} моделей`);
  check('предмет добавлен и сразу выделен', s.placements.length === 1 && !!s.selected);
  check('новый предмет стоит на полу', s.placements[0].position[1] === 0);

  const canvas = await page.$eval('canvas', (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const before = (await state(page)).placements[0].position.slice();

  await page.mouse.move(canvas.x + canvas.w / 2, canvas.y + canvas.h / 2 + 20);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(
      canvas.x + canvas.w / 2 - (240 * i) / 24,
      canvas.y + canvas.h / 2 + 20 - (100 * i) / 24,
    );
    await sleep(16);
  }
  await page.mouse.up();
  await sleep(400);

  s = await state(page);
  const after = s.placements[0].position;
  check(
    'предмет перетаскивается мышью',
    Math.hypot(after[0] - before[0], after[2] - before[2]) > 0.3,
    `${before.map((v) => v.toFixed(2))} -> ${after.map((v) => v.toFixed(2))}`,
  );
  check('перетаскивание — один шаг истории', s.past === 2, `${s.past} шага`);

  const inside = await page.evaluate(() => {
    const st = window.__studioStore.getState();
    const p = st.placements[0];
    const item = st.catalog[p.furnitureId];
    const hw = (item.width * p.scale) / 2;
    const hd = (item.depth * p.scale) / 2;
    const c = Math.cos(p.rotationY);
    const si = Math.sin(p.rotationY);
    return [[hw, hd], [hw, -hd], [-hw, hd], [-hw, -hd]]
      .map(([a, b]) => [p.position[0] + a * c + b * si, p.position[2] - a * si + b * c])
      .every(([x, z]) => x >= 0.07 && x <= 4.93 && z >= 0.07 && z <= 3.93);
  });
  check('после перетаскивания предмет целиком внутри стен', inside);

  const snapped = await page.evaluate((face) => {
    const st = window.__studioStore.getState();
    const p = st.placements[0];
    st.update(p.uid, { position: [2.5, 0, 0.9] });
    const q = window.__studioStore.getState().placements[0];
    const item = st.catalog[q.furnitureId];
    return { z: q.position[2], expect: face + (item.depth * q.scale) / 2 };
  }, FACE);
  check(
    'мебель прижимается к стене вплотную, без зазора',
    Math.abs(snapped.z - snapped.expect) < 0.01,
    `z=${snapped.z.toFixed(3)} при ожидаемом ${snapped.expect.toFixed(3)}`,
  );

  const corner = await page.evaluate((face) => {
    const st = window.__studioStore.getState();
    const p = st.placements[0];
    const item = st.catalog[p.furnitureId];
    // Ставим предмет в угол так, чтобы обе щели были в пределах прилипания.
    st.update(p.uid, {
      position: [face + (item.width * p.scale) / 2 + 0.17, 0, 0.9],
    });
    const q = window.__studioStore.getState().placements[0];
    return {
      x: q.position[0],
      z: q.position[2],
      wantX: face + (item.width * q.scale) / 2,
      wantZ: face + (item.depth * q.scale) / 2,
    };
  }, FACE);
  check(
    'в углу предмет садится вплотную к обеим стенам',
    Math.abs(corner.x - corner.wantX) < 0.02 && Math.abs(corner.z - corner.wantZ) < 0.02,
    `x=${corner.x.toFixed(3)}/${corner.wantX.toFixed(3)} z=${corner.z.toFixed(3)}/${corner.wantZ.toFixed(3)}`,
  );

  const rotated = await page.evaluate((face) => {
    const st = window.__studioStore.getState();
    const p = st.placements[0];
    st.update(p.uid, { position: [2.5, 0, 0.9] });
    st.update(p.uid, { rotationY: Math.PI / 2 });
    const q = window.__studioStore.getState().placements[0];
    const item = st.catalog[q.furnitureId];
    return { z: q.position[2], need: face + (item.width * q.scale) / 2 };
  }, FACE);
  check(
    'поворот у стены выталкивает предмет, а не топит его в стене',
    rotated.z >= rotated.need - 0.01,
    `z=${rotated.z.toFixed(3)} при минимуме ${rotated.need.toFixed(3)}`,
  );

  const height = await page.evaluate(() => {
    const st = () => window.__studioStore.getState();
    const p = st().placements[0];
    st().update(p.uid, { position: [p.position[0], 1.2, p.position[2]] });
    const raised = st().placements[0].position[1];
    st().dropToFloor(p.uid);
    const dropped = st().placements[0].position[1];
    st().update(p.uid, { position: [p.position[0], 99, p.position[2]] });
    const capped = st().placements[0].position[1];
    const item = st().catalog[p.furnitureId];
    return { raised, dropped, capped, ceiling: 2.7 - item.height * p.scale };
  });
  check('предмет поднимается над полом', Math.abs(height.raised - 1.2) < 0.001);
  check('кнопка «на пол» возвращает предмет вниз', height.dropped === 0);
  check(
    'предмет не проходит сквозь потолок',
    Math.abs(height.capped - height.ceiling) < 0.01,
    `y=${height.capped.toFixed(2)} при максимуме ${height.ceiling.toFixed(2)}`,
  );

  const history = await page.evaluate(() => {
    const st = () => window.__studioStore.getState();
    const uid = st().placements[0].uid;
    st().update(uid, { position: [2.5, 0, 2] });
    const moved = st().placements[0].position.slice();
    st().undo();
    const undone = st().placements[0].position.slice();
    st().redo();
    const redone = st().placements[0].position.slice();
    st().remove(uid);
    const afterRemove = st().placements.length;
    st().undo();
    return { moved, undone, redone, afterRemove, afterUndo: st().placements.length };
  });
  check(
    'отмена возвращает прежнее положение',
    Math.abs(history.undone[2] - history.moved[2]) > 0.01,
    JSON.stringify(history.undone),
  );
  check('повтор возвращает отменённое', Math.abs(history.redone[2] - history.moved[2]) < 0.001);
  check(
    'отмена восстанавливает удалённый предмет',
    history.afterRemove === 0 && history.afterUndo === 1,
  );

  await page.screenshot({ path: path.join(shotsDir, '11-studio-desktop.png') });

  /* --- 2. производительность ------------------------------------------- */

  await page.evaluate(() => {
    const st = window.__studioStore.getState();
    Object.keys(st.catalog)
      .slice(0, 8)
      .forEach((id) => st.add(id));
  });
  await sleep(12000);
  check(
    'каждая модель скачивается ровно один раз',
    desktop.models.length === new Set(desktop.models).size,
    `${desktop.models.length} запросов на ${new Set(desktop.models).size} моделей`,
  );

  await page.evaluate(() => window.__studioStore.getState().select(null));
  await sleep(800);
  const idle = await page.evaluate(async () => {
    const start = window.__studioGl.info.render.frame;
    await new Promise((r) => setTimeout(r, 1500));
    return window.__studioGl.info.render.frame - start;
  });
  check('в покое сцена не перерисовывается', idle <= 3, `${idle} кадров за 1.5 с покоя`);

  const cost = await page.evaluate(() => {
    const st = () => window.__studioStore.getState();
    const uid = st().placements[0].uid;
    st().beginGesture('bench');
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      st().update(uid, { position: [2 + Math.sin(i / 10), 0, 2 + Math.cos(i / 10)] }, { silent: true });
    }
    const ms = performance.now() - t0;
    st().endGesture();
    return ms / 200;
  });
  check('правка расстановки дешевле кадра', cost < 2, `${cost.toFixed(2)} мс на шаг жеста`);

  await page.evaluate(async (id) => {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  }, desktop.id);
  check(
    'работа мышью прошла без ошибок в консоли',
    desktop.errors.length === 0,
    desktop.errors.slice(0, 2).join(' | '),
  );
  await page.close();

  /* --- 3. касание: жесты предмета и камеры не путаются ------------------ */

  const mobile = await openStudio(browser, { width: 390, height: 844, touch: true });
  const m = mobile.page;

  await m.evaluate(() => {
    const st = window.__studioStore.getState();
    const sofa = Object.values(st.catalog).find((i) => i.name === 'Диван Cloud');
    const uid = st.add((sofa ?? Object.values(st.catalog)[0]).id);
    st.update(uid, { position: [2.5, 0, 2] });
    st.select(null);
  });
  await sleep(4000);

  const camera = () =>
    m.evaluate(() => {
      const c = window.__studioCamera;
      return [+c.position.x.toFixed(3), +c.position.y.toFixed(3), +c.position.z.toFixed(3)];
    });
  const position = () =>
    m.evaluate(() => window.__studioStore.getState().placements[0].position.map((v) => +v.toFixed(3)));
  const selected = () => m.evaluate(() => window.__studioStore.getState().selected);

  // Экранная точка предмета: тянуть надо именно за модель.
  const onScreen = await m.evaluate(() => {
    const p = window.__studioStore.getState().placements[0];
    const cam = window.__studioCamera;
    const rect = document.querySelector('canvas').getBoundingClientRect();
    const v = new (Object.getPrototypeOf(cam.position).constructor)(
      p.position[0],
      p.position[1] + 0.4,
      p.position[2],
    );
    v.project(cam);
    return { x: rect.x + ((v.x + 1) / 2) * rect.width, y: rect.y + ((1 - v.y) / 2) * rect.height };
  });

  const cdp = await m.createCDPSession();
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });

  const startPosition = await position();
  await touch('touchStart', [{ x: onScreen.x, y: onScreen.y, id: 1 }]);
  await touch('touchEnd', []);
  await sleep(400);
  check('тап по предмету выделяет его', (await selected()) !== null);
  check(
    'тап не сдвигает предмет',
    JSON.stringify(await position()) === JSON.stringify(startPosition),
  );

  const cameraBefore = await camera();
  await touch('touchStart', [{ x: onScreen.x, y: onScreen.y, id: 1 }]);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', [{ x: onScreen.x - i * 8, y: onScreen.y - i * 4, id: 1 }]);
    await sleep(25);
  }
  await touch('touchEnd', []);
  await sleep(400);
  const dragged = await position();
  check(
    'палец на предмете двигает предмет',
    Math.hypot(dragged[0] - startPosition[0], dragged[2] - startPosition[2]) > 0.25,
    `${startPosition} -> ${dragged}`,
  );
  check(
    'камера при перетаскивании предмета не шевелится',
    JSON.stringify(await camera()) === JSON.stringify(cameraBefore),
  );

  await touch('touchStart', [{ x: 60, y: 300, id: 1 }]);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', [{ x: 60 + i * 10, y: 300 + i * 2, id: 1 }]);
    await sleep(25);
  }
  await touch('touchEnd', []);
  await sleep(700);
  check(
    'палец на пустом месте вращает камеру',
    JSON.stringify(await camera()) !== JSON.stringify(cameraBefore),
  );
  check(
    'предмет при вращении камеры остаётся на месте',
    JSON.stringify(await position()) === JSON.stringify(dragged),
  );

  const distanceTo = (c) => Math.hypot(c[0] - 2.5, c[1], c[2] - 2);
  const beforePinch = await camera();
  await touch('touchStart', [
    { x: 150, y: 400, id: 1 },
    { x: 250, y: 400, id: 2 },
  ]);
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', [
      { x: 150 - i * 6, y: 400, id: 1 },
      { x: 250 + i * 6, y: 400, id: 2 },
    ]);
    await sleep(35);
  }
  await touch('touchEnd', []);
  await sleep(700);
  const afterPinch = await camera();
  check(
    'щипок двумя пальцами приближает камеру',
    distanceTo(afterPinch) < distanceTo(beforePinch) - 0.05,
    `${distanceTo(beforePinch).toFixed(2)} м -> ${distanceTo(afterPinch).toFixed(2)} м`,
  );

  const layout = await m.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    toolbar: [...document.querySelectorAll('button')]
      .filter((b) => ['Двигать', 'Поворот', 'Высота', 'Размер'].includes(b.textContent.trim()))
      .map((b) => Math.round(b.getBoundingClientRect().height)),
  }));
  check('на телефоне нет горизонтального переполнения', layout.overflow <= 1, `${layout.overflow}px`);
  check(
    'режимы предмета — цели под палец',
    layout.toolbar.length === 4 && layout.toolbar.every((h) => h >= 44),
    `высоты ${layout.toolbar.join(', ')}`,
  );

  await m.screenshot({ path: path.join(shotsDir, '12-studio-mobile.png') });
  await m.evaluate(async (id) => {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  }, mobile.id);
  check(
    'работа пальцем прошла без ошибок в консоли',
    mobile.errors.length === 0,
    mobile.errors.slice(0, 2).join(' | '),
  );

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`);
  console.log(`скриншоты в ${shotsDir}`);
  if (failed.length) process.exitCode = 1;
}

main();
