#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");

const ensureTrailingSlash = (input) =>
  input.endsWith("/") ? input.slice(0, -1) : input;

const readEnvFile = (relativePath) => {
  const resolved = path.resolve(projectRoot, relativePath);
  if (!existsSync(resolved)) {
    return {};
  }
  return parse(readFileSync(resolved, "utf8"));
};

const mergeEnv = (...records) =>
  records.reduce((acc, record) => Object.assign(acc, record), {});

const config = mergeEnv(
  readEnvFile(".env.local"),
  readEnvFile("packages/runner_service/.env.runner"),
  process.env,
);

const runnerPublicKey =
  config.VITE_RUNNER_PUBLIC_KEY ??
  config.RUNNER_PUBLIC_KEY ??
  config.RUNNER_PUBLICKEY;

if (!runnerPublicKey) {
  console.error(
    "[ensure-runner-account] Unable to determine runner public key. Set VITE_RUNNER_PUBLIC_KEY in .env.local or RUNNER_PUBLIC_KEY in the environment.",
  );
  process.exit(1);
}

const horizonBase =
  config.RUNNER_HORIZON_URL ??
  config.PUBLIC_STELLAR_HORIZON_URL ??
  "http://localhost:8000";
const accountUrl = `${ensureTrailingSlash(horizonBase)}/accounts/${runnerPublicKey}`;

const friendbotUrl =
  config.RUNNER_FRIENDBOT_URL ??
  `${ensureTrailingSlash(horizonBase)}/friendbot?addr=${runnerPublicKey}`;

const minBalance =
  Number.parseFloat(config.RUNNER_MIN_BALANCE ?? "100.0") || 100;

const fetchJson = async (url, init) => {
  const response = await fetch(url, init);
  if (!response.ok) {
    const error = new Error(
      `Request to ${url} failed with status ${response.status}`,
    );
    error.status = response.status;
    throw error;
  }
  return response.json();
};

const getNativeBalance = (account) => {
  if (!Array.isArray(account?.balances)) {
    return 0;
  }
  const native = account.balances.find(
    (balance) => balance?.asset_type === "native",
  );
  return native ? Number.parseFloat(native.balance ?? "0") : 0;
};

const ensureAccount = async () => {
  try {
    const account = await fetchJson(accountUrl);
    const nativeBalance = getNativeBalance(account);
    if (Number.isFinite(nativeBalance) && nativeBalance >= minBalance) {
      console.log(
        `[ensure-runner-account] Runner ${runnerPublicKey} balance is healthy (${nativeBalance} XLM).`,
      );
      return;
    }
    console.log(
      `[ensure-runner-account] Runner ${runnerPublicKey} balance is ${nativeBalance} XLM. Requesting top-up from friendbot...`,
    );
  } catch (error) {
    if (error?.status !== 404) {
      console.error(
        `[ensure-runner-account] Failed to load runner account: ${error.message}`,
      );
      throw error;
    }
    console.log(
      `[ensure-runner-account] Runner ${runnerPublicKey} not found. Creating via friendbot...`,
    );
  }

  const friendbotResponse = await fetchJson(friendbotUrl, {
    method: "POST",
  }).catch(async (error) => {
    // Some friendbots expect GET requests.
    if (error?.status === 405) {
      return fetchJson(friendbotUrl);
    }
    throw error;
  });

  if (!friendbotResponse?.successful) {
    console.warn(
      "[ensure-runner-account] Friendbot response did not report success. Inspect output for details.",
      friendbotResponse,
    );
  } else {
    console.log(
      `[ensure-runner-account] Friendbot funded runner ${runnerPublicKey}.`,
    );
  }
};

try {
  const timeoutMs =
    Number.parseInt(config.RUNNER_ENSURE_TIMEOUT_MS ?? "15000", 10) || 15000;
  const controller = new AbortController();
  const abortTimer = setTimeout(
    () => controller.abort(new Error("ensure-runner-account timed out")),
    timeoutMs,
  );

  globalThis.fetch = ((originalFetch) => {
    if (!originalFetch) {
      throw new Error("fetch API unavailable in this Node.js runtime.");
    }
    return (resource, options = {}) => {
      const merged = { signal: controller.signal, ...options };
      return originalFetch(resource, merged);
    };
  })(globalThis.fetch);

  await ensureAccount();
  clearTimeout(abortTimer);
} catch (error) {
  console.error("[ensure-runner-account] Failed:", error);
  process.exit(1);
}
