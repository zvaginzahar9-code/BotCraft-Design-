'use client';

import { create } from 'zustand';
import {
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  emptyRoom,
  setWallLength,
  type Opening,
  type Point,
  type RoomGeometry,
} from '@/lib/geometry';

export type PlanTool = 'wall' | 'select' | 'door' | 'window' | 'delete';

const STORAGE_KEY = 'botcraft.plan.v1';
const HISTORY_LIMIT = 60;

type PlanState = {
  room: RoomGeometry;
  tool: PlanTool;
  projectName: string;
  projectId: string | null;
  /** Индекс выделенной стены или null. Живёт вне истории: выделение — это
      состояние взгляда, а не документа, и отменять его нечего. */
  selectedWall: number | null;
  past: RoomGeometry[];
  future: RoomGeometry[];

  setTool: (tool: PlanTool) => void;
  selectWall: (index: number | null) => void;
  removeWall: (index: number) => void;
  setProjectName: (name: string) => void;
  setProjectId: (id: string | null) => void;

  addPoint: (p: Point) => void;
  closeRoom: () => void;
  movePoint: (index: number, p: Point) => void;
  removePoint: (index: number) => void;
  undoLastPoint: () => void;
  setWallLen: (index: number, length: number) => void;
  setWallHeight: (h: number) => void;
  setWallThickness: (t: number) => void;
  addOpening: (o: Omit<Opening, 'id'>) => void;
  removeOpening: (id: string) => void;
  loadRoom: (room: RoomGeometry, name?: string, id?: string | null) => void;
  reset: () => void;
  /** Полностью чистый старт: пустой холст, новое имя, никакой связи с проектом. */
  startNew: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  persist: () => void;
  restore: () => void;
};

function clone(room: RoomGeometry): RoomGeometry {
  return {
    ...room,
    points: room.points.map((p) => ({ ...p })),
    openings: room.openings.map((o) => ({ ...o })),
  };
}

export const usePlanStore = create<PlanState>((set, get) => {
  /** Оборачивает мутацию так, чтобы она попала в стек отмены и очистила redo. */
  const commit = (mutate: (room: RoomGeometry) => RoomGeometry) => {
    const { room, past } = get();
    const next = mutate(clone(room));
    set({
      room: next,
      past: [...past, clone(room)].slice(-HISTORY_LIMIT),
      future: [],
    });
    queueMicrotask(() => get().persist());
  };

  return {
    room: emptyRoom(),
    tool: 'wall',
    projectName: 'Новый проект',
    projectId: null,
    selectedWall: null,
    past: [],
    future: [],

    // Смена инструмента снимает выделение: подписи и ручки у каждого
    // инструмента свои, и «залипшая» подсветка стены после переключения на
    // дверь читается как баг.
    setTool: (tool) => set({ tool, selectedWall: null }),
    selectWall: (selectedWall) => set({ selectedWall }),

    /**
     * Удаляет стену, сливая её соседей.
     *
     * Стена — это отрезок между двумя точками, поэтому «убрать стену» значит
     * убрать её конечную вершину: предыдущая стена дотягивается до следующей,
     * и контур остаётся связным. У незамкнутой ломаной последняя стена просто
     * укорачивает цепочку.
     */
    removeWall: (index) => {
      const { room } = get();
      const n = room.points.length;
      if (n < 2) return;
      const victim = room.closed ? (index + 1) % n : index + 1;
      set({ selectedWall: null });
      get().removePoint(victim);
    },
    setProjectName: (projectName) => {
      set({ projectName });
      get().persist();
    },
    setProjectId: (projectId) => set({ projectId }),

    addPoint: (p) =>
      commit((room) => {
        if (room.closed) return room;
        const last = room.points[room.points.length - 1];
        // Игнорируем двойной клик, который создал бы стену нулевой длины.
        if (last && Math.hypot(last.x - p.x, last.y - p.y) < 0.02) return room;
        room.points.push({ ...p });
        return room;
      }),

    closeRoom: () =>
      commit((room) => {
        if (room.points.length >= 3) room.closed = true;
        return room;
      }),

    movePoint: (index, p) =>
      commit((room) => {
        if (room.points[index]) room.points[index] = { ...p };
        return room;
      }),

    removePoint: (index) =>
      commit((room) => {
        if (room.points.length <= 1) return { ...emptyRoom(), wallHeight: room.wallHeight };
        room.points.splice(index, 1);
        if (room.points.length < 3) room.closed = false;
        // Проёмы ссылаются на индексы стен — выкидываем те, что больше не разрешаются.
        room.openings = room.openings.filter(
          (o) => o.wall < (room.closed ? room.points.length : room.points.length - 1),
        );
        return room;
      }),

    undoLastPoint: () =>
      commit((room) => {
        if (room.closed) {
          room.closed = false;
          return room;
        }
        room.points.pop();
        return room;
      }),

    setWallLen: (index, length) => commit((room) => setWallLength(room, index, length)),

    setWallHeight: (h) =>
      commit((room) => {
        room.wallHeight = Math.min(6, Math.max(1.8, h));
        return room;
      }),

    setWallThickness: (t) =>
      commit((room) => {
        room.wallThickness = Math.min(0.6, Math.max(0.05, t));
        return room;
      }),

    addOpening: (o) =>
      commit((room) => {
        room.openings.push({ ...o, id: `op_${Math.random().toString(36).slice(2, 9)}` });
        return room;
      }),

    removeOpening: (id) =>
      commit((room) => {
        room.openings = room.openings.filter((o) => o.id !== id);
        return room;
      }),

    loadRoom: (room, name, id) => {
      set({
        room: clone(room),
        past: [],
        future: [],
        selectedWall: null,
        ...(name !== undefined ? { projectName: name } : {}),
        ...(id !== undefined ? { projectId: id } : {}),
      });
      get().persist();
    },

    reset: () => {
      set({ room: emptyRoom(), past: [], future: [], projectId: null, selectedWall: null });
      get().persist();
    },

    /**
     * Новый проект начинается с пустого листа.
     *
     * Именно этого ждут от кнопки «Создать дизайн»: не продолжения вчерашнего
     * чертежа, восстановленного из localStorage, а чистого холста. Сохранённые
     * проекты при этом не трогаются — они живут в базе, а здесь стирается
     * только черновик текущей сессии.
     */
    startNew: () => {
      set({
        room: emptyRoom(),
        tool: 'wall',
        projectName: 'Новый проект',
        projectId: null,
        selectedWall: null,
        past: [],
        future: [],
      });
      get().persist();
    },

    undo: () => {
      const { past, room, future } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set({
        room: prev,
        past: past.slice(0, -1),
        future: [clone(room), ...future].slice(0, HISTORY_LIMIT),
        selectedWall: null,
      });
      get().persist();
    },

    redo: () => {
      const { future, room, past } = get();
      if (!future.length) return;
      set({
        room: future[0],
        future: future.slice(1),
        past: [...past, clone(room)].slice(-HISTORY_LIMIT),
        selectedWall: null,
      });
      get().persist();
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    persist: () => {
      if (typeof window === 'undefined') return;
      const { room, projectName, projectId } = get();
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ room, projectName, projectId }));
      } catch {
        /* хранилище переполнено или заблокировано — план просто не переживёт перезагрузку */
      }
    },

    restore: () => {
      if (typeof window === 'undefined') return;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (!data?.room?.points) return;
        set({
          room: {
            wallHeight: DEFAULT_WALL_HEIGHT,
            wallThickness: DEFAULT_WALL_THICKNESS,
            openings: [],
            closed: false,
            ...data.room,
          },
          projectName: data.projectName ?? 'Новый проект',
          projectId: data.projectId ?? null,
        });
      } catch {
        /* битые данные — начинаем с пустого плана */
      }
    },
  };
});
