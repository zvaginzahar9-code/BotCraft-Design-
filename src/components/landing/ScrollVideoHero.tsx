'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLenis } from 'lenis/react';
import { ArrowRightIcon } from '@/components/ui/icons';

/**
 * Герой, управляемый скроллом.
 *
 * Секция выше вьюпорта; видео закреплено внутри неё, а его `currentTime`
 * отображается на то, насколько далеко пользователь прокрутил эту секцию.
 * Скролл вниз проматывает клип вперёд, вверх — назад. Само видео никогда не
 * запускается через `play()`.
 *
 * Ролик не абстрактная заставка: за десять секунд он показывает ровно то, что
 * делает продукт — пустой лист, план с размерами, поднятые стены, обставленная
 * комната. Поэтому поверх него лежат заголовок с призывом (они уходят, как
 * только начинается сам показ) и полоса стадий, которая называет то, что
 * происходит в кадре прямо сейчас.
 *
 * Плавность обеспечивают три вещи:
 *
 *   1. Позицией скролла владеет Lenis (см. SmoothScroll). Поскольку он ведёт
 *      реальный скроллер документа сглаженным значением, `getBoundingClientRect()`
 *      уже возвращает сглаженное смещение — поэтому компонент отображает скролл
 *      на время 1:1 и *не* выполняет собственного сглаживания. Именно два
 *      независимых сглаживания подряд заставляют большинство таких героев
 *      ощущаться запаздывающими.
 *
 *   2. Клип полностью состоит из ключевых кадров при 60 fps
 *      (scripts/assets/optimize-video.mjs), поэтому перемотка в любую точку —
 *      это декодирование одного кадра.
 *
 *   3. Перемотки гейтятся по декодеру. Присвоение `currentTime`, пока
 *      предыдущая перемотка ещё выполняется, ставит в очередь работу, которую
 *      браузер выбросит, — это обычная причина заиканий при скраббинге. Вместо
 *      этого мы пропускаем запись и заново применяем актуальную цель из
 *      обработчика `seeked`.
 *
 * Ни один из этих эффектов не проходит через состояние React: во время
 * прокрутки компонент не перерисовывается вообще.
 */

const FPS = 60;
const FRAME = 1 / FPS;

/** Границы стадий на таймлайне (доля прогресса). */
const STAGES = [
  { at: 0.14, label: 'План' },
  { at: 0.42, label: 'Стены' },
  { at: 0.68, label: 'Мебель' },
] as const;

/** Прогресс, к которому заголовок полностью уступает место кадру. */
const INTRO_END = 0.16;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export default function ScrollVideoHero() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const stageRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const stageIndexRef = useRef(-1);

  const progressRef = useRef(0);
  const [ready, setReady] = useState(false);

  /** Отдаёт декодеру актуальный прогресс скролла, если тот простаивает. */
  const applySeek = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const duration = video.duration;
    if (!duration || Number.isNaN(duration)) return;
    // Перемотка ещё выполняется: выходим и позволяем `seeked` перезапустить это
    // с самой свежей целью, вместо того чтобы копить запросы, которые декодер
    // всё равно отбросит.
    if (video.seeking || video.readyState < 1) return;

    // Зажимаем чуть-чуть до конца: перемотка ровно в `duration` может оставить
    // элемент в завершённом состоянии, которое отказывается отрисовываться.
    const t = Math.min(progressRef.current * duration, duration - FRAME);
    if (Math.abs(t - video.currentTime) < FRAME * 0.5) return;

    // В клипе из одних ключевых кадров `fastSeek` попадает точно в нужный кадр,
    // минуя путь точной перемотки. Chrome его не реализует, но там обычное
    // присваивание и так стоит одного декодированного кадра.
    if (typeof video.fastSeek === 'function') video.fastSeek(t);
    else video.currentTime = t;
  }, []);

  /** Пересчитывает прогресс из сглаженной Lenis позиции скролла. */
  const update = useCallback(() => {
    const section = sectionRef.current;
    if (!section) return;

    const rect = section.getBoundingClientRect();
    const scrollable = rect.height - window.innerHeight;
    const p = clamp01(scrollable > 0 ? -rect.top / scrollable : 0);
    progressRef.current = p;

    applySeek();

    // Заголовок уходит за первую шестую часть прокрутки героя: дальше слово
    // берёт сам кадр. Пишем в DOM напрямую — прогонять это через состояние
    // React значило бы перерисовывать героя на каждом кадре анимации.
    const intro = introRef.current;
    if (intro) {
      const k = clamp01(p / INTRO_END);
      intro.style.opacity = `${1 - k}`;
      intro.style.transform = `translate3d(0, ${-24 * k}px, 0)`;
      // Ушедший заголовок не должен перехватывать клики по кадру.
      intro.style.pointerEvents = k > 0.85 ? 'none' : '';
    }

    if (barRef.current) barRef.current.style.transform = `scaleX(${p})`;

    // Активная стадия меняется несколько раз за весь ролик, поэтому классы
    // трогаем только на переходе, а не каждый кадр.
    let index = -1;
    for (let i = 0; i < STAGES.length; i++) if (p >= STAGES[i].at) index = i;
    if (index !== stageIndexRef.current) {
      stageIndexRef.current = index;
      stageRefs.current.forEach((el, i) => {
        if (el) el.dataset.on = i <= index ? 'true' : 'false';
      });
    }
  }, [applySeek]);

  // Основной драйвер: Lenis шлёт `scroll` из своего же rAF-цикла, поэтому это
  // выполняется раз в кадр, пока сглаженный скролл ещё движется.
  const lenis = useLenis(update);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoaded = () => {
      setReady(true);
      update();
    };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('seeked', applySeek);
    if (video.readyState >= 1) onLoaded();

    // Если браузер не смог декодировать клип, перестаём закрывать постер
    // плейсхолдером: герой продолжает работать, просто без перемотки по кадрам.
    const giveUp = window.setTimeout(() => setReady(true), 6000);

    window.addEventListener('resize', update);

    // Запасной путь на случай, когда Lenis не смонтирован
    // (prefers-reduced-motion) и вызвать `update` больше некому.
    if (!lenis) window.addEventListener('scroll', update, { passive: true });

    update();

    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('seeked', applySeek);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
      window.clearTimeout(giveUp);
    };
  }, [lenis, update, applySeek]);

  return (
    <div ref={sectionRef} className="relative h-[340vh]">
      <div className="sticky top-0 h-[100dvh] overflow-hidden bg-[#f4f4f2]">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          src="/hero/hero.mp4"
          poster="/hero/hero-poster.jpg"
          muted
          playsInline
          preload="auto"
          // Элемент только перематывают, но не проигрывают; отключение
          // управления и PiP не даёт браузеру предложить плеерный интерфейс
          // поверх героя.
          disablePictureInPicture
          disableRemotePlayback
        />

        {/* Кадр открывается почти белым, поэтому подложка под текстом не
            нужна — хватает лёгкой вуали слева, чтобы буквы не сели на мебель,
            когда комната уже собрана. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-[62%] bg-gradient-to-r from-white/70 via-white/25 to-transparent lg:w-[52%]" />

        <div className="absolute inset-0 mx-auto flex max-w-[1240px] flex-col justify-center px-5 pt-16 sm:px-8">
          <div ref={introRef} className="max-w-[42rem] will-change-transform">
            {/* Разбивка на строки задана вручную: заголовок обязан уложиться в
                две строки на любой ширине, а естественный перенос ставит их
                четыре. */}
            <h1 className="text-[clamp(2rem,4.6vw,3.6rem)] font-semibold leading-[1.06] tracking-[-0.04em]">
              Нарисуйте комнату
              <br />
              и обставьте её в 3D
            </h1>

            <p className="mt-6 max-w-md text-[17px] leading-[1.6] text-ink-soft sm:text-[18px]">
              План по настоящим размерам, точная 3D-модель комнаты и каталог мебели.
              Прямо в браузере.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/editor?new=1"
                className="btn-base btn-accent group h-12 px-6 text-[15px] font-semibold"
              >
                Создать дизайн
                <ArrowRightIcon
                  size={17}
                  className="transition-transform duration-200 ease-out group-hover:translate-x-0.5"
                />
              </Link>
              {/* Кадр под кнопкой почти белый, поэтому обычная светлая рамка
                  на нём исчезает: этой кнопке нужна собственная, потемнее. */}
              <a
                href="#process"
                className="btn-base h-12 border border-ink/18 bg-white/80 px-5 text-[15px] backdrop-blur-sm transition-colors hover:bg-white"
              >
                Как это работает
              </a>
            </div>
          </div>
        </div>

        {/* Полоса стадий: называет то, что прямо сейчас происходит в кадре,
            и заодно показывает, сколько ролика осталось. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0">
          <div className="mx-auto flex max-w-[1240px] items-center gap-5 px-5 pb-6 sm:px-8">
            {STAGES.map((s, i) => (
              <span
                key={s.label}
                ref={(el) => {
                  stageRefs.current[i] = el;
                }}
                data-on="false"
                className="text-[12px] font-medium tracking-[0.08em] uppercase text-faint transition-colors duration-500 data-[on=true]:text-ink"
              >
                {s.label}
              </span>
            ))}
          </div>
          <div className="h-[2px] w-full bg-line/70">
            <span
              ref={barRef}
              className="block h-full w-full origin-left bg-accent"
              style={{ transform: 'scaleX(0)' }}
            />
          </div>
        </div>

        {/* Пока клип не открылся, показываем постер и тихий индикатор внизу.
            Закрывать кадр заглушкой нельзя: за ней окажется и заголовок. */}
        {!ready && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-7">
            <span className="skeleton h-[3px] w-32 rounded-full" />
          </div>
        )}
      </div>
    </div>
  );
}
