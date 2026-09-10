/**
 * Готовит исходные GLB-экспорты FurniMesh для веба.
 *
 * Исходные модели — экспорт в духе фотограмметрии: один огромный меш плюс пара
 * 4K PNG-текстур на каждую, из-за чего файлы весят по 10-30 МБ. Для DCC-пакета
 * это нормально и совершенно безнадёжно для браузерного каталога из 30
 * позиций, поэтому мы:
 *
 *   1. уменьшаем и перекодируем текстуры в WebP
 *   2. сшиваем / упрощаем / квантуем геометрию
 *   3. пишем EXT_meshopt_compression
 *
 * Результат попадает в public/models/. Оригиналы в assets/raw/ не трогаются.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from '../lib/paths.mjs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, prune, weld, simplify, textureCompress, resample,
  quantize, reorder, flatten, join,
} from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const SRC = path.join(root, 'assets', 'raw', 'models');
const OUT = path.join(root, 'public', 'models');

const TEXTURE_SIZE = 1024;
/**
 * Насколько сильно режется геометрия.
 *
 * Исходники — фотограмметрия по 300 тысяч треугольников на предмет. При 0.35
 * каталог давал около ста тысяч треугольников на модель: десять предметов в
 * комнате — это миллион треугольников на кадр, и мобильная видеокарта на таком
 * кадре складывается. При 0.12 предмет — это тридцать тысяч треугольников, что
 * для дивана в интерьере всё ещё избыточно много, а разницы в кадре не видно:
 * ошибка ограничена 0.5% габарита модели, то есть сантиметром на диване, и
 * силуэт с подушками сохраняется полностью.
 */
const SIMPLIFY_RATIO = 0.12;
const SIMPLIFY_ERROR = 0.005;

async function main() {
  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  await fs.mkdir(OUT, { recursive: true });

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptEncoder,
    'meshopt.encoder': MeshoptEncoder,
  });

  const files = (await fs.readdir(SRC)).filter((f) => f.toLowerCase().endsWith('.glb')).sort();
  const force = process.argv.includes('--force');
  let totalIn = 0;
  let totalOut = 0;
  let skipped = 0;

  for (const file of files) {
    const inPath = path.join(SRC, file);
    const outPath = path.join(OUT, file);
    const inStat = await fs.stat(inPath);
    const inSize = inStat.size;

    // Конвейер идемпотентен и стоит десятки секунд на модель, поэтому уже
    // собранные ассеты пропускаем: добавление одной новой модели в
    // assets/raw/models не должно перемалывать весь каталог заново.
    // `--force` пересобирает всё (например, после смены параметров упрощения).
    if (!force) {
      const outStat = await fs.stat(outPath).catch(() => null);
      if (outStat && outStat.mtimeMs >= inStat.mtimeMs) {
        skipped++;
        continue;
      }
    }

    try {
      const doc = await io.read(inPath);
      await doc.transform(
        dedup(),
        flatten(),
        join(),
        weld(),
        simplify({ simplifier: MeshoptSimplifier, ratio: SIMPLIFY_RATIO, error: SIMPLIFY_ERROR }),
        resample(),
        prune({ keepAttributes: false, keepLeaves: false }),
        textureCompress({
          encoder: sharp,
          targetFormat: 'webp',
          resize: [TEXTURE_SIZE, TEXTURE_SIZE],
          quality: 82,
        }),
        quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
        reorder({ encoder: MeshoptEncoder, target: 'performance' }),
      );

      doc.createExtension(
        (await import('@gltf-transform/extensions')).EXTMeshoptCompression,
      ).setRequired(true).setEncoderOptions({ method: 'quantize' });

      await io.write(outPath, doc);
      const outSize = (await fs.stat(outPath)).size;
      totalIn += inSize;
      totalOut += outSize;
      console.log(
        `${file}  ${(inSize / 1048576).toFixed(1)}MB -> ${(outSize / 1048576).toFixed(2)}MB` +
        `  (${Math.round((1 - outSize / inSize) * 100)}% smaller)`,
      );
    } catch (err) {
      console.error(`${file}  FAILED: ${err.message}`);
      await fs.copyFile(inPath, outPath);
      totalIn += inSize;
      totalOut += inSize;
    }
  }

  console.log(
    `\nTotal ${(totalIn / 1048576).toFixed(0)}MB -> ${(totalOut / 1048576).toFixed(0)}MB ` +
    `across ${files.length - skipped} models (${skipped} already built).`,
  );
}

main();
