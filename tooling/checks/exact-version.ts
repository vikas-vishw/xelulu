// Exact-version check (Req 1.2, 1.3, 1.8, 8.9, 13.1). Pure: no filesystem access.

/**
 * MAJOR.MINOR.PATCH with no leading zeros and an optional pre-release suffix.
 * Build metadata (`+…`), ranges, tags, URLs and paths are all rejected.
 */
const EXACT_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

/** Dependency fields every manifest check covers. */
export const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

export type DependencyField = (typeof DEPENDENCY_FIELDS)[number];

export type ManifestDepFinding = {
  field: string;
  name: string;
  spec: string;
  reason: string;
};

export function isExactVersion(spec: string): boolean {
  return EXACT_VERSION.test(spec);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reports every dependency that is either a workspace package without a
 * `workspace:` spec, or a non-workspace package whose spec is not exact.
 * Malformed fields or non-string specs are reported too, so nothing slips past.
 */
export function checkManifestDeps(
  manifest: Record<string, unknown>,
  workspaceNames: ReadonlySet<string>,
): ManifestDepFinding[] {
  const findings: ManifestDepFinding[] = [];

  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (deps === undefined) continue;

    if (!isPlainObject(deps)) {
      findings.push({ field, name: "", spec: "", reason: "dependency field is not an object" });
      continue;
    }

    for (const [name, rawSpec] of Object.entries(deps)) {
      if (typeof rawSpec !== "string") {
        findings.push({ field, name, spec: String(rawSpec), reason: "spec is not a string" });
        continue;
      }

      if (workspaceNames.has(name)) {
        if (!rawSpec.startsWith("workspace:")) {
          findings.push({
            field,
            name,
            spec: rawSpec,
            reason: "workspace package must use the workspace: protocol",
          });
        }
      } else if (!isExactVersion(rawSpec)) {
        findings.push({
          field,
          name,
          spec: rawSpec,
          reason: "spec is not an exact MAJOR.MINOR.PATCH[-prerelease] version",
        });
      }
    }
  }

  return findings;
}
