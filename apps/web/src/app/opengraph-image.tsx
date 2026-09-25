import { ImageResponse } from "next/og";
import messages from "../../messages/pt-BR.json";

// Static at build time: the card is the same for every locale and environment,
// so it uses the product language rather than the visitor's cookie.
const { name, tagline } = messages.brand;

export const alt = `${name} — ${tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The dark tokens of globals.css. Satori cannot read CSS variables.
const BACKGROUND = "#0b0b0f";
const FOREGROUND = "#f2f2f5";
const MUTED = "#9b9ba8";
const ACCENT = "#8b74ff";

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
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 120,
          height: 120,
          borderRadius: 24,
          background: FOREGROUND,
          color: BACKGROUND,
          fontSize: 64,
          fontWeight: 700,
        }}
      >
        {name.charAt(0)}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -3 }}>{name}</div>
        <div style={{ fontSize: 40, color: MUTED, maxWidth: 900 }}>{tagline}</div>
      </div>

      <div style={{ display: "flex", width: 160, height: 8, borderRadius: 4, background: ACCENT }} />
    </div>,
    size,
  );
}
