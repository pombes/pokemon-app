"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animate a number towards `target` (~400ms ease-out-expo).
 * Used for price displays so bids "tick" to their new value like a board.
 */
export function useCountUp(target: number, duration = 400): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(2, -10 * t); // ease-out-expo
      const current = from + (target - from) * (t >= 1 ? 1 : eased);
      setValue(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      fromRef.current = target;
    };
  }, [target, duration]);

  return value;
}
