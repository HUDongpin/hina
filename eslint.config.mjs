import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "examples/next-app/**",
      "output/**",
      "outputs/**",
      "node-compile-cache/**",
      "playwright-transform-cache-*/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
    },
  },
  {
    files: ["scripts/**/*.mjs", "eslint.config.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        URL: "readonly",
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["e2e/workbench.spec.ts"],
    rules: {
      // Browser downloads cross an untyped JSON boundary and are immediately
      // validated with Playwright assertions in the E2E specification.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
);
