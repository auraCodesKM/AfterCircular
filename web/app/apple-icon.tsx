import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Same geometry as /public/brand/aftercircular-favicon.svg, rasterised for iOS.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#0a0a0a" }}>
        <svg viewBox="0 0 64 64" width="180" height="180" fill="none">
          <path d="M44 52.78A24 24 0 1 1 55.64 36.17" stroke="#F5F2EC" strokeWidth="6" strokeLinecap="round" />
          <circle cx="51.66" cy="45.77" r="5" fill="#AD314D" />
          <path d="M32 17L44 46H20Z" fill="#F5F2EC" />
        </svg>
      </div>
    ),
    size,
  );
}
