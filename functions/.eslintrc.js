module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "google",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.dev.json"],
    sourceType: "module",
    tsconfigRootDir: __dirname,
  },
  ignorePatterns: ["/lib/**/*", "/generated/**/*", ".eslintrc.js"],
  plugins: ["@typescript-eslint", "import"],
  rules: {
    "quote-props": 0,
    indent: 0,
    quotes: ["error", "double"],
    "require-jsdoc": 0,
    "import/no-unresolved": 0,
    "operator-linebreak": 0,
    indent: ["error", 2],
    "object-curly-spacing": ["error", "always"],
    "max-len": [
      "error",
      {
        code: 80,
        ignoreComments: true,
        ignoreTrailingComments: true,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
      },
    ],
  },
};
