'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { CatalogItem, Placement } from '@/store/studio';

/**
 * Одна поставленная модель мебели.
 *
 * GLB подтягивается через `useGLTF` при первой установке предмета этого типа —
 * каталог грузит только превью, поэтому комната из трёх предметов скачивает
 * три меша, а не семьдесят. drei кэширует по URL, так что повторные установки
 * одной модели делят одну загрузку и один набор текстур; граф сцены
 * клонируется на каждый экземпляр, потому что один Object3D не может
 * находиться в сцене дважды.
 *
 * Исходные меши экспортированы нормализованными в единичный куб, поэтому мы
 * центрируем модель по началу координат, ставим её низ в y = 0 и применяем
 * реальный масштаб из каталога. Из-за этого `position[1]` расстановки читается
 * буквально: это высота НИЗА предмета над полом.
 */

const ACCENT = '#d6421f';
const QUIET = '#16171a';

export type ItemPointerHandlers = {
  onPointerDown: (uid: string, e: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (uid: string, e: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (uid: string, e: ThreeEvent<PointerEvent>) => void;
};

function FurnitureItem({
  placement,
  item,
  selected,
  interactive,
  handlers,
  registerObject,
}: {
  placement: Placement;
  item: CatalogItem;
  selected: boolean;
  /** Ложно, пока идёт жест над другим предметом: тогда этот не перехватывает луч. */
  interactive: boolean;
  handlers: ItemPointerHandlers;
  registerObject?: (uid: string, object: THREE.Object3D | null) => void;
}) {
  // Draco отключён: эти ассеты используют EXT_meshopt_compression, а включённый
  // Draco увёл бы загрузчик на CDN, который этому приложению не нужен.
  const { scene } = useGLTF(item.model_path, false);
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  const { model, offset, size } = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    const box = new THREE.Box3().setFromObject(clone);
    const centre = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    return {
      model: clone,
      offset: new THREE.Vector3(-centre.x, -box.min.y, -centre.z),
      size: s,
    };
  }, [scene]);

  useEffect(() => {
    registerObject?.(placement.uid, groupRef.current);
    return () => registerObject?.(placement.uid, null);
  }, [placement.uid, registerObject]);

  // Курсор возвращаем и при размонтировании: удалённый под курсором предмет
  // иначе оставлял бы «руку» над пустой комнатой.
  useEffect(() => {
    if (!hovered || !interactive) return;
    document.body.style.cursor = 'grab';
    return () => {
      document.body.style.cursor = '';
    };
  }, [hovered, interactive]);

  const scale = item.default_scale * placement.scale;
  const width = size.x * scale;
  const depth = size.z * scale;
  const height = size.y * scale;
  const lifted = placement.position[1] > 0.02;

  return (
    <group
      ref={groupRef}
      name={`placement:${placement.uid}`}
      position={placement.position}
      rotation={[0, placement.rotationY, 0]}
    >
      <group
        scale={scale}
        onPointerDown={(e) => interactive && handlers.onPointerDown(placement.uid, e)}
        onPointerMove={(e) => interactive && handlers.onPointerMove(placement.uid, e)}
        onPointerUp={(e) => interactive && handlers.onPointerUp(placement.uid, e)}
        onPointerOver={(e) => {
          if (!interactive) return;
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <primitive object={model} position={offset} />
      </group>

      {/* Габаритная клетка выделения.
          Рисуется только по рёбрам и полупрозрачной линией: она должна
          очерчивать предмет, а не заменять его собой. */}
      {selected && <SelectionCage width={width} height={height} depth={depth} />}

      {/* Пятно опоры на полу. По прямоугольнику видно и размер, и поворот, а у
          поднятого предмета — ещё и куда он встанет, если опустить. */}
      {(selected || hovered) && (
        <Footprint
          width={width}
          depth={depth}
          y={-placement.position[1] + 0.008}
          color={selected ? ACCENT : QUIET}
          opacity={selected ? 0.9 : 0.3}
        />
      )}

      {/* Вертикальная привязка поднятого предмета к полу: без неё висящая лампа
          читается как лампа, стоящая где-то дальше в комнате. */}
      {selected && lifted && <DropLine height={placement.position[1]} />}
    </group>
  );
}

/**
 * Мемоизация по значению.
 *
 * Перетаскивание пишет в стор десятки раз в секунду, и без этого сравнения
 * каждая правка перерисовывала бы все предметы комнаты. Клон меша живёт в
 * `useMemo`, так что даже лишний рендер не перезагружал бы GLB, — но лишняя
 * работа реконсилятора на каждом кадре жеста всё равно заметна.
 */
export default memo(FurnitureItem, (a, b) => {
  const p = a.placement;
  const q = b.placement;
  return (
    p.uid === q.uid &&
    p.furnitureId === q.furnitureId &&
    p.position[0] === q.position[0] &&
    p.position[1] === q.position[1] &&
    p.position[2] === q.position[2] &&
    p.rotationY === q.rotationY &&
    p.scale === q.scale &&
    a.selected === b.selected &&
    a.interactive === b.interactive &&
    a.item === b.item &&
    a.handlers === b.handlers &&
    a.registerObject === b.registerObject
  );
});

/** Рёбра габаритного параллелепипеда выделенного предмета. */
function SelectionCage({
  width,
  height,
  depth,
}: {
  width: number;
  height: number;
  depth: number;
}) {
  const geometry = useMemo(() => {
    const box = new THREE.BoxGeometry(width * 1.005, height * 1.005, depth * 1.005);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [width, height, depth]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry} position={[0, height / 2, 0]} renderOrder={998}>
      <lineBasicMaterial color={ACCENT} transparent opacity={0.5} depthTest={false} />
    </lineSegments>
  );
}

/**
 * Контур площади опоры на полу.
 *
 * Рисуется углами, а не сплошной рамкой: четыре угла однозначно задают и
 * размер, и поворот, но не превращают пол под предметом в разлинованную
 * коробку. `depthTest` выключен — контур должен читаться и когда предмет
 * свисает над ним.
 */
function Footprint({
  width,
  depth,
  y,
  color,
  opacity,
}: {
  width: number;
  depth: number;
  y: number;
  color: string;
  opacity: number;
}) {
  const geometry = useMemo(() => {
    const hx = width / 2;
    const hz = depth / 2;
    // Длина уголка — доля меньшей полустороны, но не больше 25 см.
    const len = Math.min(Math.min(hx, hz) * 0.6, 0.25);
    const pts: number[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * hx;
        const z = sz * hz;
        pts.push(x, 0, z, x - sx * len, 0, z);
        pts.push(x, 0, z, x, 0, z - sz * len);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [width, depth]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry} position={[0, y, 0]} renderOrder={999}>
      <lineBasicMaterial color={color} depthTest={false} transparent opacity={opacity} />
    </lineSegments>
  );
}

/**
 * Тонкая стойка от пола до поднятого предмета.
 *
 * Набрана штрихами вручную: пунктирный материал three требует посчитанных
 * расстояний вдоль линии, а здесь речь об одном отрезке, который меняет длину
 * на каждом кадре подъёма.
 */
function DropLine({ height }: { height: number }) {
  const geometry = useMemo(() => {
    const step = 0.11;
    const pts: number[] = [];
    for (let y = 0.01; y < height - 0.01; y += step) {
      pts.push(0, y - height, 0, 0, Math.min(y + step * 0.55, height - 0.01) - height, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [height]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry} renderOrder={999}>
      <lineBasicMaterial color={ACCENT} transparent opacity={0.7} depthTest={false} />
    </lineSegments>
  );
}

/**
 * Место предмета, пока его меш ещё качается.
 *
 * Прозрачный габарит по размерам из каталога: пользователь сразу видит, куда
 * встанет предмет и какого он будет размера, и не думает, что клик потерялся.
 */
export function FurnitureGhost({
  placement,
  item,
}: {
  placement: Placement;
  item: CatalogItem;
}) {
  const w = item.width * placement.scale;
  const h = item.height * placement.scale;
  const d = item.depth * placement.scale;

  const edges = useMemo(() => {
    const box = new THREE.BoxGeometry(w, h, d);
    const e = new THREE.EdgesGeometry(box);
    box.dispose();
    return e;
  }, [w, h, d]);

  useEffect(() => () => edges.dispose(), [edges]);

  return (
    <group position={placement.position} rotation={[0, placement.rotationY, 0]}>
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.07} />
      </mesh>
      <lineSegments geometry={edges} position={[0, h / 2, 0]}>
        <lineBasicMaterial color={ACCENT} transparent opacity={0.5} />
      </lineSegments>
    </group>
  );
}

export function preloadModel(path: string) {
  useGLTF.preload(path, false);
}
