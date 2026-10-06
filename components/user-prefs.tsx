"use client";

import { createContext, useContext } from "react";
import type { LanguageTag } from "@/lib/languages";

export type UserPrefs = { preferredLanguage: LanguageTag; defaultCurrency: string };

const UserPrefsContext = createContext<UserPrefs>({ preferredLanguage: "en", defaultCurrency: "USD" });

/** Signed-in user's preferences for client components (set once in the app layout). */
export function UserPrefsProvider({ value, children }: { value: UserPrefs; children: React.ReactNode }) {
  return <UserPrefsContext.Provider value={value}>{children}</UserPrefsContext.Provider>;
}

export function useUserPrefs() {
  return useContext(UserPrefsContext);
}
