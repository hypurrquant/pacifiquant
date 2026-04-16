"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

interface HeaderProps {
  walletComponent?: React.ReactNode;
  mobileExtra?: React.ReactNode;
}

export default function Header({ walletComponent, mobileExtra }: HeaderProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? "bg-dark-navy backdrop-blur-lg"
          : "bg-transparent"
      }`}
    >
      <nav className="w-full px-4 md:px-8 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 flex-shrink-0">
              <span className="font-[var(--font-outfit)] text-lg font-semibold tracking-wide text-white">
                PacifiQuant
                <sup className="text-[10px] font-normal text-primary/70 ml-0.5 -top-2 relative">beta</sup>
              </span>
            </Link>

            <nav className="hidden lg:flex items-center gap-1">
              <Link href="/perp" className="px-3 py-2 text-sm font-medium text-gray-400 hover:text-primary transition-colors whitespace-nowrap">
                Perp
              </Link>
              <Link href="/strategies" className="px-3 py-2 text-sm font-medium text-gray-400 hover:text-primary transition-colors whitespace-nowrap">
                Strategies
              </Link>
            </nav>
          </div>

          <div className="hidden lg:flex items-center gap-4 flex-shrink-0">
            {walletComponent}
          </div>

          <div className="lg:hidden flex items-center gap-2">
            {walletComponent}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="text-white p-2"
            >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isMobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
            </button>
          </div>
        </div>

        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="lg:hidden mt-4 overflow-hidden"
            >
              <div className="bg-dark-800 rounded-xl p-4 space-y-4">
                <div className="flex flex-col gap-2 pb-4 border-b border-gray-700">
                  <Link href="/perp" className="text-gray-300 hover:text-primary transition-colors py-2 px-4 rounded-lg hover:bg-dark-700 text-center" onClick={() => setIsMobileMenuOpen(false)}>
                    Perp
                  </Link>
                  <Link href="/strategies" className="text-gray-300 hover:text-primary transition-colors py-2 px-4 rounded-lg hover:bg-dark-700 text-center" onClick={() => setIsMobileMenuOpen(false)}>
                    Strategies
                  </Link>
                </div>
                {mobileExtra && (
                  <div className="flex items-center justify-center pb-4 border-b border-gray-700">
                    {mobileExtra}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>
    </header>
  );
}
