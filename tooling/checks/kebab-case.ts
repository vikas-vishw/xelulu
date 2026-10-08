// Kebab-case file-name check (Req 1.11). Pure: no filesystem access.

/** The only file names allowed to break the kebab-case rule. */
export const NAME_EXCEPTIONS: ReadonlySet<string> = new Set([
  "README.md",
  "Dockerfile",
  "_layout.tsx",
]);

const KEBAB_PART = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * True when `basename` is kebab-case: drop one leading `.`, split on `.`, and
 * every part matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Names in NAME_EXCEPTIONS pass.
 */
export function isKebabFileName(basename: string): boolean {
  if (NAME_EXCEPTIONS.has(basename)) return true;

  const name = basename.startsWith(".") ? basename.slice(1) : basename;
  if (name.length === 0) return false;

  return name.split(".").every((part) => KEBAB_PART.test(part));
}
