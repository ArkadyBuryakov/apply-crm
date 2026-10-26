/**
 * Turns free text into a prefix-matching tsquery for the `simple` configuration ("acme rec" → "acme:* & rec:*").
 * Returns null when nothing searchable is left.
 */
export function prefixQuery(text: string): string | null {
  const terms = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 10);
  if (terms.length === 0) return null;
  return terms.map((t) => `${t}:*`).join(" & ");
}
