import { createServer } from "node:http";
import pg from "pg";
import { LearnerDatabase } from "./database.js";
import { createApi } from "./http.js";
import { databaseConnection } from "../db/connections.mjs";

const databaseUrl = databaseConnection("learner");

const pool = new pg.Pool({ connectionString: databaseUrl });
const database = new LearnerDatabase({ pool });
const port = Number(process.env.PORT ?? 3000);
const server = createServer(createApi(database));

server.listen(port, () => {
  const address = server.address();
  console.log(`WordWell API listening on ${typeof address === "object" ? address?.port : port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await database.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
