export function isCmsAdmin(
  user: { metadata?: Record<string, unknown> | null } | null | undefined,
): boolean {
  return user?.metadata?.isAdmin === true;
}
export function positiveInteger(
  value: unknown,
  name: string,
  max = 1000000,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > max
  )
    throw new Error(`${name} must be a whole number between 1 and ${max}`);
  return value;
}
