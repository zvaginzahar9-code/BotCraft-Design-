'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE, Reveal } from '../motion';
import { ArrowRightIcon } from '@/components/ui/icons';

/**
 * Финальный призыв.
 *
 * Продолжение тёмного блока: одна фраза, одна кнопка и ничего больше. К этому
 * месту страница уже всё рассказала, здесь остаётся только дать нажать.
 */
export default function FinalCta() {
  const reduced = useReducedMotion();

  return (
    <section className="relative overflow-hidden border-t border-white/10 bg-ink text-white">
      <div className="pointer-events-none absolute inset-0 blueprint-invert [mask-image:radial-gradient(100%_90%_at_50%_100%,black,transparent)]" />

      <div className="relative mx-auto max-w-[1240px] px-5 py-24 text-center sm:px-8 sm:py-32">
        <motion.h2
          className="mx-auto max-w-3xl text-[clamp(2.2rem,5.4vw,4.2rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-balance"
          initial={reduced ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          Ваша комната в 3D через пару минут
        </motion.h2>

        <Reveal
          delay={0.12}
          className="mx-auto mt-6 max-w-md text-[16.5px] leading-relaxed text-white/50"
        >
          Без установки и регистрации. Нарисуйте план, остальное посчитается само.
        </Reveal>

        <Reveal delay={0.2} className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/editor?new=1"
            className="btn-base btn-accent group h-13 px-7 text-[16px] font-semibold"
          >
            Создать дизайн
            <ArrowRightIcon
              size={18}
              className="transition-transform duration-200 ease-out group-hover:translate-x-0.5"
            />
          </Link>
          <Link href="/projects" className="btn-base btn-outline-invert h-13 px-6 text-[15px]">
            Мои проекты
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
