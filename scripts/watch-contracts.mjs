#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { setInterval } from "node:timers";

const COMMAND = "stellar";
const ARGS = ["scaffold", "watch", "--build-clients"];
const DEFAULT_RPC_URL = "http://localhost:8000/rpc";
const HEALTH_CHECK_ATTEMPTS = Number(
  process.env.STELLAR_HEALTH_CHECK_ATTEMPTS || 12,
);
const HEALTH_CHECK_DELAY_MS = Number(
  process.env.STELLAR_HEALTH_CHECK_DELAY_MS || 5_000,
);

const env = { ...process.env };
const home = env.HOME || env.USERPROFILE;
if (home) {
  const cargoBin = `${home}/.cargo/bin`;
  if (env.PATH && !env.PATH.split(":").includes(cargoBin)) {
    env.PATH = `${cargoBin}:${env.PATH}`;
  } else if (!env.PATH) {
    env.PATH = cargoBin;
  }
}

let keepAliveTimer;

const ensureKeepAlive = () => {
  if (keepAliveTimer) {
    return;
  }
  // Keep the process alive so `concurrently` does not exit early.
  keepAliveTimer = setInterval(() => {
    // no-op
  }, 60_000);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rpcUrl =
  env.STELLAR_RPC_URL || process.env.STELLAR_RPC_URL || `${DEFAULT_RPC_URL}`;

const ensureNetworkTimeouts = () => {
  if (!env.STELLAR_RPC_TIMEOUT_SECS) {
    env.STELLAR_RPC_TIMEOUT_SECS = "60";
  }
  if (!env.SOROBAN_RPC_TIMEOUT_SECS) {
    env.SOROBAN_RPC_TIMEOUT_SECS = env.STELLAR_RPC_TIMEOUT_SECS;
  }
};

const startLocalContainer = () => {
  const result = spawnSync(COMMAND, ["container", "start", "local"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status === 0) {
    return;
  }

  const stderr = result.stderr?.toString() ?? "";
  if (stderr.includes("is already in use")) {
    return;
  }

  // Log, but continue. The watch command will try again if needed.
  if (stderr.trim().length > 0) {
    console.warn(`[watch-contracts] ${stderr.trim()}`);
  }
};

const checkRpcHealth = async () => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getHealth",
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        return false;
      }
      const body = await response.json();
      return body?.result?.status === "healthy";
    } finally {
      clearTimeout(timeout);
    }
  } catch (_error) {
    return false;
  }
};

const ensureLocalNetworkReady = async () => {
  ensureNetworkTimeouts();

  for (let attempt = 1; attempt <= HEALTH_CHECK_ATTEMPTS; attempt += 1) {
    if (await checkRpcHealth()) {
      return;
    }

    if (attempt === 1) {
      startLocalContainer();
    }

    await sleep(HEALTH_CHECK_DELAY_MS);
  }

  console.warn(
    `[watch-contracts] RPC health check failed after ${HEALTH_CHECK_ATTEMPTS} attempts. Continuing anyway.`,
  );
};

const run = async () => {
  await ensureLocalNetworkReady();

  const child = spawn(COMMAND, ARGS, {
    stdio: "inherit",
    env,
  });

  child.on("error", (error) => {
    if (error.code === "ENOENT") {
      console.warn(
        "[watch-contracts] Stellar CLI not found. Install it and the Scaffold plugin to enable automatic contract client generation.\n" +
          "See: https://github.com/AhaLabs/scaffold-stellar",
      );
      ensureKeepAlive();
      return;
    }

    console.error(
      `[watch-contracts] Failed to launch '${COMMAND} ${ARGS.join(" ")}':`,
      error,
    );
    process.exitCode = 1;
  });

  child.on("exit", (code, signal) => {
    if (code === 0) {
      return;
    }

    if (signal) {
      console.warn(
        `[watch-contracts] Process terminated with signal ${signal}. Contracts will not be rebuilt until it is restarted.`,
      );
      ensureKeepAlive();
      return;
    }

    if (typeof code === "number") {
      console.error(
        `[watch-contracts] Stellar CLI exited with code ${code}. Contract clients may be stale.`,
      );
    }
    ensureKeepAlive();
  });
};

run().catch((error) => {
  console.error("[watch-contracts] Unexpected failure:", error);
  process.exitCode = 1;
  ensureKeepAlive();
});
