import crypto from "node:crypto";
import { createHash } from "node:crypto";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import * as AgentRegistry from "agent_registry";
import * as PrepaidVault from "prepaid_vault";
import { RunnerConfig } from "./config.js";
import { RunnerStore } from "./store.js";
import {
  RunnerReceipt,
  RunnerRequest,
  RunnerRun,
  RunnerRunStatus,
  RunnerStatusSnapshot,
  RunnerSummary,
  UsageBudget,
} from "./types.js";

const toPositiveInt = (value: number | undefined): number => {
  if (!Number.isFinite(value) || value === undefined) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
};

const toUsageBudget = (input: UsageBudget): UsageBudget => ({
  llmIn: toPositiveInt(input.llmIn),
  llmOut: toPositiveInt(input.llmOut),
  httpCalls: toPositiveInt(input.httpCalls),
  runtimeMs: toPositiveInt(input.runtimeMs),
});

const toContractUsage = (usage: UsageBudget): PrepaidVault.UsageBreakdown => ({
  llm_in: BigInt(toPositiveInt(usage.llmIn)),
  llm_out: BigInt(toPositiveInt(usage.llmOut)),
  http_calls: BigInt(toPositiveInt(usage.httpCalls)),
  runtime_ms: BigInt(toPositiveInt(usage.runtimeMs)),
});

const usageToHexHash = (payload: string): { hash: Buffer; hex: string } => {
  const hash = createHash("sha256").update(payload).digest();
  return { hash, hex: hash.toString("hex") };
};

class Logger {
  constructor(private readonly level: "info" | "debug") {}

  info(message: string, meta?: Record<string, unknown>) {
    console.log(`[runner] ${message}`, meta ?? "");
  }

  debug(message: string, meta?: Record<string, unknown>) {
    if (this.level === "debug") {
      console.debug(`[runner:debug] ${message}`, meta ?? "");
    }
  }

  error(message: string, error?: unknown, meta?: Record<string, unknown>) {
    console.error(`[runner:error] ${message}`, meta ?? "", error ?? "");
  }
}

export class RunnerService {
  private readonly vaultClient: PrepaidVault.Client;
  private readonly registryClient: AgentRegistry.Client;
  private readonly keypair: Keypair;
  private readonly logger: Logger;
  private processing = false;
  private activeRunId?: string;
  private lastTickAt?: string;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: RunnerConfig,
    private readonly store: RunnerStore,
  ) {
    this.keypair = Keypair.fromSecret(this.config.runnerSecret);
    this.logger = new Logger(this.config.logLevel);

    this.vaultClient = new PrepaidVault.Client({
      networkPassphrase: this.config.networkPassphrase,
      contractId: this.config.contractId,
      rpcUrl: this.config.rpcUrl,
      allowHttp: true,
      publicKey: this.config.runnerPublicKey,
    });

    this.registryClient = new AgentRegistry.Client({
      networkPassphrase: this.config.networkPassphrase,
      contractId: this.config.agentRegistryId,
      rpcUrl: this.config.rpcUrl,
      allowHttp: true,
    });
  }

  async enqueue(request: RunnerRequest): Promise<RunnerRun> {
    const normalizedBudgets = toUsageBudget(request.budgets);
    const now = new Date().toISOString();
    const run: RunnerRun = {
      ...request,
      budgets: normalizedBudgets,
      id: crypto.randomUUID(),
      retries: 0,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    await this.store.add(run);
    this.logger.info("Queued run", { runId: run.id, user: run.user });
    return run;
  }

  async retryRun(id: string): Promise<RunnerRun> {
    const existing = this.store.get(id);
    if (!existing) {
      throw new Error(`Run ${id} not found`);
    }
    if (existing.status !== "failed") {
      throw new Error(
        `Only failed runs can be retried. Current status: ${existing.status}`,
      );
    }
    const updated = await this.store.update(id, {
      status: "pending",
      runId: undefined,
      usage: undefined,
      receipt: undefined,
      error: undefined,
      transactionHashes: {},
      retries: existing.retries + 1,
    });
    if (!updated) {
      throw new Error(`Unable to update run ${id}`);
    }
    this.logger.info("Re-queued run", { runId: id, retries: updated.retries });
    return updated;
  }

  start(): void {
    this.logger.info("Starting runner service", {
      runner: this.config.runnerPublicKey,
      contractId: this.config.contractId,
      rpcUrl: this.config.rpcUrl,
    });
    this.schedule();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  status(): RunnerStatusSnapshot {
    return {
      activeRunId: this.activeRunId,
      queueDepth: this.store.list().filter((run) => run.status === "pending")
        .length,
      lastTickAt: this.lastTickAt,
    };
  }

  summary(): RunnerSummary {
    return {
      config: {
        runner: this.config.runnerPublicKey,
        contractId: this.config.contractId,
        networkPassphrase: this.config.networkPassphrase,
        rpcUrl: this.config.rpcUrl,
        agentRegistryId: this.config.agentRegistryId,
        pollIntervalMs: this.config.pollIntervalMs,
      },
      status: this.status(),
    };
  }

  private schedule() {
    this.timer = setTimeout(() => {
      void this.tick();
    }, this.config.pollIntervalMs);
  }

  private async tick(): Promise<void> {
    this.lastTickAt = new Date().toISOString();
    if (this.processing) {
      this.schedule();
      return;
    }
    const next = this.store.getNextPending();
    if (!next) {
      this.schedule();
      return;
    }

    this.processing = true;
    this.activeRunId = next.id;

    try {
      await this.processRun(next);
    } catch (error) {
      this.logger.error("Runner loop error", error, { runId: next.id });
    } finally {
      this.processing = false;
      this.activeRunId = undefined;
      this.schedule();
    }
  }

  private async processRun(run: RunnerRun): Promise<void> {
    this.logger.info("Processing run", { id: run.id, user: run.user });
    let current = (await this.store.updateStatus(run.id, "opening")) ?? run;
    const transactionHashes = { ...(current.transactionHashes ?? {}) };
    let onChainRunId: number | undefined = current.runId;

    try {
      const rateVersion = await this.resolveRateVersion(current);
      current =
        (await this.store.update(current.id, {
          rateVersion,
        })) ?? current;

      const budgets = toContractUsage(current.budgets);
      const openTx = await this.vaultClient.open_run({
        user: current.user,
        caller: this.config.runnerPublicKey,
        agent_id: current.agentId,
        rate_version: rateVersion,
        budgets,
      });

      const openHash = await this.signAndSend(
        openTx,
        this.config.networkPassphrase,
      );
      transactionHashes.open = openHash;

      const rawRunId = openTx.result;
      onChainRunId =
        typeof rawRunId === "bigint" ? Number(rawRunId) : Number(rawRunId ?? 0);
      current =
        (await this.store.updateStatus(current.id, "running", {
          runId: onChainRunId,
          transactionHashes,
        })) ?? current;

      const { usage, output } = await this.executeWorkload(current);
      const { hash, hex } = usageToHexHash(output);

      current =
        (await this.store.updateStatus(current.id, "finalizing", {
          usage,
          outputHash: hex,
          transactionHashes,
        })) ?? current;

      const finalizeTx = await this.vaultClient.finalize_run({
        run_id: BigInt(onChainRunId),
        runner: this.config.runnerPublicKey,
        rate_version: rateVersion,
        usage: toContractUsage(usage),
        output_hash: hash,
      });

      const finalizeHash = await this.signAndSend(
        finalizeTx,
        this.config.networkPassphrase,
      );
      transactionHashes.finalize = finalizeHash;

      const receipt = finalizeTx.result as PrepaidVault.RunReceipt;
      const normalizedReceipt: RunnerReceipt = {
        runId: Number(receipt.run_id ?? onChainRunId ?? 0),
        actualCharge: receipt.actual_charge.toString(),
        refund: receipt.refund.toString(),
        developer: receipt.developer,
        outputHash: hex,
        finalizedAt: new Date().toISOString(),
      };

      await this.store.updateStatus(current.id, "finalized", {
        receipt: normalizedReceipt,
        transactionHashes,
      });

      this.logger.info("Run finalized", {
        runId: current.id,
        contractRunId: normalizedReceipt.runId,
        actualCharge: normalizedReceipt.actualCharge,
      });
    } catch (error) {
      this.logger.error("Run processing failed", error, { runId: current.id });
      let failureStatus: RunnerRunStatus = "failed";

      if (onChainRunId !== undefined && this.config.finalizeOnError) {
        try {
          await this.finalizeWithZero(current, onChainRunId, transactionHashes);
          failureStatus = "finalized";
        } catch (finalizeError) {
          this.logger.error("Unable to finalize failed run", finalizeError, {
            runId: current.id,
          });
        }
      }

      await this.store.updateStatus(current.id, failureStatus, {
        error: error instanceof Error ? error.message : String(error),
        transactionHashes,
      });
    }
  }

  private async finalizeWithZero(
    run: RunnerRun,
    runId: number,
    txHashes: Record<string, string>,
  ): Promise<void> {
    const usage: UsageBudget = {
      llmIn: 0,
      llmOut: 0,
      httpCalls: 0,
      runtimeMs: 0,
    };
    const failureSummary = JSON.stringify({
      runId: run.id,
      message: run.error ?? "Runner failure",
      timestamp: new Date().toISOString(),
    });
    const { hash, hex } = usageToHexHash(failureSummary);

    const rateVersion = run.rateVersion ?? (await this.resolveRateVersion(run));

    const finalizeTx = await this.vaultClient.finalize_run({
      run_id: BigInt(runId),
      runner: this.config.runnerPublicKey,
      rate_version: rateVersion,
      usage: toContractUsage(usage),
      output_hash: hash,
    });

    const finalizeHash = await this.signAndSend(
      finalizeTx,
      this.config.networkPassphrase,
    );
    txHashes.finalize = finalizeHash;

    const receipt = finalizeTx.result as PrepaidVault.RunReceipt;
    const normalizedReceipt: RunnerReceipt = {
      runId: Number(receipt.run_id ?? runId ?? 0),
      actualCharge: receipt.actual_charge.toString(),
      refund: receipt.refund.toString(),
      developer: receipt.developer,
      outputHash: hex,
      finalizedAt: new Date().toISOString(),
    };

    await this.store.updateStatus(run.id, "finalized", {
      usage,
      receipt: normalizedReceipt,
      outputHash: hex,
      transactionHashes: txHashes,
    });

    this.logger.info("Run auto-finalized after error", {
      runId: run.id,
      contractRunId: normalizedReceipt.runId,
    });
  }

  private async resolveRateVersion(run: RunnerRun): Promise<number> {
    if (run.rateVersion && run.rateVersion > 0) {
      return run.rateVersion;
    }
    try {
      const latest = await this.registryClient.latest_rate_version({
        agent_id: run.agentId,
      });
      return typeof latest === "bigint" ? Number(latest) : Number(latest);
    } catch (error) {
      this.logger.debug("Falling back to rate version 1", {
        agentId: run.agentId,
        error,
      });
      return 1;
    }
  }

  private async executeWorkload(
    run: RunnerRun,
  ): Promise<{ usage: UsageBudget; output: string }> {
    const usage: UsageBudget = {
      llmIn: Math.min(run.budgets.llmIn, Math.floor(run.budgets.llmIn * 0.8)),
      llmOut: Math.min(
        run.budgets.llmOut,
        Math.floor(run.budgets.llmOut * 0.75),
      ),
      httpCalls: Math.min(
        run.budgets.httpCalls,
        Math.floor(run.budgets.httpCalls * 0.5),
      ),
      runtimeMs: Math.min(
        run.budgets.runtimeMs,
        Math.floor(run.budgets.runtimeMs * 0.6),
      ),
    };

    const output = JSON.stringify({
      runId: run.id,
      workflowId: run.workflowId ?? null,
      label: run.label ?? null,
      timestamp: new Date().toISOString(),
      note: "Simulated workflow execution. Replace with agent runtime integration.",
    });

    await new Promise((resolve) => setTimeout(resolve, 250));

    return { usage, output };
  }

  private async signAndSend<T>(
    tx: PrepaidVault.contract.AssembledTransaction<T>,
    networkPassphrase: string,
  ): Promise<string> {
    let envelopeHash = "";
    await tx.signAndSend({
      signTransaction: async (
        xdr: string,
        opts?: { networkPassphrase?: string },
      ): Promise<string> => {
        const passphrase = opts?.networkPassphrase ?? networkPassphrase;
        const transaction = TransactionBuilder.fromXDR(xdr, passphrase);
        transaction.sign(this.keypair);
        envelopeHash = transaction.hash().toString("hex");
        return transaction.toEnvelope().toXDR("base64");
      },
    });
    return envelopeHash;
  }
}
