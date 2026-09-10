'use client';

import { useState, type ComponentType } from 'react';
import type { IconProps } from './icons';

/**
 * Вертикальная линейка инструментов.
 *
 * Один компонент на редактор плана и на 3D-студию: инструмент — это всегда
 * иконка одного размера в одном и том же месте экрана, что бы ты ни делал.
 * Подпись живёт в подсказке рядом, а не под иконкой: постоянные подписи под
 * каждой кнопкой раздувают линейку втрое и превращают её в меню.
 *
 * Подсказка появляется мгновенно, если предыдущая ещё не остыла: пробегая
 * курсором по линейке, читаешь её как список, а не ждёшь задержку на каждой
 * кнопке.
 */

export type ToolDef<Id extends string> = {
  id: Id;
  label: string;
  hint: string;
  shortcut: string;
  icon: ComponentType<IconProps>;
  /** Разделитель над кнопкой: отделяет действия от режимов. */
  separated?: boolean;
  disabled?: boolean;
  /** Действие вместо переключения режима (например, «удалить»). */
  onAction?: () => void;
  danger?: boolean;
};

/**
 * Класcы разворота линейки.
 *
 * Точку, на которой линейка встаёт вертикально, задаёт вызывающая страница:
 * редактор плана переходит к колоночной раскладке на `lg`, студия — только на
 * `xl`, потому что ей нужна ещё и панель каталога. Классы записаны целиком:
 * Tailwind собирает их сканированием исходников и динамических имён не видит.
 */
const RAIL = {
  lg: {
    root: 'lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0 lg:px-1.5 lg:py-2',
    divider: 'lg:block',
    tip: 'lg:flex',
  },
  xl: {
    root: 'xl:flex-col xl:overflow-visible xl:border-r xl:border-b-0 xl:px-1.5 xl:py-2',
    divider: 'xl:block',
    tip: 'xl:flex',
  },
} as const;

export default function ToolRail<Id extends string>({
  tools,
  active,
  onSelect,
  breakpoint = 'lg',
}: {
  tools: ToolDef<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
  /** Ширина, с которой линейка становится вертикальной. */
  breakpoint?: keyof typeof RAIL;
}) {
  const [hovered, setHovered] = useState<Id | null>(null);
  const rail = RAIL[breakpoint];

  return (
    <div
      className={`z-20 flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1.5 ${rail.root}`}
      role="toolbar"
      aria-label="Инструменты"
    >
      {tools.map((t) => {
        const on = !t.onAction && active === t.id;
        const Icon = t.icon;
        return (
          <div key={t.id} className="relative">
            {t.separated && (
              <span className={`mx-2 my-1 hidden h-px bg-line ${rail.divider}`} aria-hidden />
            )}
            <button
              type="button"
              disabled={t.disabled}
              aria-pressed={t.onAction ? undefined : on}
              aria-label={`${t.label} (${t.shortcut})`}
              onClick={() => (t.onAction ? t.onAction() : onSelect(t.id))}
              onMouseEnter={() => setHovered(t.id)}
              onMouseLeave={() => setHovered((h) => (h === t.id ? null : h))}
              onFocus={() => setHovered(t.id)}
              onBlur={() => setHovered((h) => (h === t.id ? null : h))}
              className={`btn-base grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-[8px] transition-colors duration-150 ${
                on
                  ? 'bg-accent text-white'
                  : t.danger
                    ? 'text-muted hover:bg-danger-soft hover:text-danger'
                    : 'text-muted hover:bg-canvas hover:text-ink'
              }`}
            >
              <Icon size={19} />
            </button>

            {/* Подсказка: название и горячая клавиша. Появляется справа от
                линейки, поэтому не перекрывает соседние кнопки. */}
            {hovered === t.id && !t.disabled && (
              <span
                className={`pointer-events-none absolute top-1/2 left-full z-40 ml-2 hidden -translate-y-1/2 items-center gap-2 rounded-[6px] bg-ink px-2.5 py-1.5 text-[12px] whitespace-nowrap text-white shadow-[var(--shadow-pop)] ${rail.tip}`}
              >
                {t.hint}
                <kbd className="num rounded-[3px] bg-white/15 px-1.5 py-px text-[10.5px] text-white/80">
                  {t.shortcut}
                </kbd>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
