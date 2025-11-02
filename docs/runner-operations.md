# Runner Operations Playbook

This guide documents how to operate and secure the Lumio smart-runner stack after the v2 delegated authorization upgrade.

## Architecture overview

- **PrepaidVault contract** now maintains per-user runner grants (`grant_runner`, `revoke_runner`, `list_runner_grants`) and enforces delegated execution in both `open_run` and `finalize_run`.
- **Runner service (`packages/runner_service`)** queues workflow requests (`POST /runs`), opens runs on-chain, executes the workload, and finalizes usage. State is persisted to `packages/runner_service/.runner-state.json`.
- **Frontend** surfaces runner authorization, queue depth, and recent runs. The smart-wallet provider dispatches run requests to the runner instead of calling the contract directly.

## Key management

| Item                                    | Recommendation                                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runner secret (`RUNNER_SECRET`)         | Load from a `.env.runner` file or system secret manager. Limit filesystem access to the service user.                                                                |
| Runner public key (`RUNNER_PUBLIC_KEY`) | Expose via `VITE_RUNNER_PUBLIC_KEY` for the UI and via `RUNNER_PUBLIC_KEY` for the backend if you operate multiple runner identities.                                |
| Agent registry runner list              | Keep the registry entry in sync with whichever runner account is live. Removing a runner from the registry immediately invalidates existing grants during execution. |

Key rotation procedure:

1. Add the new runner account to the agent registry.
2. Update the service environment (`RUNNER_SECRET`/`RUNNER_PUBLIC_KEY`).
3. Restart the runner service.
4. Prompt users to grant access to the new runner from the Wallet page (old grants remain until revoked).
5. Remove the previous runner from the registry once all grants are revoked.

## Runner service lifecycle

### Configuration

`packages/runner_service/src/config.ts` loads the following environment variables:

- `RUNNER_SECRET` (**required**)
- `RUNNER_RPC_URL` (default `http://localhost:8000`)
- `RUNNER_NETWORK_PASSPHRASE` (default `Standalone Network ; February 2017`)
- `RUNNER_CONTRACT_ID` (defaults to the TS binding contract id)
- `RUNNER_AGENT_REGISTRY_ID` (defaults to the agent-registry binding id)
- `RUNNER_STATE_PATH` (default `packages/runner_service/.runner-state.json`)
- `RUNNER_POLL_INTERVAL_MS` (default `1000`)
- `RUNNER_FINALIZE_ON_ERROR` (default `true`)
- `RUNNER_LOG_LEVEL` (`info` or `debug`)

Example `.env.runner`:

```
RUNNER_SECRET=SC...
RUNNER_RPC_URL=http://localhost:8000/rpc
RUNNER_CONTRACT_ID=CCJDYFWYPCHWM5JLM5TZKS2OJM7KAL7A72YI3AYU4BNBZCQFVNLDUCRP
RUNNER_AGENT_REGISTRY_ID=CC...
RUNNER_POLL_INTERVAL_MS=1500
```

### Build & run

```
pnpm install
docker compose up -d soroban  # if you rely on the local sandbox
pnpm --filter @lumio/runner-service build
pnpm --filter @lumio/runner-service dev   # hot reload
# or
pnpm --filter @lumio/runner-service start # run compiled JS
```

The service exposes:

- `GET /health` and `GET /summary` for monitoring.
- `GET /runs` / `GET /runs/:id` to inspect queue state.
- `POST /runs` to enqueue a workflow.
- `POST /runs/:id/retry` to requeue a failed run.

State is persisted to the path configured by `RUNNER_STATE_PATH`. Back up or ship this file if you need to migrate the runner.

### Monitoring & alerting

- Poll `GET /summary` and trigger alerts when `queueDepth` grows unexpectedly.
- Watch the runner service logs for errors during `open_run`/`finalize_run`. The service promotes failures to the wallet UI and retains them in the persisted state.
- The UI surfaces the most recent five runs and exposes a manual retry button. Failed retries automatically finalize with zero usage when `RUNNER_FINALIZE_ON_ERROR=true`.

### Incident response

1. **Stop executions:** Toggle “Pause new runs” in the Wallet UI if necessary.
2. **Revoke runner access:** Use the Wallet UI revoke button (or call `revoke_runner` manually) to remove the runner from affected users.
3. **Inspect queue:** `GET /runs` to identify stuck runs. Retry or manually finalize via CLI if needed.
4. **Re-enable:** Once investigations conclude, grant access again and resume runs.

## Contract deployment guide

1. Build the contract wasm:
   ```
   cargo build -p prepaid-vault --target wasm32-unknown-unknown --release
   ```
2. Register the local development network (first time only):
   ```
   stellar network add development \
     --rpc-url http://localhost:8000/rpc \
     --network-passphrase "Standalone Network ; February 2017"
   ```
3. Deploy:
   ```
   stellar contract deploy \
     --wasm target/wasm32-unknown-unknown/release/prepaid_vault.wasm \
     --source me \
     --network development
   ```

> **Note:** If deployment fails with `reference-types not enabled`, downgrade to `rustup toolchain install 1.77.0` and build with `cargo +1.77.0 build ...`. The current soroban host still expects reference-types to be disabled.

After deployment, update `packages/prepaid_vault/src/index.ts` if the contract ID changes, then rebuild the TypeScript bindings:

```
pnpm --filter prepaid_vault build
pnpm run build
```

## Security checklist

- **Grant auditing:** `list_runner_grants` now emits storage events plus Soroban logs for every grant/revoke. Subscribe to the new `runner_granted`/`runner_revoked` events for automated auditing.
- **Least privilege:** Users should only authorize the canonical runner public key displayed in the UI. The Wallet page shows the currently targeted runner and queue depth.
- **Revocation latency:** Revocation takes effect immediately; outstanding runs opened by the runner will finalize successfully, but new runs will fail with `UnauthorizedRunner`.
- **Secrets hygiene:** Avoid committing `.env.runner`. Restrict filesystem permissions to the runner service account.

## Manual validation steps

1. Start the runner service (`pnpm --filter @lumio/runner-service dev`).
2. Authorize the runner in the Wallet UI.
3. Trigger a workflow from the Builder. A new run appears in the runner panel.
4. Verify the smart-wallet transaction status transitions from `pending → finalizing → finalized` without wallet prompts.
5. Revoke the runner and confirm subsequent runs fail fast with authorization errors.
