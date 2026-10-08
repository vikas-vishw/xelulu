// Local ESLint plugin for repo-wide Xelulu rules.
import noCrossPackageImport from "./no-cross-package-import.mjs";

/** @type {import("eslint").ESLint.Plugin} */
const plugin = {
  meta: { name: "xelulu" },
  rules: {
    "no-cross-package-import": noCrossPackageImport,
  },
};

export default plugin;
