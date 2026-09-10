'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import PlanCanvas from '@/components/plan/PlanCanvas';
import { usePlanStore, type PlanTool } from '@/store/plan';
import { area, bounds, perimeter, wallsOf, isValidRoom } from '@/lib/geometry';
import ToolRail, { type ToolDef } from '@/components/ui/ToolRail';
import Sheet from '@/components/ui/Sheet';
import { useIsShort, useMediaQuery } from '@/lib/responsive';
import { plural } from '@/lib/plural';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  CheckIcon,
  CornersOutIcon,
  CursorClickIcon,
  DoorOpenIcon,
  FrameCornersIcon,
  MinusIcon,
  PlusIcon,
  PolygonIcon,
  SlidersHorizontalIcon,
  TrashIcon,
  WarningIcon,
  XIcon,
} from '@/components/ui/icons';

/**
 * Редактор плана.
 *
 * Раскладка инструмента, а не страницы: чертёж занимает всё свободное место.
 * На широком экране инструменты стоят слева, инспектор справа, и оба всегда на
 * виду. На узком инструменты уезжают вниз — под большой палец, — инспектор
 * становится выдвижным листом, а между ними остаётся одна контекстная строка,
 * которая говорит ровно то, что сейчас важно: сколько получилось метров, что
 * делать дальше или какую стену вы держите.
 */

const TOOLS: ToolDef<PlanTool>[] = [
  { id: 'wall', label: 'Стена', hint: 'Строить стены', shortcut: 'W', icon: PolygonIcon },
  {
    id: 'select',
    label: 'Выбор',
    hint: 'Двигать точки, выделять стены',
    shortcut: 'V',
    icon: CursorClickIcon,
  },
  { id: 'door', label: 'Дверь', hint: 'Поставить дверь на стену', shortcut: 'D', icon: DoorOpenIcon },
  {
    id: 'window',
    label: 'Окно',
    hint: 'Поставить окно на стену',
    shortcut: 'O',
    icon: FrameCornersIcon,
  },
  {
    id: 'delete',
    label: 'Стереть',
    hint: 'Удалить точку, стену или проём',
    shortcut: 'E',
    icon: TrashIcon,
  },
];

const HINTS: Record<PlanTool, string> = {
  wall: 'Кликайте по холсту. Двойной клик или возврат к первой точке замыкает комнату.',
  select: 'Тяните точки, чтобы менять форму. Клик по стене выделяет её.',
  door: 'Кликните по стене, чтобы поставить дверь.',
  window: 'Кликните по стене, чтобы поставить окно на высоте 90 см.',
  delete: 'Кликните по точке, стене или проёму, чтобы удалить.',
};

export default function EditorPage() {
  const router = useRouter();
  const room = usePlanStore((s) => s.room);
  const tool = usePlanStore((s) => s.tool);
  const setTool = usePlanStore((s) => s.setTool);
  const selectedWall = usePlanStore((s) => s.selectedWall);
  const selectWall = usePlanStore((s) => s.selectWall);
  const removeWall = usePlanStore((s) => s.removeWall);
  const projectName = usePlanStore((s) => s.projectName);
  const setProjectName = usePlanStore((s) => s.setProjectName);
  const setWallLen = usePlanStore((s) => s.setWallLen);
  const setWallHeight = usePlanStore((s) => s.setWallHeight);
  const closeRoom = usePlanStore((s) => s.closeRoom);
  const undo = usePlanStore((s) => s.undo);
  const redo = usePlanStore((s) => s.redo);
  const reset = usePlanStore((s) => s.reset);
  const past = usePlanStore((s) => s.past);
  const future = usePlanStore((s) => s.future);

  const [view, setView] = useState({ scale: 90, offsetX: 420, offsetY: 260 });
  const [editingWall, setEditingWall] = useState<number | null>(null);
  // Обработчик клавиатуры вешается один раз, поэтому актуальное значение он
  // читает из ссылки, а не из замыкания первого рендера.
  const editingWallRef = useRef<number | null>(null);
  editingWallRef.current = editingWall;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);

  const wide = useMediaQuery('(min-width: 1024px)');
  // В альбомной ориентации телефона каждый вертикальный пиксель на счету:
  // подписи под иконками уходят, кнопки становятся ниже, чертёж — выше.
  const short = useIsShort();

  /**
   * Что показать при входе.
   *
   * Три разных намерения, и путать их нельзя: `?new=1` — чистый лист (кнопка
   * «Создать дизайн»), `?project=id` — открыть сохранённый проект (возврат из
   * 3D), без параметров — продолжить черновик этой сессии. Параметр из адреса
   * сразу убираем: перезагрузка страницы не должна ещё раз стирать то, что уже
   * нарисовали.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantsNew = params.has('new');
    const projectId = params.get('project');
    const store = usePlanStore.getState();

    const clean = () => window.history.replaceState(null, '', '/editor');

    if (wantsNew) {
      store.startNew();
      clean();
      setRestoring(false);
      return;
    }

    if (projectId) {
      let cancelled = false;
      fetch(`/api/projects/${projectId}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('нет такого проекта'))))
        .then((data) => {
          if (cancelled) return;
          const geometry = data.project?.roomGeometry;
          if (isValidRoom(geometry)) {
            store.loadRoom(
              { ...geometry, wallHeight: data.project.wallHeight ?? geometry.wallHeight },
              data.project.name,
              projectId,
            );
          }
        })
        .catch(() => store.restore())
        .finally(() => {
          if (cancelled) return;
          clean();
          setRestoring(false);
        });
      return () => {
        cancelled = true;
      };
    }

    store.restore();
    setRestoring(false);
  }, []);

  const walls = useMemo(() => wallsOf(room), [room]);
  const roomArea = area(room);
  const roomPerimeter = perimeter(room);
  const doors = room.openings.filter((o) => o.kind === 'door').length;
  const windows = room.openings.filter((o) => o.kind === 'window').length;
  const ready = room.closed && room.points.length >= 3;
  const canClose = !room.closed && room.points.length >= 3;
  const wall = selectedWall !== null ? walls[selectedWall] : undefined;

  /** Вписывает весь план в окно просмотра. */
  const fitView = useCallback(() => {
    const el = viewportRef.current;
    const w = el?.clientWidth ?? 900;
    const h = el?.clientHeight ?? 600;
    if (!room.points.length) {
      setView({ scale: 90, offsetX: w / 2, offsetY: h / 2 });
      return;
    }
    const b = bounds(room.points);
    // Поля вокруг чертежа: сверху и снизу на узком экране висят панели, и план,
    // вписанный впритык, оказывается наполовину под ними.
    const pad = Math.min(160, Math.max(90, Math.min(w, h) * 0.3));
    const scale = Math.min(
      (w - pad) / Math.max(b.maxX - b.minX, 0.5),
      (h - pad) / Math.max(b.maxY - b.minY, 0.5),
      240,
    );
    setView({
      scale,
      offsetX: w / 2 - ((b.minX + b.maxX) / 2) * scale,
      offsetY: h / 2 - ((b.minY + b.maxY) / 2) * scale,
    });
  }, [room.points]);

  // Первая раскладка ставит начало координат в центр холста: иначе на широком
  // экране первая точка оказывается заметно левее середины. Если план уже есть
  // (открыли сохранённый проект), вписываем его целиком.
  const centred = useRef(false);
  useEffect(() => {
    if (centred.current || restoring) return;
    const el = viewportRef.current;
    if (!el || !el.clientWidth) return;
    centred.current = true;
    if (room.points.length >= 2) fitView();
    else setView((v) => ({ ...v, offsetX: el.clientWidth / 2, offsetY: el.clientHeight / 2 }));
  }, [restoring, room.points.length, fitView]);

  const zoom = (factor: number) =>
    setView((v) => {
      const el = viewportRef.current;
      const cx = (el?.clientWidth ?? 900) / 2;
      const cy = (el?.clientHeight ?? 600) / 2;
      const scale = Math.min(320, Math.max(18, v.scale * factor));
      // Зумим относительно центра окна, а не левого верхнего угла.
      return {
        scale,
        offsetX: cx - ((cx - v.offsetX) / v.scale) * scale,
        offsetY: cy - ((cy - v.offsetY) / v.scale) * scale,
      };
    });

  /**
   * Переход в 3D.
   *
   * Если чертёж уже принадлежит проекту, он обновляется. Создавать новый проект
   * на каждый переход нельзя: человек ходит между планом и расстановкой
   * десятки раз, и список проектов превратился бы в свалку копий одной комнаты.
   */
  const goTo3D = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const existingId = usePlanStore.getState().projectId;
    try {
      const res = await fetch(existingId ? `/api/projects/${existingId}` : '/api/projects', {
        method: existingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: projectName,
          roomGeometry: room,
          wallHeight: room.wallHeight,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Не удалось создать проект');
      const id = data.project.id;
      usePlanStore.getState().setProjectId(id);
      router.push(`/studio/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось связаться с сервером');
      setBusy(false);
    }
  };

  /* --- клавиатура -------------------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      const store = usePlanStore.getState();

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

      // Escape отменяет ровно текущее действие и ничего сверх того. Прежде
      // всего он не имеет права разомкнуть уже готовый контур: замкнуть
      // комнату — это результат работы, а не «последний шаг», который логично
      // отменять случайным нажатием.
      if (e.key === 'Escape') {
        if (editingWallRef.current !== null) setEditingWall(null);
        else if (store.selectedWall !== null) store.selectWall(null);
        else if (!store.room.closed && store.room.points.length) store.undoLastPoint();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectedWall !== null) {
        e.preventDefault();
        store.removeWall(store.selectedWall);
        return;
      }
      if (e.key === 'Enter' && store.selectedWall !== null) {
        e.preventDefault();
        setEditingWall(store.selectedWall);
        return;
      }

      const map: Record<string, PlanTool> = {
        w: 'wall',
        v: 'select',
        d: 'door',
        o: 'window',
        e: 'delete',
      };
      const next = map[e.key.toLowerCase()];
      if (next) store.setTool(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Выделение стены на узком экране показывается в контекстной строке, поэтому
  // лист с полным инспектором должен уйти с дороги.
  useEffect(() => {
    if (selectedWall !== null) setSheetOpen(false);
  }, [selectedWall]);

  const roomSummary = (
    <RoomInspector
      room={room}
      walls={walls}
      roomArea={roomArea}
      roomPerimeter={roomPerimeter}
      doors={doors}
      windows={windows}
      ready={ready}
      error={error}
      setWallHeight={setWallHeight}
      onPickWall={(index) => {
        selectWall(index);
        setEditingWall(index);
        setSheetOpen(false);
      }}
      onClear={() => {
        reset();
        setEditingWall(null);
        setSheetOpen(false);
      }}
    />
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-canvas">
      {/* Верхняя панель ---------------------------------------------------- */}
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2 sm:gap-2 sm:px-4">
        <Link
          href="/"
          className="btn-base btn-quiet h-10 w-10 shrink-0"
          aria-label="На главную"
          title="На главную"
        >
          <ArrowLeftIcon size={17} />
        </Link>

        <span className="mx-0.5 hidden h-5 w-px bg-line sm:block" />

        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          className="min-w-0 flex-1 rounded-[6px] border border-transparent bg-transparent px-2 py-1 text-[14.5px] font-medium outline-none transition-colors hover:border-line focus:border-accent focus:bg-white sm:max-w-[240px] sm:flex-none"
          aria-label="Название проекта"
        />

        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          <button
            type="button"
            onClick={undo}
            disabled={!past.length}
            title="Отменить (Ctrl+Z)"
            aria-label="Отменить"
            className="btn-base btn-quiet h-10 w-10"
          >
            <ArrowUUpLeftIcon size={17} />
          </button>
          <button
            type="button"
            onClick={redo}
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
            onClick={() => {
              reset();
              setEditingWall(null);
            }}
            disabled={!room.points.length}
            className="btn-base btn-quiet hidden h-10 px-3 text-[13.5px] lg:inline-flex"
          >
            Очистить
          </button>
          <button
            type="button"
            onClick={goTo3D}
            disabled={!ready || busy}
            title={ready ? 'Построить 3D-комнату' : 'Сначала замкните контур комнаты'}
            className="btn-base btn-accent h-10 px-3.5 text-[14px] font-semibold sm:px-4"
          >
            {busy ? 'Строим…' : 'В 3D'}
            {!busy && <ArrowRightIcon size={15} />}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Инструменты на широком экране ---------------------------------- */}
        {wide && <ToolRail tools={TOOLS} active={tool} onSelect={setTool} />}

        {/* Холст ---------------------------------------------------------- */}
        {/* `min-w-0`: канвас не должен мешать колонке сжиматься при
            уменьшении окна. */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={viewportRef} id="plan-viewport" className="relative min-h-0 flex-1">
            <PlanCanvas
              view={view}
              setView={setView}
              editingWall={editingWall}
              onRequestDimensionEdit={setEditingWall}
              onCommitDimension={(index, meters) => {
                setWallLen(index, meters);
                setEditingWall(null);
              }}
            />

            {/* Подсказка по текущему инструменту. Только там, где есть место и
                курсор: на телефоне её роль играет контекстная строка. */}
            {wide && (
              <div className="pointer-events-none absolute bottom-3 left-3 max-w-[min(58%,540px)]">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={tool}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                    className="rounded-[6px] bg-ink/85 px-2.5 py-1.5 text-[12px] text-white/85 backdrop-blur-sm"
                  >
                    {HINTS[tool]}
                  </motion.p>
                </AnimatePresence>
              </div>
            )}

            {/* Масштаб. */}
            <div className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-[10px] border border-line bg-white/92 p-0.5 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => zoom(0.85)}
                className="btn-base btn-quiet h-9 w-9"
                aria-label="Отдалить"
              >
                <MinusIcon size={15} />
              </button>
              <span className="num w-12 text-center text-[12px] text-muted">
                {Math.round((view.scale / 90) * 100)}%
              </span>
              <button
                type="button"
                onClick={() => zoom(1.18)}
                className="btn-base btn-quiet h-9 w-9"
                aria-label="Приблизить"
              >
                <PlusIcon size={15} />
              </button>
              <button
                type="button"
                onClick={fitView}
                className="btn-base btn-quiet h-9 w-9"
                aria-label="Вписать план в экран"
                title="Вписать в экран"
              >
                <CornersOutIcon size={15} />
              </button>
            </div>
          </div>

          {/* Контекстная строка и инструменты для узкого экрана ------------ */}
          {!wide && (
            <div className="shrink-0 border-t border-line bg-surface">
              <div className="flex min-h-[46px] items-center gap-2 border-b border-hairline px-2.5 py-1.5">
                {wall ? (
                  <>
                    <span className="shrink-0 text-[13px] font-medium">
                      Стена {wall.index + 1}
                    </span>
                    <input
                      key={`len-${wall.index}-${wall.length.toFixed(3)}`}
                      defaultValue={wall.length.toFixed(2)}
                      inputMode="decimal"
                      aria-label="Длина стены в метрах"
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        const v = parseFloat((e.target as HTMLInputElement).value.replace(',', '.'));
                        if (Number.isFinite(v) && v >= 0.1) setWallLen(wall.index, v);
                        (e.target as HTMLInputElement).blur();
                      }}
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value.replace(',', '.'));
                        if (Number.isFinite(v) && v >= 0.1) setWallLen(wall.index, v);
                      }}
                      className="field num h-9 max-w-[92px] px-2.5 text-[13.5px]"
                    />
                    <span className="shrink-0 text-[13px] text-muted">м</span>
                    <button
                      type="button"
                      onClick={() => {
                        removeWall(wall.index);
                        setEditingWall(null);
                      }}
                      aria-label="Удалить стену"
                      className="btn-base ml-auto h-9 w-9 shrink-0 text-muted hover:bg-danger-soft hover:text-danger"
                    >
                      <TrashIcon size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => selectWall(null)}
                      aria-label="Снять выделение"
                      className="btn-base btn-quiet h-9 w-9 shrink-0"
                    >
                      <XIcon size={15} />
                    </button>
                  </>
                ) : canClose ? (
                  <>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
                      Осталось замкнуть контур
                    </span>
                    <button
                      type="button"
                      onClick={closeRoom}
                      className="btn-base btn-accent h-9 shrink-0 px-3.5 text-[13.5px] font-semibold"
                    >
                      <CheckIcon size={15} weight="bold" />
                      Замкнуть
                    </button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
                      {room.points.length === 0
                        ? 'Коснитесь холста — появится первая точка'
                        : ready
                          ? `${roomArea.toFixed(1)} м² · ${walls.length} ${plural(walls.length, 'стена', 'стены', 'стен')} · ${room.wallHeight.toFixed(2)} м`
                          : `${walls.length} ${plural(walls.length, 'стена', 'стены', 'стен')} · продолжайте контур`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSheetOpen(true)}
                      className="btn-base btn-ghost h-9 shrink-0 px-3 text-[13px]"
                    >
                      <SlidersHorizontalIcon size={15} />
                      Комната
                    </button>
                  </>
                )}
              </div>

              <div
                className="grid grid-cols-5 gap-1 px-2 pt-1.5 pb-[max(8px,env(safe-area-inset-bottom))]"
                role="toolbar"
                aria-label="Инструменты"
              >
                {TOOLS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTool(t.id)}
                    aria-pressed={tool === t.id}
                    aria-label={t.label}
                    title={t.hint}
                    className={`btn-base rounded-[10px] font-medium ${
                      short ? 'h-11 gap-2 text-[13px]' : 'h-[52px] flex-col gap-1 text-[11.5px]'
                    } ${
                      tool === t.id
                        ? 'bg-accent text-white'
                        : 'text-muted hover:bg-canvas hover:text-ink'
                    }`}
                  >
                    <t.icon size={20} />
                    {!short && t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Инспектор на широком экране ------------------------------------ */}
        {wide && (
          <aside className="slim-scroll flex w-[304px] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface">
            <AnimatePresence mode="wait" initial={false}>
              {wall ? (
                <motion.div
                  key="wall"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <h2 className="text-[14px] font-semibold">Стена {wall.index + 1}</h2>
                    <button
                      type="button"
                      onClick={() => selectWall(null)}
                      className="btn-base btn-quiet h-8 px-2.5 text-[12.5px]"
                    >
                      Снять
                    </button>
                  </div>

                  <div className="space-y-4 px-4 py-4">
                    <div>
                      <label htmlFor="wall-length" className="panel-title block">
                        Длина
                      </label>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          id="wall-length"
                          key={`len-${wall.index}-${wall.length.toFixed(3)}`}
                          defaultValue={wall.length.toFixed(2)}
                          inputMode="decimal"
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            const v = parseFloat(
                              (e.target as HTMLInputElement).value.replace(',', '.'),
                            );
                            if (Number.isFinite(v) && v >= 0.1) setWallLen(wall.index, v);
                          }}
                          onBlur={(e) => {
                            const v = parseFloat(e.target.value.replace(',', '.'));
                            if (Number.isFinite(v) && v >= 0.1) setWallLen(wall.index, v);
                          }}
                          className="field num px-3 py-2 text-[14px]"
                        />
                        <span className="text-[13px] text-muted">м</span>
                      </div>
                      <p className="mt-2 text-[12px] leading-relaxed text-faint">
                        Соседние стены сохранят свои углы: изменение поглотит ближайшая
                        параллельная стена.
                      </p>
                    </div>

                    <dl className="space-y-2 border-t border-hairline pt-3">
                      <Row
                        k="Угол"
                        v={`${Math.round(((wall.angle * 180) / Math.PI + 360) % 360)}°`}
                      />
                      <Row k="Начало" v={`${wall.start.x.toFixed(2)}, ${wall.start.y.toFixed(2)}`} />
                      <Row k="Конец" v={`${wall.end.x.toFixed(2)}, ${wall.end.y.toFixed(2)}`} />
                    </dl>
                  </div>

                  <div className="mt-auto border-t border-line px-4 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        removeWall(wall.index);
                        setEditingWall(null);
                      }}
                      className="btn-base h-10 w-full border border-danger/25 bg-danger-soft text-[13.5px] font-medium text-danger transition-colors hover:bg-danger hover:text-white"
                    >
                      <TrashIcon size={15} />
                      Удалить стену
                    </button>
                    <p className="mt-2 text-center text-[11.5px] text-faint">
                      Соседние стены сомкнутся. Ctrl+Z вернёт как было.
                    </p>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="room"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  {roomSummary}
                </motion.div>
              )}
            </AnimatePresence>
          </aside>
        )}
      </div>

      {!wide && (
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Комната">
          <div className="slim-scroll min-h-0 flex-1 overflow-y-auto">{roomSummary}</div>
        </Sheet>
      )}
    </div>
  );
}

/**
 * Сводка по комнате: метрика, высота стен, список стен и состояние готовности.
 * Один и тот же блок работает и в боковой панели, и в выдвижном листе.
 */
function RoomInspector({
  room,
  walls,
  roomArea,
  roomPerimeter,
  doors,
  windows,
  ready,
  error,
  setWallHeight,
  onPickWall,
  onClear,
}: {
  room: ReturnType<typeof usePlanStore.getState>['room'];
  walls: ReturnType<typeof wallsOf>;
  roomArea: number;
  roomPerimeter: number;
  doors: number;
  windows: number;
  ready: boolean;
  error: string | null;
  setWallHeight: (h: number) => void;
  onPickWall: (index: number) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="hidden border-b border-line px-4 py-3 lg:block">
        <h2 className="text-[14px] font-semibold">Комната</h2>
      </div>

      <div className="px-4 py-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Metric label="Площадь" value={roomArea ? roomArea.toFixed(1) : '—'} unit="м²" />
          <Metric label="Периметр" value={roomPerimeter ? roomPerimeter.toFixed(1) : '—'} unit="м" />
          <Metric label="Стены" value={String(walls.length)} />
          <Metric label="Проёмы" value={`${doors}+${windows}`} />
        </dl>

        <div className="mt-5 border-t border-hairline pt-4">
          <div className="flex items-baseline justify-between">
            <label htmlFor="wall-height" className="panel-title">
              Высота стен
            </label>
            <span className="num text-[13.5px]">{room.wallHeight.toFixed(2)} м</span>
          </div>
          <input
            id="wall-height"
            type="range"
            min={2}
            max={4}
            step={0.05}
            value={room.wallHeight}
            onChange={(e) => setWallHeight(parseFloat(e.target.value))}
            className="range mt-2 w-full"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 border-t border-hairline px-4 py-4">
        <h3 className="panel-title">Стены</h3>
        {walls.length === 0 ? (
          <p className="mt-3 text-[13px] leading-relaxed text-faint">
            Пока ни одной. Коснитесь холста, чтобы построить первую.
          </p>
        ) : (
          <ul className="mt-2 -mx-1.5">
            {walls.map((w) => (
              <li key={w.index}>
                <button
                  type="button"
                  onClick={() => onPickWall(w.index)}
                  className="flex w-full cursor-pointer items-center justify-between rounded-[6px] px-1.5 py-2 text-left transition-colors hover:bg-canvas"
                >
                  <span className="text-[13px] text-muted">Стена {w.index + 1}</span>
                  <span className="num text-[12.5px]">{w.length.toFixed(2)} м</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Состояние готовности: единственное место, где редактор говорит, чего
          он ждёт от пользователя. */}
      <div className="mt-auto border-t border-line px-4 py-3.5">
        {error && (
          <p className="mb-2.5 flex items-start gap-2 rounded-[6px] bg-danger-soft px-2.5 py-2 text-[12.5px] text-danger">
            <WarningIcon size={15} className="mt-px shrink-0" />
            {error}
          </p>
        )}
        <p className={`text-[12.5px] leading-relaxed ${ready ? 'text-ok' : 'text-muted'}`}>
          {ready
            ? 'Контур замкнут. Можно строить 3D.'
            : room.points.length >= 3
              ? 'Вернитесь к первой точке, чтобы замкнуть контур.'
              : 'Постройте минимум три стены и замкните контур.'}
        </p>
        <button
          type="button"
          onClick={onClear}
          disabled={!room.points.length}
          className="btn-base btn-ghost mt-3 h-9 w-full text-[13px] lg:hidden"
        >
          Очистить чертёж
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  // Пока значения нет, единица измерения не пишется: «— м²» читается как
  // сломанная вёрстка, а не как «ещё не посчитано».
  const empty = value === '—';
  return (
    <div>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={`num mt-0.5 text-[17px] ${empty ? 'text-faint' : ''}`}>
        {value}
        {unit && !empty && <span className="ml-1 text-[12px] text-faint">{unit}</span>}
      </dd>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12.5px] text-muted">{k}</dt>
      <dd className="num text-[12.5px]">{v}</dd>
    </div>
  );
}
