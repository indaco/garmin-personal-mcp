import en from "./locales/en.json";

/** The page texts in English: the source of the keys. Every other catalogue has exactly these keys. */
export { en };
export type Key = keyof typeof en;
export type Catalogue = Record<Key, string>;
