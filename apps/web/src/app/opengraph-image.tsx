import { ImageResponse } from "next/og";
import messages from "../../messages/pt-BR.json";

// Static at build time: the card is the same for every locale and environment,
// so it uses the product language rather than the visitor's cookie.
const { name, tagline } = messages.brand;

export const alt = `${name} — ${tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The dark tokens of globals.css. Satori cannot read CSS variables.
const BACKGROUND = "#121019";
const FOREGROUND = "#ecebf4";
const ACCENT = "#8b74ff";

/**
 * Manrope 500, subset to the tagline. Satori reads only ttf, otf and woff, so
 * the font comes from the Google Fonts CSS API, which serves ttf by default.
 */
async function loadManrope(text: string): Promise<ArrayBuffer> {
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=Manrope:wght@500&text=${encodeURIComponent(text)}`,
  ).then((response) => response.text());
  const url = css.match(/src: url\((.+?)\) format\('(?:truetype|opentype)'\)/)?.[1];
  if (!url) throw new Error("Manrope: no ttf in the Google Fonts response");
  return fetch(url).then((response) => response.arrayBuffer());
}

const manrope = await loadManrope(tagline);

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        background: BACKGROUND,
        color: FOREGROUND,
        fontFamily: "Manrope",
      }}
    >
      {/* The logo: symbol 33 beside the drawn ARGON, as in brand-mark.tsx. */}
      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        <svg width="96" height="96" viewBox="0 0 64 64">
          <path fill={FOREGROUND} d="M27.30 5 42.70 5 20.18 58 4.78 58Z" />
          <circle fill={ACCENT} cx="49" cy="48.3" r="10.5" />
        </svg>
        <svg width="348" height="58" viewBox="0 8 264 44">
          <defs>
            <clipPath id="argon-wm-clip">
              <rect x="0" y="10" width="266" height="40" />
            </clipPath>
          </defs>
          <g fill="none" stroke={FOREGROUND} strokeWidth="3.5" strokeLinejoin="miter" strokeMiterlimit="10">
            <g clipPath="url(#argon-wm-clip)">
              <path d="M58.25 11.75H74A9.125 9.125 0 0 1 74 30H60V50" />
              <path d="M68 30 88.7 53" />
              <path fill={FOREGROUND} stroke="none" d="M126.5 10H149.5L146.0 13.5H126.5Z" />
              <path d="M126.5 11.75A18.25 18.25 0 0 0 126.5 48.25H146.75V31H132" />
              <path d="M230 53V10L262 50V7" />
            </g>
            <path d="M4 50 21 10 38 50" />
            <circle cx="190" cy="30" r="18.6" />
          </g>
        </svg>
      </div>

      <div
        style={{ display: "flex", fontSize: 64, fontWeight: 500, lineHeight: 1.1, letterSpacing: -1.6, maxWidth: 960 }}
      >
        {tagline}
      </div>

      <div style={{ display: "flex", width: 160, height: 6, background: ACCENT }} />
    </div>,
    {
      ...size,
      fonts: [{ name: "Manrope", data: manrope, style: "normal", weight: 500 }],
    },
  );
}
