"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  getCartItems,
  addCartItem,
  removeCartItem,
  clearCart,
  type CartItem,
} from "@/lib/db";

type CartInput = Omit<CartItem, "id" | "addedAt">;

type CartContextType = {
  items: CartItem[];
  loading: boolean;
  add: (item: CartInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
};

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCartItems()
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  const add = useCallback(async (item: CartInput) => {
    const newItem: CartItem = {
      ...item,
      id: crypto.randomUUID(),
      addedAt: Date.now(),
    };
    await addCartItem(newItem);
    setItems((prev) => [...prev, newItem]);
  }, []);

  const remove = useCallback(async (id: string) => {
    await removeCartItem(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clear = useCallback(async () => {
    await clearCart();
    setItems([]);
  }, []);

  return (
    <CartContext.Provider value={{ items, loading, add, remove, clear }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
