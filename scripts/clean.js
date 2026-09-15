import fs from "node:fs";

fs.rmSync("dist", { recursive: true, force: true });
console.log("[clean] Removed dist/");
