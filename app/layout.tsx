import type { Metadata, Viewport } from "next";
import { Newsreader, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
  axes: ["opsz"],
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://stay-dog.vercel.app"),
  title: "Stay — you leave, your voice doesn't",
  description:
    "One in five dogs panics when left alone. Stay listens, waits for the quiet, and answers in your voice — never the same words twice.",
  openGraph: {
    title: "Stay — you leave, your voice doesn't",
    description:
      "Stay listens for your dog, waits for it to settle, and answers in your voice. Never the same words twice.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stay — you leave, your voice doesn't",
    description:
      "Stay listens for your dog, waits for it to settle, and answers in your voice.",
  },
};

export const viewport: Viewport = {
  themeColor: "#15110d",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${plexSans.variable} ${plexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
