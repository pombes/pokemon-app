"use client";

import { useEffect, type ReactNode } from "react";

/**
 * Bottom sheet — the app's modal pattern. Slides up over a dimmed backdrop.
 * One-handed friendly: actions live at the bottom of the screen.
 */
export default function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px] animate-fade"
      />
      <div className="absolute inset-x-0 bottom-0 animate-sheet">
        <div className="bg-surface-raised border-t border-x border-edge-bright rounded-t-[26px] px-5 pt-3 pb-8 max-h-[85dvh] overflow-y-auto shadow-[0_-12px_48px_rgba(0,0,0,0.6)]">
          {/* Grabber */}
          <div className="w-10 h-1 rounded-full bg-edge-bright mx-auto mb-4" />
          {title && (
            <h2 className="text-[20px] font-extrabold tracking-tight text-content mb-4">
              {title}
            </h2>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
