/** Parse a single-field query into character name and optional realm query. */

export interface ParsedCharacterQuery {
  name: string;
  realm: string | null;
}

/**
 * Accepts:
 * - "Wallidrixe-Archimonde"
 * - "Wallidrixe-arch"
 * - "wallidrixe archimonde"
 * - "Aleria" (name only)
 */
export function parseCharacterQuery(query: string): ParsedCharacterQuery {
  const trimmed = query.trim();
  if (!trimmed) {
    return { name: "", realm: null };
  }

  const dash = trimmed.indexOf("-");
  if (dash > 0) {
    return {
      name: trimmed.slice(0, dash).trim(),
      realm: trimmed.slice(dash + 1).trim() || null,
    };
  }

  const space = trimmed.search(/\s+/);
  if (space > 0) {
    return {
      name: trimmed.slice(0, space).trim(),
      realm: trimmed.slice(space).trim() || null,
    };
  }

  return { name: trimmed, realm: null };
}

export function formatCharacterSuggestionLabel(name: string, realmSlug: string): string {
  return `${name}-${realmSlug}`;
}

export function formatResolveLabel(name: string, realmName: string): string {
  return `Search ${name} — ${realmName}`;
}

export const REALM_REQUIRED_HINT = "Add the realm using Character-Realm";
