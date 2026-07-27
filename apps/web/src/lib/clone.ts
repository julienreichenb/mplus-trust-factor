/** Deep clone that works with Vue reactive proxies (structuredClone cannot). */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
