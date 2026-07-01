import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShiftKing App Store Screenshots",
  description: "Design and export App Store screenshots for ShiftKing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
