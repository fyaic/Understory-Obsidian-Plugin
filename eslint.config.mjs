import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: [
      "main.js",
      "node_modules/**",
      "src/bundledEnginePayload.js",
      "understory-graphify-engine/**",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.js", "scripts/**/*.js", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": ["error", { caughtErrors: "none" }],
      "no-implicit-globals": "off",
      // The custom multi-page UI supports Obsidian before 1.13. Returning partial
      // declarative definitions would replace it entirely on 1.13+.
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
    },
  },
  {
    files: ["tests/**/*.js"],
    rules: {
      "no-redeclare": "off",
      "obsidianmd/hardcoded-config-path": "off",
      "obsidianmd/no-global-this": "off",
      "obsidianmd/prefer-window-timers": "off",
    },
  },
]);
