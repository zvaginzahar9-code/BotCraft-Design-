'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useIsTabletUp } from '@/lib/responsive';
import { XIcon } from '@/components/ui/icons';

/**
 * Выдвижная панель поверх сцены.
 *
 * На телефоне приезжает снизу — там, где до неё дотягивается большой палец, — а
 * на планшете сбоку, потому что в альбомной ориентации нижняя панель съедает
 * почти весь и без того низкий кадр. На десктопе её не существует вовсе:
 * каталог и инспектор там прикреплены к раскладке и ничего не перекрывают.
 *
 * Сцена под панелью продолжает жить: подложка приглушает её, но вьюпорт не
 * размонтируется, поэтому возврат к комнате ничего не перезагружает.
 */
export default function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const sideways = useIsTabletUp();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            key="scrim"
            type="button"
            aria-label="Закрыть панель"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 cursor-default bg-ink/25"
          />
          <motion.section
            key="sheet"
            role="dialog"
            aria-modal="false"
            aria-label={title}
            initial={sideways ? { x: '100%' } : { y: '100%' }}
            animate={sideways ? { x: 0 } : { y: 0 }}
            exit={sideways ? { x: '100%' } : { y: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 42, mass: 0.9 }}
            drag={sideways ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              // Смахивание вниз закрывает: на телефоне это быстрее, чем целиться
              // в крестик, и это первое, что человек пробует.
              if (info.offset.y > 90 || info.velocity.y > 650) onClose();
            }}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[74dvh] flex-col overflow-hidden rounded-t-[16px] border border-line bg-surface shadow-[var(--shadow-pop)] md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[380px] md:rounded-none md:border-y-0 md:border-r-0"
          >
            <header className="relative flex shrink-0 items-center gap-2 border-b border-line px-3 pt-4 pb-2.5 md:pt-2.5">
              {/* Ручка захвата: без неё смахивание — секрет, о котором никто не
                  догадается. */}
              <span
                aria-hidden
                className="absolute top-1.5 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-line md:hidden"
              />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[14px] font-semibold">{title}</h2>
                {subtitle && <p className="truncate text-[11.5px] text-faint">{subtitle}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть"
                className="btn-base btn-quiet h-9 w-9 shrink-0"
              >
                <XIcon size={16} />
              </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
