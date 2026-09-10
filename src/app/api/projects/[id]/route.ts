import { NextResponse } from 'next/server';
import { deleteProject, getProject, updateProject } from '@/lib/projects';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: 'Проект не найден' }, { status: 404 });
  return NextResponse.json({ project });
}

export async function PUT(request: Request, { params }: Ctx) {
  const { id } = await params;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 });
  }

  const project = await updateProject(id, {
    name: body.name,
    roomGeometry: body.roomGeometry,
    wallHeight: body.wallHeight,
    placements: Array.isArray(body.placements) ? body.placements : undefined,
  });

  if (!project) return NextResponse.json({ error: 'Проект не найден' }, { status: 404 });
  return NextResponse.json({ project });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!(await deleteProject(id))) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
