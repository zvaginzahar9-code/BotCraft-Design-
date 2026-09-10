'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Точки перелома интерфейса.
 *
 * Держим их здесь, а не в каждом компоненте: раскладка переключается и в CSS
 * (классы Tailwind), и в JS (какой вариант анимации у панели — снизу или
 * сбоку), и эти два решения обязаны совпадать до пикселя.
 */
export const BREAKPOINTS = {
  /** С этой ширины панели выезжают сбоку, а не снизу. */
  tablet: 768,
  /** С этой ширины панели прикреплены к раскладке и ничего не перекрывают. */
  desktop: 1280,
} as const;

/**
 * Подписка на медиазапрос.
 *
 * Через `useSyncExternalStore`, а не через эффект: эффект узнаёт ширину экрана
 * уже после первой отрисовки, и на десктопе успевает мигнуть мобильная
 * раскладка. Здесь же React берёт клиентское значение сразу при гидратации, до
 * кадра. На сервере разметка собирается по мобильному варианту — он же
 * безопасный запасной путь, если JS почему-то не выполнится.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Экран, на котором панели можно держать открытыми постоянно. */
export function useIsDesktop(): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS.desktop}px)`);
}

/** Планшет и шире: панель выезжает сбоку. */
export function useIsTabletUp(): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS.tablet}px)`);
}

/**
 * Низкий экран: телефон в альбомной ориентации, окно во всю ширину и в треть
 * высоты. Панели, рассчитанные на портрет, съедают здесь половину кадра, и
 * раскладка обязана становиться плоской.
 */
export function useIsShort(): boolean {
  return useMediaQuery('(max-height: 520px)');
}

/**
 * Устройство без настоящего курсора.
 *
 * Определяет не «маленький экран», а именно способ ввода: на планшете 1024px
 * пальцу нужны те же крупные цели, что и на телефоне, а окно браузера шириной
 * 700px на десктопе прекрасно живёт с мышью.
 */
export function useIsTouch(): boolean {
  return useMediaQuery('(hover: none) and (pointer: coarse)');
}
