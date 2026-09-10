/**
 * Корень репозитория, вычисленный от расположения этого файла.
 *
 * Скрипты лежат на два уровня глубже корня (scripts/<группа>/<файл>.mjs),
 * поэтому каждый из них берёт `root` отсюда, а не считает `..` самостоятельно:
 * иначе при любом переносе скрипта в другую папку пути молча уезжают.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Каталог, куда скрипты проверки складывают скриншоты. */
export const shotsDir = path.join(root, '.verify');
