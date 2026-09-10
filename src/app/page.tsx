import SiteHeader from '@/components/landing/SiteHeader';
import ScrollVideoHero from '@/components/landing/ScrollVideoHero';
import SmoothScroll from '@/components/landing/SmoothScroll';
import SiteFooter from '@/components/landing/SiteFooter';
import Process from '@/components/landing/sections/Process';
import Capabilities from '@/components/landing/sections/Capabilities';
import Constructor from '@/components/landing/sections/Constructor';
import Catalog, { type ShowcaseItem } from '@/components/landing/sections/Catalog';
import FinalCta from '@/components/landing/sections/FinalCta';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Лендинг.
 *
 * Страница открывается hero-видео, привязанным к скроллу: за десять секунд
 * ролик показывает весь продукт, а заголовок с кнопкой лежат поверх первого,
 * ещё пустого кадра. Дальше идут четыре блока — порядок работы, возможности,
 * каталог и сам 3D-конструктор — и закрывающий призыв на чернилах.
 *
 * Данные каталога приходят прямо из БД: и витрина, и фильтр, и иллюстрации
 * шагов показывают те же модели, что загружаются в сцену студии. Заглушек на
 * странице нет.
 */
export default async function HomePage() {
  const items = await query<ShowcaseItem>(
    `SELECT id, name, category, thumbnail_path, width, depth, height
     FROM furniture WHERE thumbnail_path <> '' ORDER BY category, name`,
  );

  // COUNT возвращает bigint, драйвер отдал бы его строкой — приводим к int.
  const [{ n: total }] = await query<{ n: number }>('SELECT COUNT(*)::int AS n FROM furniture');

  /**
   * Превью для иллюстрации третьего шага.
   *
   * Список имён — это курирование, а не данные: на изометрии размером в
   * ладонь предмет должен читаться силуэтом, поэтому чёрный круглый диван или
   * зеркало там смотрятся пятном. Если названия в базе поменяются, берём
   * первое, что нашлось в подходящей категории.
   */
  const preferred = ['Диван Cloud', 'Кресло Boucle', 'Столик Round Oak'];
  const fallbackCategories = ['Диваны', 'Стулья', 'Столы'];
  const stepThumbs = preferred
    .map(
      (name, i) =>
        (items.find((it) => it.name === name) ??
          items.find((it) => it.category === fallbackCategories[i]))?.thumbnail_path,
    )
    .filter(Boolean) as string[];

  return (
    <>
      {/* Забирает себе скроллер документа на этой странице; герой отображает
          его сглаженную позицию на таймлайн видео. */}
      <SmoothScroll />
      <SiteHeader />
      <main>
        <ScrollVideoHero />

        <Process thumbs={stepThumbs} />
        <Capabilities thumbs={items.slice(0, 6).map((i) => i.thumbnail_path)} />
        <Catalog items={items} total={total} />
        <Constructor shot="/shots/studio.png" />
        <FinalCta />
      </main>

      <SiteFooter />
    </>
  );
}
