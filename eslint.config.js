import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "web/dist/**", "dist/**", "webui-dist/**", "webui/assets/vendor/**", ".wrangler/**", "*.html", "migrations/**", "seed/seed.sql", "worker-configuration.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: { globals: { console: "readonly", process: "readonly", fetch: "readonly", URL: "readonly", setTimeout: "readonly", clearTimeout: "readonly" } },
  },
  {
    // k6負荷試験スクリプトはk6ランタイム固有のグローバルを使用する（Node/ブラウザ用ESLint設定の対象外）
    files: ["scripts/load/**/*.js"],
    languageOptions: { globals: { __ENV: "readonly", __VU: "readonly", __ITER: "readonly" } },
  },
);
