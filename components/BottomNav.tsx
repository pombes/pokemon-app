"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useCart } from "@/context/CartContext";
import { useT } from "@/context/SettingsContext";

export default function BottomNav() {
  const pathname = usePathname();
  const { items } = useCart();
  const { tr } = useT();
  const cartCount = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <nav
      className="fixed bottom-0 inset-x-0 border-t border-edge bg-surface/90 backdrop-blur-xl z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex w-full max-w-[480px] mx-auto sm:border-x sm:border-edge">
        <NavItem
          href="/zoeken"
          icon="search"
          label={tr("nav_search")}
          active={pathname === "/zoeken"}
        />
        <NavItem
          href="/cart"
          icon="shopping_cart"
          label={tr("nav_deal")}
          active={pathname === "/cart"}
          badge={cartCount}
        />
        <NavItem
          href="/voorraad"
          icon="inventory_2"
          label={tr("nav_stock")}
          active={pathname === "/voorraad"}
        />
        <NavItem
          href="/instellingen"
          icon="settings"
          label={tr("nav_settings")}
          active={pathname === "/instellingen"}
        />
      </div>
    </nav>
  );
}

function NavItem({
  href,
  icon,
  label,
  active,
  badge,
}: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[62px] relative transition-colors duration-200 ${
        active ? "text-gold" : "text-content-dim"
      }`}
    >
      <div
        className={`absolute top-0 left-1/2 -translate-x-1/2 h-[3px] rounded-b-full bg-gold transition-all duration-300 ${
          active ? "w-8 opacity-100 shadow-[0_0_12px_rgba(240,180,64,0.6)]" : "w-0 opacity-0"
        }`}
      />
      <div className={`relative transition-transform duration-200 ${active ? "-translate-y-px" : ""}`}>
        <span className={`ms text-2xl ${active ? "ms-fill" : ""}`}>{icon}</span>
        {badge != null && badge > 0 && (
          <span className="absolute -top-1 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full bg-gold text-base text-[10px] font-extrabold flex items-center justify-center leading-none animate-pop">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </div>
      <span
        className={`text-[11px] tracking-wide ${active ? "font-bold" : "font-medium"}`}
      >
        {label}
      </span>
    </Link>
  );
}
