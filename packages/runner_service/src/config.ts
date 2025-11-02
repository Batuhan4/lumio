import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { z } from "zod";
import { networks as vaultNetworks } from "prepaid_vault";
import { networks as registryNetworks } from "agent_registry";

export type RunnerConfig = {
  port: number;
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  agentRegistryId: string;
  runnerSecret: string;
  runnerPublicKey: string;
  dataPath: string;
  pollIntervalMs: number;
  finalizeOnError: boolean;
  logLevel: "info" | "debug";
};

const defaultVault = vaultNetworks?.standalone;
const defaultRegistry = registryNetworks?.standalone;
const defaultRpc = process.env.SOROBAN_RPC_URL ?? "http://localhost:8000";

const defaultDataPath = path.resolve(
  process.cwd(),
  "packages/runner_service/.runner-state.json",
);

const envSchema = z.object({
  port: z.coerce.number().int().min(0).default(4000),
  rpcUrl: z.string().min(1).default(defaultRpc),
  networkPassphrase: z
    .string()
    .min(1)
    .default(
      defaultVault?.networkPassphrase ?? "Standalone Network ; February 2017",
    ),
  contractId: z
    .string()
    .min(1)
    .default(defaultVault?.contractId ?? ""),
  agentRegistryId: z
    .string()
    .min(1)
    .default(defaultRegistry?.contractId ?? ""),
  runnerSecret: z.string().min(1, { message: "RUNNER_SECRET is required" }),
  dataPath: z.string().min(1).default(defaultDataPath),
  pollIntervalMs: z.coerce.number().int().positive().default(1000),
  finalizeOnError: z.coerce.boolean().default(true),
  logLevel: z
    .enum(["info", "debug"])
    .default(
      (process.env.NODE_ENV === "development" ? "debug" : "info") as
        | "info"
        | "debug",
    ),
});

export const loadConfig = (): RunnerConfig => {
  const raw = {
    port: process.env.RUNNER_PORT ?? process.env.PORT,
    rpcUrl:
      process.env.RUNNER_RPC_URL ?? process.env.SOROBAN_RPC_URL ?? defaultRpc,
    networkPassphrase:
      process.env.RUNNER_NETWORK_PASSPHRASE ??
      process.env.SOROBAN_NETWORK_PASSPHRASE ??
      defaultVault?.networkPassphrase ??
      "Standalone Network ; February 2017",
    contractId:
      process.env.RUNNER_CONTRACT_ID ?? defaultVault?.contractId ?? "",
    agentRegistryId:
      process.env.RUNNER_AGENT_REGISTRY_ID ?? defaultRegistry?.contractId ?? "",
    runnerSecret:
      process.env.RUNNER_SECRET ?? process.env.RUNNER_PRIVATE_KEY ?? "",
    dataPath: process.env.RUNNER_STATE_PATH ?? defaultDataPath,
    pollIntervalMs: process.env.RUNNER_POLL_INTERVAL_MS,
    finalizeOnError: process.env.RUNNER_FINALIZE_ON_ERROR,
    logLevel: process.env.RUNNER_LOG_LEVEL,
  };

  const parsed = envSchema.parse(raw);
  let runnerKeypair: Keypair;
  try {
    runnerKeypair = Keypair.fromSecret(parsed.runnerSecret);
  } catch (error) {
    throw new Error(
      "Runner configuration failed: RUNNER_SECRET must be a valid Ed25519 secret seed.",
      { cause: error },
    );
  }

  if (!parsed.contractId) {
    throw new Error(
      "Runner configuration missing contractId. Set RUNNER_CONTRACT_ID or regenerate contract bindings.",
    );
  }
  if (!parsed.agentRegistryId) {
    throw new Error(
      "Runner configuration missing agentRegistryId. Set RUNNER_AGENT_REGISTRY_ID or regenerate contract bindings.",
    );
  }

  return {
    port: parsed.port,
    rpcUrl: parsed.rpcUrl,
    networkPassphrase: parsed.networkPassphrase,
    contractId: parsed.contractId,
    agentRegistryId: parsed.agentRegistryId,
    runnerSecret: parsed.runnerSecret,
    runnerPublicKey: runnerKeypair.publicKey(),
    dataPath: parsed.dataPath,
    pollIntervalMs: parsed.pollIntervalMs,
    finalizeOnError: parsed.finalizeOnError,
    logLevel: parsed.logLevel,
  };
};
