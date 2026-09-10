'use client';

import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import { LineHeading, Reveal } from '../motion';

/**
 * 3D-конструктор.
 *
 * Единственная тёмная секция страницы и её визуальный якорь: до этого места
 * лендинг рассказывал про план и каталог, здесь он наконец показывает сам
 * инструмент. Снимок настоящий — его снимает scripts/assets/shoot-app.mjs с
 * работающего приложения, поэтому он не может разойтись с продуктом.
 *
 * Кадр слегка приподнимается на скролле. Это единственный параллакс на
 * странице: он держит внимание на снимке, пока читаются подписи сбоку.
 */

const SPECS = [
  ['Управление', 'тянешь предмет — едет предмет, тянешь пустоту — едет камера'],
  ['Преобразования', 'перемещение, высота над полом, поворот, размер'],
  ['Стены', 'мебель сама встаёт вплотную к стене и в угол'],
  ['Телефон', 'крупные органы управления вместо уменьшенного десктопа'],
];

export default function Constructor({ shot }: { shot: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const y = useTransform(scrollYProgress, [0, 1], reduced ? [0, 0] : [26, -26]);

  return (
    <section ref={ref} className="relative overflow-hidden bg-ink text-white">
      <div className="pointer-events-none absolute inset-0 blueprint-invert [mask-image:radial-gradient(120%_70%_at_50%_0%,black,transparent)]" />

      <div className="relative mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <div className="grid gap-x-12 gap-y-6 lg:grid-cols-12">
          <LineHeading
            className="text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1.04] tracking-[-0.04em] lg:col-span-7"
            lines={['Комната, которую', 'можно обойти', 'со всех сторон']}
          />
          <Reveal delay={0.1} className="lg:col-span-4 lg:col-start-9 lg:self-end">
            <p className="max-w-sm text-[16px] leading-[1.65] text-white/55">
              Вьюпорт занимает почти весь экран, панели прижаты к краям. Всё
              внимание — комнате, а не интерфейсу вокруг неё.
            </p>
          </Reveal>
        </div>

        <motion.div
          style={{ y }}
          className="mt-14 overflow-hidden rounded-lg border border-white/12 bg-white/[0.03] p-1.5 will-change-transform sm:p-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shot}
            alt="Окно 3D-конструктора BotCraft Design: комната с расставленной мебелью, панель каталога и инспектор объекта"
            loading="lazy"
            decoding="async"
            width={1600}
            height={950}
            className="w-full rounded-md"
          />
        </motion.div>

        <dl className="mt-14 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          {SPECS.map(([k, v]) => (
            <Reveal key={k} y={14} className="border-t border-white/12 pt-4">
              <dt className="text-[14px] font-medium text-white">{k}</dt>
              <dd className="mt-1.5 text-[13.5px] leading-relaxed text-white/45">{v}</dd>
            </Reveal>
          ))}
        </dl>
      </div>
    </section>
  );
}
