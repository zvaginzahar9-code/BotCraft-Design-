'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  centroid,
  closestOnSegment,
  dist,
  snap,
  wallsOf,
  type Point,
  type RoomGeometry,
  type Wall,
} from '@/lib/geometry';
import { usePlanStore } from '@/store/plan';
import { useIsTouch } from '@/lib/responsive';

/**
 * Поверхность для рисования плана этажа.
 *
 * Стены, сетка и направляющие рисуются на 2D-canvas, а интерактивные части —
 * подписи размеров и ручки вершин — лежат поверх обычным DOM. Так они остаются
 * чёткими, кликабельными и редактируемыми, и не нужно ловить попадания по
 * тексту внутри canvas.
 *
 * Чертёж намеренно скупой на цвет: стены графитовые, сетка почти незаметна, и
 * акцент появляется ровно там, где сейчас что-то происходит — на строящейся
 * стене, на наведённой подписи, на выделенном отрезке. Если подсветить всё,
 * не подсвечено ничего.
 *
 * ЖЕСТЫ. Одна раскладка на мышь и на палец, потому что различаются не
 * устройства, а намерения:
 *
 *   • два пальца — всегда вид: масштаб и сдвиг холста;
 *   • один палец инструментом рисования — предпросмотр, который встаёт точкой
 *     на отпускании (палец закрывает собой то, куда целится, поэтому решение
 *     принимается не в момент касания, а в момент, когда человек уже увидел
 *     линию и её длину);
 *   • один палец инструментом выбора — тянет вершину, а на пустом месте
 *     двигает холст;
 *   • средняя и правая кнопки мыши двигают холст всегда.
 */

/**
 * Имя моношрифта для canvas.
 *
 * next/font выдаёт хешированное семейство и кладёт его в CSS-переменную, а
 * `ctx.font` переменные не разворачивает — приходится читать значение из
 * вычисленных стилей. Один раз за жизнь модуля: шрифт не меняется.
 */
let monoFamily: string | null = null;
function monoFont(sizePx: number, weight = 500) {
  if (monoFamily === null) {
    monoFamily =
      getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() ||
      'monospace';
  }
  return `${weight} ${sizePx}px ${monoFamily}`;
}

const GRID_STEP = 0.1; // метры, к которым притягивается курсор
const AXIS_LOCK_DEG = 6;
/** Смещение в пикселях, после которого нажатие перестаёт быть «кликом». */
const TAP_SLOP = 7;
const MIN_SCALE = 18;
const MAX_SCALE = 320;

type View = { scale: number; offsetX: number; offsetY: number };

type Props = {
  view: View;
  setView: (v: View | ((v: View) => View)) => void;
  /** Стена, у которой сейчас правят длину, или null. */
  editingWall: number | null;
  onRequestDimensionEdit: (wallIndex: number | null) => void;
  onCommitDimension: (wallIndex: number, meters: number) => void;
};

type Gesture =
  | { kind: 'tap'; x: number; y: number; moved: boolean }
  | { kind: 'pan'; x: number; y: number; ox: number; oy: number }
  | { kind: 'vertex'; index: number }
  | { kind: 'pinch'; distance: number; scale: number; anchor: Point }
  | null;

export default function PlanCanvas({
  view,
  setView,
  editingWall,
  onRequestDimensionEdit,
  onCommitDimension,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const [hoverClose, setHoverClose] = useState(false);
  const [hoverWall, setHoverWall] = useState<number | null>(null);
  const [dragVertex, setDragVertex] = useState<number | null>(null);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture>(null);
  // Вид читается из ссылки: жест живёт между кадрами, и замыкание с устаревшим
  // масштабом превратило бы щипок в рывок.
  const viewRef = useRef(view);
  viewRef.current = view;

  const touch = useIsTouch();
  const hitRadius = touch ? 20 : 14;
  const wallHit = touch ? 18 : 10;

  const room = usePlanStore((s) => s.room);
  const tool = usePlanStore((s) => s.tool);
  const selectedWall = usePlanStore((s) => s.selectedWall);
  const selectWall = usePlanStore((s) => s.selectWall);
  const addPoint = usePlanStore((s) => s.addPoint);
  const closeRoom = usePlanStore((s) => s.closeRoom);
  const movePoint = usePlanStore((s) => s.movePoint);
  const removePoint = usePlanStore((s) => s.removePoint);
  const addOpening = usePlanStore((s) => s.addOpening);
  const removeOpening = usePlanStore((s) => s.removeOpening);

  const walls = useMemo(() => wallsOf(room), [room]);
  const centre = useMemo(() => centroid(room.points), [room.points]);

  /* --- преобразования координат ---------------------------------------- */

  const toScreen = useCallback(
    (p: Point) => ({
      x: p.x * view.scale + view.offsetX,
      y: p.y * view.scale + view.offsetY,
    }),
    [view],
  );

  const toPlan = useCallback(
    (x: number, y: number): Point => ({
      x: (x - view.offsetX) / view.scale,
      y: (y - view.offsetY) / view.scale,
    }),
    [view],
  );

  /* --- размер холста ---------------------------------------------------- */

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* --- привязка курсора -------------------------------------------------- */

  const snapPoint = useCallback(
    (raw: Point): { point: Point; closing: boolean; axis: boolean } => {
      const points = room.points;
      const last = points[points.length - 1];
      let p = { x: snap(raw.x, GRID_STEP), y: snap(raw.y, GRID_STEP) };
      let axis = false;

      // Привязка к осям: стены держатся ортогональными, пока пользователь явно
      // не уведёт курсор от прямого угла.
      if (last && tool === 'wall' && !room.closed) {
        const dx = p.x - last.x;
        const dy = p.y - last.y;
        const angle = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
        if (angle < AXIS_LOCK_DEG || angle > 180 - AXIS_LOCK_DEG) {
          p = { x: p.x, y: last.y };
          axis = true;
        } else if (Math.abs(angle - 90) < AXIS_LOCK_DEG) {
          p = { x: last.x, y: p.y };
          axis = true;
        }
      }

      // Притягиваемся к первой вершине, чтобы замкнуть контур.
      const first = points[0];
      if (first && points.length >= 3 && !room.closed) {
        const px = dist(toScreen(p) as Point, toScreen(first) as Point);
        if (px < hitRadius * 2) return { point: { ...first }, closing: true, axis: false };
      }

      // Притягиваемся к любой существующей вершине, чтобы контур оставался
      // герметичным.
      for (const v of points) {
        if (dist(toScreen(p) as Point, toScreen(v) as Point) < hitRadius) {
          return { point: { ...v }, closing: false, axis: false };
        }
      }
      return { point: p, closing: false, axis };
    },
    [room.points, room.closed, tool, toScreen, hitRadius],
  );

  /* --- отрисовка --------------------------------------------------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w || !size.h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    drawGrid(ctx, size, view);

    const pts = room.points;
    const wallPx = Math.max(5, room.wallThickness * view.scale);

    // Пол: залитая внутренность после замыкания контура.
    if (room.closed && pts.length >= 3) {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const s = toScreen(p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(22, 23, 26, 0.035)';
      ctx.fill();
    }

    // Тела стен: графитовая полоса с белым сердечником — стандартная
    // условность плана, читается и на сетке, и на заливке пола.
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    for (const w of walls) {
      const a = toScreen(w.start);
      const b = toScreen(w.end);
      const active = selectedWall === w.index || editingWall === w.index;
      const hovered = hoverWall === w.index;

      if (active) {
        // Мягкая подложка под выделенной стеной: сама стена цвет не меняет,
        // иначе чертёж начинает мигать при каждом выборе.
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = 'rgba(214, 66, 31, 0.18)';
        ctx.lineWidth = wallPx + 12;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = active ? '#d6421f' : hovered ? '#3c3e45' : '#16171a';
      ctx.lineWidth = wallPx;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, wallPx - 3.5);
      ctx.stroke();
    }

    // Проёмы: разрыв в стене с условным обозначением.
    for (const op of room.openings) {
      const w = walls[op.wall];
      if (!w) continue;
      const cx = w.start.x + (w.end.x - w.start.x) * op.t;
      const cy = w.start.y + (w.end.y - w.start.y) * op.t;
      const ux = (w.end.x - w.start.x) / (w.length || 1);
      const uy = (w.end.y - w.start.y) / (w.length || 1);
      const half = op.width / 2;
      const a = toScreen({ x: cx - ux * half, y: cy - uy * half });
      const b = toScreen({ x: cx + ux * half, y: cy + uy * half });

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = wallPx + 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = op.kind === 'door' ? '#16171a' : '#5b8fb0';
      ctx.lineWidth = op.kind === 'door' ? 2.5 : 4;
      ctx.stroke();

      if (op.kind === 'door') {
        // Дуга открывания в четверть окружности — обычная условность планов.
        const r = op.width * view.scale;
        ctx.beginPath();
        ctx.arc(a.x, a.y, r, Math.atan2(uy, ux), Math.atan2(uy, ux) + Math.PI / 2);
        ctx.strokeStyle = 'rgba(22, 23, 26, 0.3)';
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }
    }

    // «Резиновый» предпросмотр строящейся стены.
    const last = pts[pts.length - 1];
    if (tool === 'wall' && !room.closed && last && cursor) {
      const a = toScreen(last);
      const b = toScreen(cursor);

      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = hoverClose ? '#17795e' : '#d6421f';
      ctx.lineWidth = 1.75;
      ctx.stroke();
      ctx.setLineDash([]);

      const len = dist(last, cursor);
      if (len > 0.05) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const deg = Math.round(
          ((Math.atan2(cursor.y - last.y, cursor.x - last.x) * 180) / Math.PI + 360) % 360,
        );
        const label = `${len.toFixed(2)} м · ${deg}°`;
        ctx.font = monoFont(touch ? 13 : 11.5);
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = hoverClose ? '#17795e' : '#16171a';
        roundRect(ctx, mid.x - tw / 2 - 7, mid.y - 30, tw + 14, 22, 5);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, mid.x, mid.y - 19);
      }
    }

    // Точка, к которой сейчас притянут палец: на касании курсора нет, и без
    // этой метки непонятно, куда именно встанет вершина.
    if (cursor && (tool === 'wall' || tool === 'door' || tool === 'window')) {
      const s = toScreen(cursor);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = hoverClose ? '#17795e' : '#d6421f';
      ctx.fill();
    }

    // Мишень замыкания на первой вершине.
    if (!room.closed && pts.length >= 3) {
      const s = toScreen(pts[0]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, hoverClose ? 12 : 8, 0, Math.PI * 2);
      ctx.strokeStyle = hoverClose ? '#17795e' : '#9a9ca4';
      ctx.lineWidth = 1.75;
      ctx.stroke();
    }
  }, [
    room,
    walls,
    size,
    view,
    cursor,
    hoverClose,
    hoverWall,
    tool,
    editingWall,
    selectedWall,
    toScreen,
    touch,
  ]);

  /* --- взаимодействие ---------------------------------------------------- */

  const localPoint = (clientX: number, clientY: number): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  /** Ближайшая стена под указателем в экранных пикселях. */
  const wallAt = useCallback(
    (local: Point): number | null => {
      let best: { index: number; d: number } | null = null;
      for (const w of walls) {
        const { point } = closestOnSegment(
          local,
          toScreen(w.start) as Point,
          toScreen(w.end) as Point,
        );
        const d = dist(local, point);
        if (!best || d < best.d) best = { index: w.index, d };
      }
      return best && best.d < wallHit ? best.index : null;
    },
    [walls, toScreen, wallHit],
  );

  const vertexAt = useCallback(
    (local: Point): number =>
      room.points.findIndex((p) => dist(toScreen(p) as Point, local as Point) < hitRadius),
    [room.points, toScreen, hitRadius],
  );

  /** Действие инструмента в точке — то, ради чего человек коснулся холста. */
  const applyTool = useCallback(
    (local: Point) => {
      const raw = toPlan(local.x, local.y);

      if (tool === 'select' || tool === 'delete') {
        const hit = vertexAt(local);
        if (hit >= 0) {
          if (tool === 'delete') removePoint(hit);
          return;
        }
        if (tool === 'delete') {
          const op = hitOpening(room, walls, raw);
          if (op) {
            removeOpening(op.id);
            return;
          }
          const wall = wallAt(local);
          if (wall !== null) usePlanStore.getState().removeWall(wall);
          return;
        }
        // Клик по стене выделяет её; клик по пустому месту снимает выделение.
        const wall = wallAt(local);
        selectWall(wall);
        if (wall === null) onRequestDimensionEdit(null);
        return;
      }

      if (tool === 'door' || tool === 'window') {
        const target = nearestWall(walls, raw);
        if (!target) return;
        const isDoor = tool === 'door';
        addOpening({
          kind: isDoor ? 'door' : 'window',
          wall: target.index,
          t: target.t,
          width: isDoor ? 0.9 : 1.2,
          height: isDoor ? 2.1 : 1.4,
          sill: isDoor ? 0 : 0.9,
        });
        return;
      }

      if (room.closed) return;
      const { point, closing } = snapPoint(raw);
      if (closing) {
        closeRoom();
        setCursor(null);
        return;
      }
      addPoint(point);
    },
    [
      tool,
      room,
      walls,
      toPlan,
      vertexAt,
      wallAt,
      snapPoint,
      selectWall,
      onRequestDimensionEdit,
      removePoint,
      removeOpening,
      addOpening,
      addPoint,
      closeRoom,
    ],
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    canvas?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Второй палец — это всегда вид. Начатое одним пальцем действие
    // отменяется: человек передумал ставить точку и хочет подвинуть чертёж.
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = localPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      const v = viewRef.current;
      gesture.current = {
        kind: 'pinch',
        distance: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1),
        scale: v.scale,
        // Запоминаем точку плана между пальцами: весь жест она остаётся под
        // ними, поэтому масштаб и сдвиг получаются одним движением.
        anchor: { x: (mid.x - v.offsetX) / v.scale, y: (mid.y - v.offsetY) / v.scale },
      };
      setDragVertex(null);
      setCursor(null);
      return;
    }
    if (pointers.current.size > 2) return;

    const local = localPoint(e.clientX, e.clientY);

    // Средняя и правая кнопки мыши двигают чертёж без всяких условий.
    if (e.button === 1 || e.button === 2) {
      gesture.current = {
        kind: 'pan',
        x: e.clientX,
        y: e.clientY,
        ox: view.offsetX,
        oy: view.offsetY,
      };
      return;
    }
    if (e.button !== 0) return;

    if (tool === 'select') {
      const hit = vertexAt(local);
      if (hit >= 0) {
        selectWall(null);
        setDragVertex(hit);
        gesture.current = { kind: 'vertex', index: hit };
        return;
      }
    }

    gesture.current = { kind: 'tap', x: e.clientX, y: e.clientY, moved: false };

    // Рисующие инструменты сразу показывают, куда встанет точка.
    if (tool === 'wall' || tool === 'door' || tool === 'window') {
      const { point, closing } = snapPoint(toPlan(local.x, local.y));
      setCursor(point);
      setHoverClose(closing);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const local = localPoint(e.clientX, e.clientY);
    const g = gesture.current;

    if (g?.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const distance = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
      const mid = localPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (g.scale * distance) / g.distance));
      setView({
        scale,
        offsetX: mid.x - g.anchor.x * scale,
        offsetY: mid.y - g.anchor.y * scale,
      });
      return;
    }

    if (g?.kind === 'pan') {
      setView({
        scale: view.scale,
        offsetX: g.ox + (e.clientX - g.x),
        offsetY: g.oy + (e.clientY - g.y),
      });
      return;
    }

    if (g?.kind === 'vertex') {
      const raw = toPlan(local.x, local.y);
      movePoint(g.index, { x: snap(raw.x, GRID_STEP), y: snap(raw.y, GRID_STEP) });
      return;
    }

    if (g?.kind === 'tap') {
      const travel = Math.hypot(e.clientX - g.x, e.clientY - g.y);
      if (travel > TAP_SLOP) {
        // Инструменты выбора и стирания на пустом месте двигают чертёж;
        // рисующие продолжают целиться — палец подводят к нужному месту, не
        // отрывая его.
        if (tool === 'select' || tool === 'delete') {
          gesture.current = {
            kind: 'pan',
            x: g.x,
            y: g.y,
            ox: view.offsetX,
            oy: view.offsetY,
          };
          setView({
            scale: view.scale,
            offsetX: view.offsetX + (e.clientX - g.x),
            offsetY: view.offsetY + (e.clientY - g.y),
          });
          return;
        }
        g.moved = true;
      }
      if (tool === 'wall' || tool === 'door' || tool === 'window') {
        const { point, closing } = snapPoint(toPlan(local.x, local.y));
        setCursor(point);
        setHoverClose(closing);
      }
      return;
    }

    // Свободное движение мыши: подсветка и предпросмотр.
    if (e.pointerType === 'mouse') {
      if (tool === 'select' || tool === 'delete') {
        setHoverWall(vertexAt(local) >= 0 ? null : wallAt(local));
        setCursor(null);
        return;
      }
      setHoverWall(null);
      const { point, closing } = snapPoint(toPlan(local.x, local.y));
      setCursor(point);
      setHoverClose(closing);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    canvasRef.current?.releasePointerCapture?.(e.pointerId);

    if (g?.kind === 'vertex') setDragVertex(null);
    if (g?.kind === 'tap') applyTool(localPoint(e.clientX, e.clientY));

    // Пока на экране остаётся палец, жест не закончен — но щипок с одним
    // пальцем уже не щипок.
    gesture.current = null;
    if (pointers.current.size === 0 && e.pointerType !== 'mouse') {
      setCursor(null);
      setHoverClose(false);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    const local = localPoint(e.clientX, e.clientY);
    const before = toPlan(local.x, local.y);
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      // При зуме удерживаем точку плана под курсором на месте.
      return {
        scale,
        offsetX: local.x - before.x * scale,
        offsetY: local.y - before.y * scale,
      };
    });
  };

  /* --- курсор ------------------------------------------------------------ */

  const cursorStyle =
    tool === 'wall' || tool === 'delete'
      ? 'crosshair'
      : tool === 'door' || tool === 'window'
        ? 'copy'
        : dragVertex !== null
          ? 'grabbing'
          : hoverWall !== null
            ? 'pointer'
            : 'default';

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-white">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 touch-none"
        style={{ cursor: cursorStyle }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => {
          if (gesture.current) return;
          setCursor(null);
          setHoverWall(null);
        }}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={() => {
          if (!room.closed && room.points.length >= 3) closeRoom();
        }}
      />

      {/* Подписи размеров: нажатие открывает ввод точной длины прямо на месте. */}
      {walls.map((w) => {
        if (w.length < 0.05) return null;
        const { left, top } = dimensionAnchor(w, centre, toScreen, touch ? 30 : 24);
        const active = editingWall === w.index;
        const on = selectedWall === w.index || hoverWall === w.index;

        if (active) {
          return (
            <DimensionInput
              key={`dim-${w.index}`}
              left={left}
              top={top}
              value={w.length}
              onCancel={() => onRequestDimensionEdit(null)}
              onCommit={(v) => onCommitDimension(w.index, v)}
            />
          );
        }

        return (
          <button
            key={`dim-${w.index}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              usePlanStore.getState().selectWall(w.index);
              onRequestDimensionEdit(w.index);
            }}
            title="Изменить длину стены"
            className={`num absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-[6px] border whitespace-nowrap transition-colors duration-150 ${
              touch ? 'px-2.5 py-1.5 text-[12.5px]' : 'px-2 py-[3px] text-[11.5px]'
            } ${
              on
                ? 'border-accent bg-accent text-white'
                : 'border-line bg-white/95 text-ink hover:border-accent hover:text-accent'
            }`}
            style={{ left, top }}
          >
            {w.length.toFixed(2)} м
          </button>
        );
      })}

      {/* Ручки вершин. */}
      {room.points.map((p, i) => {
        const s = toScreen(p);
        const grabbable = tool === 'select' || tool === 'delete';
        const base = touch ? 'h-4 w-4' : 'h-3 w-3';
        return (
          <span
            key={`v-${i}`}
            className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 border-[1.5px] bg-white transition-[width,height,border-color] duration-150 ${
              dragVertex === i
                ? `${touch ? 'h-5 w-5' : 'h-3.5 w-3.5'} border-accent`
                : grabbable
                  ? `${base} border-ink`
                  : `${touch ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5'} border-faint`
            }`}
            style={{ left: s.x, top: s.y }}
          />
        );
      })}

      {/* Пустое состояние. */}
      {room.points.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6">
          <div className="max-w-sm text-center">
            <p className="text-[16px] font-medium">
              {touch ? 'Коснитесь холста' : 'Поставьте первую точку'}
            </p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
              {touch
                ? 'Стены строятся одна за другой и держатся прямого угла. Вернитесь к первой точке, чтобы замкнуть комнату. Двумя пальцами — масштаб.'
                : 'Кликайте по холсту: стены строятся одна за другой и держатся прямого угла. Вернитесь к первой точке, чтобы замкнуть комнату.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* --- ввод размера ------------------------------------------------------- */

/**
 * Поле ввода длины прямо на месте подписи.
 *
 * Модальное окно здесь было бы лишним: правка одного числа не требует ни
 * прерывания, ни защищённого фокуса, а перекрытое затемнением полотно мешает
 * увидеть, что именно меняется.
 */
function DimensionInput({
  left,
  top,
  value,
  onCommit,
  onCancel,
}: {
  left: number;
  top: number;
  value: number;
  onCommit: (meters: number) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value.toFixed(2));
  const ref = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  // Значение читаем из самого поля, а не из состояния: так фиксация не зависит
  // от того, успел ли React обработать последний ввод до нажатия Enter.
  const commit = () => {
    const raw = ref.current?.value ?? draft;
    const v = parseFloat(raw.replace(',', '.'));
    if (Number.isFinite(v) && v >= 0.1) onCommit(v);
    else onCancel();
  };

  return (
    <div
      className="absolute z-30 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-[8px] border border-accent bg-white py-1 pr-2 pl-1 shadow-[var(--shadow-pop)]"
      style={{ left, top }}
    >
      <input
        ref={ref}
        value={draft}
        inputMode="decimal"
        aria-label="Длина стены в метрах"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') onCancel();
          e.stopPropagation();
        }}
        className="num w-20 rounded-[5px] px-2 py-1.5 text-[13.5px] outline-none"
      />
      <span className="text-[11px] text-muted">м</span>
    </div>
  );
}

/* --- вспомогательное ---------------------------------------------------- */

/**
 * Позиция подписи размера: снаружи контура, по нормали к стене — так, как
 * размеры ставят на чертеже.
 */
function dimensionAnchor(
  w: Wall,
  centre: Point,
  toScreen: (p: Point) => Point,
  offset: number,
) {
  const midPlan = { x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 };
  const mid = toScreen(midPlan);
  let nx = -(w.end.y - w.start.y) / (w.length || 1);
  let ny = (w.end.x - w.start.x) / (w.length || 1);
  if (nx * (centre.x - midPlan.x) + ny * (centre.y - midPlan.y) > 0) {
    nx = -nx;
    ny = -ny;
  }
  return { left: mid.x + nx * offset, top: mid.y + ny * offset };
}

/**
 * Сетка плана: полметра, метр и пятиметровые линии.
 *
 * Три уровня вместо двух дают опору взгляду на любом зуме — при отдалении
 * мелкие линии гаснут сами, потому что рисуются только когда шаг больше
 * шести пикселей.
 */
function drawGrid(ctx: CanvasRenderingContext2D, size: { w: number; h: number }, view: View) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size.w, size.h);

  const drawLines = (step: number, color: string) => {
    if (step < 6) return;
    ctx.beginPath();
    const startX = view.offsetX % step;
    const startY = view.offsetY % step;
    for (let x = startX; x < size.w; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, size.h);
    }
    for (let y = startY; y < size.h; y += step) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(size.w, Math.round(y) + 0.5);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  drawLines(view.scale * 0.5, '#f4f4f2');
  drawLines(view.scale, '#e9e9e6');
  drawLines(view.scale * 5, '#dededa');
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function nearestWall(walls: Wall[], p: Point) {
  let best: { index: number; t: number; d: number } | null = null;
  for (const w of walls) {
    const { point, t } = closestOnSegment(p, w.start, w.end);
    const d = dist(p, point);
    if (!best || d < best.d) best = { index: w.index, t, d };
  }
  return best && best.d < 0.6 ? best : null;
}

function hitOpening(room: RoomGeometry, walls: Wall[], p: Point) {
  for (const op of room.openings) {
    const w = walls[op.wall];
    if (!w) continue;
    const c = {
      x: w.start.x + (w.end.x - w.start.x) * op.t,
      y: w.start.y + (w.end.y - w.start.y) * op.t,
    };
    if (dist(p, c) < Math.max(op.width / 2, 0.3)) return op;
  }
  return null;
}
