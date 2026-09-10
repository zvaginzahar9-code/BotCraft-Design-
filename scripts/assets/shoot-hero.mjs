/** Снимает героя в нескольких позициях скролла, чтобы перемотку можно было оценить глазами. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { shotsDir } from '../lib/paths.mjs';
import { findBrowser } from '../lib/browser.mjs';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = shotsDir;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: await findBrowser(),
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 950 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await page.evaluate(
    () =>
      new Promise((res) => {
        const v = document.querySelector('video');
        if (v.readyState >= 2) return res();
        v.addEventListener('loadeddata', res, { once: true });
        setTimeout(res, 15000);
      }),
  );

  for (const frac of [0, 0.25, 0.55, 0.85]) {
    await page.evaluate((f) => {
      const h = document.querySelector('main > div').getBoundingClientRect().height;
      window.scrollTo(0, (h - window.innerHeight) * f);
    }, frac);
    await sleep(2500);
    const t = await page.evaluate(() => document.querySelector('video').currentTime.toFixed(2));
    const name = `hero-${String(Math.round(frac * 100)).padStart(2, '0')}.png`;
    await page.screenshot({ path: path.join(OUT, name) });
    console.log(`${name}  video t=${t}s`);
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
