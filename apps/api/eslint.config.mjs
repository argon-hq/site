import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Type-aware rules: the ones that catch a promise left floating, an `any` slipping through a cast
// and a condition that is always true — what a review reads for by hand otherwise.
export default tseslint.config(
  { ignores: ["dist/**", "out/**", ".mastra/**", "src/generated/**", "studio/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // An `async` that awaits nothing is how a fake answers a promise; the rule adds nothing here.
      "@typescript-eslint/require-await": "off",
      // A promise nobody awaits is a failure nobody sees. `void` marks the ones that are meant to be.
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false } }],
      // Prisma rows and Mastra results are typed; what they carry is known, not `any`.
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      // String(error) is the house style for reasons; template literals with unknowns stay allowed.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true, allowNullish: true },
      ],
    },
  },
  {
    // Tests build fakes with `as unknown as`, and answer with `async` arrows that await nothing:
    // the unsafe-* rules would only report the fakes. A floating promise is still an error there.
    files: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    rules: {
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    // Config files and scripts are not part of the project's type graph.
    files: ["*.mjs", "*.ts", "scripts/**"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
