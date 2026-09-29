import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const BASE_CLASSES =
  "rounded-ctl bg-accent px-6 py-3.5 text-base font-medium text-accent-foreground transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

type LinkCta = {
  href: ComponentProps<typeof Link>["href"];
  onClick?: never;
  disabled?: never;
};

type ButtonCta = {
  href?: never;
  onClick: () => void;
  disabled?: boolean;
};

type PrimaryCtaProps = (LinkCta | ButtonCta) & {
  /** Extra layout classes, such as `w-fit` outside a flex row. */
  className?: string;
  children: ReactNode;
};

/**
 * The accent call to action of the full-screen pages: a link when it has an
 * `href`, a button when it has an `onClick`.
 */
export function PrimaryCta({ className, children, ...cta }: PrimaryCtaProps) {
  const classes = className ? `${BASE_CLASSES} ${className}` : BASE_CLASSES;

  if (cta.href !== undefined) {
    return (
      <Link href={cta.href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={cta.onClick}
      disabled={cta.disabled}
      className={`${classes} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {children}
    </button>
  );
}
