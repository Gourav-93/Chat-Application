// Builds the lazy emoji shortcode lookup and finds, resolves, and ranks composer tokens.

const PREFERRED = new Map([
  [
    "smile",
    {
      unified: "1f604",
      emoji: "\u{1f604}",
      name: "Grinning face with smiling eyes",
    },
  ],
  ["heart", { unified: "2764-fe0f", emoji: "\u2764\uFE0F", name: "Red heart" }],
  ["fire", { unified: "1f525", emoji: "\u{1f525}", name: "Fire" }],
]);
const KEYCAP_NAMES = new Map([
  ["0023-fe0f-20e3", "keycap_hash"],
  ["002a-fe0f-20e3", "keycap_asterisk"],
]);
const TONE_NAMES = ["light", "medium-light", "medium", "medium-dark", "dark"];
const MAX_TOKEN_LENGTH = 256;
const SUGGESTION_LIMIT = 8;
let cachedIndex = null;
let loadingIndex;

function normalizeAlias(name) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9+]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function unicodeEmoji(unified) {
  return String.fromCodePoint(
    ...unified.split("-").map((code) => Number.parseInt(code, 16)),
  );
}

function makeIndex(data) {
  const aliases = new Map(PREFERRED);
  const keywords = new Map();
  const entries = [];
  const variants = [];
  const uniqueKeys = new Set(aliases.keys());

  function reserveAlias(candidate, unified) {
    if (uniqueKeys.has(candidate))
      candidate += "_" + unified.replaceAll("-", "_");
    while (uniqueKeys.has(candidate)) candidate += "_";
    uniqueKeys.add(candidate);
    return candidate;
  }

  const rows = Object.values(data.emojis).flat();
  for (const { u, n } of rows) {
    const name = n.at(-1);
    const key = KEYCAP_NAMES.get(u) || normalizeAlias(name);
    const alias =
      PREFERRED.get(key)?.unified === u ? key : reserveAlias(key, u);
    const terms = [...new Set(n.map(normalizeAlias).filter(Boolean))];
    const entry = { unified: u, emoji: unicodeEmoji(u), name, alias, terms };
    entries.push(entry);
    aliases.set(alias, entry);
    for (const term of terms) {
      // A null value reserves an ambiguous keyword for search only.
      if (!keywords.has(term)) keywords.set(term, entry);
      else if (keywords.get(term)?.unified !== u) keywords.set(term, null);
    }
  }
  // Reserve base names first so generated variation aliases cannot shadow them.
  for (const [rowIndex, { v }] of rows.entries()) {
    const { alias, name } = entries[rowIndex];
    for (const [index, unified] of (v || []).entries()) {
      const tones = unified.split("-").flatMap((code) => {
        const tone = Number.parseInt(code, 16) - 0x1f3fb;
        return tone >= 0 && tone < TONE_NAMES.length ? [tone] : [];
      });
      const toneCode = tones.length
        ? "tone_" + tones.map((tone) => tone + 1).join("_")
        : "variant_" + (index + 1);
      const variantAlias = reserveAlias(alias + "_" + toneCode, unified);
      const variantName = tones.length
        ? tones.map((tone) => TONE_NAMES[tone]).join(" and ") + " skin tone"
        : "variant " + (index + 1);
      const variant = {
        unified,
        emoji: unicodeEmoji(unified),
        name: name + ", " + variantName,
        alias: variantAlias,
      };
      variants.push(variant);
      aliases.set(variantAlias, variant);
    }
  }
  for (const [keyword, entry] of keywords) {
    if (entry && !aliases.has(keyword)) aliases.set(keyword, entry);
  }
  return { aliases, entries, variants };
}

export function getEmojiShortcodeIndex() {
  return cachedIndex;
}

export function loadEmojiShortcodes() {
  // Use the picker's exact data import so Vite and the browser can share the chunk.
  loadingIndex ||= import("emoji-picker-react/data/emojis-en")
    .then(({ default: data }) => {
      cachedIndex = makeIndex(data);
      return cachedIndex;
    })
    .catch((error) => {
      loadingIndex = null;
      throw error;
    });
  return loadingIndex;
}

export function findShortcodeToken(text, end, closed = false) {
  if (closed && text[end - 1] !== ":") return null;
  const queryEnd = closed ? end - 1 : end;
  const match = /:([a-z0-9_+-]*)$/i.exec(
    text.slice(Math.max(0, queryEnd - MAX_TOKEN_LENGTH - 1), queryEnd),
  );
  if (!match) return null;
  const start = queryEnd - match[0].length;
  const before = text.slice(0, start);
  if (
    before &&
    !/(?:[\s([{"'\u201C\u2018,!?;]|\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\uFE0F|\u20E3|\u{E007F})$/u.test(
      before,
    )
  )
    return null;
  // Even a punctuation boundary can belong to a URL query or fragment.
  if (/(?:[a-z][a-z\d+.-]*:\/\/|www\.)\S*$/i.test(before)) return null;
  const query = match[1].toLowerCase().replaceAll("-", "_");
  return closed && !query ? null : { start, end, query };
}

export function suggestionReplacementEnd(text, end) {
  const suffix = /^[a-z0-9_+-]*:/i.exec(
    text.slice(end, end + MAX_TOKEN_LENGTH + 1),
  );
  if (!suffix) return end;

  // Extend past the caret only for a complete, recognized shortcode.
  const completeEnd = end + suffix[0].length;
  const token = findShortcodeToken(text, completeEnd, true);
  return token && resolveEmojiShortcode(cachedIndex, token.query)
    ? completeEnd
    : end;
}

export function resolveEmojiShortcode(index, query) {
  return index?.aliases.get(query) || PREFERRED.get(query) || null;
}

export function getEmojiSuggestions(index, query) {
  if (!query) return [];
  const unique = new Map();
  const add = (entry, rank) => {
    const previous = unique.get(entry.unified);
    if (!previous || previous.rank > rank)
      unique.set(entry.unified, { entry, rank });
  };
  const exact = resolveEmojiShortcode(index, query);
  if (exact) add(exact, 0);
  for (const [alias, entry] of PREFERRED) {
    if (alias.startsWith(query)) add(entry, 1);
  }
  if (index) {
    for (const entry of index.entries) {
      if (entry.alias.startsWith(query)) add(entry, 2);
      else if (entry.terms.includes(query)) add(entry, 3);
      else if (entry.terms.some((term) => term.startsWith(query)))
        add(entry, 4);
    }
    if (
      /_(?:tone|variant)(?:_.*)?$/.test(query) ||
      (exact && unique.size < SUGGESTION_LIMIT)
    ) {
      for (const variant of index.variants) {
        if (variant.alias.startsWith(query)) add(variant, 5);
      }
    }
  }
  return [...unique.values()]
    .sort(
      (a, b) => a.rank - b.rank || (a.entry.unified < b.entry.unified ? -1 : 1),
    )
    .slice(0, SUGGESTION_LIMIT)
    .map(({ entry }) => entry);
}
