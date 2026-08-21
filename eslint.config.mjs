import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    "inspriation-ui/**",
    "ml/.venv/**",
    "next-env.d.ts",
    "node_modules/**",
    "out/**",
    "public/ort/**",
    "public/tflite-wasm/**",
  ]),
]);
