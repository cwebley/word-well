import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrivateError } from "./storage/crypto.js";

// Source setup owns a pinned Python toolchain. It has no model/database imports.
const [group, operation, ...options] = process.argv.slice(2);
if (group === "sources" && ["fetch", "setup", "extract", "verify", "status", "recover"].includes(operation)) {
  const child = spawn(process.env.WORDWELL_SOURCE_PYTHON ?? "python3", [
    fileURLToPath(new URL("./sources/prepare.py", import.meta.url)), operation, ...options
  ], { stdio: "inherit" });
  child.on("error", () => { console.error("source_python_unavailable"); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 1; });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
} else {
  try {
    if (group === "writer") {
      const { executeWriterCommand } = await import("./writer-commands.js");
      console.log(JSON.stringify(await executeWriterCommand(process.argv.slice(3))));
    } else if (group === "planner") {
      const { executePlannerCommand } = await import("./planner-commands.js");
      console.log(JSON.stringify(await executePlannerCommand(process.argv.slice(3))));
    } else if (["run", "resume", "recover", "inspect"].includes(group)) {
      const { executeProductionCommand } = await import("./production-commands.js");
      console.log(JSON.stringify(await executeProductionCommand(process.argv.slice(2))));
    } else if (group === "compatibility") {
      const { executeGateCompatibilityCommand } = await import("./gate-compatibility-commands.js");
      console.log(JSON.stringify(await executeGateCompatibilityCommand(process.argv.slice(2))));
    } else if (group === "promotion") {
      const { executePromotionCommand } = await import("./promotion-commands.js");
      console.log(JSON.stringify(await executePromotionCommand(process.argv.slice(2))));
    } else {
    const [{ executeSourceCommand }, { openLocalSourceStore }] = await Promise.all([import("./commands.js"), import("./storage/source-local.js")]);
    console.log(JSON.stringify(await executeSourceCommand(process.argv.slice(2), openLocalSourceStore)));
    }
  } catch (error) {
    console.error(error instanceof PrivateError ? error.references ? JSON.stringify({ code: error.code, ...error.references }) : error.code : "pipeline_command_failed");
    process.exitCode = 1;
  }
}
