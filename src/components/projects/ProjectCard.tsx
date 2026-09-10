'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { area, bounds, type Point } from '@/lib/geometry';
import type { ProjectSummary } from '@/lib/projects';
import { TrashIcon } from '@/components/ui/icons';
import { plural } from '@/lib/plural';

/**
 * Карточка сохранённого проекта.
 *
 * Превью — не иконка и не заглушка, а контур самой комнаты, отрисованный из
 * той же геометрии, из которой строятся стены в 3D. Список проектов поэтому
 * узнаётся с одного взгляда: планировки отличаются формой, а не только
 * названием.
 */
export default function ProjectCard({ project }: { project: ProjectSummary }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const roomArea = area({
    points: project.points,
    closed: project.closed,
    wallHeight: project.wallHeight,
    wallThickness: 0.15,
    openings: [],
  });

  const remove = async () => {
    setBusy(true);
    try {
      await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="group relative overflow-hidden rounded-md border border-line bg-surface transition-colors duration-200 hover:border-ink/20">
      <Link href={`/studio/${project.id}`} className="block">
        <div className="relative aspect-[16/10] border-b border-hairline bg-paper blueprint">
          <PlanPreview points={project.points} closed={project.closed} />
        </div>

        <div className="px-4 py-3.5">
          <div className="truncate text-[14.5px] font-medium">{project.name}</div>
          <div className="mt-1.5 flex items-center gap-3 text-[12px] text-muted">
            <span className="num">{roomArea ? `${roomArea.toFixed(1)} м²` : 'без контура'}</span>
            <span className="h-3 w-px bg-line" />
            <span>
              <span className="num">{project.items}</span>{' '}
              {plural(project.items, 'предмет', 'предмета', 'предметов')}
            </span>
          </div>
          <div className="mt-1 text-[11.5px] text-faint">{formatWhen(project.updatedAt)}</div>
        </div>
      </Link>

      {/* Удаление живёт поверх карточки и появляется на наведении: в спокойном
          состоянии список читается как галерея, а не как таблица с кнопками. */}
      <div className="absolute top-2.5 right-2.5">
        {confirming ? (
          <div className="flex items-center gap-1 rounded-[8px] border border-line bg-white/95 p-1 shadow-[var(--shadow-panel)] backdrop-blur-sm">
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="btn-base h-7 rounded-[6px] bg-danger px-2.5 text-[12px] font-medium text-white"
            >
              {busy ? 'Удаляем…' : 'Удалить'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="btn-base btn-quiet h-7 rounded-[6px] px-2.5 text-[12px]"
            >
              Отмена
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Удалить проект «${project.name}»`}
            className="btn-base h-8 w-8 rounded-[6px] border border-line bg-white/90 text-muted opacity-0 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
          >
            <TrashIcon size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Контур комнаты, вписанный в превью карточки. */
function PlanPreview({ points, closed }: { points: Point[]; closed: boolean }) {
  if (points.length < 2) {
    return (
      <div className="grid h-full place-items-center text-[12px] text-faint">Пустой план</div>
    );
  }

  const b = bounds(points);
  const w = Math.max(b.maxX - b.minX, 0.001);
  const h = Math.max(b.maxY - b.minY, 0.001);
  const pad = 0.14 * Math.max(w, h);
  const vb = `${b.minX - pad} ${b.minY - pad} ${w + pad * 2} ${h + pad * 2}`;
  const d =
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ') + (closed ? ' Z' : '');
  // Штрих задаётся в единицах плана, поэтому масштабируем его от размера
  // комнаты: иначе на большой квартире контур становится волоском.
  const stroke = Math.max(w, h) * 0.022;

  return (
    <svg viewBox={vb} className="h-full w-full p-4" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <path
        d={d}
        fill={closed ? 'rgba(22,23,26,0.05)' : 'none'}
        stroke="#16171a"
        strokeWidth={stroke}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * API отдаёт время как «YYYY-MM-DD HH:MM:SS» по UTC, без указания зоны,
 * поэтому дописываем её явно — иначе браузер прочитал бы отметку как локальную
 * и проект, сохранённый минуту назад, оказывался бы «в будущем».
 */
function formatWhen(raw: string): string {
  const date = new Date(raw.replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return raw;

  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)} ч назад`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
