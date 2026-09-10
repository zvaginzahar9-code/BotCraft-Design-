import Link from 'next/link';
import SiteHeader from '@/components/landing/SiteHeader';
import SiteFooter from '@/components/landing/SiteFooter';
import ProjectCard from '@/components/projects/ProjectCard';
import { listProjects } from '@/lib/projects';
import { PlusIcon } from '@/components/ui/icons';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const projects = await listProjects();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto min-h-[70vh] max-w-[1240px] px-5 pt-28 pb-24 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-5 border-b border-hairline pb-7">
          <div>
            <h1 className="text-[clamp(1.9rem,3.6vw,2.6rem)] font-semibold tracking-[-0.035em]">
              Мои проекты
            </h1>
            <p className="mt-2.5 text-[15.5px] text-muted">
              {projects.length
                ? 'Сохранённые комнаты вместе с расставленной мебелью.'
                : 'Здесь появятся комнаты, которые вы сохраните в конструкторе.'}
            </p>
          </div>
          <Link
            href="/editor?new=1"
            className="btn-base btn-primary h-10 px-4 text-[14px] font-semibold"
          >
            <PlusIcon size={15} />
            Новый проект
          </Link>
        </div>

        {projects.length === 0 ? (
          <div className="mt-16 flex flex-col items-center text-center">
            {/* Пустое состояние показывает, что именно появится в списке:
                контур комнаты — то же превью, что будет на карточке. */}
            <svg viewBox="0 0 120 80" className="h-24 w-36 text-line" aria-hidden>
              <path
                d="M18 66 L18 16 L74 16 L74 38 L102 38 L102 66 Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeDasharray="5 5"
              />
            </svg>
            <p className="mt-6 text-[16px] font-medium">Пока пусто</p>
            <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-muted">
              Нарисуйте план комнаты, перейдите в 3D и сохраните проект. Он окажется
              здесь и откроется ровно в том виде, в каком вы его оставили.
            </p>
            <Link
              href="/editor?new=1"
              className="btn-base btn-accent mt-7 h-11 px-6 text-[15px] font-semibold"
            >
              Создать дизайн
            </Link>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
