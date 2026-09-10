'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useStudioStore, type TransformMode } from '@/store/studio';
import { HeightControl, RotationControl, ScaleControl } from './controls';
import {
  ArrowClockwiseIcon,
  ArrowsOutCardinalIcon,
  ArrowsVerticalIcon,
  CopyIcon,
  ResizeIcon,
  SlidersHorizontalIcon,
  TrashIcon,
  XIcon,
} from '@/components/ui/icons';

/**
 * Панель выделенного предмета.
 *
 * Появляется ровно тогда, когда что-то выбрано, и говорит три вещи сразу: что
 * выбрано, что с этим можно сделать и что делает перетаскивание прямо сейчас.
 * Активный режим подсвечен акцентом — это единственный источник правды о том,
 * как поведёт себя палец на модели.
 *
 * Порядок режимов не случаен: сначала то, что делают всегда (двигают), потом
 * то, что делают часто (поворот), и только потом высота и размер. Удаление
 * стоит с краю и отделено — промахнуться по нему мимо «дублировать» нельзя.
 */

const MODES: {
  id: TransformMode;
  label: string;
  hint: string;
  key: string;
  icon: typeof ArrowsOutCardinalIcon;
}[] = [
  { id: 'move', label: 'Двигать', hint: 'Тяните предмет по полу', key: 'G', icon: ArrowsOutCardinalIcon },
  { id: 'rotate', label: 'Поворот', hint: 'Тяните вокруг предмета', key: 'R', icon: ArrowClockwiseIcon },
  { id: 'height', label: 'Высота', hint: 'Тяните предмет вверх и вниз', key: 'H', icon: ArrowsVerticalIcon },
  { id: 'scale', label: 'Размер', hint: 'Тяните от центра предмета', key: 'S', icon: ResizeIcon },
];

export default function ObjectToolbar({
  compact,
  touch,
  onOpenInspector,
}: {
  /** Одна строка вместо трёх: на десктопе рядом стоит полный инспектор. */
  compact: boolean;
  touch: boolean;
  onOpenInspector?: () => void;
}) {
  const selected = useStudioStore((s) => s.selected);
  const placements = useStudioStore((s) => s.placements);
  const catalog = useStudioStore((s) => s.catalog);
  const mode = useStudioStore((s) => s.mode);
  const setMode = useStudioStore((s) => s.setMode);
  const select = useStudioStore((s) => s.select);
  const remove = useStudioStore((s) => s.remove);
  const duplicate = useStudioStore((s) => s.duplicate);

  const placement = placements.find((p) => p.uid === selected);
  const item = placement ? catalog[placement.furnitureId] : null;
  if (!placement || !item) return null;

  const modeButtonClass = (on: boolean) =>
    `btn-base cursor-pointer transition-colors ${
      on ? 'bg-accent text-white' : 'text-muted hover:bg-canvas hover:text-ink'
    }`;

  if (compact) {
    const h = touch ? 'h-11' : 'h-9';
    return (
      <div className="panel pointer-events-auto flex items-center gap-1 p-1.5">
        <span className="ml-1 flex min-w-0 items-center gap-2 pr-1.5">
          <span className="h-7 w-7 shrink-0 rounded-[6px] border border-hairline bg-paper p-0.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.thumbnail_path}
              alt=""
              className="h-full w-full object-contain mix-blend-multiply"
            />
          </span>
          <span className="max-w-[150px] truncate text-[13px] font-medium">{item.name}</span>
        </span>

        <span className="h-6 w-px bg-line" />

        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            aria-pressed={mode === m.id}
            title={`${m.hint} · ${m.key}`}
            className={`${modeButtonClass(mode === m.id)} ${h} gap-1.5 px-2.5 text-[13px]`}
          >
            <m.icon size={16} />
            {m.label}
          </button>
        ))}

        <span className="h-6 w-px bg-line" />

        {onOpenInspector && (
          <button
            type="button"
            onClick={onOpenInspector}
            title="Все свойства"
            aria-label="Все свойства предмета"
            className={`btn-base btn-quiet ${h} w-11`}
          >
            <SlidersHorizontalIcon size={17} />
          </button>
        )}
        <button
          type="button"
          onClick={() => duplicate(placement.uid)}
          title="Дублировать (D)"
          aria-label="Дублировать"
          className={`btn-base btn-quiet ${h} ${touch ? 'w-11' : 'w-9'}`}
        >
          <CopyIcon size={16} />
        </button>
        <button
          type="button"
          onClick={() => remove(placement.uid)}
          title="Удалить (Delete)"
          aria-label="Удалить"
          className={`btn-base ${h} ${touch ? 'w-11' : 'w-9'} text-muted transition-colors hover:bg-danger-soft hover:text-danger`}
        >
          <TrashIcon size={16} />
        </button>
        <button
          type="button"
          onClick={() => select(null)}
          title="Снять выделение (Esc)"
          aria-label="Снять выделение"
          className={`btn-base btn-quiet ${h} ${touch ? 'w-11' : 'w-9'}`}
        >
          <XIcon size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto w-full border-t border-line bg-surface/97 backdrop-blur-xl md:border-t-0">
      {/* Что выбрано и что с этим можно сделать помимо трансформаций. */}
      <div className="flex items-center gap-2 px-3 pt-2">
        <span className="h-8 w-8 shrink-0 rounded-[6px] border border-hairline bg-paper p-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.thumbnail_path}
            alt=""
            className="h-full w-full object-contain mix-blend-multiply"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">{item.name}</span>
          <span className="num block truncate text-[11px] text-faint">
            {Math.round(item.width * placement.scale * 100)}×
            {Math.round(item.depth * placement.scale * 100)}×
            {Math.round(item.height * placement.scale * 100)} см
          </span>
        </span>

        {onOpenInspector && (
          <button
            type="button"
            onClick={onOpenInspector}
            aria-label="Все свойства предмета"
            title="Все свойства"
            className="btn-base btn-quiet h-10 w-10"
          >
            <SlidersHorizontalIcon size={18} />
          </button>
        )}
        <button
          type="button"
          onClick={() => duplicate(placement.uid)}
          aria-label="Дублировать"
          className="btn-base btn-quiet h-10 w-10"
        >
          <CopyIcon size={18} />
        </button>
        <button
          type="button"
          onClick={() => remove(placement.uid)}
          aria-label="Удалить предмет"
          className="btn-base h-10 w-10 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
        >
          <TrashIcon size={18} />
        </button>
        <button
          type="button"
          onClick={() => select(null)}
          aria-label="Снять выделение"
          className="btn-base btn-quiet h-10 w-10"
        >
          <XIcon size={17} />
        </button>
      </div>

      {/* Режимы: четыре равные колонки — на любой ширине попадаешь пальцем. */}
      <div className="grid grid-cols-4 gap-1 px-2 pt-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            aria-pressed={mode === m.id}
            className={`${modeButtonClass(mode === m.id)} h-[52px] flex-col gap-1 rounded-[10px] text-[11.5px] font-medium`}
          >
            <m.icon size={20} />
            {m.label}
          </button>
        ))}
      </div>

      {/* Крупный орган управления активным режимом. Для перемещения его нет
          намеренно: двигать предмет ползунками — худший из способов, а сцена
          прямо под панелью и так принимает палец. */}
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
          className="px-3 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))]"
        >
          {mode === 'move' && (
            <p className="flex h-11 items-center justify-center gap-2 text-center text-[12.5px] text-muted">
              Тяните предмет пальцем по полу. Он сам встанет к стене.
            </p>
          )}
          {mode === 'height' && <HeightControl placement={placement} item={item} touch={touch} />}
          {mode === 'rotate' && <RotationControl placement={placement} item={item} touch={touch} />}
          {mode === 'scale' && <ScaleControl placement={placement} item={item} touch={touch} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
