'use client';

import Link from 'next/link';
import { Logo } from './SiteHeader';
import { Reveal } from './motion';

/**
 * Подвал на тех же чернилах, что и две секции над ним: страница закрывается
 * одним тёмным блоком, а не рассыпается на светлую и тёмную половины.
 *
 * Внизу — крупный вордмарк, срезанный нижним краем: подпись, а не очередная
 * строка ссылок.
 */

const COLUMNS = [
  {
    title: 'Продукт',
    links: [
      { label: 'Как это работает', href: '#process' },
      { label: 'Возможности', href: '#features' },
      { label: 'Каталог', href: '#catalog' },
    ],
  },
  {
    title: 'Работа',
    links: [
      { label: 'Редактор плана', href: '/editor' },
      { label: 'Мои проекты', href: '/projects' },
    ],
  },
];

export default function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-ink text-white">
      <div className="mx-auto max-w-[1240px] px-5 pt-16 sm:px-8 sm:pt-20">
        <div className="grid gap-10 pb-14 sm:grid-cols-2 lg:grid-cols-4">
          <Reveal className="lg:col-span-2" y={14}>
            <Link href="/" aria-label="BotCraft Design, на главную">
              <Logo />
            </Link>
            <p className="mt-5 max-w-xs text-[14px] leading-relaxed text-white/45">
              Конструктор интерьера: план по реальным размерам, точная 3D-комната
              и каталог мебели. Прямо в браузере.
            </p>
          </Reveal>

          {COLUMNS.map((col, i) => (
            <Reveal key={col.title} delay={0.06 + i * 0.05} y={14}>
              <div className="text-[13px] font-medium text-white/40">{col.title}</div>
              {/* Отступ внутри ссылки, а не между строками: на телефоне цель
                  должна быть высотой с палец, а не с высоту шрифта. */}
              <ul className="mt-3 -ml-1">
                {col.links.map((l) => (
                  <li key={l.href}>
                    {l.href.startsWith('#') ? (
                      <a
                        href={l.href}
                        className="inline-flex min-h-[40px] items-center px-1 text-[14px] text-white/70 transition-colors duration-200 hover:text-white"
                      >
                        {l.label}
                      </a>
                    ) : (
                      <Link
                        href={l.href}
                        className="inline-flex min-h-[40px] items-center px-1 text-[14px] text-white/70 transition-colors duration-200 hover:text-white"
                      >
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 py-7">
          <p className="text-[13px] text-white/40">
            © {new Date().getFullYear()} BotCraft Design
          </p>
          <p className="text-[13px] text-white/40">Работает в браузере, без установки</p>
        </div>
      </div>

      {/* Вордмарк во всю ширину, срезанный нижним краем. */}
      <div
        aria-hidden
        className="select-none px-5 pt-2 text-center text-[clamp(2rem,12.4vw,13rem)] font-semibold leading-[0.8] tracking-[-0.055em] whitespace-nowrap text-white/[0.055] sm:px-8"
        style={{ marginBottom: '-0.18em' }}
      >
        BotCraft Design
      </div>
    </footer>
  );
}
