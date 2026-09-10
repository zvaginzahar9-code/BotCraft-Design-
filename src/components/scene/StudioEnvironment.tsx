'use client';

import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Освещение на основе изображения, генерируемое прямо в процессе.
 *
 * `<Environment preset>` из drei скачивает HDRI с CDN, а зависеть от него у
 * приложения нет причин: RoomEnvironment из three — это маленькая процедурная
 * студия, которую мы один раз предфильтруем в PMREM-кубкарту. Она даёт
 * материалам мебели правдоподобные отражения без единого сетевого запроса и без
 * ассета, который пришлось бы возить с собой.
 */
export default function StudioEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const envMap = pmrem.fromScene(room, 0.04).texture;
    scene.environment = envMap;
    scene.environmentIntensity = 0.75;

    return () => {
      scene.environment = null;
      envMap.dispose();
      pmrem.dispose();
      room.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => m?.dispose());
        }
      });
    };
  }, [gl, scene]);

  return null;
}
