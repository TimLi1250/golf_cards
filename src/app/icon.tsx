import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{
      alignItems: "center",
      background: "#0b2c24",
      display: "flex",
      height: "100%",
      justifyContent: "center",
      position: "relative",
      width: "100%",
    }}>
      <div style={{
        alignItems: "center",
        background: "#fffdf7",
        border: "28px solid #ddf06a",
        boxShadow: "inset -28px -28px 0 #b7cbbf",
        display: "flex",
        fontFamily: "monospace",
        fontSize: 188,
        fontWeight: 900,
        height: 350,
        justifyContent: "center",
        letterSpacing: -24,
        width: 350,
      }}>G</div>
    </div>,
    size,
  );
}
