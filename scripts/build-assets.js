import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";

const isProduction =
  process.argv.includes("--prod") || process.env.NODE_ENV === "production";

// Standalone CSS files referenced by name in the SwatchKit layouts.
// They are not imported by main.css, so esbuild never sees them — copy them.
const STANDALONE_CSS = ["swatchkit-ui.css", "swatchkit-preview.css"];

await esbuild.build({
  entryPoints: ["src/css/main.css", "src/js/main.js", "src/js/navigation-preview.js", "src/service-worker.js"],
  bundle: true,
  outdir: "dist",
  outbase: "src",
  minify: isProduction,
  sourcemap: !isProduction,
  format: "esm",
  // Emit referenced assets (fonts/images via url()) next to the output
  // instead of failing, in case a dependency ships them.
  loader: {
    ".woff": "file",
    ".woff2": "file",
    ".ttf": "file",
    ".eot": "file",
    ".svg": "file",
    ".png": "file",
    ".jpg": "file",
    ".gif": "file",
  },
  logLevel: "info",
});

fs.mkdirSync(path.join("dist", "css"), { recursive: true });
for (const file of STANDALONE_CSS) {
  const src = path.join("src", "css", file);
  const dest = path.join("dist", "css", file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[assets] Copied dist/css/${file}`);
  }
}

console.log(
  `[assets] Built CSS and JS with esbuild${isProduction ? " (production)" : ""}`,
);
