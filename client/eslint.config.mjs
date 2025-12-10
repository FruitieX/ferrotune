import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-test/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    "rules": {
      // Allow unused vars prefixed with underscore (for intentionally unused params)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_",
          "caughtErrorsIgnorePattern": "^_"
        }
      ],
      "no-restricted-imports": [
        "error",
        {
          "paths": [
            {
              "name": "react",
              "importNames": ["useCallback", "useMemo", "memo"],
              "message": "React Compiler handles memoization automatically. Do not use useCallback, useMemo and memo."
            }
          ]
        }
    ]}
  }
]);

export default eslintConfig;
