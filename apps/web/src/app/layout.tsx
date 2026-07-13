import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fonglish — Secure bilingual consultation",
  description:
    "Private video consultation with real-time translated captions for cross-language client meetings.",
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
