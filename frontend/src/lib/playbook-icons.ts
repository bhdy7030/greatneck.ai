/**
 * Centralized playbook icon system using OpenMoji (open source).
 * Each icon key maps to a Unicode hex codepoint for CDN loading.
 * CDN: https://cdn.jsdelivr.net/npm/openmoji@15.1/color/svg/{HEX}.svg
 */

const OPENMOJI_BASE = "https://cdn.jsdelivr.net/npm/openmoji@15.1/color/svg";

// Map icon keys → Unicode hex codepoints
const ICON_CODEPOINTS: Record<string, string> = {
  home: "1F3E1",        // 🏡 house with garden
  snowflake: "2744",    // ❄️
  flower: "1F33A",      // 🌺 hibiscus
  sun: "1F31E",         // 🌞 sun with face
  leaf: "1F341",        // 🍁 maple leaf
  star: "1F31F",        // 🌟 glowing star
  briefcase: "1F4BC",   // 💼
  heart: "1F496",       // 💖 sparkling heart
  book: "1F4DA",        // 📚 books
  tools: "1F6E0",       // 🛠️
  kitchen: "1F373",     // 🍳 cooking
  garden: "1F33B",      // 🌻 sunflower
  money: "1F4B0",       // 💰 money bag
  car: "1F697",         // 🚗
  baby: "1F476",        // 👶
  paint: "1F3A8",       // 🎨 palette
  shield: "1F6E1",      // 🛡️
  globe: "1F30E",       // 🌎
  school: "1F393",      // 🎓 graduation
  dog: "1F436",         // 🐶
  tree: "1F333",        // 🌳
  rocket: "1F680",      // 🚀
};

// Fallback native emojis (for SSR / loading states)
const FALLBACK_EMOJIS: Record<string, string> = {
  home: "\u{1F3E1}",
  snowflake: "\u{2744}\u{FE0F}",
  flower: "\u{1F33A}",
  sun: "\u{1F31E}",
  leaf: "\u{1F341}",
  star: "\u{1F31F}",
  briefcase: "\u{1F4BC}",
  heart: "\u{1F496}",
  book: "\u{1F4DA}",
  tools: "\u{1F6E0}\u{FE0F}",
  kitchen: "\u{1F373}",
  garden: "\u{1F33B}",
  money: "\u{1F4B0}",
  car: "\u{1F697}",
  baby: "\u{1F476}",
  paint: "\u{1F3A8}",
  shield: "\u{1F6E1}\u{FE0F}",
  globe: "\u{1F30E}",
  school: "\u{1F393}",
  dog: "\u{1F436}",
  tree: "\u{1F333}",
  rocket: "\u{1F680}",
};

export const ICON_KEYS = Object.keys(ICON_CODEPOINTS);

/** Get OpenMoji SVG URL for an icon key */
export function getOpenMojiUrl(icon: string): string {
  const code = ICON_CODEPOINTS[icon] || "1F4CB"; // 📋 clipboard fallback
  return `${OPENMOJI_BASE}/${code}.svg`;
}

/** Get native emoji fallback for an icon key */
export function getPlaybookEmoji(icon: string): string {
  return FALLBACK_EMOJIS[icon] || "\u{1F4CB}";
}
