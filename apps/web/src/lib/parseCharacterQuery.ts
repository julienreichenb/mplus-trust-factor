/** Parse a single-field query such as "Wallidrixe-Archimonde" into name and optional realm. */
export function parseCharacterQuery(query: string): { name: string; realm: string | null } {
  const trimmed = query.trim();
  const dash = trimmed.indexOf("-");
  if (dash <= 0) {
    return { name: trimmed, realm: null };
  }
  return {
    name: trimmed.slice(0, dash).trim(),
    realm: trimmed.slice(dash + 1).trim() || null,
  };
}

export function formatCharacterSuggestionLabel(name: string, realmSlug: string): string {
  return `${name}-${realmSlug}`;
}
