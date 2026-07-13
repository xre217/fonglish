import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fonglish — Real-time call subtitles",
  description:
    "1:1 video calls with live bilingual subtitles and real-time translation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
