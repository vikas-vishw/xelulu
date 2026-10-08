// Xelulu dependency-direction rule (Req 13.3, 13.5).
//
// apps/* and services/* are leaves: no workspace package may import from a
// different app or service, by relative path or by package name. Only
// packages/shared may be imported across package boundaries.
//
// Known limitation: import(expr) and require(expr) with non-literal arguments
// cannot be resolved and are not reported. The manifest check (Req 13.1, 13.2)
// is the second line of defence at the dependency level.

import path from "node:path";

const posix = path.posix;

const LEAF_KINDS = new Set(["app", "service"]);

/**
 * Normalise a path to forward slashes and a lower-case drive letter.
 * @param {string} p
 * @returns {string}
 */
function toPosix(p) {
  let s = p.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(s)) s = s[0].toLowerCase() + s.slice(1);
  return s;
}

/** @param {string} s */
function isAbsolutePosix(s) {
  return s.startsWith("/") || /^[a-z]:\//i.test(s);
}

/** @param {string} s */
function stripTrailingSlash(s) {
  return s.length > 1 && s.endsWith("/") && !/^[a-z]:\/$/i.test(s) ? s.slice(0, -1) : s;
}

/**
 * Windows file systems are case-insensitive, so when the root looks like a
 * Windows path (drive letter or backslashes) compare paths case-insensitively.
 * @param {string} rootDir
 */
function isWindowsStyle(rootDir) {
  return /^[A-Za-z]:/.test(rootDir) || rootDir.includes("\\");
}

/**
 * Path of `absFile` relative to `root`, or null when it lies outside the root.
 * Both inputs are already normalised and case-folded.
 * @param {string} absFile
 * @param {string} root
 * @returns {string | null}
 */
function relativeToRoot(absFile, root) {
  if (absFile === root) return "";
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return absFile.startsWith(prefix) ? absFile.slice(prefix.length) : null;
}

/**
 * @typedef {{ dir: string, name: string, kind: "app" | "service" | "shared" }} PackageInfo
 * @typedef {{ rootDir: string, packages: readonly PackageInfo[] }} ClassifyOptions
 * @typedef {{ owner: PackageInfo | null, target: PackageInfo | null, violation: boolean }} Classification
 */

/**
 * Pure core of the rule.
 *
 * - Owner: the package whose `dir` is a prefix of `fromFile` relative to `rootDir`.
 * - Target: for relative/absolute specifiers, the package containing the resolved
 *   path; for bare specifiers, the package whose `name` equals the specifier or is
 *   followed by `/` and a subpath. Anything else has no target.
 * - Violation: owner and target exist, differ, and the target is an app or service.
 *
 * `dir` may be relative to `rootDir` (e.g. "services/gateway") or absolute.
 * Either separator style is accepted everywhere.
 *
 * @param {string} fromFile absolute path of the importing file
 * @param {string} specifier the import specifier as written
 * @param {ClassifyOptions} options
 * @returns {Classification}
 */
export function classifyImport(fromFile, specifier, options) {
  const { rootDir, packages } = options;
  const fold = isWindowsStyle(rootDir) ? (/** @type {string} */ s) => s.toLowerCase() : (s) => s;

  const root = fold(stripTrailingSlash(posix.normalize(toPosix(rootDir))));

  // Package dirs as root-relative, folded, slash-normalised keys.
  const table = packages.map((pkg) => {
    let dir = toPosix(pkg.dir);
    if (isAbsolutePosix(dir)) {
      dir = relativeToRoot(fold(stripTrailingSlash(posix.normalize(dir))), root) ?? "\0outside";
    } else {
      dir = fold(stripTrailingSlash(posix.normalize(dir)));
      if (dir.startsWith("./")) dir = dir.slice(2);
    }
    return { pkg, dir };
  });

  /** @param {string | null} rel */
  const findByPath = (rel) => {
    if (rel === null) return null;
    let best = null;
    for (const entry of table) {
      if (entry.dir === "" || entry.dir === ".") continue;
      if (rel === entry.dir || rel.startsWith(`${entry.dir}/`)) {
        if (best === null || entry.dir.length > best.dir.length) best = entry;
      }
    }
    return best;
  };

  const fromAbs = posix.normalize(toPosix(fromFile));
  const ownerEntry = findByPath(relativeToRoot(fold(fromAbs), root));
  if (ownerEntry === null) return { owner: null, target: null, violation: false };

  /** @type {{ pkg: PackageInfo, dir: string } | null} */
  let targetEntry = null;
  const spec = toPosix(specifier);
  if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") {
    const resolved = posix.normalize(`${posix.dirname(fromAbs)}/${spec}`);
    targetEntry = findByPath(relativeToRoot(fold(stripTrailingSlash(resolved)), root));
  } else if (isAbsolutePosix(spec)) {
    const resolved = posix.normalize(spec);
    targetEntry = findByPath(relativeToRoot(fold(stripTrailingSlash(resolved)), root));
  } else {
    // Bare specifier: package names are case-sensitive, so match the original text.
    targetEntry =
      table.find((e) => specifier === e.pkg.name || specifier.startsWith(`${e.pkg.name}/`)) ?? null;
  }

  const owner = ownerEntry.pkg;
  const target = targetEntry ? targetEntry.pkg : null;
  const violation =
    targetEntry !== null && targetEntry.dir !== ownerEntry.dir && LEAF_KINDS.has(target.kind);
  return { owner, target, violation };
}

/**
 * Human-readable violation message (design: "ESLint flat config and the
 * dependency-direction rule").
 * @param {PackageInfo} owner
 * @param {PackageInfo} target
 */
export function formatMessage(owner, target) {
  return `${owner.dir} must not import from ${target.dir} (apps/* and services/* are leaves; only packages/shared may be imported)`;
}

/**
 * Literal string value of a specifier node, or null when it cannot be resolved
 * statically (a non-literal or a template with expressions).
 * @param {any} node
 * @returns {string | null}
 */
function staticString(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow imports from a different workspace package under apps/* or services/*.",
    },
    schema: [
      {
        type: "object",
        properties: {
          rootDir: { type: "string" },
          packages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                dir: { type: "string" },
                name: { type: "string" },
                kind: { enum: ["app", "service", "shared"] },
              },
              required: ["dir", "name", "kind"],
              additionalProperties: false,
            },
          },
        },
        required: ["rootDir", "packages"],
        additionalProperties: false,
      },
    ],
    messages: {
      crossPackage: "{{message}}",
    },
  },
  create(context) {
    const options = context.options[0];
    if (!options) return {};
    const fromFile = context.filename;

    /**
     * @param {any} reportNode
     * @param {string | null} specifier
     */
    const check = (reportNode, specifier) => {
      if (specifier === null) return;
      const result = classifyImport(fromFile, specifier, options);
      if (result.violation && result.owner && result.target) {
        context.report({
          node: reportNode,
          messageId: "crossPackage",
          data: { message: formatMessage(result.owner, result.target) },
        });
      }
    };

    return {
      ImportDeclaration(node) {
        check(node, staticString(node.source));
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node, staticString(node.source));
      },
      ExportAllDeclaration(node) {
        check(node, staticString(node.source));
      },
      ImportExpression(node) {
        check(node, staticString(node.source));
      },
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments.length >= 1
        ) {
          const arg = node.arguments[0];
          check(node, arg && arg.type === "Literal" ? staticString(arg) : null);
        }
      },
    };
  },
};

export default rule;
