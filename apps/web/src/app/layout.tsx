import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fonglish — Bilingual consultation",
  description:
    "Private video with live translated captions for conversations that cross languages.",
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
