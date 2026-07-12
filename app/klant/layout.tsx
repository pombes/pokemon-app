import { CartProvider } from "@/context/CartContext";

export default function KlantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CartProvider>{children}</CartProvider>;
}
