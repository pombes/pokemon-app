"use client";

import type { Condition } from "@/lib/db";

export const CONDITIONS: Condition[] = [
  "MT",
  "NM",
  "EX",
  "GD",
  "LP",
  "PL",
  "PO",
];

interface Props {
  selected: Condition;
  onChange: (c: Condition) => void;
}

export default function ConditionButtons({ selected, onChange }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
      {CONDITIONS.map((c) => {
        const active = c === selected;
        return (
          <button
            key={c}
            onClick={() => onChange(c)}
            className={`press min-w-[54px] h-[50px] flex-none rounded-2xl font-mono text-[16px] font-semibold border transition-colors duration-150 ${
              active
                ? "bg-gold border-gold-bright text-base shadow-[0_0_22px_rgba(240,180,64,0.35)]"
                : "ticket border-edge text-content-dim"
            }`}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}
