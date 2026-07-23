import BottomNav from "@/components/BottomNav";
import { CartProvider } from "@/context/CartContext";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CartProvider>
      <div className="flex flex-col min-h-dvh bg-base">
        {/* Phone-frame width on desktop; full width on mobile. The subtle
            side borders make the column read as a deliberate device frame
            instead of content floating in the void. */}
        <main className="flex-1 pb-[76px] w-full max-w-[480px] mx-auto sm:border-x sm:border-edge">
          {children}
        </main>
        <BottomNav />
      </div>
    </CartProvider>
  );
}
