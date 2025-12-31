import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const sans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Year Review Coach",
  description: "Voice-first annual review partner that keeps you moving forward."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={sans.variable}>
        <div className="app-shell">{children}</div>
      </body>
    </html>
  );
}
