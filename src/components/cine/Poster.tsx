import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

function tone(title: string): number {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) % 4;
  return Math.abs(hash);
}

export function Poster({
  src,
  title,
  className,
  eager,
  decorative,
  focus,
}: {
  src: string | null;
  title: string;
  className?: string;
  eager?: boolean;
  decorative?: boolean;
  focus?: "left" | "center" | "right" | "top";
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const visible = Boolean(src) && !failed;

  return (
    <div className={cn("relative overflow-hidden bg-bg", className)}>
      {visible ? (
        <img
          src={src ?? undefined}
          alt={decorative ? "" : `${title} poster`}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onError={() => setFailed(true)}
          className={cn("framed h-full w-full object-cover", focus && `still-${focus}`)}
        />
      ) : (
        <div className={cn("poster-fallback", `poster-fallback-${tone(title)}`)}>
          <span className="px-3 text-center text-sm font-medium text-balance text-fg">{title}</span>
        </div>
      )}
    </div>
  );
}
