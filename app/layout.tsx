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

/**
 * One in six, not one in five. The survey puts separation anxiety at 17.2%,
 * and this string is the one most people read — it is what a shared link
 * shows — so it is the last place a rounded-down number should survive.
 */
const DESCRIPTION =
  "One dog in six panics when left alone. Stay listens, waits for the quiet, and answers in your voice — never the same words twice.";

export const metadata: Metadata = {
  metadataBase: new URL("https://stay-swart.vercel.app"),
  title: "Stay — you leave, your voice doesn't",
  description: DESCRIPTION,
  openGraph: {
    title: "Stay — you leave, your voice doesn't",
    description: DESCRIPTION,
    type: "website",
    siteName: "Stay",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stay — you leave, your voice doesn't",
    description: DESCRIPTION,
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
