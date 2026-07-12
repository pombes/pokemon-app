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
  getSettings,
  saveSettings,
  type VendorSettings,
  DEFAULT_SETTINGS,
} from "@/lib/db";
import { t, type Lang, type TKey } from "@/lib/i18n";

type SettingsContextType = {
  settings: VendorSettings;
  loading: boolean;
  save: (next: VendorSettings) => Promise<void>;
};

const SettingsContext = createContext<SettingsContextType | null>(null);

/**
 * Single source of truth for vendor settings, shared app-wide so a change
 * (like switching language) is reflected everywhere instantly.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<VendorSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  const save = useCallback(async (next: VendorSettings) => {
    await saveSettings(next);
    setSettings(next);
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loading, save }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextType {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}

/** Translation helper bound to the active language from settings. */
export function useT() {
  const { settings } = useSettings();
  const lang: Lang = settings.language ?? "nl";
  const tr = useCallback(
    (key: TKey, vars?: Record<string, string | number>) => t(lang, key, vars),
    [lang]
  );
  return { tr, lang };
}
