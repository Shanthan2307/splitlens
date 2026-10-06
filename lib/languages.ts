/** Languages offered for UI preference and receipt translation (BCP 47 tags). */
export const LANGUAGE_TAGS = [
  "en", "es", "fr", "de", "it", "pt", "pt-BR", "nl", "sv", "no", "da", "fi", "is", "pl", "cs", "sk", "sl", "hr",
  "sr", "bs", "hu", "ro", "bg", "mk", "sq", "el", "tr", "ru", "uk", "be", "et", "lv", "lt", "ka", "hy", "az",
  "kk", "uz", "ar", "he", "fa", "ur", "hi", "bn", "pa", "gu", "mr", "ta", "te", "kn", "ml", "si", "ne", "th",
  "lo", "km", "my", "vi", "id", "ms", "tl", "zh-Hans", "zh-Hant", "ja", "ko", "mn", "sw", "am", "yo", "zu",
  "af", "ca", "eu", "gl", "cy", "ga", "mt",
] as const;

export type LanguageTag = (typeof LANGUAGE_TAGS)[number];

const TAG_SET: ReadonlySet<string> = new Set(LANGUAGE_TAGS);

export function isLanguageTag(value: string): value is LanguageTag {
  return TAG_SET.has(value);
}

/** English name, e.g. "de" → "German" (for search). */
export function languageNameEn(tag: LanguageTag): string {
  return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
}

/** Name of the language in its own script, e.g. "de" → "Deutsch". */
export function languageName(tag: LanguageTag): string {
  return new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag;
}
