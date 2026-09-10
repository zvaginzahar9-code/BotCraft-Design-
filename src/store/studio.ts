'use client';

import { create } from 'zustand';
import type { RoomGeometry } from '@/lib/geometry';
import { boxOf, findFreeSpot, solvePlacement } from '@/lib/placement';

/**
 * Состояние 3D-конструктора.
 *
 * Один принцип: стор — единственное место, где расстановка может измениться, и
 * он же следит за тем, чтобы расстановка оставалась физически возможной. Куда
 * бы ни пришла правка — из гизмо, из перетаскивания пальцем, из ползунка в
 * инспекторе или из поля ввода — она проходит через один и тот же решатель
 * (`solvePlacement`), поэтому предмет не может оказаться в стене ни одним из
 * путей. Раньше это делала сцена у себя внутри, и любой другой путь правки
 * (ползунок поворота, например) обходил проверку стороной.
 */

export type TransformMode = 'move' | 'height' | 'rotate' | 'scale';

export type CatalogItem = {
  id: string;
  name: string;
  category: string;
  model_path: string;
  thumbnail_path: string;
  width: number;
  depth: number;
  height: number;
  default_scale: number;
};

export type Placement = {
  /** Клиентский id экземпляра: несколько расстановок могут делить один furniture id. */
  uid: string;
  furnitureId: string;
  /** [x, высота над полом, z] в метрах. y — это низ предмета, а не его центр. */
  position: [number, number, number];
  rotationY: number;
  scale: number;
};

const HISTORY_LIMIT = 60;
/**
 * Окно склейки правок в истории, мс.
 *
 * Ползунки шлют `update` десятки раз в секунду. Без склейки один поворот занял
 * бы всю историю целиком, и Ctrl+Z отматывал бы его по градусу. Непрерывные
 * жесты (перетаскивание в сцене) вместо этого явно открывают и закрывают
 * транзакцию через `beginGesture` / `endGesture` — там окно не нужно вовсе.
 */
const COALESCE_MS = 650;

type StudioState = {
  projectId: string;
  projectName: string;
  room: RoomGeometry;
  placements: Placement[];
  selected: string | null;
  mode: TransformMode;
  /** Прилипание мебели к стенам. */
  snapEnabled: boolean;
  /** Стена, к которой предмет прижался прямо сейчас; сцена её подсвечивает. */
  snappedWall: number | null;
  dirty: boolean;
  catalog: Record<string, CatalogItem>;
  past: Placement[][];
  future: Placement[][];

  init: (input: {
    projectId: string;
    projectName: string;
    room: RoomGeometry;
    placements: Placement[];
  }) => void;
  setCatalog: (items: CatalogItem[]) => void;
  setProjectName: (name: string) => void;
  add: (furnitureId: string) => string | null;
  update: (uid: string, patch: Partial<Omit<Placement, 'uid'>>, opts?: UpdateOptions) => void;
  /** Ставит предмет обратно на пол, не трогая остальное. */
  dropToFloor: (uid: string) => void;
  remove: (uid: string) => void;
  duplicate: (uid: string) => void;
  select: (uid: string | null) => void;
  setMode: (mode: TransformMode) => void;
  setSnapEnabled: (on: boolean) => void;
  markClean: () => void;
  /** Открывает транзакцию истории: весь жест ляжет в один шаг отмены. */
  beginGesture: (key: string) => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
};

type UpdateOptions = {
  /** Позволить предмету прилипнуть к стене (по умолчанию — как в настройках). */
  snap?: boolean;
  /** Не писать в историю: правка идёт внутри уже открытого жеста. */
  silent?: boolean;
};

export const newUid = () => `p_${Math.random().toString(36).slice(2, 10)}`;

const SCALE_MIN = 0.25;
const SCALE_MAX = 4;

export const useStudioStore = create<StudioState>((set, get) => {
  let lastPush = 0;
  let lastKey = '';
  let inGesture = false;

  const pushHistory = (key: string, force = false) => {
    const now = Date.now();
    if (!force && key === lastKey && now - lastPush < COALESCE_MS) {
      lastPush = now;
      return;
    }
    lastKey = key;
    lastPush = now;
    set((s) => ({
      past: [...s.past, s.placements].slice(-HISTORY_LIMIT),
      future: [],
    }));
  };

  /** Приводит расстановку к физически возможной по текущей комнате. */
  const solve = (
    state: StudioState,
    placement: Placement,
    snap: boolean,
  ): { placement: Placement; snappedWall: number | null } => {
    const item = state.catalog[placement.furnitureId];
    if (!item) return { placement, snappedWall: null };
    const scale = clamp(placement.scale, SCALE_MIN, SCALE_MAX);
    const result = solvePlacement({
      room: state.room,
      box: boxOf(item, scale),
      position: placement.position,
      rotationY: placement.rotationY,
      snap,
    });
    return {
      placement: {
        ...placement,
        scale,
        position: result.position,
        rotationY: result.rotationY,
      },
      snappedWall: result.snappedWall,
    };
  };

  return {
    projectId: '',
    projectName: '',
    room: { points: [], closed: false, wallHeight: 2.7, wallThickness: 0.15, openings: [] },
    placements: [],
    selected: null,
    mode: 'move',
    snapEnabled: true,
    snappedWall: null,
    dirty: false,
    catalog: {},
    past: [],
    future: [],

    init: ({ projectId, projectName, room, placements }) => {
      lastKey = '';
      inGesture = false;
      set({
        projectId,
        projectName,
        room,
        placements,
        selected: null,
        snappedWall: null,
        dirty: false,
        past: [],
        future: [],
      });
    },

    setCatalog: (items) => {
      set({ catalog: Object.fromEntries(items.map((i) => [i.id, i])) });
      // Каталог приезжает после расстановки, поэтому только теперь известно,
      // какого размера сохранённые предметы. Проверяем их на пригодность —
      // комнату могли перерисовать, пока проект лежал в базе.
      const state = get();
      if (!state.placements.length) return;
      let changed = false;
      const fixed = state.placements.map((p) => {
        const { placement } = solve(state, p, false);
        if (
          placement.position[0] !== p.position[0] ||
          placement.position[1] !== p.position[1] ||
          placement.position[2] !== p.position[2]
        ) {
          changed = true;
        }
        return placement;
      });
      if (changed) set({ placements: fixed });
    },

    setProjectName: (projectName) => set({ projectName, dirty: true }),

    add: (furnitureId) => {
      const state = get();
      const item = state.catalog[furnitureId];
      if (!item) return null;

      const box = boxOf(item, 1);
      const taken = state.placements
        .map((p) => {
          const c = state.catalog[p.furnitureId];
          if (!c) return null;
          return {
            x: p.position[0],
            z: p.position[2],
            radius: (Math.hypot(c.width, c.depth) / 2) * p.scale,
          };
        })
        .filter(Boolean) as { x: number; z: number; radius: number }[];

      const spot = findFreeSpot({ room: state.room, box, taken });
      const placement: Placement = {
        uid: newUid(),
        furnitureId,
        // Мебель всегда появляется стоящей на полу: висящий в воздухе диван —
        // это не «свобода по Y», это сломанная сцена.
        position: [spot.x, 0, spot.z],
        rotationY: 0,
        scale: 1,
      };

      pushHistory(`add:${placement.uid}`, true);
      set((s) => ({
        placements: [...s.placements, solve(s, placement, false).placement],
        selected: placement.uid,
        mode: 'move',
        dirty: true,
      }));
      return placement.uid;
    },

    update: (uid, patch, opts) => {
      const state = get();
      const current = state.placements.find((p) => p.uid === uid);
      if (!current) return;
      if (!opts?.silent && !inGesture) {
        pushHistory(`update:${uid}:${Object.keys(patch).join(',')}`);
      }

      const wants = { ...current, ...patch };
      const snap = (opts?.snap ?? state.snapEnabled) && patch.position !== undefined;
      const { placement, snappedWall } = solve(state, wants, snap);

      set((s) => ({
        placements: s.placements.map((p) => (p.uid === uid ? placement : p)),
        snappedWall,
        dirty: true,
      }));
    },

    dropToFloor: (uid) => {
      const current = get().placements.find((p) => p.uid === uid);
      if (!current || current.position[1] === 0) return;
      get().update(uid, { position: [current.position[0], 0, current.position[2]] });
    },

    remove: (uid) => {
      pushHistory(`remove:${uid}`, true);
      set((s) => ({
        placements: s.placements.filter((p) => p.uid !== uid),
        selected: s.selected === uid ? null : s.selected,
        snappedWall: null,
        dirty: true,
      }));
    },

    duplicate: (uid) => {
      const state = get();
      const source = state.placements.find((p) => p.uid === uid);
      if (!source) return;
      pushHistory(`duplicate:${uid}`, true);
      const item = state.catalog[source.furnitureId];
      // Сдвигаем копию на её собственную ширину, а не на фиксированные 40 см:
      // копия шкафа обязана встать рядом, а не влезть в оригинал.
      const step = item ? Math.max(item.width, item.depth) * source.scale * 0.6 + 0.15 : 0.5;
      const copy: Placement = {
        ...source,
        uid: newUid(),
        position: [source.position[0] + step, source.position[1], source.position[2] + step],
      };
      set((s) => ({
        placements: [...s.placements, solve(s, copy, false).placement],
        selected: copy.uid,
        dirty: true,
      }));
    },

    select: (selected) => set({ selected, snappedWall: null }),
    setMode: (mode) => set({ mode }),
    setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
    markClean: () => set({ dirty: false }),

    beginGesture: (key) => {
      if (inGesture) return;
      pushHistory(key, true);
      inGesture = true;
    },
    endGesture: () => {
      inGesture = false;
      lastKey = '';
      set({ snappedWall: null });
    },

    undo: () => {
      const { past, placements, future, selected } = get();
      if (!past.length) return;
      lastKey = '';
      inGesture = false;
      const prev = past[past.length - 1];
      set({
        placements: prev,
        past: past.slice(0, -1),
        future: [placements, ...future].slice(0, HISTORY_LIMIT),
        // Выделение на исчезнувшем предмете сняли бы всё равно — снимаем сразу.
        selected: prev.some((p) => p.uid === selected) ? selected : null,
        snappedWall: null,
        dirty: true,
      });
    },

    redo: () => {
      const { future, placements, past, selected } = get();
      if (!future.length) return;
      lastKey = '';
      inGesture = false;
      const next = future[0];
      set({
        placements: next,
        future: future.slice(1),
        past: [...past, placements].slice(-HISTORY_LIMIT),
        selected: next.some((p) => p.uid === selected) ? selected : null,
        snappedWall: null,
        dirty: true,
      });
    },
  };
});

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export { SCALE_MIN, SCALE_MAX };
