import type { PublicFaqEntryDTO } from "@mplus/contracts";

export function normalizeFaqSearchText(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase();
}

export function faqEntryMatchesQuery(entry: Pick<PublicFaqEntryDTO, "title" | "description">, query: string): boolean {
  const needle = normalizeFaqSearchText(query);
  if (!needle) return true;
  const haystack = normalizeFaqSearchText(`${entry.title}\n${entry.description}`);
  return haystack.includes(needle);
}

export function filterFaqEntries<T extends Pick<PublicFaqEntryDTO, "title" | "description">>(
  entries: readonly T[],
  query: string,
): T[] {
  return entries.filter((entry) => faqEntryMatchesQuery(entry, query));
}
