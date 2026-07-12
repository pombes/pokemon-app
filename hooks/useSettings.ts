// Settings now live in a shared context so language/percentage changes
// propagate app-wide instantly. This re-export keeps existing imports working.
export { useSettings, useT } from "@/context/SettingsContext";
