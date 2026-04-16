import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import Header from "@/shared/layout/Header";
import Footer from "@/shared/layout/Footer";
import Providers from "./_providers/Providers";
import { ToastContainer } from "@/shared/ui/ToastContainer";
import { WalletButton } from "@/domains/account/wallet";
import React from "react";

const inter = Inter({ subsets: ["latin"] });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", weight: ["600"] });

export const metadata: Metadata = {
  title: "PacifiQuant - Perpetuals & Strategies",
  description: "Pacifica-first perpetual trading with cross-DEX strategies.",
  keywords: ["PacifiQuant", "Pacifica", "Perp", "Perpetuals", "Strategies", "Funding Arb"],
  authors: [{ name: "PacifiQuant Team" }],
  icons: {
    icon: "/favicon.ico",
    apple: "/icon-192x192.png",
  },
  manifest: "/manifest.json",
  themeColor: '#070c0f',
  openGraph: {
    title: "PacifiQuant - Perpetuals & Strategies",
    description: "Pacifica-first perpetual trading with cross-DEX strategies.",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "PacifiQuant",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PacifiQuant - Perpetuals & Strategies",
    description: "Pacifica-first perpetual trading with cross-DEX strategies.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const webAppJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "PacifiQuant",
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
    description: "Pacifica-first perpetual trading with cross-DEX strategies.",
  };

  return (
    <html lang="en" className="scroll-smooth bg-dark-navy" style={{ backgroundColor: '#070c0f' }}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppJsonLd) }}
        />
      </head>
      <body className={`${inter.className} ${outfit.variable} bg-dark-navy overflow-x-hidden min-h-screen flex flex-col`}>
        <Providers>
          <Header
            walletComponent={<WalletButton />}
          />
          <main className="pt-16 flex-1">{children}</main>
          <Footer />
          <ToastContainer />
        </Providers>
      </body>
    </html>
  );
}
