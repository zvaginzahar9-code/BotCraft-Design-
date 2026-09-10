'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, OrbitControls, TransformControls, useGLTF } from '@react-three/drei';
import StudioEnvironment from './StudioEnvironment';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { bounds, centroid, type RoomGeometry } from '@/lib/geometry';
import { wallFaces } from '@/lib/placement';
import { useMediaQuery } from '@/lib/responsive';
import { SCALE_MAX, SCALE_MIN, useStudioStore, type TransformMode } from '@/store/studio';
import Room3D from './Room3D';
import FurnitureItem, { FurnitureGhost, type ItemPointerHandlers } from './FurnitureItem';

export type SceneHandle = {
  resetCamera: () => void;
  frameSelected: () => void;
};

const CAMERA_FOV = 45;
/** Порог в пикселях, после которого нажатие считается перетаскиванием, а не выбором. */
const DRAG_THRESHOLD = 5;

/**
 * Вьюпорт 3D-конструктора.
 *
 * Модель взаимодействия здесь важнее всего остального, поэтому она построена на
 * одном правиле, которое человек усваивает с первой попытки:
 *
 *   • тянешь предмет — двигается предмет;
 *   • тянешь пустоту — поворачивается камера.
 *
 * Из этого следует всё остальное. Палец, начавший движение на диване, никогда
 * не крутит комнату; два пальца — всегда камера, чем бы ни был занят первый.
 * Что именно делает перетаскивание предмета, задаёт текущий режим (двигать,
 * поднимать, вращать, размер) — то есть «не тем инструментом» ошибиться можно,
 * а «не той осью» уже нет: ось выбирает режим.
 *
 * На десктопе поверх этого лежит классический гизмо с осями — он нужен для
 * точной работы мышью и появляется только там, где есть настоящий курсор.
 */
export default function StudioScene({
  room,
  onReady,
}: {
  room: RoomGeometry;
  onReady?: (handle: SceneHandle) => void;
}) {
  const coarse = useMediaQuery('(pointer: coarse)');
  const placements = useStudioStore((s) => s.placements);
  const catalog = useStudioStore((s) => s.catalog);
  const selected = useStudioStore((s) => s.selected);
  const select = useStudioStore((s) => s.select);

  const centre = useMemo(() => centroid(room.points), [room.points]);
  const extent = useMemo(() => {
    if (room.points.length < 2) return 6;
    const b = bounds(room.points);
    return Math.max(b.maxX - b.minX, b.maxY - b.minY, 2);
  }, [room.points]);

  const initialCamera = useMemo(() => defaultCameraFor(room, centre, 1.6), [room, centre]);

  /**
   * Освобождает меши и текстуры моделей, которых больше нет в комнате.
   *
   * Кэш drei держит загруженный GLB вечно, поэтому без этого час работы с
   * каталогом из семидесяти позиций оставляет в памяти всё, что примерили, —
   * и вкладка неизбежно приходит к падению WebGL-контекста.
   */
  const loadedPaths = useRef(new Set<string>());
  useEffect(() => {
    const inUse = new Set(
      placements.map((p) => catalog[p.furnitureId]?.model_path).filter(Boolean) as string[],
    );
    for (const p of inUse) loadedPaths.current.add(p);

    // Чистим не сразу: предмет часто удаляют, чтобы тут же поставить такой же.
    const timer = window.setTimeout(() => {
      for (const path of [...loadedPaths.current]) {
        if (inUse.has(path)) continue;
        useGLTF.clear(path);
        loadedPaths.current.delete(path);
      }
    }, 20000);
    return () => window.clearTimeout(timer);
  }, [placements, catalog]);

  return (
    <Canvas
      shadows
      // Кадр рисуется по требованию, а не шестьдесят раз в секунду в пустоту:
      // комната неподвижна ровно до тех пор, пока её не трогают, и телефон не
      // греет карман, показывая один и тот же кадр. r3f сам просит кадр на
      // каждое изменение сцены, орбита — на каждый шаг инерции.
      frameloop="demand"
      // Плотность пикселей: на телефоне сглаживание уже даёт третий-четвёртый
      // сабпиксель, а рисовать в 3x на мобильной видеокарте — гарантированные
      // просадки на вращении камеры.
      dpr={[1, coarse ? 1.5 : 1.75]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ position: initialCamera, fov: CAMERA_FOV, near: 0.1, far: 220 }}
      onPointerMissed={(e) => {
        // Только основная кнопка: снятие выделения правым кликом (панорамой)
        // выглядело бы как случайная потеря объекта.
        if (e.button === 0) select(null);
      }}
    >
      {/* Подложка чуть темнее белых стен: без этого комната растворяется в
          фоне и перестаёт читаться объёмом. */}
      <color attach="background" args={['#e3e3e0']} />
      <hemisphereLight intensity={0.55} groundColor="#cfcfcb" />
      <KeyLight position={[centre.x + 6, 11, centre.y + 4]} />
      <directionalLight position={[centre.x - 7, 7, centre.y - 6]} intensity={0.5} />

      <StudioEnvironment />
      <Room3D room={room} />
      <SnapHighlight room={room} />

      {/* Бледная сетка за пределами комнаты: пол не обрывается в пустоту, и
          видно, где комната стоит относительно мира. */}
      <Grid
        position={[centre.x, -0.004, centre.y]}
        args={[extent * 6, extent * 6]}
        cellSize={0.5}
        cellColor="#d5d5d1"
        sectionSize={5}
        sectionColor="#c2c2bd"
        fadeDistance={extent * 5}
        fadeStrength={1.4}
        infiniteGrid={false}
      />

      <Stage room={room} centre={centre} extent={extent} selected={selected} onReady={onReady} />
    </Canvas>
  );
}

/**
 * Основной источник света и его карта теней.
 *
 * Карта теней пересчитывается не каждый кадр, а только когда в комнате
 * действительно что-то изменилось. Тени в интерьере статичны: солнце не
 * движется, и пока никто не двигает мебель, пересчитывать проекцию всей сцены
 * во второй буфер — чистая трата кадра. Во время перетаскивания расстановка
 * меняется каждый кадр, и тень честно едет за предметом.
 */
function KeyLight({ position }: { position: [number, number, number] }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const placements = useStudioStore((s) => s.placements);

  useEffect(() => {
    const l = light.current;
    if (!l) return;
    l.shadow.autoUpdate = false;
    l.shadow.needsUpdate = true;
  }, []);

  useEffect(() => {
    if (light.current) light.current.shadow.needsUpdate = true;
  }, [placements, position]);

  return (
    <directionalLight
      ref={light}
      position={position}
      intensity={2.1}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-20}
      shadow-camera-right={20}
      shadow-camera-top={20}
      shadow-camera-bottom={-20}
      shadow-bias={-0.0005}
    />
  );
}

/**
 * Точка съёмки, с которой комната помещается в кадр целиком.
 *
 * Радиус описанной сферы комнаты делится на синус половины угла обзора — и по
 * вертикали, и по горизонтали, потому что на вертикальном экране узкое место
 * именно горизонталь. Множитель 0.9 намеренно меньше единицы: в интерьер
 * смотрят вплотную, поля вокруг комнаты были бы пустой тратой кадра.
 */
function defaultCameraFor(
  room: RoomGeometry,
  centre: { x: number; y: number },
  aspect: number,
): [number, number, number] {
  const b =
    room.points.length >= 2 ? bounds(room.points) : { minX: -2, maxX: 2, minY: -2, maxY: 2 };
  const w = Math.max(b.maxX - b.minX, 1);
  const d = Math.max(b.maxY - b.minY, 1);
  const radius = 0.5 * Math.hypot(w, d, room.wallHeight);

  const vFov = (CAMERA_FOV * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.2));
  const distance = Math.max(radius / Math.sin(vFov / 2), radius / Math.sin(hFov / 2)) * 0.9;

  // Направление взгляда: три четверти сверху — с него читаются и планировка,
  // и высота стен. На вертикальном экране взгляд поднимается: сверху пол
  // проецируется ближе к квадрату и заполняет узкий кадр, а не лежит в нём
  // тонкой полосой.
  const elevation = 0.55 * THREE.MathUtils.clamp(1 / Math.max(aspect, 0.2), 1, 2.2);
  const dir = new THREE.Vector3(0.62, elevation, 0.82).normalize().multiplyScalar(distance);
  return [centre.x + dir.x, Math.max(dir.y, room.wallHeight * 1.15), centre.y + dir.z];
}

/**
 * Всё, чему нужен доступ к камере и канвасу: расстановка, жесты, гизмо,
 * орбита. Живёт внутри `<Canvas>`, потому что `useThree` работает только там.
 */
function Stage({
  room,
  centre,
  extent,
  selected,
  onReady,
}: {
  room: RoomGeometry;
  centre: { x: number; y: number };
  extent: number;
  selected: string | null;
  onReady?: (handle: SceneHandle) => void;
}) {
  const { camera, gl, size } = useThree();
  const placements = useStudioStore((s) => s.placements);
  const catalog = useStudioStore((s) => s.catalog);
  const mode = useStudioStore((s) => s.mode);
  const select = useStudioStore((s) => s.select);

  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const objects = useRef(new Map<string, THREE.Object3D>());
  const [selectedObject, setSelectedObject] = useState<THREE.Object3D | null>(null);
  // Инкрементируется при монтировании и размонтировании модели, чтобы гизмо мог
  // прицепиться к предмету, который в момент выделения ещё догружался.
  const [objectsVersion, setObjectsVersion] = useState(0);
  const [dragging, setDragging] = useState<string | null>(null);
  const gizmoRef = useRef<{ axis: string | null; dragging: boolean } | null>(null);

  // Гизмо показываем только там, где есть настоящий курсор: на телефоне его
  // стрелки меньше подушечки пальца, и попасть по нужной невозможно.
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)');

  // Счётчик реально отрисованных кадров для замеров производительности
  // (scripts/verify): при отрисовке по требованию число тиков requestAnimationFrame
  // ничего не говорит о нагрузке. В продакшен-сборку не попадает.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as unknown as {
      __studioGl?: THREE.WebGLRenderer;
      __studioCamera?: THREE.Camera;
    };
    w.__studioGl = gl;
    w.__studioCamera = camera;
  }, [gl, camera]);

  const registerObject = useCallback((uid: string, object: THREE.Object3D | null) => {
    if (object) objects.current.set(uid, object);
    else objects.current.delete(uid);
    setObjectsVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    setSelectedObject(selected ? (objects.current.get(selected) ?? null) : null);
  }, [selected, objectsVersion]);

  /* --- камера ------------------------------------------------------------ */

  const target = useMemo<[number, number, number]>(
    () => [centre.x, room.wallHeight * 0.35, centre.y],
    [centre.x, centre.y, room.wallHeight],
  );

  const aspect = size.width / Math.max(size.height, 1);

  const resetCamera = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.object.position.set(...defaultCameraFor(room, centre, aspect));
    controls.target.set(...target);
    controls.update();
  }, [room, centre, aspect, target]);

  /**
   * Кадрирование под текущий вьюпорт.
   *
   * Одна и та же дистанция даёт на альбомном мониторе комнату целиком, а на
   * вертикальном телефоне — половину дивана: горизонтальный угол обзора уже
   * вертикального ровно во столько раз, во сколько кадр уже своей высоты.
   * Поэтому вид перекадрируется при смене размера окна и поворота устройства —
   * но только пока пользователь сам не тронул камеру: после этого его ракурс
   * важнее нашего.
   */
  const userMovedCamera = useRef(false);
  useEffect(() => {
    if (userMovedCamera.current) return;
    resetCamera();
  }, [resetCamera]);

  /** Подводит камеру к выделенному предмету, сохраняя направление взгляда. */
  const frameSelected = useCallback(() => {
    const controls = controlsRef.current;
    const uid = useStudioStore.getState().selected;
    const placement = useStudioStore.getState().placements.find((p) => p.uid === uid);
    const item = placement ? useStudioStore.getState().catalog[placement.furnitureId] : null;
    if (!controls || !placement || !item) return;

    const span = Math.max(item.width, item.depth, item.height) * placement.scale;
    const distance = Math.max(span * 2.4, 1.8);
    const dir = controls.object.position.clone().sub(controls.target).normalize();
    const focus = new THREE.Vector3(
      placement.position[0],
      placement.position[1] + (item.height * placement.scale) / 2,
      placement.position[2],
    );
    controls.target.copy(focus);
    controls.object.position.copy(focus.clone().add(dir.multiplyScalar(distance)));
    controls.update();
  }, []);

  useEffect(() => {
    onReady?.({ resetCamera, frameSelected });
  }, [onReady, resetCamera, frameSelected]);

  /* --- прямое перетаскивание предметов ----------------------------------- */

  const drag = useRef<{
    uid: string;
    pointerId: number;
    mode: TransformMode;
    plane: THREE.Plane;
    grab: THREE.Vector3;
    startPosition: [number, number, number];
    startRotation: number;
    startScale: number;
    startAngle: number;
    startDistance: number;
    startY: number;
    screen: { x: number; y: number };
    moved: boolean;
  } | null>(null);

  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);

  /** Точка, где текущий указатель пересекает рабочую плоскость жеста. */
  const intersect = useCallback(
    (clientX: number, clientY: number, plane: THREE.Plane): THREE.Vector3 | null => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(plane, hit) ? hit.clone() : null;
    },
    [camera, gl, raycaster, hit],
  );

  const endDrag = useCallback(() => {
    if (!drag.current) return;
    const wasMoved = drag.current.moved;
    drag.current = null;
    setDragging(null);
    const controls = controlsRef.current;
    if (controls) controls.enabled = true;
    if (wasMoved) useStudioStore.getState().endGesture();
    document.body.style.cursor = '';
  }, []);

  const handlePointerDown = useCallback(
    (uid: string, e: ThreeEvent<PointerEvent>) => {
      // Второй палец на экране — это всегда камера: масштаб и панорама важнее
      // случайного сдвига предмета, за который держится первый.
      if (!e.isPrimary) {
        endDrag();
        return;
      }
      // Захват оси гизмо уже обрабатывается им самим — не мешаем.
      if (gizmoRef.current?.axis) return;
      if ((e.nativeEvent as PointerEvent).button !== undefined && e.nativeEvent.button > 0) return;

      e.stopPropagation();
      const state = useStudioStore.getState();
      if (state.selected !== uid) select(uid);

      const placement = state.placements.find((p) => p.uid === uid);
      if (!placement) return;

      const [px, py, pz] = placement.position;
      const activeMode = state.mode;

      // Рабочая плоскость жеста. Для подъёма она вертикальная и развёрнута к
      // камере, для остального — горизонтальная на высоте самого предмета:
      // предмет обязан следовать за курсором один в один, иначе перетаскивание
      // «уползает» тем сильнее, чем ниже камера.
      let plane: THREE.Plane;
      if (activeMode === 'height') {
        const normal = new THREE.Vector3();
        camera.getWorldDirection(normal);
        normal.y = 0;
        if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1);
        normal.normalize();
        plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          normal,
          new THREE.Vector3(px, py, pz),
        );
      } else {
        plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -py);
      }

      const point = intersect(e.nativeEvent.clientX, e.nativeEvent.clientY, plane);
      if (!point) return;

      drag.current = {
        uid,
        pointerId: e.pointerId,
        mode: activeMode,
        plane,
        grab: point.clone().sub(new THREE.Vector3(px, py, pz)),
        startPosition: [px, py, pz],
        startRotation: placement.rotationY,
        startScale: placement.scale,
        startAngle: Math.atan2(point.z - pz, point.x - px),
        startDistance: Math.max(Math.hypot(point.x - px, point.z - pz), 0.08),
        startY: point.y,
        screen: { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY },
        moved: false,
      };
      setDragging(uid);
      const controls = controlsRef.current;
      if (controls) controls.enabled = false;
    },
    [camera, endDrag, intersect, select],
  );

  // Пустые обработчики: события живут на окне, но предмету нужны все три, чтобы
  // r3f не считал жест прерванным.
  const noop = useCallback(() => {}, []);
  const handlers = useMemo<ItemPointerHandlers>(
    () => ({ onPointerDown: handlePointerDown, onPointerMove: noop, onPointerUp: noop }),
    [handlePointerDown, noop],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;

      if (!d.moved) {
        const travel = Math.hypot(e.clientX - d.screen.x, e.clientY - d.screen.y);
        if (travel < DRAG_THRESHOLD) return;
        d.moved = true;
        useStudioStore.getState().beginGesture(`${d.mode}:${d.uid}`);
        document.body.style.cursor = d.mode === 'move' ? 'grabbing' : 'ns-resize';
      }

      const point = intersect(e.clientX, e.clientY, d.plane);
      if (!point) return;

      const store = useStudioStore.getState();

      if (d.mode === 'move') {
        store.update(
          d.uid,
          {
            position: [point.x - d.grab.x, d.startPosition[1], point.z - d.grab.z],
          },
          // Alt временно отключает прилипание: иногда нужно поставить предмет
          // именно в сантиметре от стены, а не вплотную.
          { snap: e.altKey ? false : undefined, silent: true },
        );
        return;
      }

      if (d.mode === 'height') {
        const next = d.startPosition[1] + (point.y - d.startY);
        store.update(
          d.uid,
          { position: [d.startPosition[0], Math.max(0, next), d.startPosition[2]] },
          { snap: false, silent: true },
        );
        return;
      }

      if (d.mode === 'rotate') {
        const angle = Math.atan2(point.z - d.startPosition[2], point.x - d.startPosition[0]);
        // Экранный поворот против часовой стрелки в XZ — это уменьшение
        // rotationY, поэтому знак обратный.
        let next = d.startRotation - (angle - d.startAngle);
        // Shift держит шаг в 15°: ровные углы нужны чаще произвольных.
        if (e.shiftKey) next = Math.round(next / (Math.PI / 12)) * (Math.PI / 12);
        store.update(d.uid, { rotationY: next }, { silent: true });
        return;
      }

      if (d.mode === 'scale') {
        const distance = Math.max(
          Math.hypot(point.x - d.startPosition[0], point.z - d.startPosition[2]),
          0.04,
        );
        const next = THREE.MathUtils.clamp(
          d.startScale * (distance / d.startDistance),
          SCALE_MIN,
          SCALE_MAX,
        );
        store.update(d.uid, { scale: next }, { silent: true });
      }
    };

    const onUp = (e: PointerEvent) => {
      if (drag.current && e.pointerId !== drag.current.pointerId) return;
      endDrag();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [endDrag, intersect]);

  /* --- гизмо ------------------------------------------------------------- */

  /** Считывает преобразование с гизмо и проводит его через тот же решатель. */
  const commitGizmo = useCallback(() => {
    const store = useStudioStore.getState();
    const uid = store.selected;
    if (!uid || !selectedObject) return;
    const current = store.placements.find((p) => p.uid === uid);
    if (!current) return;

    if (store.mode === 'scale') {
      // Масштабирование намеренно равномерное; берём ту ось, за которую тянул
      // пользователь.
      const s = selectedObject.scale;
      const dominant = [s.x, s.y, s.z].reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a));
      selectedObject.scale.set(1, 1, 1);
      store.update(uid, { scale: current.scale * dominant }, { silent: true });
      return;
    }

    store.update(
      uid,
      {
        position: [
          selectedObject.position.x,
          Math.max(0, selectedObject.position.y),
          selectedObject.position.z,
        ],
        rotationY: selectedObject.rotation.y,
      },
      { silent: true },
    );
  }, [selectedObject]);

  const showGizmo = finePointer && selectedObject && !dragging;
  const gizmoMode = mode === 'rotate' ? 'rotate' : mode === 'scale' ? 'scale' : 'translate';

  return (
    <>
      {placements.map((p) => {
        const item = catalog[p.furnitureId];
        if (!item) return null;
        return (
          <Suspense key={p.uid} fallback={<FurnitureGhost placement={p} item={item} />}>
            <FurnitureItem
              placement={p}
              item={item}
              selected={selected === p.uid}
              interactive={!dragging || dragging === p.uid}
              handlers={handlers}
              registerObject={registerObject}
            />
          </Suspense>
        );
      })}

      {showGizmo && (
        <TransformControls
          object={selectedObject}
          mode={gizmoMode}
          size={0.9}
          space={mode === 'rotate' ? 'local' : 'world'}
          showX={mode === 'move' || mode === 'scale'}
          showZ={mode === 'move' || mode === 'scale'}
          showY={mode === 'height' || mode === 'rotate' || mode === 'scale'}
          rotationSnap={Math.PI / 36}
          onObjectChange={commitGizmo}
          onMouseDown={() => {
            useStudioStore.getState().beginGesture(`gizmo:${selected}`);
            if (gizmoRef.current) gizmoRef.current.dragging = true;
          }}
          onMouseUp={() => {
            commitGizmo();
            useStudioStore.getState().endGesture();
            if (gizmoRef.current) gizmoRef.current.dragging = false;
          }}
          ref={(instance) => {
            gizmoRef.current = instance as unknown as { axis: string | null; dragging: boolean };
          }}
        />
      )}

      <CameraRig
        controlsRef={controlsRef}
        target={target}
        extent={extent}
        onUserControl={() => {
          userMovedCamera.current = true;
        }}
      />
    </>
  );
}

/**
 * Подсветка стены, к которой предмет прилип.
 *
 * Прилипание без обратной связи ощущается как сбой управления: предмет
 * «сам» дёрнулся, и непонятно почему. Полупрозрачная плоскость на внутренней
 * грани стены объясняет это одним кадром.
 */
function SnapHighlight({ room }: { room: RoomGeometry }) {
  const snappedWall = useStudioStore((s) => s.snappedWall);
  const faces = useMemo(() => wallFaces(room), [room]);
  const face = snappedWall === null ? null : faces.find((f) => f.index === snappedWall);
  if (!face) return null;

  return (
    <mesh
      position={[face.face.x, room.wallHeight / 2, face.face.y]}
      rotation={[0, Math.atan2(face.normal.x, face.normal.y), 0]}
    >
      <planeGeometry args={[face.length, room.wallHeight]} />
      <meshBasicMaterial
        color="#d6421f"
        transparent
        opacity={0.14}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * Орбитальное управление с ограничениями редактора интерьера: камера не может
 * нырнуть под пол или уехать так далеко, что комната превратится в точку, а
 * панорамирование ограничено окрестностью комнаты.
 *
 * Раскладка жестов одинаково честна на всех устройствах: один палец крутит,
 * два — приближают и сдвигают; мышью — левая крутит, колесо приближает, правая
 * сдвигает.
 */
function CameraRig({
  controlsRef,
  target,
  extent,
  onUserControl,
}: {
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>;
  target: [number, number, number];
  extent: number;
  onUserControl: () => void;
}) {
  const { camera } = useThree();

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.target.set(...target);
    controls.update();
    // Выполняется один раз на комнату: перецентровка на каждом рендере мешала бы
    // пользователю.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target[0], target[1], target[2]]);

  return (
    <OrbitControls
      ref={controlsRef as never}
      makeDefault
      enableDamping
      dampingFactor={0.09}
      rotateSpeed={0.85}
      zoomSpeed={0.9}
      panSpeed={0.85}
      minDistance={1.2}
      maxDistance={extent * 4 + 8}
      // Останавливаемся чуть не доходя до горизонтали, чтобы камера не ушла под
      // землю, и не доходя до зенита, где вид теряет объём.
      maxPolarAngle={Math.PI / 2 - 0.05}
      minPolarAngle={0.14}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }}
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      onStart={onUserControl}
      onChange={() => {
        // Держим цель орбиты рядом с комнатой и выше пола.
        const controls = controlsRef.current;
        if (!controls) return;
        const t = controls.target;
        t.x = THREE.MathUtils.clamp(t.x, target[0] - extent, target[0] + extent);
        t.z = THREE.MathUtils.clamp(t.z, target[2] - extent, target[2] + extent);
        t.y = THREE.MathUtils.clamp(t.y, 0, 4);
        if (camera.position.y < 0.3) camera.position.y = 0.3;
      }}
    />
  );
}
