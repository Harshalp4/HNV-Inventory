/**
 * Initials and a colour for a name, worked out from the name itself.
 *
 * <p>A list of a dozen orders from four suppliers is much easier to scan when each supplier
 * carries a mark of its own. Deriving it from the name means nobody has to maintain a
 * mapping, no new field is needed on any record, and the same supplier is the same colour
 * on every screen it appears on — which is the only property that makes the mark useful.</p>
 */

/** Two letters: the initials of the first two words, or the first two letters of one. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => /[a-z0-9]/i.test(word));
  if (words.length === 0) return '—';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * One of the six chart colours, chosen by the name.
 *
 * <p>A sum of character codes rather than anything cleverer: it has to be stable across
 * reloads and machines, and it has to spread names across the palette. It does both, and a
 * collision only ever means two suppliers share a colour — which the name beside it settles.</p>
 */
export function badgeColour(name: string): string {
  let total = 0;
  for (let i = 0; i < name.length; i++) total += name.charCodeAt(i);
  return `var(--ss-chart-${(total % 6) + 1})`;
}
