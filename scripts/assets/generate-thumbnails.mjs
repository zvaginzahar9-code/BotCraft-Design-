/**
 * Рендерит превью каталога для каждой оптимизированной GLB.
 *
 * Исходные модели поставляются без картинок предпросмотра, поэтому мы рендерим
 * их сами тем же стеком, что использует приложение (three.js + WebGL), а не
 * подставляем стоковые фото: так каждое превью гарантированно показывает
 * ровно тот меш, который загрузит каталог.
 *
 * Headless Chromium (Chrome или Edge — что установлено) рендерит каждую модель
 * в нейтральной студии на прозрачном фоне, после чего sharp уменьшает результат
 * до WebP.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { root } from '../lib/paths.mjs';
import { findBrowser } from '../lib/browser.mjs';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const MODELS = path.join(root, 'public', 'models');
const OUT = path.join(root, 'public', 'thumbs');
const PORT = 4599;
const RENDER_SIZE = 768;
const THUMB_SIZE = 384;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.json': 'application/json',
};

function startServer() {
  const server = http.createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(root, url);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

const PAGE = /* html */ `
<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:transparent;overflow:hidden}
  canvas{display:block}
</style></head><body>
<script type="importmap">
{"imports":{
  "three":"/node_modules/three/build/three.module.js",
  "three/addons/":"/node_modules/three/examples/jsm/"
}}
</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const SIZE = ${RENDER_SIZE};
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(SIZE, SIZE);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const scene = new THREE.Scene();
scene.environment = envMap;
scene.background = null;

const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(3, 5, 4);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.6);
fill.position.set(-4, 2, -3);
scene.add(fill);
scene.add(new THREE.AmbientLight(0xffffff, 0.35));

const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

let current = null;

function disposeCurrent() {
  if (!current) return;
  current.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        for (const k of Object.keys(m)) {
          const v = m[k];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    }
  });
  scene.remove(current);
  current = null;
}

window.renderModel = async (url) => {
  disposeCurrent();
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  scene.add(model);
  current = model;

  // Кадрируем модель в фиксированном ракурсе «три четверти», чтобы весь каталог
  // читался как единый набор предметных снимков.
  const radius = size.length() / 2;
  const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.12;
  const dir = new THREE.Vector3(0.72, 0.5, 1).normalize();
  camera.position.copy(dir.multiplyScalar(dist));
  camera.lookAt(0, 0, 0);
  camera.near = Math.max(dist - radius * 3, 0.01);
  camera.far = dist + radius * 4;
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  return {
    png: renderer.domElement.toDataURL('image/png'),
    size: [size.x, size.y, size.z],
  };
};

window.__ready = true;
</script></body></html>
`;

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(root, '.thumb-render.html'), PAGE);

  const server = await startServer();
  const executablePath = await findBrowser();
  console.log(`renderer: ${path.basename(executablePath)}`);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
      `--window-size=${RENDER_SIZE},${RENDER_SIZE}`,
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: RENDER_SIZE, height: RENDER_SIZE });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`http://localhost:${PORT}/.thumb-render.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__ready === true', { timeout: 60000 });

  const files = (await fs.readdir(MODELS)).filter((f) => f.endsWith('.glb')).sort();
  const dimensions = {};

  for (const file of files) {
    const id = path.basename(file, '.glb');
    const outPath = path.join(OUT, `${id}.webp`);
    try {
      const result = await page.evaluate(
        (u) => window.renderModel(u),
        `http://localhost:${PORT}/public/models/${file}`,
      );
      const buf = Buffer.from(result.png.split(',')[1], 'base64');
      await sharp(buf)
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 88 })
        .toFile(outPath);
      dimensions[id] = result.size.map((v) => +v.toFixed(4));
      console.log(`ok  ${id}`);
    } catch (err) {
      console.error(`err ${id}: ${err.message}`);
    }
  }

  await fs.writeFile(
    path.join(root, 'assets', 'model-bounds.json'),
    JSON.stringify(dimensions, null, 2),
  );

  await browser.close();
  server.close();
  await fs.unlink(path.join(root, '.thumb-render.html')).catch(() => {});
  console.log(`\n${Object.keys(dimensions).length}/${files.length} thumbnails written to public/thumbs/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
