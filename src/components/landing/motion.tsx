'use client';

import {
  motion,
  useInView,
  useReducedMotion,
  animate,
  type Transition,
} from 'framer-motion';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';

/**
 * Анимационные примитивы лендинга.
 *
 * Движение по странице должно читаться одним почерком, поэтому кривая, шаг
 * задержки и амплитуда живут здесь, а не в каждой секции по-своему.
 *
 * Правило амплитуды: элемент выезжает на 16–20 px, не больше. Длинный проезд
 * выглядит эффектно на видео и раздражает на третьем экране — а страницу
 * пролистывают целиком.
 *
 * Каждый примитив уважает `prefers-reduced-motion`: при выключенной анимации
 * элементы просто оказываются на своих местах, без подмены разметки.
 */

/** Кривая входа: быстрый старт, долгий выдох. Та же, что у --ease-out в CSS. */
export const EASE = [0.23, 1, 0.32, 1] as const;

const REVEAL: Transition = { duration: 0.6, ease: EASE };

type RevealProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Задержка внутри своей группы, с. */
  delay?: number;
  /** Стартовое смещение по вертикали, px. */
  y?: number;
  as?: ElementType;
  /** Доля элемента во вьюпорте, после которой считаем его показанным. */
  amount?: number;
  id?: string;
};

/** Одиночное появление блока при въезде во вьюпорт. */
export function Reveal({
  children,
  className,
  style,
  delay = 0,
  y = 18,
  as = 'div',
  amount = 0.3,
  id,
}: RevealProps) {
  const reduced = useReducedMotion();
  const Component = motion[as as 'div'] ?? motion.div;

  return (
    <Component
      id={id}
      className={className}
      style={style}
      initial={reduced ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{ ...REVEAL, delay }}
    >
      {children}
    </Component>
  );
}

/**
 * Контейнер каскада. Дети, обёрнутые в `StaggerItem`, выезжают по очереди —
 * порядок задаёт разметка, а не ручные задержки на каждом элементе.
 */
export function Stagger({
  children,
  className,
  delay = 0,
  step = 0.055,
  as = 'div',
  amount = 0.2,
  id,
  style,
}: RevealProps & { step?: number }) {
  const Component = motion[as as 'div'] ?? motion.div;

  return (
    <Component
      id={id}
      className={className}
      style={style}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, amount }}
      variants={{
        hidden: {},
        shown: { transition: { staggerChildren: step, delayChildren: delay } },
      }}
    >
      {children}
    </Component>
  );
}

export function StaggerItem({
  children,
  className,
  y = 16,
  style,
  as = 'div',
}: Omit<RevealProps, 'delay' | 'amount'>) {
  const reduced = useReducedMotion();
  const Component = motion[as as 'div'] ?? motion.div;

  return (
    <Component
      className={className}
      style={style}
      variants={{
        hidden: reduced ? { opacity: 1 } : { opacity: 0, y },
        shown: { opacity: 1, y: 0, transition: REVEAL },
      }}
    >
      {children}
    </Component>
  );
}

/**
 * Построчный набор крупного заголовка.
 *
 * Строки выходят из-под собственной базовой линии — тот же жест, каким
 * страница проявляет всё остальное, только заметнее, потому что это самый
 * крупный текст в секции. Принимает уже размеченные строки, а не одну
 * подстроку с переносом: разбивку решает вёрстка, а не регулярка.
 */
export function LineHeading({
  lines,
  className,
  as = 'h2',
  step = 0.07,
}: {
  lines: ReactNode[];
  className?: string;
  as?: 'h1' | 'h2' | 'h3';
  step?: number;
}) {
  const reduced = useReducedMotion();
  const Component = motion[as];

  return (
    <Component
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, amount: 0.5 }}
      variants={{ hidden: {}, shown: { transition: { staggerChildren: step } } }}
    >
      {lines.map((line, i) => (
        // Внешний span обрезает выезжающую строку, внутренний её двигает.
        <span key={i} className="block overflow-hidden pb-[0.06em]">
          <motion.span
            className="block"
            variants={{
              hidden: reduced ? { opacity: 1 } : { opacity: 0, y: '100%' },
              shown: { opacity: 1, y: '0%', transition: { duration: 0.7, ease: EASE } },
            }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </Component>
  );
}

/** Счётчик, отсчитывающий значение один раз при появлении во вьюпорте. */
export function Counter({
  to,
  duration = 1.2,
  className,
}: {
  to: number;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? to : 0);

  useEffect(() => {
    if (!inView || reduced) return;
    const controls = animate(0, to, {
      duration,
      ease: EASE,
      onUpdate: (v) => setValue(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, to, duration, reduced]);

  return (
    <span ref={ref} className={className}>
      {value}
    </span>
  );
}
