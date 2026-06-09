const esbuild = require("esbuild");
const { esbuildPluginPino } = require("esbuild-plugin-pino");
const path = require("path");
const fs = require("fs");

const outdir = path.join(__dirname, "dist");
fs.mkdirSync(outdir, { recursive: true });

esbuild.build({
  entryPoints: [path.join(__dirname, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir,
  outExtension: { ".js": ".mjs" },
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
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
}).then(() => {
  console.log("Build complete: dist/");
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
