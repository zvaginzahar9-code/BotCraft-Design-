'use client';

import { ReactLenis } from 'lenis/react';
import { useEffect, useState } from 'react';
// Обязательная таблица стилей Lenis. Главное — она ослабляет
// `html, body { height: 100% }` из globals.css до `height: auto`, когда Lenis
// активен: без этого инстанс неверно измеряет предел прокрутки.
import 'lenis/dist/lenis.css';

/**
 * Плавная прокрутка Lenis, ограниченная лендингом.
 *
 * `root` привязывает инстанс к скроллеру документа, поэтому `window.scrollY` и
 * `getBoundingClientRect()` продолжают отдавать *сглаженную* позицию — именно
 * это позволяет ScrollVideoHero отображать скролл на время видео, не добавляя
 * собственного сглаживания.
 *
 * Компонент намеренно монтируется на страницу, а не в корневой layout: роуты
 * редактора и студии держат собственные канвасы и скролл-контейнеры, и перехват
 * скроллера документа под ними создаёт больше проблем, чем решает.
 */
export default function SmoothScroll() {
  // Тем, кто попросил у ОС меньше анимации, достаётся нативный скроллер.
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setEnabled(!mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  if (!enabled) return null;

  return (
    <ReactLenis
      root
      options={{
        // lerp вместо duration: сглаживание, не зависящее от частоты кадров,
        // и достаточно быстрое, чтобы hero-видео не отставало от колеса.
        lerp: 0.12,
        wheelMultiplier: 1,
        // Тач-устройства скроллятся нативно: синхронизация заставила бы
        // перемотку видео бороться с инерционным скроллом iOS.
        syncTouch: false,
        // Ссылки навигации (#features, #how, ...) плавно едут, а не прыгают.
        anchors: { offset: -68 },
        allowNestedScroll: true,
      }}
    />
  );
}
