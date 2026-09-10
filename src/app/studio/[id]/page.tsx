import { notFound, redirect } from 'next/navigation';
import StudioClient from '@/components/studio/StudioClient';
import { getProject } from '@/lib/projects';
import { DEFAULT_WALL_THICKNESS } from '@/lib/geometry';

export const dynamic = 'force-dynamic';

export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  // Сохранённая геометрия — единственный источник правды для 3D-комнаты,
  // поэтому сцена полностью восстанавливается из БД после перезагрузки.
  const saved = project.roomGeometry;
  // Строить комнату не из чего — отправляем пользователя рисовать её заново,
  // вместо того чтобы бросать в пустой вьюпорт.
  if (!saved.points || saved.points.length < 3) redirect('/editor');

  const room = {
    ...saved,
    openings: saved.openings ?? [],
    wallThickness: saved.wallThickness ?? DEFAULT_WALL_THICKNESS,
    wallHeight: project.wallHeight,
  };

  return (
    <StudioClient
      projectId={project.id}
      projectName={project.name}
      room={room}
      placements={project.placements.map((p) => ({
        uid: `p_${p.id}`,
        furnitureId: p.furnitureId,
        position: p.position,
        rotationY: p.rotationY,
        scale: p.scale,
      }))}
    />
  );
}
