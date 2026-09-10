import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

/**
 * Geist ведёт весь интерфейс, Geist Mono — только числа: размеры стен,
 * габариты мебели, координаты. Моноширинный набор здесь не стилистика, а
 * требование: значение в поле не должно прыгать, пока его тянут ползунком.
 *
 * Шрифты подключены через next/font: файлы уезжают в собственную сборку,
 * поэтому нет ни запроса к стороннему домену, ни скачка шрифта при загрузке.
 */
const sans = Geist({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-geist-sans',
  display: 'swap',
});

const mono = Geist_Mono({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Конструктор интерьера BotCraft Design',
  description:
    'Нарисуйте план комнаты по реальным размерам, получите точную 3D-модель и расставьте мебель из каталога. Прямо в браузере.',
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
