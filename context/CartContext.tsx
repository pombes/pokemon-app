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
  getParkedDeals,
  addParkedDeal,
  removeParkedDeal,
  type CartItem,
  type ParkedDeal,
} from "@/lib/db";

type CartInput = Omit<CartItem, "id" | "addedAt">;

/** The one reversible thing the vendor did last — powers "undo". */
type LastAction =
  | { kind: "add"; id: string; qty: number }
  | { kind: "qty"; id: string; delta: number }
  | { kind: "remove"; item: CartItem };

type CartContextType = {
  items: CartItem[];
  loading: boolean;
  canUndo: boolean;
  parked: ParkedDeal[];
  add: (item: CartInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  updateQty: (id: string, delta: number) => Promise<void>;
  undo: () => Promise<void>;
  clear: () => Promise<void>;
  park: () => Promise<void>;
  resume: (id: string) => Promise<void>;
  discardParked: (id: string) => Promise<void>;
};

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [parked, setParked] = useState<ParkedDeal[]>([]);

  useEffect(() => {
    getCartItems()
      .then(setItems)
      .finally(() => setLoading(false));
    getParkedDeals().then(setParked).catch(() => {});
  }, []);

  const add = useCallback(
    async (item: CartInput) => {
      // Same card, condition, type and price → bump quantity, don't duplicate
      const match = items.find(
        (i) =>
          i.cardId === item.cardId &&
          i.cardName === item.cardName &&
          i.condition === item.condition &&
          i.type === item.type &&
          Math.abs(i.correctedPrice - item.correctedPrice) < 0.005
      );
      if (match) {
        const updated = { ...match, quantity: match.quantity + item.quantity };
        await addCartItem(updated);
        setItems((prev) => prev.map((i) => (i.id === match.id ? updated : i)));
        setLastAction({ kind: "add", id: match.id, qty: item.quantity });
        return;
      }
      const newItem: CartItem = {
        ...item,
        id: crypto.randomUUID(),
        addedAt: Date.now(),
      };
      await addCartItem(newItem);
      setItems((prev) => [...prev, newItem]);
      setLastAction({ kind: "add", id: newItem.id, qty: newItem.quantity });
    },
    [items]
  );

  /** Change quantity by delta; removes the row when it hits 0. */
  const applyQtyChange = useCallback(
    async (id: string, delta: number) => {
      const item = items.find((i) => i.id === id);
      if (!item) return;
      const newQty = item.quantity + delta;
      if (newQty <= 0) {
        await removeCartItem(id);
        setItems((prev) => prev.filter((i) => i.id !== id));
      } else {
        const updated = { ...item, quantity: newQty };
        await addCartItem(updated);
        setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
      }
    },
    [items]
  );

  const updateQty = useCallback(
    async (id: string, delta: number) => {
      const item = items.find((i) => i.id === id);
      if (!item) return;
      await applyQtyChange(id, delta);
      // If the change removed the row, undo must restore the whole item
      if (item.quantity + delta <= 0) {
        setLastAction({ kind: "remove", item });
      } else {
        setLastAction({ kind: "qty", id, delta });
      }
    },
    [applyQtyChange, items]
  );

  const remove = useCallback(
    async (id: string) => {
      const item = items.find((i) => i.id === id);
      await removeCartItem(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      if (item) setLastAction({ kind: "remove", item });
    },
    [items]
  );

  const undo = useCallback(async () => {
    if (!lastAction) return;
    if (lastAction.kind === "add") {
      await applyQtyChange(lastAction.id, -lastAction.qty);
    } else if (lastAction.kind === "qty") {
      // Row may have been deleted at qty 0 — restore is handled by re-adding
      const exists = items.some((i) => i.id === lastAction.id);
      if (exists) {
        await applyQtyChange(lastAction.id, -lastAction.delta);
      }
    } else {
      await addCartItem(lastAction.item);
      setItems((prev) => [...prev, lastAction.item]);
    }
    setLastAction(null);
  }, [lastAction, applyQtyChange, items]);

  const clear = useCallback(async () => {
    await clearCart();
    setItems([]);
    setLastAction(null);
  }, []);

  /** Park the whole cart: customer walks away, next customer steps up. */
  const park = useCallback(async () => {
    if (items.length === 0) return;
    const deal: ParkedDeal = {
      id: crypto.randomUUID(),
      items,
      createdAt: Date.now(),
    };
    await addParkedDeal(deal);
    await clearCart();
    setItems([]);
    setParked((prev) => [deal, ...prev]);
    setLastAction(null);
  }, [items]);

  /** Bring a parked deal back into the cart (added to whatever is there). */
  const resume = useCallback(async (id: string) => {
    const deal = (await getParkedDeals()).find((d) => d.id === id);
    if (!deal) return;
    for (const item of deal.items) {
      await addCartItem(item);
    }
    await removeParkedDeal(id);
    setItems((prev) => {
      const existing = new Set(prev.map((i) => i.id));
      return [...prev, ...deal.items.filter((i) => !existing.has(i.id))];
    });
    setParked((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const discardParked = useCallback(async (id: string) => {
    await removeParkedDeal(id);
    setParked((prev) => prev.filter((d) => d.id !== id));
  }, []);

  return (
    <CartContext.Provider
      value={{
        items,
        loading,
        canUndo: lastAction !== null,
        parked,
        add,
        remove,
        updateQty,
        undo,
        clear,
        park,
        resume,
        discardParked,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
