'use client';

import { useStudioStore } from '@/store/studio';
import { HeightControl, PositionControl, RotationControl, ScaleControl } from './controls';
import { CopyIcon, MagnetIcon, TrashIcon, XIcon } from '@/components/ui/icons';

/**
 * Инспектор выделенного объекта.
 *
 * Каждое поле пишет прямо в сцену, поэтому цифры здесь — не отчёт, а орган
 * управления: значения показываются в тех же единицах, в которых их удобно
 * задавать (сантиметры для габаритов, градусы для поворота), и обновляются,
 * пока предмет тянут в комнате.
 *
 * Порядок блоков повторяет порядок режимов на панели над сценой. Это одна и та
 * же модель предмета, просто показанная подробнее, — переучиваться при
 * переходе с телефона на десктоп не приходится.
 */
export default function PropertiesPanel({
  touch = false,
  embedded = false,
}: {
  touch?: boolean;
  /** Внутри выдвижного листа: заголовок и крестик уже есть у самого листа. */
  embedded?: boolean;
}) {
  const selected = useStudioStore((s) => s.selected);
  const placements = useStudioStore((s) => s.placements);
  const catalog = useStudioStore((s) => s.catalog);
  const remove = useStudioStore((s) => s.remove);
  const duplicate = useStudioStore((s) => s.duplicate);
  const select = useStudioStore((s) => s.select);
  const snapEnabled = useStudioStore((s) => s.snapEnabled);
  const setSnapEnabled = useStudioStore((s) => s.setSnapEnabled);

  const placement = placements.find((p) => p.uid === selected);
  const item = placement ? catalog[placement.furnitureId] : null;

  if (!placement || !item) return null;

  const dims = {
    w: item.width * placement.scale,
    d: item.depth * placement.scale,
    h: item.height * placement.scale,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!embedded && (
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-3 py-2.5">
          <span className="h-9 w-9 shrink-0 rounded-[6px] border border-hairline bg-paper p-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.thumbnail_path}
              alt=""
              className="h-full w-full object-contain mix-blend-multiply"
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold">{item.name}</div>
            <div className="text-[11.5px] text-faint">{item.category}</div>
          </div>
          <button
            type="button"
            onClick={() => select(null)}
            aria-label="Снять выделение"
            title="Снять выделение (Esc)"
            className="btn-base btn-quiet h-8 w-8 shrink-0 rounded-[6px]"
          >
            <XIcon size={14} />
          </button>
        </div>
      )}

      <div className="slim-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[8px] border border-line bg-line">
          <Readout label="Ширина" value={Math.round(dims.w * 100)} />
          <Readout label="Глубина" value={Math.round(dims.d * 100)} />
          <Readout label="Высота" value={Math.round(dims.h * 100)} />
        </div>

        <Field label="Высота над полом">
          <HeightControl placement={placement} item={item} touch={touch} />
          <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
            Поднимите светильник или полку над полом. Кнопка «На пол» вернёт предмет обратно.
          </p>
        </Field>

        <Field label="Поворот">
          <RotationControl placement={placement} item={item} touch={touch} />
        </Field>

        <Field label="Размер">
          <ScaleControl placement={placement} item={item} touch={touch} />
        </Field>

        <Field label="Положение в комнате">
          <PositionControl placement={placement} item={item} touch={touch} />
          <label className="mt-3 flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={snapEnabled}
              onChange={(e) => setSnapEnabled(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <MagnetIcon size={14} />
              Прижимать к стенам
            </span>
          </label>
        </Field>
      </div>

      <div className="flex shrink-0 gap-1.5 border-t border-line px-3 py-2.5">
        <button
          type="button"
          onClick={() => duplicate(placement.uid)}
          className="btn-base btn-ghost h-10 flex-1 text-[12.5px]"
        >
          <CopyIcon size={14} />
          Дублировать
        </button>
        <button
          type="button"
          onClick={() => remove(placement.uid)}
          title="Удалить (Delete)"
          className="btn-base h-10 flex-1 border border-danger/25 bg-danger-soft text-[12.5px] font-medium text-danger transition-colors hover:bg-danger hover:text-white"
        >
          <TrashIcon size={14} />
          Удалить
        </button>
      </div>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface px-2 py-2 text-center">
      <div className="text-[10.5px] text-faint">{label}</div>
      <div className="num mt-0.5 text-[13.5px]">
        {value}
        <span className="ml-0.5 text-[10px] text-faint">см</span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-hairline pt-3.5 first:border-t-0">
      <div className="mb-2.5 panel-title">{label}</div>
      {children}
    </div>
  );
}
