import { useTranslations } from "next-intl";
import { useId } from "react";

/**
 * Sizes from the prototype: `md` in the header (symbol 28 px, ARGON 17 px),
 * `sm` in the footer (20 px / 13 px) and `lg` on the full-screen pages, which
 * have no header.
 */
const SIZES = {
  sm: { symbol: "size-5", wordmark: "h-[13px]" },
  md: { symbol: "size-7", wordmark: "h-[17px]" },
  lg: { symbol: "size-10 sm:size-12", wordmark: "h-6 sm:h-[29px]" },
} as const;

type BrandMarkProps = {
  size?: keyof typeof SIZES;
};

/**
 * The Argon logo: symbol 33 (mirrored dot) beside the drawn ARGON. The blade
 * and the name follow the text color; the dot is the only lilac part.
 */
export function BrandMark({ size = "lg" }: BrandMarkProps) {
  const t = useTranslations("brand");
  const classes = SIZES[size];

  return (
    <span role="img" aria-label={t("name")} className="inline-flex w-fit shrink-0 items-center gap-3 select-none">
      <BrandSymbol className={classes.symbol} />
      <BrandWordmark className={classes.wordmark} />
    </span>
  );
}

function BrandSymbol({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" className={`shrink-0 ${className}`}>
      <path className="fill-current" d="M27.30 5 42.70 5 20.18 58 4.78 58Z" />
      <circle className="fill-accent" cx="49" cy="48.3" r="10.5" />
    </svg>
  );
}

/** ARGON is drawn with strokes, not set in a font. */
function BrandWordmark({ className }: { className: string }) {
  // The clip squares off the stroke ends at the baseline and cap height. Its id
  // must be unique because the logo can appear more than once on a page.
  const clipId = `argon-wm-clip-${useId()}`;

  return (
    <svg
      viewBox="0 8 264 44"
      aria-hidden="true"
      focusable="false"
      className={`aspect-[6/1] w-auto shrink-0 ${className}`}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="10" width="266" height="40" />
        </clipPath>
      </defs>
      <g fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="miter" strokeMiterlimit="10">
        <g clipPath={`url(#${clipId})`}>
          <path d="M58.25 11.75H74A9.125 9.125 0 0 1 74 30H60V50" />
          <path d="M68 30 88.7 53" />
          <path fill="currentColor" stroke="none" d="M126.5 10H149.5L146.0 13.5H126.5Z" />
          <path d="M126.5 11.75A18.25 18.25 0 0 0 126.5 48.25H146.75V31H132" />
          <path d="M230 53V10L262 50V7" />
        </g>
        <path d="M4 50 21 10 38 50" />
        <circle cx="190" cy="30" r="18.6" />
      </g>
    </svg>
  );
}
