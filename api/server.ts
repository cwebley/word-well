import { createServer } from "node:http";
import pg from "pg";
import { LearnerDatabase } from "./database.js";
import { createApi } from "./http.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const pool = new pg.Pool({ connectionString: databaseUrl });
const database = new LearnerDatabase({ pool });
const port = Number(process.env.PORT ?? 3000);
const server = createServer(createApi(database));

server.listen(port, () => console.log(`WordWell API listening on ${port}`));

async function shutdown(): Promise<void> {
  server.close();
  await database.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
