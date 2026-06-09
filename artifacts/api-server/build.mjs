import { createRequire } from "module";
const require = createRequire(import.meta.url);

import * as esbuild from "esbuild";
import { esbuildPluginPino } from "esbuild-plugin-pino";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(__dirname, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.join(__dirname, "dist/index.mjs"),
  sourcemap: true,
  plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
  external: [
    "pg-native",
    "better-sqlite3",
    "mysql2",
    "oracledb",
    "mssql",
    "tedious",
    "pg-query-stream",
  ],
  banner: {
    js: `import { createRequire as _cr } from 'module'; const require = _cr(import.meta.url);`,
  },
});

console.log("Build complete: dist/index.mjs");
