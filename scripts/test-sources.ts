import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.env.WORDWELL_SOURCE_DIR ?? resolve(homedir(), "Library/Application Support/WordWell/sources"));
const child = spawn(resolve(root, "toolchain/venv/bin/python"), [
  "-m", "unittest", "discover", "-s", fileURLToPath(new URL("../pipeline/sources/", import.meta.url)), "-p", "test_*.py"
], { stdio: "inherit", env: { ...process.env, NLTK_DATA: resolve(root, "toolchain/nltk_data") } });
child.on("error", () => { console.error("Run sources setup before test:sources"); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
