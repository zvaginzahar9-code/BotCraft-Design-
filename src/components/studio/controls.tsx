'use client';

import { useStudioStore, SCALE_MAX, SCALE_MIN, type Placement, type CatalogItem } from '@/store/studio';
import { ArrowLineDownIcon, ArrowClockwiseIcon } from '@/components/ui/icons';

/**
 * Органы управления выделенным предметом.
 *
 * Одни и те же элементы стоят и в плавающей панели над сценой, и в инспекторе
 * справа: то, что человек выучил на телефоне, работает точно так же на
 * десктопе. Поэтому они живут отдельным модулем, а не внутри одной из панелей.
 *
 * Каждый ползунок открывает транзакцию истории на нажатии и закрывает на
 * отпускании — иначе одна протяжка размера забила бы весь стек отмены
 * промежуточными значениями.
 */

type ControlProps = {
  placement: Placement;
  item: CatalogItem;
  /** Крупные цели для пальца. */
  touch?: boolean;
};

export function HeightControl({ placement, item, touch }: ControlProps) {
  const update = useStudioStore((s) => s.update);
  const dropToFloor = useStudioStore((s) => s.dropToFloor);
  const wallHeight = useStudioStore((s) => s.room.wallHeight);

  const height = item.height * placement.scale;
  const max = Math.max(0.1, wallHeight - height);
  const value = Math.min(placement.position[1], max);

  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={0}
        max={max}
        step={0.01}
        value={value}
        aria-label="Высота над полом"
        onPointerDown={() => useStudioStore.getState().beginGesture(`height:${placement.uid}`)}
        onPointerUp={() => useStudioStore.getState().endGesture()}
        onChange={(e) =>
          update(placement.uid, {
            position: [placement.position[0], parseFloat(e.target.value), placement.position[2]],
          })
        }
        className={`range flex-1 ${touch ? 'range-lg' : ''}`}
      />
      <output className="num w-14 shrink-0 text-right text-[12.5px] tabular-nums">
        {Math.round(value * 100)} см
      </output>
      <button
        type="button"
        onClick={() => dropToFloor(placement.uid)}
        disabled={value < 0.005}
        title="Опустить на пол"
        className={`btn-base btn-ghost shrink-0 px-2.5 text-[12.5px] ${touch ? 'h-11' : 'h-8'}`}
      >
        <ArrowLineDownIcon size={touch ? 17 : 14} />
        На пол
      </button>
    </div>
  );
}

export function RotationControl({ placement, touch }: ControlProps) {
  const update = useStudioStore((s) => s.update);
  const deg = Math.round((((placement.rotationY * 180) / Math.PI) % 360 + 360) % 360);

  const setDeg = (next: number) =>
    update(placement.uid, { rotationY: (((next % 360) + 360) % 360 * Math.PI) / 180 });

  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={0}
        max={359}
        step={1}
        value={deg}
        aria-label="Поворот вокруг вертикальной оси"
        onPointerDown={() => useStudioStore.getState().beginGesture(`rotate:${placement.uid}`)}
        onPointerUp={() => useStudioStore.getState().endGesture()}
        onChange={(e) => setDeg(parseFloat(e.target.value))}
        className={`range flex-1 ${touch ? 'range-lg' : ''}`}
      />
      <output className="num w-11 shrink-0 text-right text-[12.5px] tabular-nums">{deg}°</output>
      <div className="flex shrink-0 gap-1">
        {/* Четверть оборота — самый частый поворот в интерьере: мебель стоит
            вдоль стен, а стены перпендикулярны. */}
        <button
          type="button"
          onClick={() => setDeg(deg - 90)}
          aria-label="Повернуть на 90° влево"
          className={`btn-base btn-ghost px-2 ${touch ? 'h-11 w-11' : 'h-8 w-8'}`}
        >
          <ArrowClockwiseIcon size={touch ? 17 : 14} className="-scale-x-100" />
        </button>
        <button
          type="button"
          onClick={() => setDeg(deg + 90)}
          aria-label="Повернуть на 90° вправо"
          className={`btn-base btn-ghost px-2 ${touch ? 'h-11 w-11' : 'h-8 w-8'}`}
        >
          <ArrowClockwiseIcon size={touch ? 17 : 14} />
        </button>
      </div>
    </div>
  );
}

export function ScaleControl({ placement, item, touch }: ControlProps) {
  const update = useStudioStore((s) => s.update);
  const percent = Math.round(placement.scale * 100);

  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={SCALE_MIN}
        max={Math.min(SCALE_MAX, 2.5)}
        step={0.01}
        value={placement.scale}
        aria-label="Масштаб предмета"
        onPointerDown={() => useStudioStore.getState().beginGesture(`scale:${placement.uid}`)}
        onPointerUp={() => useStudioStore.getState().endGesture()}
        onChange={(e) => update(placement.uid, { scale: parseFloat(e.target.value) })}
        className={`range flex-1 ${touch ? 'range-lg' : ''}`}
      />
      <output className="num w-14 shrink-0 text-right text-[12.5px] tabular-nums">
        {percent}%
      </output>
      <button
        type="button"
        onClick={() => update(placement.uid, { scale: 1 })}
        disabled={Math.abs(placement.scale - 1) < 0.005}
        title="Вернуть реальный размер"
        className={`btn-base btn-ghost shrink-0 px-2.5 text-[12.5px] ${touch ? 'h-11' : 'h-8'}`}
      >
        Сброс
      </button>
    </div>
  );
}

/** Точная позиция предмета в метрах — для тех, кто знает, куда именно ставит. */
export function PositionControl({ placement }: ControlProps) {
  const update = useStudioStore((s) => s.update);

  const set = (axis: 0 | 2, raw: string) => {
    const v = parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(v)) return;
    const next: [number, number, number] = [...placement.position];
    next[axis] = v;
    update(placement.uid, { position: next }, { snap: false });
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      {([0, 2] as const).map((axis) => (
        <label key={axis} className="flex items-center gap-2">
          <span className="num w-3 shrink-0 text-[11.5px] text-faint">
            {axis === 0 ? 'X' : 'Y'}
          </span>
          <input
            key={`${axis}-${placement.position[axis].toFixed(3)}`}
            defaultValue={placement.position[axis].toFixed(2)}
            inputMode="decimal"
            aria-label={axis === 0 ? 'Положение по горизонтали' : 'Положение по глубине'}
            onBlur={(e) => set(axis, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            className="field num px-2 py-1.5 text-[12.5px]"
          />
        </label>
      ))}
    </div>
  );
}
