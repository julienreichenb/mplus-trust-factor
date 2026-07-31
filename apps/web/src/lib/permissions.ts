export function hasPermission(
  permissions: string[] | undefined,
  required: string | string[],
): boolean {
  if (!permissions?.length) return false;
  const needed = Array.isArray(required) ? required : [required];
  return needed.every((key) => permissions.includes(key));
}
