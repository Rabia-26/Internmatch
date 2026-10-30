"use client";
import { useState } from "react";

export function DocumentScanner() {
  const [isAnimating, setIsAnimating] = useState(true);

  return (
    <div className="relative w-full h-64 sm:h-80 md:h-96 flex items-center justify-center">
      <div className="relative w-40 h-48 sm:w-48 sm:h-56 md:w-56 md:h-64 perspective">
        {/* Document 1 */}
        <div className="absolute inset-0 animate-pulse">
          <div className="w-full h-full rounded-lg bg-gradient-to-br from-blue-500/40 to-cyan-500/20 border-2 border-blue-400/50 shadow-lg shadow-blue-500/20 p-4 flex flex-col gap-3">
            <div className="w-3/4 h-3 bg-blue-300/40 rounded"></div>
            <div className="w-full h-2 bg-blue-300/30 rounded"></div>
            <div className="w-5/6 h-2 bg-blue-300/30 rounded"></div>
            <div className="w-1/2 h-2 bg-blue-300/30 rounded"></div>

            {/* Scanning line animation */}
            <div className="absolute inset-0 overflow-hidden rounded-lg">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-scan"></div>
            </div>
          </div>
        </div>

        {/* Floating contradiction badges */}
        <div className="absolute -top-8 -right-8 animate-float-badge-1">
          <div className="bg-red-500/90 text-white text-xs sm:text-sm font-bold px-3 py-1 sm:py-2 rounded-full border border-red-400/50 shadow-lg shadow-red-500/30 flex items-center gap-1 whitespace-nowrap">
            <span>⚠</span>
            <span>Contradiction</span>
          </div>
        </div>

        <div className="absolute top-16 sm:top-20 md:top-24 -right-6 animate-float-badge-2">
          <div className="bg-yellow-500/90 text-white text-xs sm:text-sm font-bold px-3 py-1 sm:py-2 rounded-full border border-yellow-400/50 shadow-lg shadow-yellow-500/30 flex items-center gap-1 whitespace-nowrap">
            <span>⚡</span>
            <span>Inconsistency</span>
          </div>
        </div>

        <div className="absolute bottom-12 sm:bottom-16 -right-10 animate-float-badge-3">
          <div className="bg-red-500/90 text-white text-xs sm:text-sm font-bold px-3 py-1 sm:py-2 rounded-full border border-red-400/50 shadow-lg shadow-red-500/30 flex items-center gap-1 whitespace-nowrap">
            <span>⚠</span>
            <span>Conflict</span>
          </div>
        </div>

        {/* Glow effect */}
        <div className="absolute inset-0 rounded-lg bg-gradient-to-t from-blue-500/10 to-transparent blur-xl -z-10"></div>
      </div>
    </div>
  );
}
