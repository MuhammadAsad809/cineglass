import type { ReactNode } from "react";
import { MovieCard } from "@/components/cine/MovieCard";
import type { Title } from "@/lib/cine/types";

export function MovieGrid({
  heading,
  subtitle,
  titles,
  action,
}: {
  heading: string;
  subtitle: string;
  titles: Title[];
  action?: ReactNode;
}) {
  return (
    <section className="mx-auto mt-10 w-full max-w-6xl px-3">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{heading}</h2>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>
        {action}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 md:grid-cols-4 lg:grid-cols-6">
        {titles.map((title) => (
          <MovieCard key={title.id} title={title} />
        ))}
      </div>
    </section>
  );
}

export function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} className="skeleton aspect-poster rounded-2xl" />
      ))}
    </div>
  );
}
