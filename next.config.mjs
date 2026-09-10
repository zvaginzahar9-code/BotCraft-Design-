/**
 * Политика безопасности содержимого.
 *
 * Составлена по тому, что приложение действительно использует, а не по
 * шаблону: внешних доменов у проекта нет вовсе — шрифты собираются в бандл
 * через next/font, модели, превью и hero-видео лежат в public/, а к Supabase
 * ходит только сервер, из браузера обращений к базе нет. Поэтому источники
 * ограничены собственным origin.
 *
 * Две поблажки сделаны осознанно:
 *
 *   `'unsafe-inline'` в script-src — Next в App Router встраивает в страницу
 *   инлайновые скрипты потоковой отдачи и гидратации. Альтернатива — nonce,
 *   но он требует middleware на каждый запрос и лишает /editor статической
 *   оптимизации; для проекта такого размера размен невыгодный.
 *
 *   `'wasm-unsafe-eval'` — three.js декодирует сжатую геометрию GLB
 *   WebAssembly-модулем, а инстанцирование WASM без этого источника
 *   запрещено. Это строго уже, чем `'unsafe-eval'`: разрешает только WASM.
 *
 * `blob:` в img-src и worker-src нужен three.js: текстуры и воркеры загрузчика
 * создаются из объектных URL.
 */
const csp = (dev) =>
  [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self'",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // В режиме разработки webpack и React Refresh выполняют код через eval,
    // а HMR держит websocket — в собранном приложении ни того, ни другого нет.
    dev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    // `blob:` обязателен: GLTFLoader выкладывает встроенные в GLB текстуры во
    // временные объектные URL и читает их обратно через fetch. Без него модели
    // грузятся геометрией без материалов.
    dev ? "connect-src 'self' blob: ws: wss:" : "connect-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Драйвер PostgreSQL — нативный модуль с динамическими require (опциональный
   * pg-native, выбор парсеров), поэтому бандлить его в серверный чанк нельзя:
   * он должен грузиться из node_modules как обычный CommonJS-пакет.
   */
  serverExternalPackages: ['pg'],
  transpilePackages: ['three'],

  /**
   * Заголовки безопасности.
   *
   * Strict-Transport-Security намеренно не задаётся здесь: его выставляет сама
   * платформа, и дублировать его конфигурацией приложения значило бы рисковать
   * перезаписать корректное значение более слабым.
   */
  async headers() {
    const dev = process.env.NODE_ENV === 'development';
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp(dev) },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            // Приложению не нужен ни один из этих датчиков и устройств:
            // закрываем их, чтобы встроенный сторонний код не мог их запросить.
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=(), ' +
              'magnetometer=(), gyroscope=(), accelerometer=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
