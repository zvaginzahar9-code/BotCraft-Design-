'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { EASE, LineHeading, Reveal, Stagger, StaggerItem } from '../motion';
import { CubeIcon, DoorOpenIcon, FloppyDiskIcon, RulerIcon } from '@/components/ui/icons';

/**
 * Возможности.
 *
 * Сетка собрана как один расчерченный лист: общая рамка, внутри — волосяные
 * линии. Отдельных карточек нет намеренно, иначе секция превращается в четыре
 * одинаковых прямоугольника с иконкой и подписью, то есть в ничто.
 *
 * Ячейки разного веса и разной фактуры: одна светлая с размерной подписью,
 * одна с настоящими превью каталога, одна чернильная с планом, одна тихая.
 */

function CellHead({
  icon,
  title,
  invert = false,
}: {
  icon: React.ReactNode;
  title: string;
  invert?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={invert ? 'text-white/50' : 'text-accent'}>{icon}</span>
      <h3
        className={`text-[16.5px] font-semibold tracking-[-0.02em] ${
          invert ? 'text-white' : 'text-ink'
        }`}
      >
        {title}
      </h3>
    </div>
  );
}

/** План с дверью и окном — то же обозначение, что рисует редактор. */
function OpeningsPlan() {
  const reduced = useReducedMotion();
  return (
    <svg viewBox="0 0 260 120" className="h-full w-full" aria-hidden>
      <path d="M30 96 L30 28 L230 28 L230 96 Z" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="7" />
      {/* Окно: разрыв в стене двойной линией. */}
      <path d="M92 28 L148 28" stroke="#16171a" strokeWidth="9" />
      <path d="M92 28 L148 28" stroke="#7fb3d5" strokeWidth="3" />
      {/* Дверь: разрыв плюс дуга открывания. */}
      <path d="M168 96 L212 96" stroke="#16171a" strokeWidth="9" />
      <motion.path
        d="M168 96 L212 96"
        stroke="var(--color-accent)"
        strokeWidth="2.5"
        initial={{ pathLength: reduced ? 1 : 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, ease: EASE }}
      />
      <motion.path
        d="M168 96 A 44 44 0 0 0 168 52"
        fill="none"
        stroke="var(--color-accent)"
        strokeOpacity="0.5"
        strokeWidth="1.5"
        initial={{ pathLength: reduced ? 1 : 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7, delay: 0.2, ease: EASE }}
      />
    </svg>
  );
}

export default function Capabilities({ thumbs }: { thumbs: string[] }) {
  return (
    <section id="features" className="border-t border-hairline bg-paper">
      <div className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <div className="grid gap-x-12 gap-y-6 lg:grid-cols-12">
          <LineHeading
            className="text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1.04] tracking-[-0.04em] lg:col-span-6"
            lines={['Инструмент,', 'который считает,', 'а не рисует похоже']}
          />
          <Reveal delay={0.1} className="lg:col-span-5 lg:col-start-8 lg:self-end">
            <p className="max-w-sm text-[16px] leading-[1.65] text-muted">
              Под каждой линией на экране лежит реальная геометрия в метрах. То, что
              поместилось на плане, поместится и в комнате.
            </p>
          </Reveal>
        </div>

        {/* Расчерченный лист: одна рамка, внутри волосяные линии. */}
        <Stagger
          className="mt-14 grid overflow-hidden rounded-lg border border-line bg-surface md:grid-cols-2 lg:grid-cols-6 lg:grid-rows-2"
          step={0.07}
        >
          {/* Реальные метры ------------------------------------------------ */}
          <StaggerItem className="group flex flex-col justify-between border-b border-line p-7 md:col-span-1 lg:col-span-4 lg:border-r">
            <div>
              <CellHead icon={<RulerIcon size={19} />} title="Реальные метры" />
              <p className="mt-3 max-w-sm text-[14.5px] leading-relaxed text-muted">
                Длина стены пересчитывается на ходу. Нажмите на подпись размера,
                введите нужное значение, и план перестроится. Соседние стены
                сохранят свои углы.
              </p>
            </div>

            {/* Размерная строка: тот же элемент, что живёт в редакторе. */}
            <div className="mt-8 flex items-end gap-3">
              <div className="inline-flex items-baseline gap-1.5 rounded-sm border border-line bg-paper px-3 py-2 transition-colors duration-200 group-hover:border-accent-line">
                <span className="num text-[19px] font-medium">4.20</span>
                <span className="text-[12px] text-muted">м</span>
                <span className="ml-1 block h-4 w-px animate-pulse bg-accent" />
              </div>
              <div className="hidden flex-1 items-center gap-2 pb-2 sm:flex">
                <span className="h-px flex-1 bg-line" />
                <span className="num text-[11.5px] text-faint">шаг сетки 10 см</span>
                <span className="h-px flex-1 bg-line" />
              </div>
            </div>
          </StaggerItem>

          {/* Каталог ------------------------------------------------------- */}
          <StaggerItem className="relative flex flex-col justify-between overflow-hidden border-b border-line bg-paper p-7 md:col-span-1 lg:col-span-2 lg:row-span-2 lg:border-b-0">
            <div>
              <CellHead icon={<CubeIcon size={19} />} title="Каталог моделей" />
              <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
                Настоящие GLB-модели. Превью в каталоге отрисованы из них же,
                поэтому в комнату встаёт ровно то, что вы выбрали.
              </p>
            </div>

            {/* Превью идут лесенкой, а не ровной сеткой: колонка читается
                витриной, а не таблицей. */}
            <div className="mt-8 grid grid-cols-2 gap-2">
              {thumbs.slice(0, 6).map((src, i) => (
                <span
                  key={src}
                  className={`grid aspect-square place-items-center rounded-sm border border-hairline bg-surface p-2 ${
                    i % 2 ? 'translate-y-3' : ''
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-contain mix-blend-multiply"
                  />
                </span>
              ))}
            </div>
          </StaggerItem>

          {/* Двери и окна -------------------------------------------------- */}
          <StaggerItem className="relative flex flex-col justify-between overflow-hidden border-b border-line bg-ink p-7 md:col-span-1 lg:col-span-2 lg:border-b-0 lg:border-r">
            <div>
              <CellHead icon={<DoorOpenIcon size={19} />} title="Двери и окна" invert />
              <p className="mt-3 text-[14.5px] leading-relaxed text-white/55">
                Проёмы ставятся прямо на стену и по-настоящему вырезаются в 3D,
                вместе с высотой подоконника.
              </p>
            </div>
            {/* План занимает всю оставшуюся высоту ячейки: она вытянута
                соседней колонкой каталога, и прижатая к низу картинка оставила
                бы посередине пустоту. */}
            <div className="mt-6 flex min-h-[104px] flex-1 items-center">
              <OpeningsPlan />
            </div>
          </StaggerItem>

          {/* Проект -------------------------------------------------------- */}
          <StaggerItem className="flex flex-col justify-between p-7 md:col-span-1 lg:col-span-2">
            <div>
              <CellHead icon={<FloppyDiskIcon size={19} />} title="Проект под рукой" />
              <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
                Комната, размеры и расстановка сохраняются целиком. Вернуться и
                продолжить можно в любой момент.
              </p>
            </div>
            <div className="mt-6">
              {/* Тот же контур, что рисуется на карточке проекта в списке:
                  секция показывает ровно то, что человек потом увидит. */}
              <div className="rounded-sm border border-hairline bg-paper p-3">
                <svg viewBox="0 0 200 92" className="h-full w-full" aria-hidden>
                  <path
                    d="M24 76 L24 16 L120 16 L120 44 L176 44 L176 76 Z"
                    fill="rgba(22,23,26,0.05)"
                    stroke="var(--color-ink)"
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              <dl className="mt-4 space-y-2 border-t border-hairline pt-3.5">
                {[
                  ['Геометрия плана', 'точки, проёмы'],
                  ['Высота стен', '2.70 м'],
                  ['Расстановка', 'позиция, поворот, масштаб'],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3">
                    <dt className="text-[13px] text-muted">{k}</dt>
                    <dd className="num text-right text-[12px] text-faint">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </StaggerItem>
        </Stagger>
      </div>
    </section>
  );
}
