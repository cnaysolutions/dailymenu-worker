import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Günün Menüsü | Daily Menu",
  description:
    "AI-powered daily menu with halal dishes — soup, main course, salad, and side. No pork, no alcohol. Yapay zeka ile oluşturulan günlük menü.",
  keywords: ["daily menu", "halal food", "günün menüsü", "helal yemek", "AI menu"],
  openGraph: {
    title: "Günün Menüsü | Daily Menu",
    description: "Fresh halal menu every day — generated with AI",
    type: "website",
    locale: "tr_TR",
    alternateLocale: "en_US",
  },
  robots: "index, follow",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
