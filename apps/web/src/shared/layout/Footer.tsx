"use client";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-dark-navy border-t border-gray-800 py-6">
      <div className="w-full px-4 md:px-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="text-white font-semibold tracking-wide">PacifiQuant</span>
            <span className="text-gray-500 text-sm hidden sm:inline">|</span>
            <span className="text-gray-500 text-sm hidden sm:inline">Pacifica-first Perp Hub</span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-500">
            <span>&copy; {currentYear} PacifiQuant</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
