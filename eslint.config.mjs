import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "apps/**",
      "fhevmTemp/**",
      "tmp/**",
      ".coverage_artifacts/**",
      ".coverage_cache/**",
      ".coverage_contracts/**",
      "artifacts/**",
      "build/**",
      "cache/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "public/vendor/**",
      "skills/*/bin/**",
      "types/**",
      "*.env",
      "*.log",
      "coverage.json",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["public/**/*.js", "src/metamask-wallet.js", "scripts/ui-smoke.mjs"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "_", varsIgnorePattern: "_" }],
    },
  },
  {
    // public/app.js loads as a classic script, so its top-level functions are window globals (e.g. console
    // debug helpers like debugLoanAction) rather than dead code.
    files: ["public/**/*.js"],
    languageOptions: {
      sourceType: "script",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { vars: "local", argsIgnorePattern: "_", varsIgnorePattern: "_" }],
    },
  },
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": ["error", { ignoreIIFE: true, ignoreVoid: true }],
      "@typescript-eslint/no-inferrable-types": "off",
    },
  },
);
