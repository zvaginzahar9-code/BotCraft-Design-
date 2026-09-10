'use client';

import Link from 'next/link';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { EASE, LineHeading, Reveal } from '../motion';
import { ArrowRightIcon } from '@/components/ui/icons';

/**
 * Порядок работы: три шага на липкой колонке.
 *
 * Слева закреплён заголовок с указателем текущего шага, справа шаги проезжают
 * мимо. Так путь читается непрерывным, а не тремя одинаковыми карточками в
 * ряд, и на длинном шаге всё время видно, где ты находишься.
 *
 * Иллюстрации не абстрактные: первая рисует ровно ту ломаную, которую строит
 * редактор, вторая поднимает её в объём, третья ставит на пол настоящие
 * превью моделей из каталога — те же файлы, что загрузятся в сцену.
 *
 * На узких экранах липкость отключается: колонки складываются в один поток.
 */

const STEPS = [
  {
    title: 'Нарисуйте комнату',
    text: 'Кликайте по холсту: стены строятся одна за другой с привязкой к сетке и к прямому углу. Длина каждой стены считается сразу; нажмите на подпись, чтобы задать точную.',
  },
  {
    title: 'Получите 3D-модель',
    text: 'План поднимается в объём по вашему чертежу: стены нужной высоты, пол по контуру, проёмы там, где вы поставили двери и окна. Готовых комнат в проекте нет.',
  },
  {
    title: 'Расставьте мебель',
    text: 'Каталог отдаёт модели по одной, когда вы их ставите. Тяните предмет пальцем или мышью: он поедет по полу и сам встанет вплотную к стене. Высота, поворот и размер — рядом, в панели предмета.',
  },
];

/* --- Иллюстрации шагов -------------------------------------------------- */

function StepVisual({ step, thumbs }: { step: number; thumbs: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  // Иллюстрация следит за собственной видимостью, а не за «текущестью» шага:
  // на узких экранах блок шага выше вьюпорта, и порог родителя мог не
  // сработать вовсе — чертёж так и оставался пустой сеткой.
  const seen = useInView(ref, { once: true, amount: 0.4 });
  const reduced = useReducedMotion();
  const show = seen ? 'shown' : 'hidden';

  return (
    <div
      ref={ref}
      className="relative aspect-[16/10] w-full overflow-hidden rounded-md border border-hairline bg-paper blueprint"
    >
      <svg viewBox="0 0 320 200" className="h-full w-full" aria-hidden>
        {step === 0 && (
          <motion.g initial="hidden" animate={show}>
            <motion.path
              d="M62 150 L62 52 L184 52 L184 92 L258 92 L258 150 Z"
              fill="var(--color-accent)"
              fillOpacity="0.05"
              variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
              transition={{ duration: 0.5, delay: reduced ? 0 : 1.1, ease: EASE }}
            />
            <motion.path
              d="M62 150 L62 52 L184 52 L184 92 L258 92 L258 150 Z"
              fill="none"
              stroke="var(--color-ink)"
              strokeWidth="2.5"
              strokeLinejoin="round"
              variants={{ hidden: { pathLength: reduced ? 1 : 0 }, shown: { pathLength: 1 } }}
              transition={{ duration: reduced ? 0 : 1.3, ease: EASE }}
            />
            {[
              [62, 150],
              [62, 52],
              [184, 52],
              [184, 92],
              [258, 92],
              [258, 150],
            ].map(([cx, cy], i) => (
              <motion.rect
                key={`${cx}-${cy}`}
                x={cx - 3.5}
                y={cy - 3.5}
                width="7"
                height="7"
                fill="var(--color-surface)"
                stroke="var(--color-accent)"
                strokeWidth="2"
                variants={{ hidden: { opacity: reduced ? 1 : 0 }, shown: { opacity: 1 } }}
                transition={{ duration: 0.25, delay: reduced ? 0 : 0.2 + i * 0.2, ease: EASE }}
              />
            ))}
            {/* Подпись размера — тот самый элемент, который в редакторе
                нажимают, чтобы ввести точную длину. */}
            <motion.g
              variants={{
                hidden: { opacity: reduced ? 1 : 0, y: reduced ? 0 : 5 },
                shown: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.4, delay: reduced ? 0 : 1.25, ease: EASE }}
            >
              <rect x="98" y="32" width="50" height="20" rx="5" fill="var(--color-ink)" />
              <text
                x="123"
                y="46"
                textAnchor="middle"
                fill="#fff"
                fontSize="11"
                fontWeight="500"
                fontFamily="var(--font-mono)"
              >
                4.20 м
              </text>
            </motion.g>
          </motion.g>
        )}

        {step === 1 && (
          <motion.g initial="hidden" animate={show}>
            {/* Тот же контур, поднятый в изометрию: сперва пол, затем стены. */}
            <motion.path
              d="M58 140 L160 104 L262 140 L160 176 Z"
              fill="#c9a882"
              fillOpacity="0.55"
              stroke="var(--color-ink)"
              strokeOpacity="0.35"
              strokeWidth="1.5"
              variants={{
                hidden: { opacity: reduced ? 1 : 0, y: reduced ? 0 : 8 },
                shown: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.5, ease: EASE }}
            />
            <motion.path
              d="M58 140 L58 82 L160 46 L160 104 Z"
              fill="#ffffff"
              stroke="var(--color-ink)"
              strokeOpacity="0.45"
              strokeWidth="1.5"
              strokeLinejoin="round"
              variants={{
                hidden: { opacity: reduced ? 1 : 0, y: reduced ? 0 : 26 },
                shown: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.6, delay: reduced ? 0 : 0.2, ease: EASE }}
            />
            <motion.path
              d="M160 104 L160 46 L262 82 L262 140 Z"
              fill="#f2f2ef"
              stroke="var(--color-ink)"
              strokeOpacity="0.45"
              strokeWidth="1.5"
              strokeLinejoin="round"
              variants={{
                hidden: { opacity: reduced ? 1 : 0, y: reduced ? 0 : 26 },
                shown: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.6, delay: reduced ? 0 : 0.32, ease: EASE }}
            />
            {/* Размерная выноска высоты стены. */}
            <motion.g
              variants={{ hidden: { opacity: reduced ? 1 : 0 }, shown: { opacity: 1 } }}
              transition={{ duration: 0.4, delay: reduced ? 0 : 0.8, ease: EASE }}
            >
              <path
                d="M274 88 L274 146 M270 88 L278 88 M270 146 L278 146"
                stroke="var(--color-accent)"
                strokeWidth="1.5"
              />
              <text
                x="282"
                y="121"
                fill="var(--color-accent)"
                fontSize="10.5"
                fontFamily="var(--font-mono)"
              >
                2.70
              </text>
            </motion.g>
          </motion.g>
        )}

        {step === 2 && (
          <motion.g initial="hidden" animate={show}>
            <path
              d="M58 140 L160 104 L262 140 L160 176 Z"
              fill="#c9a882"
              fillOpacity="0.55"
              stroke="var(--color-ink)"
              strokeOpacity="0.35"
              strokeWidth="1.5"
            />
            <path d="M58 140 L58 82 L160 46 L160 104 Z" fill="#ffffff" stroke="var(--color-ink)" strokeOpacity="0.28" strokeWidth="1.5" />
            <path d="M160 104 L160 46 L262 82 L262 140 Z" fill="#f2f2ef" stroke="var(--color-ink)" strokeOpacity="0.28" strokeWidth="1.5" />
            {/* Настоящие превью каталога, поставленные на пол. */}
            {thumbs.slice(0, 3).map((src, i) => {
              const spots = [
                { x: 96, y: 96, w: 62 },
                { x: 168, y: 84, w: 52 },
                { x: 140, y: 122, w: 46 },
              ];
              const s = spots[i];
              return (
                <motion.image
                  key={src}
                  href={src}
                  x={s.x}
                  y={s.y}
                  width={s.w}
                  height={s.w}
                  preserveAspectRatio="xMidYMax meet"
                  variants={{
                    hidden: { opacity: reduced ? 1 : 0, y: reduced ? 0 : -14 },
                    shown: { opacity: 1, y: 0 },
                  }}
                  transition={{ duration: 0.45, delay: reduced ? 0 : 0.15 + i * 0.18, ease: EASE }}
                />
              );
            })}
          </motion.g>
        )}
      </svg>
    </div>
  );
}

/* --- Секция ------------------------------------------------------------- */

function Step({
  index,
  thumbs,
  onActive,
}: {
  index: number;
  thumbs: string[];
  onActive: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Середина вьюпорта как линия чтения: шаг считается текущим, пока он её
  // пересекает. Порог по площади здесь не годится — блоки разной высоты, и на
  // узком экране шаг целиком в кадр не помещается.
  const inView = useInView(ref, { margin: '-45% 0px -45% 0px' });
  const step = STEPS[index];

  // Родитель узнаёт о текущем шаге из эффекта, а не из тела рендера: обновлять
  // состояние чужого компонента прямо во время отрисовки React не разрешает.
  useEffect(() => {
    if (inView) onActive(index);
  }, [inView, index, onActive]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.6, ease: EASE }}
      className="border-t border-hairline pt-8 first:border-t-0 first:pt-0 lg:pb-20"
    >
      <div className="flex items-baseline gap-3">
        <span className="num text-[13px] text-accent">{String(index + 1).padStart(2, '0')}</span>
        <h3 className="text-[clamp(1.45rem,2.4vw,1.9rem)] font-semibold leading-[1.12] tracking-[-0.03em]">
          {step.title}
        </h3>
      </div>
      <p className="mt-3 max-w-lg text-[15.5px] leading-[1.65] text-muted">{step.text}</p>

      <div className="mt-7">
        <StepVisual step={index} thumbs={thumbs} />
      </div>
    </motion.div>
  );
}

export default function Process({ thumbs }: { thumbs: string[] }) {
  const [active, setActive] = useState(0);

  return (
    <section id="process" className="bg-surface">
      <div className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <div className="grid gap-x-12 gap-y-14 lg:grid-cols-12">
          {/* Липкая колонка --------------------------------------------- */}
          <div className="lg:sticky lg:top-28 lg:col-span-4 lg:self-start">
            <LineHeading
              className="text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1.04] tracking-[-0.04em]"
              lines={['Из чертежа', 'в комнату', 'за три шага']}
            />

            <Reveal delay={0.1} className="mt-6 max-w-sm text-[16px] leading-[1.65] text-muted">
              Никаких готовых планировок: всё, что вы увидите в 3D, посчитано по
              линиям, которые вы нарисовали минуту назад.
            </Reveal>

            {/* Указатель текущего шага: подсвечивается, пока его блок
                проходит через середину экрана. */}
            <div className="mt-10 hidden lg:block">
              {STEPS.map((s, i) => (
                <div key={s.title} className="flex items-center gap-4 py-2">
                  <div className="relative h-px w-8 bg-line">
                    <motion.span
                      className="absolute inset-y-0 left-0 -top-px block h-[2px] bg-accent"
                      animate={{ width: i <= active ? '100%' : '0%' }}
                      transition={{ duration: 0.4, ease: EASE }}
                    />
                  </div>
                  <span
                    className={`text-[14px] transition-colors duration-400 ${
                      i === active ? 'text-ink' : 'text-faint'
                    }`}
                  >
                    {s.title}
                  </span>
                </div>
              ))}
            </div>

            <Reveal delay={0.16} className="mt-10">
              <Link
                href="/editor?new=1"
                className="btn-base btn-primary group h-11 px-5 text-[14.5px] font-semibold"
              >
                Начать с чертежа
                <ArrowRightIcon
                  size={16}
                  className="transition-transform duration-200 ease-out group-hover:translate-x-0.5"
                />
              </Link>
            </Reveal>
          </div>

          {/* Шаги -------------------------------------------------------- */}
          <div className="flex flex-col gap-14 lg:col-span-7 lg:col-start-6 lg:gap-0">
            {STEPS.map((s, i) => (
              <Step key={s.title} index={i} thumbs={thumbs} onActive={setActive} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
