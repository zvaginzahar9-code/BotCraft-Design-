/**
 * Перекодирует hero-ролик под перемотку скроллом.
 *
 * У исходника две независимые проблемы, и обе проявляются как рывки, когда клип
 * перематывают скроллом, а не проигрывают:
 *
 *   1. Джаддер. Файл помечен как 1280x720@60, но на деле это контент 24 fps,
 *      добитый до 60 дублированными кадрами: промежутки между различными кадрами
 *      чередуются 33 мс / 50 мс (паттерн 2:3). Новую информацию несут лишь 240
 *      кадров из 600. Перемотка вскрывает эту неравномерность куда сильнее
 *      воспроизведения, потому что глаз следит за скроллом.
 *
 *      Поэтому: `mpdecimate` выбрасывает добивку, `setpts`/`fps` перетактовывает
 *      остаток в чистые 24 fps, а `minterpolate` заново собирает 60 fps с
 *      компенсацией движения. На выходе 596 кадров и *ни одного* дубля, так что
 *      на 220vh прокрутки героя отдельный кадр приходится примерно на каждые
 *      3.7 px.
 *
 *   2. Задержка перемотки. У исходника GOP в 250 кадров — три ключевых кадра на
 *      весь клип, — поэтому перемотка в произвольную точку означает
 *      декодирование до 250 кадров. Кодирование только ключевыми кадрами (`-g 1`)
 *      меняет размер файла на стоимость перемотки: любое присвоение
 *      `currentTime` становится декодированием одного кадра.
 *
 * CRF 27 выбран так, чтобы уложиться примерно в 5 МБ при 60 fps из одних
 * ключевых кадров; на этом материале (плоские рендеры, без зерна) он держит
 * SSIM 0.975 относительно интерполированного мастера без видимых артефактов.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from '../lib/paths.mjs';
const SRC_DIR = path.join(root, 'assets', 'raw', 'hero');
const OUT_DIR = path.join(root, 'public', 'hero');

const FPS = 60;
const SRC_FPS = 24; // истинная частота исходника после снятия добивки
const WIDTH = 1280;
const CRF = 27;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const src = (await fs.readdir(SRC_DIR)).find((f) => /\.(mp4|mov|webm|m4v)$/i.test(f));
  if (!src) throw new Error(`no source video in ${SRC_DIR}`);
  const input = path.join(SRC_DIR, src);
  console.log(`source: ${src}`);

  const filters = [
    // Выбрасываем дубли, появившиеся при добивке 24->60...
    'mpdecimate',
    // ...затем перетактовываем выжившие в постоянные 24 fps. mpdecimate
    // оставляет дыры в таймстемпах; без этого интерполятор унаследовал бы их.
    `setpts=N/${SRC_FPS}/TB`,
    `fps=${SRC_FPS}`,
    // Синтезируем недостающие кадры. `mci` с двунаправленной оценкой медленный
    // (~90 с на этот клип), но данный материал — плоские рендеры, чистые края,
    // без зерна — близок к лучшему случаю для блочного сопоставления.
    `minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`,
    `scale=${WIDTH}:-2:flags=lanczos`,
  ].join(',');

  await run('ffmpeg', [
    '-y', '-i', input,
    '-an', '-sn', '-dn',
    '-map', '0:v:0',
    '-vf', filters,
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-preset', 'slow',
    '-crf', String(CRF),
    // Только ключевые кадры: каждый кадр — keyframe, без B-кадров и цепочек ссылок.
    '-g', '1', '-keyint_min', '1',
    '-sc_threshold', '0',
    '-x264-params', 'ref=1:bframes=0',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    path.join(OUT_DIR, 'hero.mp4'),
  ]);

  // Кадр-постер, чтобы герою было что отрисовать до декодирования видео.
  await run('ffmpeg', [
    '-y', '-i', input,
    '-frames:v', '1', '-q:v', '4',
    '-vf', `scale=${WIDTH}:-2`,
    path.join(OUT_DIR, 'hero-poster.jpg'),
  ]);

  const stat = await fs.stat(path.join(OUT_DIR, 'hero.mp4'));
  console.log(`hero.mp4: ${(stat.size / 1048576).toFixed(1)} MB @ ${FPS}fps all-intra`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
