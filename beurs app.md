# Beurs-Kassa — Claude Code Project Spec

## What we are building

A Progressive Web App (PWA) for TCG (Trading Card Game) vendors at European card fairs (beurzen). The app replaces the current workflow of: phone → Cardmarket → calculator → eBay → repeat — for every single card a vendor wants to buy, sell or trade. Everything under one roof, fast, at a busy table.

**Target user:** a vendor standing at a table at a Pokémon/TCG fair in the Netherlands/Belgium/Germany. They are on Android. They have customers waiting. Speed and simplicity are everything.

**Primary market:** Dutch/Belgian/German beurs-vendors. Language of the app: Dutch (UI labels, buttons, etc. in Dutch). 

---

## Tech Stack

- **Framework:** Next.js (App Router)
- **Database:** Supabase (Postgres + Realtime)
- **Styling:** Tailwind CSS
- **PWA:** next-pwa or built-in Next.js PWA support
- **Deployment:** Vercel
- **Platform target:** Android Chrome first (PWA install, camera access, later Web Bluetooth for label printing)

---

## Critical Architecture Rule: Offline-First

**This is not optional and cannot be added later — it determines the architecture from day 1.**

Card fair halls often have poor or no mobile signal. An app that crashes when signal drops is dead at a busy table.

- Store all vendor settings, cart state, and transactions in **IndexedDB locally first**
- Cache every price lookup locally with a timestamp (show "prijs van 2u geleden" if offline)
- Sync to Supabase in the background when connection is available
- The calculator and cart must work 100% offline — only live price fetching requires internet
- If a card has never been looked up and there is no connection: allow the vendor to manually enter a price (this is already a feature — the custom price override)

Use a service worker for offline caching of the app shell.

---

## API Key Setup (do this before writing code)

### Price Data: pokemon-api.com via RapidAPI

1. Sign up at rapidapi.com
2. Find "Pokemon TCG API" by provider **tcggopro**
3. Subscribe to the free Basic tier (100 req/day)
4. Store the key as `RAPIDAPI_KEY` in `.env.local`

**IMPORTANT — build the price fetch as a standalone, swappable module** (`/lib/priceService.ts`). This provider may change or break. The rest of the app must never call the API directly — always go through this service. If the provider changes, only this file needs updating.

The API returns Cardmarket EUR prices: `trendPrice`, `averageSellPrice`, `lowPrice`, `avg1`, `avg7`, `avg30`. Always use `trendPrice` as the base price shown to the vendor.

**Caching rule:** Before making an API call, check IndexedDB for a cached price for this card_id. If it exists and is less than 4 hours old, use the cache. Only call the API if cache is stale or missing. This keeps daily requests well within the free tier.

### Card Scanning (optional, add after core flow works): Ximilar

- Sign up at ximilar.com — free plan with monthly credits
- Use ONLY the card identification endpoint (which card is this), NOT the grading/centering endpoints
- Result: card name + set → auto-fills the search field → vendor confirms → rest of flow continues as normal
- Manual search is ALWAYS available as fallback — scanner is a bonus, not a dependency
- Store key as `XIMILAR_KEY` in `.env.local`

---

## Supabase Schema

Create these tables in Supabase:

```sql
-- Vendor settings (one row per vendor account)
create table vendor_settings (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references auth.users(id),
  cash_percentage integer default 60,
  trade_percentage integer default 75,
  condition_multipliers jsonb default '{
    "MT": 100, "NM": 100, "EX": 80,
    "GD": 65, "LP": 50, "PL": 35, "PO": 20
  }',
  language text default 'nl',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Price lookups log (for building our own price history over time)
create table price_lookups (
  id uuid primary key default gen_random_uuid(),
  card_id text not null,
  card_name text not null,
  card_set text,
  trend_price numeric,
  avg7 numeric,
  avg30 numeric,
  vendor_id uuid references auth.users(id),
  looked_up_at timestamptz default now()
);

-- Inventory (fase 2 — define now, use in fase 2)
create table inventory (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references auth.users(id),
  card_id text not null,
  card_name text not null,
  card_set text,
  card_image_url text,
  condition text not null,
  is_holo boolean default false,
  is_foil boolean default false,
  quantity integer default 1,
  purchase_price numeric not null,
  purchased_at timestamptz default now(),
  notes text
);

-- Transactions (fase 2)
-- DO NOT store profit as a column — calculate it in queries as sell_price - purchase_price
create table transactions (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references auth.users(id),
  type text not null check (type in ('buy', 'sell', 'trade')),
  card_id text not null,
  card_name text not null,
  card_set text,
  condition text,
  quantity integer default 1,
  market_price_at_time numeric,
  purchase_price numeric,
  sell_price numeric,
  payment_method text check (payment_method in ('cash', 'tikkie', 'pin', 'trade', 'other')),
  event_tag text,
  created_at timestamptz default now(),
  notes text
);
```

---

## MVP 1 — What to Build Now

Build only these screens. Nothing else. No inventory, no analytics, no graphs yet.

### Screen 1: Instellingen (Settings)

First-time setup screen. Vendor fills in once, stored in `vendor_settings`:

- **Inkoop cash %** — slider or number input, default 60
- **Inkoop inruil %** — slider or number input, default 75
- **Conditie-percentages** — 7 editable fields (MT/NM/EX/GD/LP/PL/PO) with defaults
- Save button → stored locally (IndexedDB) AND synced to Supabase when online

Simple screen, not fancy. The vendor sets this up once at home before the fair.

---

### Screen 2: Zoek & Bereken (Main Screen — the core of the app)

This is the screen the vendor uses at their table. It must be fast and work with one hand.

**Layout (top to bottom):**

1. **Zoekbalk** — large text input, autofocus on load. Vendor types card name. Show search results as a list below (card name + set + small thumbnail). Tap to select.

2. **Scan-knop** — camera icon next to the search bar. On tap: open camera → send frame to Ximilar → on result: auto-fill search + select card. Show a "Zoeken..." spinner. If Ximilar fails or is unavailable: show error toast, focus back on search bar. **Never block the flow.**

3. **Geselecteerde kaart** — once selected, show:
   - Card image (thumbnail)
   - Card name + set
   - Cardmarket trendprijs: **€XX,XX** (large, prominent)
   - "Bijgewerkt: [timestamp of cache]" in small grey text below price
   - 7-day avg and 30-day avg in small text (informational only)

4. **Conditie-knoppen** — 7 large tap-friendly buttons in a row:
   `MT` `NM` `EX` `GD` `LP` `PL` `PO`
   Default selected: NM. On tap: highlight selected, recalculate price instantly.

5. **Gecorrigeerde prijs** — show: "Gecorrigeerde prijs: **€XX,XX**" (trendprijs × conditie%)
   Below that, an editable input field pre-filled with this value. Vendor can manually override this price at any time (e.g. for newly released sets with inflated prices).

6. **Biedingen** — two large cards side by side:
   - 💰 **Cash bod: €XX,XX** (gecorrigeerde prijs × cash%)
   - 🔄 **Inruil bod: €XX,XX** (gecorrigeerde prijs × trade%)
   These update in real-time as vendor adjusts condition or overrides price.

7. **Toevoegen aan cart** — two buttons: "Toevoegen als inkoop" and "Toevoegen als inruil"
   On tap: add to cart with the selected condition, price, and type. Show brief success toast.

8. **Cart indicator** — floating badge showing number of items in cart. Tap to go to cart screen.

---

### Screen 3: Winkelwagen / Cart (Trade Cart)

This screen handles the full deal when a customer hands over multiple cards.

**Layout:**

- **Inkoop sectie** — list of cards the vendor is buying from the customer. Each row: card name, condition, cash bod, inruil bod. Swipe left to remove.

- **Inruil sectie** (optional — if the customer also wants cards from the vendor) — same list format. These are cards going OUT.

- **Totaal** — calculated at the bottom:
  - Totaal inkoop waarde: €XX,XX
  - Totaal uitruil waarde: €XX,XX
  - **Verschil: [Klant betaalt €X,XX bij] or [Vendor keert €X,XX uit]**

- **Klantscherm-knop** — full-screen button "Toon klant". Opens Screen 4.

- **Deal sluiten** — button at bottom. On tap in fase 1: clear the cart, show "Deal gesloten!" confirmation. (In fase 2 this will write to inventory + transactions.)

---

### Screen 4: Klantscherm (Customer Display)

Shown when vendor taps "Toon klant". Full-screen, clean, no vendor internals visible.

Display only:
- App name / logo
- List of cards with: card name, condition, and for each: "Cash: €XX" / "Inruil: €XX"
- Total at bottom: "Totaal cash: €XX" / "Totaal inruil: €XX"
- Big "Terug" button for vendor to dismiss

**What must NOT be visible:** trendprijs, margins, percentages, cost calculations. The customer sees only the offer.

---

### Screen 5: Auth (simple)

- Email + password login/register via Supabase Auth
- On first login: redirect to Instellingen screen
- Keep it minimal — no social login, no complex onboarding

---

## Navigation

Bottom navigation bar with 4 icons:
1. 🔍 Zoeken (main screen — default)
2. 🛒 Winkelwagen (with item count badge)
3. 📦 Voorraad (disabled/greyed out with "Komt in fase 2" tooltip)
4. ⚙️ Instellingen

---

## UI Guidelines

- **Mobile-first, large tap targets** — minimum 48px touch targets on all interactive elements
- **Dark mode by default** — vendors work in all lighting conditions; dark is easier on a bright fair
- **Dutch UI** — all labels, buttons, toasts in Dutch
- **No unnecessary animations** — speed over visual flair; every ms counts at a busy table
- **Color coding:** green for inruil/trade, blue/white for cash, red for remove/cancel
- **Font size:** generous — vendor may be glancing quickly, not reading carefully

---

## What NOT to Build in MVP 1

Do not build these yet, even if it seems easy:
- Inventory management (fase 2)
- Transaction history (fase 2)
- Day overview / analytics (fase 3-4)
- Price graphs (fase 4)
- Label printing (fase 4)
- Multi-account / team features
- Cardmarket sync / push
- Graded card pricing UI
- Subscription/payment flows

---

## Environment Variables

```
RAPIDAPI_KEY=your_rapidapi_key_here
XIMILAR_KEY=your_ximilar_key_here (optional, add when implementing scan)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

---

## File Structure

```
/app
  /login          → Auth screen
  /instellingen   → Settings screen
  /zoeken         → Main search + calculate screen (default)
  /cart           → Trade cart screen
  /klant          → Customer display screen (fullscreen)
/lib
  /priceService.ts   → ALL price API calls go through here, nowhere else
  /db.ts             → IndexedDB helpers (offline storage)
  /supabase.ts       → Supabase client
/components
  /ConditionButtons.tsx
  /CardResult.tsx
  /CartItem.tsx
  /BidDisplay.tsx
/hooks
  /useCart.ts        → Cart state (persisted in IndexedDB)
  /useSettings.ts    → Vendor settings (persisted in IndexedDB + Supabase)
```

---

## Start Here

Build in this order:
1. Project setup: Next.js + Tailwind + Supabase + PWA config
2. Supabase schema (run the SQL above)
3. Auth (login/register)
4. `/lib/priceService.ts` — build and test the price fetch with real cards before touching UI
5. Instellingen screen — vendor configures their percentages
6. Zoeken screen — search, condition buttons, price display, bids
7. Cart screen — multi-card deal flow
8. Klantscherm — customer display
9. Wire up offline (IndexedDB) for settings and cart state
10. PWA manifest + service worker

Do not move to step 6 until step 4 (priceService) returns correct EUR prices for real Pokémon cards verified against Cardmarket.
