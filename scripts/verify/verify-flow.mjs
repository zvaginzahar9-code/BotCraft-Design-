/**
 * Сквозная проверка продуктового сценария на работающем dev-сервере.
 *
 * Прогоняет headless Chromium по пути: лендинг -> редактор плана -> рисование
 * комнаты -> правка размера -> генерация 3D -> добавление мебели -> её
 * трансформация -> сохранение -> перезагрузка, проверяя реальное состояние на
 * каждом шаге и снимая скриншоты.
 *
 * Запуск: node scripts/verify/verify-flow.mjs [baseUrl]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { shotsDir } from '../lib/paths.mjs';
import { findBrowser } from '../lib/browser.mjs';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const SHOTS = shotsDir;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: await findBrowser(),
    headless: true,
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1680,1000',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1000, deviceScaleFactor: 1 });
  // Студия предупреждает о несохранённых правках через beforeunload; в
  // автоматическом прогоне подтверждаем уход, иначе перезагрузка зависает.
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  // Прерванные RSC-префетчи — норма, когда роутер уходит с страницы на лету,
  // поэтому считаем только настоящие ответы с ошибкой.
  const modelRequests = new Set();
  page.on('response', (r) => {
    const url = r.url();
    if (url.includes('/models/') && url.endsWith('.glb')) modelRequests.add(url);
    if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()}: ${url}`);
  });

  /* --- 1. landing ---------------------------------------------------- */
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 });
  const landing = await page.evaluate(() => ({
    hasVideo: !!document.querySelector('video[src*="hero"]'),
    cta: [...document.querySelectorAll('a')].some(
      (a) => a.textContent.includes('Создать дизайн') && a.getAttribute('href') === '/editor?new=1',
    ),
    cards: document.querySelectorAll('img[src^="/thumbs/"]').length,
  }));
  check('лендинг: элемент hero-видео на месте', landing.hasVideo);
  check('лендинг: кнопка действия ведёт на чистый холст редактора', landing.cta);
  check('лендинг: превью каталога отрисованы из БД', landing.cards > 0, `${landing.cards} cards`);

  // Герой на скролле: клип обязан проматываться вместе с позицией прокрутки.
  const scrub = await page.evaluate(async () => {
    const v = document.querySelector('video');
    if (!v) return null;
    const waitReady = new Promise((res) => {
      if (v.readyState >= 1) return res(true);
      v.addEventListener('loadedmetadata', () => res(true), { once: true });
      setTimeout(() => res(false), 15000);
    });
    const ready = await waitReady;
    if (!ready) return { ready: false };
    const at0 = v.currentTime;
    window.scrollTo(0, window.innerHeight * 1.6);
    await new Promise((r) => setTimeout(r, 1200));
    const atMid = v.currentTime;
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 1200));
    const back = v.currentTime;
    return { ready: true, duration: v.duration, at0, atMid, back };
  });
  if (scrub?.ready) {
    check('герой: скролл проматывает видео вперёд', scrub.atMid > scrub.at0 + 0.3,
      `t=${scrub.at0.toFixed(2)} -> ${scrub.atMid.toFixed(2)} of ${scrub.duration.toFixed(1)}s`);
    check('герой: скролл назад отматывает видео', scrub.back < scrub.atMid - 0.2,
      `t=${scrub.atMid.toFixed(2)} -> ${scrub.back.toFixed(2)}`);
  } else {
    check('герой: видео декодируется в этом браузере', false, 'metadata never loaded');
  }
  await page.screenshot({ path: path.join(SHOTS, '01-landing.png') });

  /* --- 2. plan editor ------------------------------------------------- */
  await page.goto(`${BASE}/editor?new=1`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('canvas');
  await sleep(600);
  const freshCanvas = await page.evaluate(() => {
    const raw = localStorage.getItem('botcraft.plan.v1');
    return raw ? JSON.parse(raw).room.points.length : 0;
  });
  check('новый проект открывается пустым холстом', freshCanvas === 0, `${freshCanvas} точек`);

  const box = await page.$eval('canvas', (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  // Рисуем прямоугольник четырьмя кликами, затем замыкаем на первой точке.
  const pts = [
    [box.x + 260, box.y + 150],
    [box.x + 700, box.y + 150],
    [box.x + 700, box.y + 470],
    [box.x + 260, box.y + 470],
    [box.x + 260, box.y + 150],
  ];
  for (const [x, y] of pts) {
    await page.mouse.move(x, y);
    await sleep(120);
    await page.mouse.click(x, y);
    await sleep(220);
  }

  const drawn = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('botcraft.plan.v1'));
    return {
      points: s.room.points.length,
      closed: s.room.closed,
      labels: [...document.querySelectorAll('button[title="Изменить длину стены"]')].map(
        (b) => b.textContent,
      ),
    };
  });
  check('редактор: четыре стены построены последовательно', drawn.points === 4, `${drawn.points} points`);
  check('редактор: комната замыкается на первой точке', drawn.closed === true);
  check('редактор: у каждой стены есть подпись размера', drawn.labels.length === 4, drawn.labels.join(', '));

  // Вводим точную длину и проверяем, что геометрия за ней следует. Ввод
  // происходит прямо на подписи размера: модального окна в редакторе нет.
  const resized = await page.evaluate(async () => {
    const before = JSON.parse(localStorage.getItem('botcraft.plan.v1')).room.points;
    [...document.querySelectorAll('button')].find((b) => /Стена 1/.test(b.textContent)).click();
    await new Promise((r) => setTimeout(r, 250));
    const input = document.querySelector('input[inputmode="decimal"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '5');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    // Снимаем выделение, чтобы инспектор снова показывал сводку по комнате.
    document.querySelector('canvas').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return {
      before,
      walls: [...document.querySelectorAll('aside button')]
        .filter((b) => /Стена \d/.test(b.textContent))
        .map((b) => b.textContent),
      stats: document.querySelector('aside').innerText,
      // Длины берём из отдельного элемента строки: в textContent кнопки номер
      // стены и её длина склеиваются («Стена 15.00 м»).
      lengths: [...document.querySelectorAll('aside button')]
        .filter((b) => /Стена \d/.test(b.textContent))
        .map((b) => parseFloat(b.lastElementChild.textContent)),
    };
  });
  check(
    'редактор: введённый размер меняет стену ровно до 5.00 m',
    /Стена 15\.00 м/.test(resized.walls[0] ?? ''),
    resized.walls.join(' | '),
  );
  check(
    'редактор: противоположная параллельная стена следует за ней, комната остаётся прямоугольной',
    /Стена 35\.00 м/.test(resized.walls[2] ?? ''),
  );
  // Площадь сверяем с самими стенами: числа зависят от размера окна, а
  // инвариант «площадь = произведение сторон прямоугольника» — нет.
  const expectedArea = (resized.lengths[0] * resized.lengths[1]).toFixed(1);
  check(
    'редактор: площадь пересчитана по новой геометрии',
    resized.stats.includes(expectedArea),
    `ожидали ${expectedArea} м², панель: ${resized.stats.replace(/\s+/g, ' ').slice(0, 90)}`,
  );
  await page.screenshot({ path: path.join(SHOTS, '02-editor.png') });

  /* --- 3. 3D generation ---------------------------------------------- */
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 120000 }),
    page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .find((b) => /В 3D/.test(b.textContent))
        .click(),
    ),
  ]);
  const studioUrl = page.url();
  check('сценарий: «В 3D» создаёт проект и переходит к нему', /\/studio\/[0-9a-f-]{36}/.test(studioUrl), studioUrl);

  await page.waitForSelector('canvas', { timeout: 30000 });
  await sleep(4000);

  const scene = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return { canvas: !!c, ctxLost: gl ? gl.isContextLost() : null, w: c?.width, h: c?.height };
  });
  check('3D: WebGL-канвас живой', scene.canvas && scene.ctxLost === false, `${scene.w}x${scene.h}`);

  // Комната должна быть реально отрисована, а не просто иметь живой контекст.
  // Обратное чтение WebGL-канваса через drawImage возвращает пустой буфер
  // (preserveDrawingBuffer не включён), поэтому меряем контраст на настоящем
  // скриншоте области вьюпорта.
  const shot = path.join(SHOTS, '03-room.png');
  await page.screenshot({ path: shot });
  const viewportBox = await page.$eval('canvas', (c) => {
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  const region = await page.screenshot({
    clip: { x: viewportBox.x + viewportBox.w * 0.2, y: viewportBox.y + viewportBox.h * 0.25,
            width: viewportBox.w * 0.6, height: viewportBox.h * 0.5 },
    encoding: 'base64',
  });
  const sharp = (await import('sharp')).default;
  const stats = await sharp(Buffer.from(region, 'base64')).stats();
  const spread = Math.max(...stats.channels.map((c) => c.max - c.min));
  const stdev = Math.max(...stats.channels.map((c) => c.stdev));
  check('3D: комната отрисована (во вьюпорте настоящий контраст, а не заливка)',
    spread > 25 && stdev > 4, `spread ${spread}, stdev ${stdev.toFixed(1)}`);

  const viewportClip = {
    x: viewportBox.x + viewportBox.w * 0.2,
    y: viewportBox.y + viewportBox.h * 0.25,
    width: viewportBox.w * 0.6,
    height: viewportBox.h * 0.5,
  };
  const emptyRoomPixels = await sharp(Buffer.from(region, 'base64')).greyscale().raw().toBuffer();

  /* --- 4. catalog + furniture ---------------------------------------- */
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/furniture');
    const data = await res.json();
    return {
      count: data.items.length,
      categories: data.categories.map((c) => `${c.category}:${c.count}`),
      sample: data.items[0],
      cards: document.querySelectorAll('img[src^="/thumbs/"]').length,
    };
  });
  check('каталог: отдаётся из базы данных', catalog.count > 0, `${catalog.count} items`);
  check('каталог: превью ссылаются на сгенерированные рендеры', /^\/thumbs\/.+\.webp$/.test(catalog.sample.thumbnail_path));
  check('каталог: модели ссылаются на оптимизированные GLB', /^\/models\/.+\.glb$/.test(catalog.sample.model_path));
  check('каталог: карточки отрисованы в панели', catalog.cards > 5, `${catalog.cards} cards`);

  // Добавляем три разных предмета, дожидаясь появления каждого в счётчике.
  const countInRoom = () =>
    page.evaluate(() => Number(document.body.innerText.match(/Мебель\s*(\d+)/)?.[1] ?? 0));
  const names = [];
  for (const idx of [1, 6, 12]) {
    const before = await countInRoom();
    const name = await page.evaluate((i) => {
      const cards = [...document.querySelectorAll('button')].filter((b) =>
        b.querySelector('img[src^="/thumbs/"]'),
      );
      const card = cards[i];
      card?.click();
      return card?.getAttribute('title') ?? null;
    }, idx);
    names.push(name);
    for (let t = 0; t < 40 && (await countInRoom()) === before; t++) await sleep(300);
  }
  const total = await countInRoom();
  check('мебель: три модели добавлены в комнату', total === 3,
    `${total} placed: ${names.join(', ')}`);

  // Даём мешам договрузиться и декодироваться, прежде чем судить о картинке:
  // счётчик обновляется мгновенно при добавлении, а GLB — нет.
  await sleep(9000);
  check(
    'мебель: скачаны только поставленные GLB (ленивая загрузка)',
    modelRequests.size === 3,
    `${modelRequests.size} of ${catalog.count} models fetched over the network`,
  );

  // Мебель должна быть видимой, а не просто присутствовать в состоянии:
  // сравниваем вьюпорт с тем же кадром пустой комнаты.
  const furnishedRegion = await page.screenshot({ clip: viewportClip, encoding: 'base64' });
  const furnishedPixels = await sharp(Buffer.from(furnishedRegion, 'base64'))
    .greyscale().raw().toBuffer();
  let changed = 0;
  for (let i = 0; i < Math.min(emptyRoomPixels.length, furnishedPixels.length); i++) {
    if (Math.abs(emptyRoomPixels[i] - furnishedPixels[i]) > 12) changed++;
  }
  const changedPct = (changed / emptyRoomPixels.length) * 100;
  check('мебель: модели действительно отрисованы в комнате', changedPct > 3,
    `${changedPct.toFixed(1)}% of the viewport changed`);
  await page.screenshot({ path: path.join(SHOTS, '04-furnished.png') });

  /* --- 5. transforms -------------------------------------------------- */
  const selectable = await page.evaluate(
    () => !!document.querySelector('input[aria-label="Поворот вокруг вертикальной оси"]'),
  );
  check('мебель: последний добавленный предмет выделен и доступен в инспекторе', selectable);

  const transformed = await page.evaluate(async () => {
    // Поворот и масштаб через панель свойств, которая пишет в то же состояние,
    // что и гизмо.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const rot = document.querySelector('input[aria-label="Поворот вокруг вертикальной оси"]');
    setter.call(rot, '90');
    rot.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    const sc = document.querySelector('input[aria-label="Масштаб предмета"]');
    setter.call(sc, '1.5');
    sc.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    return { text: document.body.innerText };
  });
  check('мебель: поворот применён вокруг вертикальной оси', /90°/.test(transformed.text));
  check('мебель: равномерный масштаб применён', /150%/.test(transformed.text));

  /* --- 6. save + reload ----------------------------------------------- */
  await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim().startsWith('Сохранить'))
      .click(),
  );
  // Ждём именно подтверждения, а не «примерно столько, сколько нужно»: на
  // холодном dev-сервере первый PUT компилирует роут и занимает секунды.
  let savedLabel = '';
  for (let t = 0; t < 40; t++) {
    savedLabel = await page.evaluate(() =>
      [...document.querySelectorAll('button')].map((b) => b.textContent).join('|'),
    );
    if (/Сохранено|Не вышло/.test(savedLabel)) break;
    await sleep(400);
  }
  check('сохранение: показано состояние успеха', /Сохранено/.test(savedLabel), savedLabel.slice(0, 80));

  const api = await page.evaluate(async (url) => {
    const id = url.split('/').pop();
    const r = await fetch(`/api/projects/${id}`);
    const d = await r.json();
    return {
      placements: d.project.placements.length,
      points: d.project.roomGeometry.points.length,
      wallHeight: d.project.wallHeight,
      scales: d.project.placements.map((p) => p.scale),
      rotations: d.project.placements.map((p) => +p.rotationY.toFixed(3)),
    };
  }, studioUrl);
  check('сохранение: расстановка записана реляционно', api.placements === 3, `${api.placements} rows`);
  check('сохранение: геометрия комнаты записана', api.points === 4);
  check('сохранение: преобразования записаны', api.scales.some((s) => s > 1.4) && api.rotations.some((r) => r > 1.5),
    `scales ${api.scales.join(',')} rot ${api.rotations.join(',')}`);

  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(4500);
  const restored = await page.evaluate(
    () => document.body.innerText.match(/Мебель\s*(\d+)/)?.[1] ?? '0',
  );
  check('перезагрузка: проект восстановлен из базы данных', restored === '3', `${restored} items after reload`);
  await page.screenshot({ path: path.join(SHOTS, '05-restored.png') });

  /* --- 7. адаптивность вёрстки ----------------------------------------- */
  const sizes = [
    { name: 'десктоп', w: 1680, h: 1000, slug: 'desktop' },
    { name: 'ноутбук', w: 1366, h: 800, slug: 'laptop' },
    { name: 'планшет', w: 1024, h: 768, slug: 'tablet' },
  ];
  for (const s of sizes) {
    await page.setViewport({ width: s.w, height: s.h });
    await sleep(1400);
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const r = canvas?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        viewportW: Math.round(r?.width ?? 0),
        viewportH: Math.round(r?.height ?? 0),
      };
    });
    check(`адаптивность ${s.name} (${s.w}px): нет горизонтального переполнения`, layout.overflow <= 1,
      `переполнение ${layout.overflow}px`);
    check(`адаптивность ${s.name}: 3D-вьюпорт сохраняет рабочий размер`,
      layout.viewportW > 320 && layout.viewportH > 220,
      `${layout.viewportW}x${layout.viewportH}`);
    await page.screenshot({ path: path.join(SHOTS, `07-${s.slug}.png`) });
  }

  await page.setViewport({ width: 1024, height: 768 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  const landingOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  check('адаптивность: на лендинге нет горизонтального переполнения', landingOverflow <= 1,
    `переполнение ${landingOverflow}px`);

  /* --- итог ------------------------------------------------------------- */
  const realErrors = consoleErrors.filter(
    (e) => !/favicon|Download the React DevTools|Warning: /.test(e),
  );
  check('за весь сценарий нет ошибок в консоли', realErrors.length === 0, realErrors.join('\n      '));

  // Сценарий создаёт настоящий проект — и убирает его за собой, чтобы список
  // проектов не зарастал следами прогонов.
  await page.evaluate(async (url) => {
    await fetch(`/api/projects/${url.split('/').pop()}`, { method: 'DELETE' });
  }, studioUrl);

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`);
  console.log(`скриншоты в ${SHOTS}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
