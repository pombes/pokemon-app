"use client";

import { fmt } from "@/lib/format";
import { useCountUp } from "@/hooks/useCountUp";
import { useT } from "@/context/SettingsContext";

interface Props {
  cashBid: number;
  tradeBid: number;
}

export default function BidDisplay({ cashBid, tradeBid }: Props) {
  const { tr } = useT();
  const cash = useCountUp(cashBid);
  const trade = useCountUp(tradeBid);

  return (
    <div className="flex gap-3">
      <div className="flex-1 relative overflow-hidden rounded-[20px] border border-gold/30 bg-gradient-to-b from-gold/12 to-gold/4 p-4">
        <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-gold/10 blur-2xl" />
        <div className="flex items-center gap-2 text-gold">
          <span className="ms ms-fill text-[18px]">payments</span>
          <span className="text-[13px] font-bold uppercase tracking-[0.08em]">
            {tr("cash_bid")}
          </span>
        </div>
        <div className="mt-2.5 font-mono font-bold text-[26px] tracking-tight text-gold-bright leading-none tabular-nums">
          {fmt(cash)}
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden rounded-[20px] border border-trade/30 bg-gradient-to-b from-trade/12 to-trade/4 p-4">
        <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-trade/10 blur-2xl" />
        <div className="flex items-center gap-2 text-trade">
          <span className="ms ms-fill text-[18px]">swap_horiz</span>
          <span className="text-[13px] font-bold uppercase tracking-[0.08em]">
            {tr("trade_bid")}
          </span>
        </div>
        <div className="mt-2.5 font-mono font-bold text-[26px] tracking-tight text-trade leading-none tabular-nums">
          {fmt(trade)}
        </div>
      </div>
    </div>
  );
}
