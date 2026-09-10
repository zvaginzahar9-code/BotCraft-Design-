/**
 * Иконки продукта.
 *
 * Один набор (Phosphor) на лендинг, редактор плана и студию: одна сетка, одна
 * толщина штриха, один визуальный вес. Рисовать пути руками нельзя — иначе
 * через неделю в интерфейсе окажется шесть разных «крестиков».
 *
 * Реэкспорт собран поимённо, а не через `export *`: так в бандл попадают
 * только те иконки, которые действительно используются, и заодно виден весь
 * словарь интерфейса в одном файле.
 */
export {
  // навигация и действия
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  CheckIcon,
  CopyIcon,
  FloppyDiskIcon,
  ListIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  TrashIcon,
  WarningIcon,
  XIcon,

  // редактор плана
  PolygonIcon,
  CursorClickIcon,
  DoorOpenIcon,
  FrameCornersIcon,
  RulerIcon,
  CornersOutIcon,

  // 3D-студия
  ArrowsOutCardinalIcon,
  ArrowClockwiseIcon,
  ArrowsVerticalIcon,
  ArrowLineDownIcon,
  ResizeIcon,
  CubeIcon,
  CubeFocusIcon,
  ArmchairIcon,
  MagnetIcon,
  SlidersHorizontalIcon,
  SquaresFourIcon,
} from '@phosphor-icons/react/dist/ssr';

export type { IconProps } from '@phosphor-icons/react/dist/lib/types';
