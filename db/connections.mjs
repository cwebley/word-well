import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Local connection credentials only. Shell variables take precedence.
const localFile = fileURLToPath(new URL("../.env.database", import.meta.url));
if (existsSync(localFile)) process.loadEnvFile(localFile);

const variables = {
  admin: "WORDWELL_ADMIN_DATABASE_URL",
  learner: "WORDWELL_LEARNER_DATABASE_URL",
  pipeline: "WORDWELL_PIPELINE_DATABASE_URL"
};

export function databaseConnection(job) {
  const value = process.env[variables[job]];
  if (!value) throw new Error(`${variables[job]} is required. Run npm run db:setup for local connections.`);
  const url = new URL(value);
  if (job !== "admin" && decodeURIComponent(url.username) !== `wordwell_${job}_login`)
    throw new Error(`${variables[job]} must use the restricted ${job} login.`);
  return value;
}

export function inDatabase(connectionString, name) {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}
