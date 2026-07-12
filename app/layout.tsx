import type { Metadata, Viewport } from "next";
import { Barlow, Spline_Sans_Mono } from "next/font/google";
import { SettingsProvider } from "@/context/SettingsContext";
import "./globals.css";

const barlow = Barlow({
  subsets: ["latin"],
  variable: "--font-barlow",
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

const splineMono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-spline-mono",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "CardPit",
  description: "Mobiele POS voor TCG-handelaren op beurzen",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CardPit",
  },
};

export const viewport: Viewport = {
  themeColor: "#0C0B09",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="nl"
      className={`${barlow.variable} ${splineMono.variable} h-full`}
    >
      <body className="bg-base text-content font-sans antialiased min-h-dvh">
        <SettingsProvider>{children}</SettingsProvider>
      </body>
    </html>
  );
}
