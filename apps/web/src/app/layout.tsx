import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fonglish — Digital interpreter",
  description:
    "Private video with live spoken interpretation (and optional subtitles) for conversations that cross languages.",
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
