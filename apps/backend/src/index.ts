import { startServer } from "./server.js";

const port = Number(process.env.PORT ?? 3001);
const app = await startServer({ port });
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(JSON.stringify({ event: "shutdown", signal }));

  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();

  try {
    await app.close();
    process.exitCode = 0;
  } catch (error) {
    console.error(JSON.stringify({ event: "shutdown_failed", error: String(error) }));
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
