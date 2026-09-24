import type { ReactNode } from "react";

/** The one h1 style of the full-screen pages. */
export function PageHeading({ children }: { children: ReactNode }) {
  return (
    <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
      {children}
    </h1>
  );
}
