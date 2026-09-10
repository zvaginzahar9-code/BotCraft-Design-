'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { area, perimeter, type RoomGeometry } from '@/lib/geometry';
import { useStudioStore, type CatalogItem, type Placement } from '@/store/studio';
import { useIsDesktop, useIsShort, useIsTouch, useMediaQuery } from '@/lib/responsive';
import CatalogPanel from './CatalogPanel';
import PropertiesPanel from './PropertiesPanel';
import ObjectToolbar from './ObjectToolbar';
import Sheet from '@/components/ui/Sheet';
import type { SceneHandle } from '@/components/scene/StudioScene';
import {
  ArmchairIcon,
  ArrowLeftIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  CheckIcon,
  CubeFocusIcon,
  FloppyDiskIcon,
  MagnetIcon,
  SquaresFourIcon,
  WarningIcon,
  XIcon,
} from '@/components/ui/icons';

// WebGL существует только в браузере, а бандл сцены тяжёлый — держим его вне
// серверного рендера и вне первоначальной загрузки.
const StudioScene = dynamic(() => import('@/components/scene/StudioScene'), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-[#e3e3e0]">
      <div className="text-center">
        <span className="skeleton mx-auto block h-1 w-32 rounded-full" />
        <p className="mt-4 text-[13px] text-muted">Строим комнату…</p>
      </div>
    </div>
  ),
});

const EASE = [0.23, 1, 0.32, 1] as const;
const HINT_KEY = 'botcraft.studio.hint.v2';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * 3D-конструктор.
 *
 * Раскладка не «сжимается», а пересобирается. На десктопе каталог и инспектор
 * прикреплены по сторонам и всегда на виду — там есть место и есть мышь. На
 * планшете и телефоне главное — кадр: панели уходят в выдвижные листы, а над
 * сценой остаётся только то, что относится к выбранному предмету. Это разные
 * интерфейсы из одних и тех же частей, а не один интерфейс в двух размерах.
 */
export default function StudioClient({
  projectId,
  projectName,
  room,
  placements: initialPlacements,
}: {
  projectId: string;
  projectName: string;
  room: RoomGeometry;
  placements: Placement[];
}) {
  const init = useStudioStore((s) => s.init);
  const setCatalog = useStudioStore((s) => s.setCatalog);
  const placements = useStudioStore((s) => s.placements);
  const catalogMap = useStudioStore((s) => s.catalog);
  const add = useStudioStore((s) => s.add);
  const dirty = useStudioStore((s) => s.dirty);
  const markClean = useStudioStore((s) => s.markClean);
  const name = useStudioStore((s) => s.projectName);
  const setProjectName = useStudioStore((s) => s.setProjectName);
  const selected = useStudioStore((s) => s.selected);
  const snapEnabled = useStudioStore((s) => s.snapEnabled);
  const setSnapEnabled = useStudioStore((s) => s.setSnapEnabled);
  const past = useStudioStore((s) => s.past);
  const future = useStudioStore((s) => s.future);

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [sheet, setSheet] = useState<'catalog' | 'props' | null>(null);
  const [hintSeen, setHintSeen] = useState(true);
  const sceneRef = useRef<SceneHandle | null>(null);

  const isDesktop = useIsDesktop();
  const isTouch = useIsTouch();
  // Телефон в альбомной ориентации: высокая панель предмета съела бы половину
  // кадра, поэтому там она сжимается в одну строку, как на десктопе.
  const isShort = useIsShort();
  const isWideEnough = useMediaQuery('(min-width: 620px)');
  const compactBar = isDesktop || (isShort && isWideEnough);

  // Заполняем стор из серверных данных ровно один раз на проект. Пропсы на
  // каждом серверном рендере — новые объекты, поэтому зависимость эффекта от их
  // идентичности перезапускала бы его при любом ре-рендере роута, выбрасывая
  // всё, что пользователь успел расставить.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (seededFor.current === projectId) return;
    seededFor.current = projectId;
    init({ projectId, projectName, room, placements: initialPlacements });
  }, [init, projectId, projectName, room, initialPlacements]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/furniture')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setItems(data.items ?? []);
        setCatalog(data.items ?? []);
      })
      .catch(() => setItems([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [setCatalog]);

  // Доступ к состоянию сцены для сквозных проверок (scripts/verify): проверять
  // расстановку по пикселям невозможно, а «мебель не в стене» — это инвариант,
  // который обязан проверяться числами. В продакшен-сборку не попадает.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as { __studioStore?: unknown }).__studioStore = useStudioStore;
  }, []);

  useEffect(() => {
    try {
      setHintSeen(window.localStorage.getItem(HINT_KEY) === '1');
    } catch {
      setHintSeen(true);
    }
  }, []);

  const dismissHint = useCallback(() => {
    setHintSeen(true);
    try {
      window.localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* приватный режим — подсказка просто покажется ещё раз */
    }
  }, []);

  const stats = useMemo(() => ({ area: area(room), perimeter: perimeter(room) }), [room]);

  const addItem = useCallback(
    (item: CatalogItem) => {
      add(item.id);
      // На телефоне лист каталога закрывает сцену: после выбора надо показать
      // человеку, что предмет действительно появился в комнате.
      if (!isDesktop) setSheet(null);
    },
    [add, isDesktop],
  );

  const save = useCallback(async () => {
    setSaveState('saving');
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: useStudioStore.getState().projectName,
          roomGeometry: room,
          wallHeight: room.wallHeight,
          placements: useStudioStore.getState().placements.map((p) => ({
            furnitureId: p.furnitureId,
            position: p.position,
            rotationY: p.rotationY,
            scale: p.scale,
          })),
        }),
      });
      if (!res.ok) throw new Error('save failed');
      markClean();
      setSaveState('saved');
      window.setTimeout(() => setSaveState('idle'), 2400);
    } catch {
      setSaveState('error');
      window.setTimeout(() => setSaveState('idle'), 3200);
    }
  }, [projectId, room, markClean]);

  /* --- клавиатура -------------------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA'].includes(el.tagName)) return;
      const store = useStudioStore.getState();

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        store.undo();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))
      ) {
        e.preventDefault();
        store.redo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === 'g' || key === 'm' || key === '1') store.setMode('move');
      if (key === 'r' || key === '2') store.setMode('rotate');
      if (key === 'h' || key === '3') store.setMode('height');
      if (key === 's' || key === '4') store.setMode('scale');
      if (key === 'f') sceneRef.current?.frameSelected();
      if (key === 'escape') {
        setSheet(null);
        store.select(null);
      }
      if (key === 'd' && store.selected) store.duplicate(store.selected);
      if ((e.key === 'Delete' || e.key === 'Backspace') && store.selected) {
        e.preventDefault();
        store.remove(store.selected);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  // Уход со страницы с несохранёнными правками — самая дорогая потеря в
  // продукте, поэтому браузер спрашивает подтверждение.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Инспектор в листе имеет смысл только пока что-то выделено.
  useEffect(() => {
    if (!selected && sheet === 'props') setSheet(null);
  }, [selected, sheet]);

  const placedCount = placements.length;
  const selectedItem = (() => {
    const placement = placements.find((p) => p.uid === selected);
    return placement ? catalogMap[placement.furnitureId] : null;
  })();
  const showHint = !hintSeen && !!selected;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-canvas">
      {/* Верхняя панель ---------------------------------------------------- */}
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2 sm:gap-2 sm:px-4">
        <Link
          href={`/editor?project=${projectId}`}
          className="btn-base btn-quiet h-10 w-10 shrink-0"
          aria-label="Назад к чертежу"
          title="Назад к чертежу комнаты"
        >
          <ArrowLeftIcon size={17} />
        </Link>

        <span className="mx-0.5 hidden h-5 w-px bg-line sm:block" />

        <input
          value={name}
          onChange={(e) => setProjectName(e.target.value)}
          aria-label="Название проекта"
          className="min-w-0 flex-1 rounded-[6px] border border-transparent bg-transparent px-2 py-1 text-[14.5px] font-medium outline-none transition-colors hover:border-line focus:border-accent focus:bg-white sm:max-w-[220px] sm:flex-none"
        />

        <dl className="ml-2 hidden items-center gap-4 lg:flex">
          <Stat k="Площадь" v={`${stats.area.toFixed(1)} м²`} />
          <Stat k="Периметр" v={`${stats.perimeter.toFixed(1)} м`} />
          <Stat k="Высота" v={`${room.wallHeight.toFixed(2)} м`} />
          <Stat k="Мебель" v={String(placedCount)} />
        </dl>

        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          <button
            type="button"
            onClick={() => useStudioStore.getState().undo()}
            disabled={!past.length}
            title="Отменить (Ctrl+Z)"
            aria-label="Отменить"
            className="btn-base btn-quiet h-10 w-10"
          >
            <ArrowUUpLeftIcon size={17} />
          </button>
          <button
            type="button"
            onClick={() => useStudioStore.getState().redo()}
            disabled={!future.length}
            title="Вернуть (Ctrl+Shift+Z)"
            aria-label="Вернуть"
            className="btn-base btn-quiet h-10 w-10"
          >
            <ArrowUUpRightIcon size={17} />
          </button>

          <span className="mx-1 hidden h-5 w-px bg-line sm:block" />

          <button
            type="button"
            onClick={save}
            disabled={saveState === 'saving'}
            title="Сохранить (Ctrl+S)"
            aria-label="Сохранить проект"
            className={`btn-base h-10 px-3 text-[14px] font-semibold sm:px-4 ${
              saveState === 'saved'
                ? 'bg-ok text-white'
                : saveState === 'error'
                  ? 'bg-danger text-white'
                  : 'btn-accent'
            }`}
          >
            {saveState === 'saving' && <span className="hidden sm:inline">Сохраняем…</span>}
            {saveState === 'saving' && <FloppyDiskIcon size={17} className="sm:hidden" />}
            {saveState === 'saved' && (
              <>
                <CheckIcon size={16} weight="bold" />
                <span className="hidden sm:inline">Сохранено</span>
              </>
            )}
            {saveState === 'error' && (
              <>
                <WarningIcon size={16} />
                <span className="hidden sm:inline">Не вышло</span>
              </>
            )}
            {saveState === 'idle' && (
              <>
                <FloppyDiskIcon size={17} className="sm:hidden" />
                <span className="hidden sm:inline">Сохранить</span>
                {dirty && <span className="h-1.5 w-1.5 rounded-full bg-white/70" />}
              </>
            )}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Вьюпорт -------------------------------------------------------- */}
        {/* `min-w-0` обязателен: канвас держит свою пиксельную ширину до
            следующего ресайза, и без разрешения сжиматься flex-колонка
            выталкивает правую панель за край экрана. */}
        <div className="relative min-h-0 min-w-0 flex-1">
          <StudioScene
            room={room}
            onReady={(handle) => {
              sceneRef.current = handle;
            }}
          />

          {/* Управление видом. Держится в углу кадра, чтобы не спорить с
              панелью предмета внизу. */}
          <div className="absolute top-3 right-3 z-20 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => sceneRef.current?.resetCamera()}
              className="btn-base panel h-10 w-10 text-muted hover:text-ink"
              aria-label="Сбросить вид камеры"
              title="Сбросить вид камеры"
            >
              <CubeFocusIcon size={18} />
            </button>
            <button
              type="button"
              onClick={() => setSnapEnabled(!snapEnabled)}
              aria-pressed={snapEnabled}
              className={`btn-base panel h-10 w-10 ${
                snapEnabled ? 'text-accent' : 'text-faint hover:text-ink'
              }`}
              aria-label="Прижимать мебель к стенам"
              title={
                snapEnabled ? 'Прижимание к стенам включено' : 'Прижимание к стенам выключено'
              }
            >
              <MagnetIcon size={18} />
            </button>
          </div>

          {/* Подсказка о модели управления. Показывается один раз — в момент,
              когда она впервые может пригодиться, то есть на первом
              выделенном предмете. */}
          <AnimatePresence>
            {showHint && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: EASE }}
                // Правый край оставлен кнопкам вида: подсказка не имеет права
                // закрывать собой органы управления, о которых рассказывает.
                className="absolute top-3 right-16 left-3 z-20 max-w-[420px]"
              >
                <div className="panel flex items-start gap-2.5 p-3">
                  <p className="flex-1 text-[12.5px] leading-relaxed text-ink-soft">
                    Тяните <b className="font-semibold">предмет</b> — двигается предмет. Тяните{' '}
                    <b className="font-semibold">пустое место</b> — поворачивается комната.{' '}
                    {isTouch
                      ? 'Двумя пальцами — приближение.'
                      : 'Колесо приближает, правая кнопка сдвигает вид.'}
                  </p>
                  <button
                    type="button"
                    onClick={dismissHint}
                    aria-label="Понятно"
                    className="btn-base btn-quiet -mt-1 -mr-1 h-8 w-8 shrink-0"
                  >
                    <XIcon size={14} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Пустая комната: единственное, что сейчас нужно сделать. */}
          <AnimatePresence>
            {placedCount === 0 && !loading && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="pointer-events-none absolute inset-x-0 bottom-20 z-10 flex justify-center px-6 xl:bottom-6"
              >
                <p className="flex items-center gap-2 rounded-[8px] bg-ink/88 px-3.5 py-2 text-center text-[12.5px] text-white/90 backdrop-blur-sm">
                  <ArmchairIcon size={16} className="shrink-0" />
                  {isDesktop
                    ? 'Комната готова. Выберите мебель в каталоге справа.'
                    : 'Комната готова. Откройте каталог и поставьте первый предмет.'}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Панель предмета. На десктопе — плавающая строка над сценой, на
              остальных — закреплённая снизу панель с крупными целями. */}
          {compactBar ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex flex-wrap justify-center gap-2 px-4">
              <AnimatePresence>
                {selected && (
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 12 }}
                    transition={{ duration: 0.2, ease: EASE }}
                  >
                    <ObjectToolbar
                      compact
                      touch={isTouch}
                      onOpenInspector={isDesktop ? undefined : () => setSheet('props')}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              {!isDesktop && (
                <button
                  type="button"
                  onClick={() => setSheet('catalog')}
                  className="btn-base btn-accent pointer-events-auto h-12 px-4 text-[14px] font-semibold shadow-[var(--shadow-pop)]"
                >
                  <SquaresFourIcon size={18} />
                  Каталог
                </button>
              )}
            </div>
          ) : (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col items-center md:px-4 md:pb-4">
              {/* Каталог обязан быть доступен и с выделенным предметом: иначе,
                  чтобы поставить второй стул, пришлось бы сперва догадаться
                  снять выделение. */}
              <AnimatePresence>
                {selected && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.16, ease: EASE }}
                    className="flex w-full justify-end px-3 pb-2 md:w-[540px] md:max-w-full md:px-0"
                  >
                    <button
                      type="button"
                      onClick={() => setSheet('catalog')}
                      aria-label="Открыть каталог мебели"
                      title="Каталог мебели"
                      className="btn-base panel pointer-events-auto h-12 w-12 rounded-full text-ink"
                    >
                      <SquaresFourIcon size={20} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence mode="popLayout">
                {selected ? (
                  <motion.div
                    key="object"
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 24 }}
                    transition={{ duration: 0.22, ease: EASE }}
                    className="w-full md:w-[540px] md:max-w-full md:overflow-hidden md:rounded-[14px] md:border md:border-line md:shadow-[var(--shadow-pop)]"
                  >
                    <ObjectToolbar
                      compact={false}
                      touch={isTouch}
                      onOpenInspector={() => setSheet('props')}
                    />
                  </motion.div>
                ) : (
                  <motion.button
                    key="catalog"
                    type="button"
                    onClick={() => setSheet('catalog')}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 16 }}
                    transition={{ duration: 0.22, ease: EASE }}
                    className="btn-base btn-accent pointer-events-auto mb-[max(14px,env(safe-area-inset-bottom))] h-12 px-5 text-[15px] font-semibold shadow-[var(--shadow-pop)]"
                  >
                    <SquaresFourIcon size={18} />
                    Каталог мебели
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Правая колонка десктопа ---------------------------------------- */}
        {isDesktop && (
          <aside className="flex min-h-0 w-[344px] shrink-0 flex-col border-l border-line bg-surface">
            <div className="flex min-h-0 flex-1 flex-col">
              <CatalogPanel items={items} loading={loading} onAdd={addItem} />
            </div>

            {/* Инспектор выезжает снизу той же колонки, когда что-то выделено:
                каталог остаётся на месте, и можно продолжать ставить мебель, не
                теряя выбранный предмет из виду. Высота — доля экрана, а не
                фиксированные пиксели: на ноутбуке 720p инспектор фиксированной
                высоты не оставил бы каталогу и одного ряда карточек. */}
            <div
              className={`min-h-0 shrink-0 overflow-hidden transition-[height] duration-300 ease-out ${
                selected ? 'h-[min(392px,46dvh)] border-t border-line' : 'h-0'
              }`}
            >
              <PropertiesPanel />
            </div>
          </aside>
        )}
      </div>

      {/* Выдвижные панели для планшета и телефона -------------------------- */}
      {!isDesktop && (
        <>
          <Sheet
            open={sheet === 'catalog'}
            onClose={() => setSheet(null)}
            title="Каталог мебели"
            subtitle={`${items.length} моделей`}
          >
            <CatalogPanel items={items} loading={loading} onAdd={addItem} touch={isTouch} />
          </Sheet>

          <Sheet
            open={sheet === 'props' && !!selected}
            onClose={() => setSheet(null)}
            title={selectedItem?.name ?? 'Свойства предмета'}
            subtitle={selectedItem?.category}
          >
            <PropertiesPanel touch={isTouch} embedded />
          </Sheet>
        </>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[12px] text-faint">{k}</dt>
      <dd className="num text-[12.5px] text-ink">{v}</dd>
    </div>
  );
}
