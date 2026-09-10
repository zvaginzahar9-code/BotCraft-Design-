import { NextResponse } from 'next/server';
import { createProject, listProjects } from '@/lib/projects';
import { isValidRoom } from '@/lib/geometry';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ projects: await listProjects() });
}

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 });
  }

  if (!isValidRoom(body?.roomGeometry)) {
    return NextResponse.json(
      { error: 'Комната должна быть замкнутой и содержать минимум 3 точки' },
      { status: 400 },
    );
  }

  const project = await createProject({
    name: body.name,
    roomGeometry: body.roomGeometry,
    wallHeight: body.wallHeight,
    placements: Array.isArray(body.placements) ? body.placements : [],
  });

  return NextResponse.json({ project }, { status: 201 });
}
