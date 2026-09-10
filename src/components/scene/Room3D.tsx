'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { RoomGeometry } from '@/lib/geometry';
import { centroid } from '@/lib/geometry';
import { buildOpeningFrames, buildWallBoxes, createFloorTexture, orientNormals } from '@/lib/room3d';

/**
 * Сгенерированная комната: процедурные стены, пол, вырезанный по полигону
 * плана, и плинтус. Здесь нет ни одного готового ассета — каждый элемент
 * получен из собственного чертежа пользователя.
 */
export default function Room3D({ room }: { room: RoomGeometry }) {
  const { camera, invalidate } = useThree();
  const wallMeshes = useRef(new Map<string, THREE.Mesh>());

  const interior = useMemo(() => centroid(room.points), [room.points]);
  const boxes = useMemo(
    () => orientNormals(buildWallBoxes(room), interior),
    [room, interior],
  );
  const frames = useMemo(() => buildOpeningFrames(room), [room]);

  /* Floor -------------------------------------------------------------- */

  const floorGeometry = useMemo(() => {
    if (room.points.length < 3) return null;
    const shape = new THREE.Shape();
    // Инверсия y плюс поворот на -90° по X ставят +y плана в +z мира, при этом
    // нормаль поверхности смотрит вверх.
    room.points.forEach((p, i) => {
      if (i === 0) shape.moveTo(p.x, -p.y);
      else shape.lineTo(p.x, -p.y);
    });
    shape.closePath();
    const geom = new THREE.ShapeGeometry(shape);
    geom.rotateX(-Math.PI / 2);
    return geom;
  }, [room.points]);

  const floorTexture = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const tex = new THREE.CanvasTexture(createFloorTexture());
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    // UV у ShapeGeometry — это сырые координаты плана в метрах, поэтому одна
    // плитка текстуры на 1.6 м держит ширину доски правдоподобной при любом
    // размере комнаты.
    tex.repeat.set(1 / 1.6, 1 / 1.6);
    return tex;
  }, []);

  useEffect(() => {
    return () => {
      floorGeometry?.dispose();
      floorTexture?.dispose();
    };
  }, [floorGeometry, floorTexture]);

  /* Ceiling-side wall culling ------------------------------------------- */

  // Стены между камерой и комнатой прячутся, чтобы интерьер оставался виден при
  // облёте — так же ведут себя десктопные планировщики.
  const camDir = useRef(new THREE.Vector3());
  useFrame(() => {
    camDir.current.set(
      camera.position.x - interior.x,
      0,
      camera.position.z - interior.y,
    );
    if (camDir.current.lengthSq() < 1e-6) return;
    camDir.current.normalize();

    let animating = false;
    for (const box of boxes) {
      const mesh = wallMeshes.current.get(box.key);
      if (!mesh) continue;
      // Нормаль смотрит наружу, поэтому положительное скалярное произведение с
      // направлением камеры означает, что стена стоит между зрителем и комнатой.
      const facing = box.normal[0] * camDir.current.x + box.normal[2] * camDir.current.z;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const target = facing < 0.22 ? 1 : 0;
      if (Math.abs(target - mat.opacity) > 0.004) {
        mat.opacity += (target - mat.opacity) * 0.2;
        animating = true;
      } else {
        mat.opacity = target;
      }
      mat.transparent = mat.opacity < 0.99;
      mat.depthWrite = mat.opacity > 0.99;
      mesh.visible = mat.opacity > 0.02;
    }
    // Кадры рисуются по требованию, поэтому затухание обязано само просить
    // следующий кадр — иначе стена застынет полупрозрачной, как только
    // остановится камера.
    if (animating) invalidate();
  });

  if (room.points.length < 3) return null;

  return (
    <group>
      {/* Пол */}
      {floorGeometry && (
        <mesh geometry={floorGeometry} receiveShadow position={[0, 0, 0]}>
          <meshStandardMaterial
            map={floorTexture ?? undefined}
            color="#ffffff"
            roughness={0.72}
            metalness={0}
          />
        </mesh>
      )}

      {/* Плинтус: тонкая тёмная линия на стыке стены и пола. */}
      {boxes.map((box) => (
        <mesh
          key={`skirt-${box.key}`}
          position={[box.position[0], 0.045, box.position[2]]}
          rotation={[0, box.rotationY, 0]}
        >
          <boxGeometry args={[box.size[0], 0.09, box.size[2] + 0.012]} />
          <meshStandardMaterial color="#f2f2f4" roughness={0.6} />
        </mesh>
      ))}

      {/* Стены */}
      {boxes.map((box) => (
        <mesh
          key={box.key}
          ref={(el) => {
            if (el) wallMeshes.current.set(box.key, el);
            else wallMeshes.current.delete(box.key);
          }}
          position={box.position}
          rotation={[0, box.rotationY, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={box.size} />
          <meshStandardMaterial
            color="#f7f7f8"
            roughness={0.94}
            metalness={0}
            transparent
            opacity={1}
            depthWrite
          />
        </mesh>
      ))}

      {/* Остекление и дверные полотна */}
      {frames.map((f) => (
        <mesh key={f.key} position={f.position} rotation={[0, f.rotationY, 0]}>
          <boxGeometry args={f.size} />
          {f.kind === 'window' ? (
            /* Стекло сделано полупрозрачным материалом, а не физическим
               преломлением: `transmission` заставляет three рисовать всю сцену
               ещё раз в отдельный буфер на каждом кадре, а в кадре с окном
               видно ровно то же самое — светлая плоскость с бликом. */
            <meshStandardMaterial
              color="#cfe4f5"
              roughness={0.05}
              metalness={0.1}
              envMapIntensity={1.4}
              transparent
              opacity={0.34}
              depthWrite={false}
            />
          ) : (
            <meshStandardMaterial color="#e9e5dd" roughness={0.7} />
          )}
        </mesh>
      ))}
    </group>
  );
}
