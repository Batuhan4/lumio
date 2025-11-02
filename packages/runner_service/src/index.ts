import bodyParser from "body-parser";
import express from "express";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { RunnerService } from "./runner.js";
import { RunnerStore } from "./store.js";

const usageSchema = z.object({
  llmIn: z.coerce.number().min(0).default(0),
  llmOut: z.coerce.number().min(0).default(0),
  httpCalls: z.coerce.number().min(0).default(0),
  runtimeMs: z.coerce.number().min(0).default(0),
});

const runRequestSchema = z.object({
  user: z.string().min(1),
  agentId: z.coerce.number().int().nonnegative(),
  rateVersion: z.coerce.number().int().positive().optional(),
  budgets: usageSchema,
  workflowId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  label: z.string().optional(),
});

const idParamsSchema = z.object({
  id: z.string().min(1),
});

(async () => {
  try {
    const config = loadConfig();
    const store = new RunnerStore(config.dataPath);
    await store.init();

    const runner = new RunnerService(config, store);
    runner.start();

    const app = express();
    const corsOrigin = process.env.RUNNER_CORS_ORIGIN ?? "*";

    app.use((req, res, next) => {
      res.header("Access-Control-Allow-Origin", corsOrigin);
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
      next();
    });

    app.use(bodyParser.json({ limit: "1mb" }));

    app.get("/health", (_req, res) => {
      res.json({ ok: true, status: runner.status() });
    });

    app.get("/summary", (_req, res) => {
      res.json(runner.summary());
    });

    app.get("/runs", (_req, res) => {
      res.json(store.list());
    });

    app.get("/runs/:id", (req, res) => {
      const { id } = idParamsSchema.parse(req.params);
      const run = store.get(id);
      if (!run) {
        res.status(404).json({ error: "Run not found" });
        return;
      }
      res.json(run);
    });

    app.post("/runs", async (req, res) => {
      try {
        const payload = runRequestSchema.parse(req.body);
        const run = await runner.enqueue(payload);
        res.status(202).json(run);
      } catch (error) {
        if (error instanceof z.ZodError) {
          res
            .status(400)
            .json({ error: "Invalid payload", issues: error.issues });
          return;
        }
        console.error("Failed to enqueue run", error);
        res.status(500).json({ error: "Failed to enqueue run" });
      }
    });

    app.post("/runs/:id/retry", async (req, res) => {
      try {
        const { id } = idParamsSchema.parse(req.params);
        const run = await runner.retryRun(id);
        res.json(run);
      } catch (error) {
        if (error instanceof z.ZodError) {
          res
            .status(400)
            .json({ error: "Invalid request", issues: error.issues });
          return;
        }
        res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : "Unable to retry the specified run",
        });
      }
    });

    const server = app.listen(config.port, () => {
      console.log(
        `[runner] listening on :${config.port} as ${config.runnerPublicKey} (contract ${config.contractId})`,
      );
    });

    const shutdown = async () => {
      runner.stop();
      server.close(() => {
        process.exit(0);
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error("Runner service failed to start", error);
    process.exit(1);
  }
})();
