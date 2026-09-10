'use client';

import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import LogoMark from './LogoMark';
import { EASE } from './motion';
import { ListIcon, XIcon } from '@/components/ui/icons';

const NAV = [
  { label: 'Как это работает', href: '#process' },
  { label: 'Возможности', href: '#features' },
  { label: 'Каталог', href: '#catalog' },
];

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      {/* Знак — это негативное пространство внутри залитого квадрата, поэтому
          плитке нужна непрозрачная подложка: иначе сквозь узел просвечивает
          hero-видео. */}
      <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-[8px] bg-white">
        <LogoMark className="h-full w-full text-ink" />
      </span>
      <span className="text-[15.5px] font-semibold tracking-[-0.02em]">BotCraft Design</span>
    </span>
  );
}

/**
 * Шапка лендинга.
 *
 * Над hero-видео держится прозрачной, чтобы не спорить с кадром, и набирает
 * матовое стекло с волосяной линией, как только страница тронулась. Ссылок
 * ровно три — по одной на каждую содержательную секцию; всё остальное ведёт
 * в сам продукт.
 */
export default function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-500 ${
        scrolled
          ? 'border-b border-hairline bg-white/85 backdrop-blur-xl'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-5 sm:px-8">
        <Link href="/" aria-label="BotCraft Design, на главную">
          <Logo />
        </Link>

        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-7 lg:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-[14px] text-muted transition-colors duration-200 hover:text-ink"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/projects"
            className="btn-base btn-quiet hidden h-9 px-3.5 text-[14px] sm:inline-flex"
          >
            Мои проекты
          </Link>
          <Link
            href="/editor?new=1"
            className="btn-base btn-primary hidden h-9 px-4 text-[14px] font-semibold lg:inline-flex"
          >
            Создать дизайн
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
            aria-expanded={open}
            className="btn-base btn-ghost h-9 w-9 cursor-pointer lg:hidden"
          >
            {open ? <XIcon size={16} /> : <ListIcon size={16} />}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="mobile-nav"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="overflow-hidden border-t border-hairline bg-white lg:hidden"
          >
            <div className="px-5 py-3">
              {NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block py-2.5 text-[15px] text-muted transition-colors hover:text-ink"
                >
                  {item.label}
                </a>
              ))}
              <Link
                href="/editor?new=1"
                onClick={() => setOpen(false)}
                className="btn-base btn-accent mt-3 mb-1 h-11 w-full text-[15px] font-semibold"
              >
                Создать дизайн
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
