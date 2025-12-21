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
    ".next-dev/**",
    ".next-test/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Allow unused vars prefixed with underscore (for intentionally unused params)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              importNames: ["useCallback", "useMemo", "memo"],
              message:
                "React Compiler handles memoization automatically. Remove manual calls to useCallback, useMemo and React.memo.",
            },
          ],
        },
      ],
      // useVirtualizer returns functions that can't be memoized - this is expected behavior
      // and React Compiler handles it by skipping memoization for those components
      "react-hooks/incompatible-library": "off",
    },
  },
]);

export default eslintConfig;
