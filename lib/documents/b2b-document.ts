export function isPrismaUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "P2002") return true;
  // Nested cause (some Prisma/driver wrappers).
  const cause = (error as { cause?: unknown }).cause;
  if (cause && cause !== error) return isPrismaUniqueConstraintError(cause);
  return false;
}
