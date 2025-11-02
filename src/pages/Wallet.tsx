import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Icon,
  Input,
  Layout,
  Text,
  Toggle,
  Modal,
} from "@stellar/design-system";
import { useWallet } from "../hooks/useWallet";
import { useWalletBalance } from "../hooks/useWalletBalance";
import { useVaultBalance } from "../hooks/useVaultBalance";
import { useNotification } from "../hooks/useNotification";
import { useSmartWallet } from "../hooks/useSmartWallet";
import {
  contractUnitsToNumber,
  parseAmountToContractUnits,
} from "../util/amount";
import { createPrepaidVaultClient } from "../contracts/prepaid_vault";
import { createAgentRegistryClient } from "../contracts/agent_registry";
import { networkPassphrase as defaultNetworkPassphrase } from "../contracts/util";
import { formatCurrency } from "../util/format";
import { listRunnerRuns, retryRunnerRun } from "../services/runner";
import type { RunnerRun, RunnerRunStatus } from "../services/runner";
import type { Option, u64 } from "@stellar/stellar-sdk/contract";
import type { RunnerGrant } from "prepaid_vault";
import styles from "./Wallet.module.css";

const WALLET_MODAL_ROOT_ID = "wallet-modal-root";
const QUICK_DEPOSIT_AMOUNTS = ["25", "50", "100"];
const QUICK_WITHDRAW_AMOUNTS = ["10", "25", "50"];
const DEFAULT_AGENT_ID = 1;
const RUNNER_PUBLIC_KEY =
  (import.meta.env.VITE_RUNNER_PUBLIC_KEY as string | undefined) ?? undefined;
const RUNNER_POLL_INTERVAL = 5_000;

const isRunnerGrant = (value: unknown): value is RunnerGrant => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<RunnerGrant>;
  return (
    typeof candidate.runner === "string" &&
    typeof candidate.agent_id === "number"
  );
};

const toRunnerGrantArray = (value: unknown): RunnerGrant[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRunnerGrant);
};

const Wallet = () => {
  const [perRunCap, setPerRunCap] = useState(5);
  const [dailyCap, setDailyCap] = useState(50);
  const [isPaused, setIsPaused] = useState(false);
  const [isDepositModalOpen, setDepositModalOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositError, setDepositError] = useState<string>();
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawError, setWithdrawError] = useState<string>();
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [runnerAddress, setRunnerAddress] = useState<string | undefined>(
    RUNNER_PUBLIC_KEY,
  );
  const [runnerGrants, setRunnerGrants] = useState<RunnerGrant[]>([]);
  const [isRunnerLoading, setIsRunnerLoading] = useState(false);
  const [runnerMessage, setRunnerMessage] = useState<string>();
  const [isGrantingRunner, setIsGrantingRunner] = useState(false);
  const [isRevokingRunner, setIsRevokingRunner] = useState(false);
  const [runnerRuns, setRunnerRuns] = useState<RunnerRun[]>([]);
  const [runnerRunsError, setRunnerRunsError] = useState<string>();

  const {
    address,
    isPending: isWalletPending,
    signTransaction: signTransactionFn,
    signAuthEntry: signAuthEntryFn,
    networkPassphrase: walletNetworkPassphrase,
  } = useWallet();
  const { addNotification } = useNotification();
  const { balance: smartWalletBalance, refresh: refreshSmartWallet } =
    useSmartWallet();
  const {
    isLoading: isVaultBalanceLoading,
    error: vaultBalanceError,
    refresh: refreshVaultBalance,
  } = useVaultBalance();
  const {
    xlm: walletXlmBalance,
    isLoading: isWalletBalanceLoading,
    error: walletBalanceError,
  } = useWalletBalance();

  const reservedBalance = 0;
  const pendingWithdrawals = 0;

  const availableBalance = useMemo(() => {
    if (!address || vaultBalanceError) return 0;
    return Math.max(
      0,
      smartWalletBalance - reservedBalance - pendingWithdrawals,
    );
  }, [
    address,
    smartWalletBalance,
    vaultBalanceError,
    reservedBalance,
    pendingWithdrawals,
  ]);

  const balanceDisplay = useMemo(() => {
    if (!address) return "Connect wallet";
    if (isVaultBalanceLoading) return "Loading...";
    if (vaultBalanceError) return "—";
    return formatCurrency(smartWalletBalance);
  }, [address, isVaultBalanceLoading, vaultBalanceError, smartWalletBalance]);

  const availableDisplay = useMemo(() => {
    if (!address) return "Connect wallet";
    if (isVaultBalanceLoading) return "Loading...";
    if (vaultBalanceError) return "—";
    return formatCurrency(availableBalance);
  }, [address, isVaultBalanceLoading, vaultBalanceError, availableBalance]);

  const loadRunnerSettings = useCallback(async () => {
    if (!address) {
      setRunnerGrants([]);
      return;
    }
    setIsRunnerLoading(true);
    try {
      const registryClient = createAgentRegistryClient();
      const agentDetailsTx = await registryClient.get_agent({
        agent_id: DEFAULT_AGENT_ID,
      });
      const agentDetails = agentDetailsTx.result as
        | { runners?: unknown }
        | undefined;
      const candidateRunners = Array.isArray(agentDetails?.runners)
        ? (agentDetails?.runners as unknown[]).map((runner) => String(runner))
        : [];

      if (RUNNER_PUBLIC_KEY) {
        setRunnerAddress(RUNNER_PUBLIC_KEY);
      } else if (!runnerAddress && candidateRunners.length > 0) {
        setRunnerAddress(candidateRunners[0]);
      }

      const vaultClient = createPrepaidVaultClient();
      const grantsTx = await vaultClient.list_runner_grants({
        user: address,
      });
      const grants = toRunnerGrantArray(grantsTx.result);
      setRunnerGrants(grants);
      setRunnerMessage(undefined);
    } catch (error) {
      setRunnerMessage(
        error instanceof Error
          ? error.message
          : "Unable to load runner configuration.",
      );
    } finally {
      setIsRunnerLoading(false);
    }
  }, [address, runnerAddress]);

  const refreshRunnerRuns = useCallback(async () => {
    try {
      const runs = await listRunnerRuns();
      setRunnerRuns(runs);
      setRunnerRunsError(undefined);
    } catch (error) {
      setRunnerRunsError(
        error instanceof Error
          ? error.message
          : "Unable to load runner activity.",
      );
    }
  }, []);

  useEffect(() => {
    void loadRunnerSettings();
  }, [loadRunnerSettings]);

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      await refreshRunnerRuns();
      if (!cancelled) {
        timeout = setTimeout(() => {
          void poll();
        }, RUNNER_POLL_INTERVAL);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [refreshRunnerRuns]);

  const perRunCapDisplay = useMemo(
    () => formatCurrency(perRunCap),
    [perRunCap],
  );
  const dailyCapDisplay = useMemo(() => formatCurrency(dailyCap), [dailyCap]);
  const policyStatusLabel = useMemo(() => {
    if (perRunCap <= 0 && dailyCap <= 0) return "Spending paused";
    if (perRunCap <= 0) return "Per-run paused";
    if (dailyCap <= 0) return "Daily paused";
    return "Policy active";
  }, [perRunCap, dailyCap]);
  const policyStatusToneClass =
    perRunCap > 0 && dailyCap > 0
      ? styles.statusPillActive
      : styles.statusPillWarning;
  const pauseStatusLabel = isPaused ? "Runs paused" : "Runs active";
  const pauseStatusToneClass = isPaused
    ? styles.statusPillWarning
    : styles.statusPillActive;

  const isRunnerAuthorized = useMemo(() => {
    if (!runnerAddress) {
      return false;
    }
    return runnerGrants.some((grant) => {
      const agentIdValue =
        (grant as { agent_id?: number; agentId?: number }).agent_id ??
        (grant as { agentId?: number }).agentId ??
        0;
      return (
        grant.runner === runnerAddress &&
        Number(agentIdValue) === DEFAULT_AGENT_ID
      );
    });
  }, [runnerAddress, runnerGrants]);

  const runnerQueueDepth = useMemo(
    () => runnerRuns.filter((run) => run.status !== "finalized").length,
    [runnerRuns],
  );

  const recentRunnerRuns = useMemo(
    () =>
      [...runnerRuns]
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )
        .slice(0, 5),
    [runnerRuns],
  );

  const formatRunnerStatus = useCallback((status?: RunnerRunStatus) => {
    if (!status) {
      return "Unknown";
    }
    return status.charAt(0).toUpperCase() + status.slice(1);
  }, []);

  const runnerStatusTone = useCallback((status?: RunnerRunStatus) => {
    switch (status) {
      case "finalized":
        return styles.statusPillActive;
      case "failed":
        return styles.statusPillError;
      default:
        return styles.statusPillWarning;
    }
  }, []);

  const handleOpenDeposit = () => {
    setDepositAmount("");
    setDepositError(undefined);
    setDepositModalOpen(true);
  };

  const handleCloseDeposit = () => {
    if (isDepositing) return;
    setDepositModalOpen(false);
    setDepositError(undefined);
  };

  const handleOpenWithdraw = () => {
    setWithdrawAmount("");
    setWithdrawError(undefined);
    setWithdrawModalOpen(true);
  };

  const handleCloseWithdraw = () => {
    if (isWithdrawing) return;
    setWithdrawModalOpen(false);
    setWithdrawError(undefined);
  };

  const handleDeposit = async () => {
    if (!address) {
      setDepositError("Connect your wallet to deposit.");
      return;
    }

    if (!signTransactionFn) {
      setDepositError("Wallet signing is unavailable.");
      return;
    }

    let submissionStarted = false;

    try {
      const contractAmount = parseAmountToContractUnits(depositAmount);
      if (contractAmount <= 0n) {
        setDepositError("Enter an amount greater than zero.");
        return;
      }

      setIsDepositing(true);
      submissionStarted = true;
      setDepositError(undefined);

      const vaultClient = createPrepaidVaultClient({
        publicKey: address,
      });

      const tx = await vaultClient.deposit({
        user: address,
        amount: contractAmount,
      });

      const needsAdditionalSignatures = (() => {
        try {
          return tx.needsNonInvokerSigningBy().length > 0;
        } catch {
          return false;
        }
      })();

      if (needsAdditionalSignatures) {
        if (!signAuthEntryFn) {
          throw new Error(
            "Wallet cannot sign authorization entries required for this deposit.",
          );
        }
        const passphrase =
          walletNetworkPassphrase ?? defaultNetworkPassphrase ?? "";
        await tx.signAuthEntries({
          address,
          signAuthEntry: (
            authEntry: Parameters<NonNullable<typeof signAuthEntryFn>>[0],
            opts: Parameters<NonNullable<typeof signAuthEntryFn>>[1],
          ) =>
            signAuthEntryFn(authEntry, {
              ...opts,
              address,
              networkPassphrase: passphrase,
            }),
        });
      }

      await tx.signAndSend({
        signTransaction: (
          xdr: Parameters<NonNullable<typeof signTransactionFn>>[0],
          opts: Parameters<NonNullable<typeof signTransactionFn>>[1],
        ) =>
          signTransactionFn(xdr, {
            ...opts,
            address,
          }),
      });

      setDepositModalOpen(false);
      setDepositAmount("");
      const depositDisplay = contractUnitsToNumber(contractAmount);
      addNotification(
        `Deposited ${depositDisplay.toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 7,
        })} USDC`,
        "success",
      );
      await refreshVaultBalance();
      await refreshSmartWallet();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Deposit failed.";
      setDepositError(message);
      if (submissionStarted) {
        console.error(error);
        addNotification(message, "error");
      }
    } finally {
      setIsDepositing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!address) {
      setWithdrawError("Connect your wallet to withdraw.");
      return;
    }

    if (!signTransactionFn) {
      setWithdrawError("Wallet signing is unavailable.");
      return;
    }

    let submissionStarted = false;

    try {
      const contractAmount = parseAmountToContractUnits(withdrawAmount);
      if (contractAmount <= 0n) {
        setWithdrawError("Enter an amount greater than zero.");
        return;
      }

      const withdrawDisplay = contractUnitsToNumber(contractAmount);
      if (withdrawDisplay > availableBalance) {
        setWithdrawError("Amount exceeds available balance.");
        return;
      }

      setIsWithdrawing(true);
      submissionStarted = true;
      setWithdrawError(undefined);

      const vaultClient = createPrepaidVaultClient({
        publicKey: address,
      });

      const tx = await vaultClient.withdraw({
        user: address,
        amount: contractAmount,
      });

      const needsAdditionalSignatures = (() => {
        try {
          return tx.needsNonInvokerSigningBy().length > 0;
        } catch {
          return false;
        }
      })();

      if (needsAdditionalSignatures) {
        if (!signAuthEntryFn) {
          throw new Error(
            "Wallet cannot sign authorization entries required for this withdrawal.",
          );
        }
        const passphrase =
          walletNetworkPassphrase ?? defaultNetworkPassphrase ?? "";
        await tx.signAuthEntries({
          address,
          signAuthEntry: (
            authEntry: Parameters<NonNullable<typeof signAuthEntryFn>>[0],
            opts: Parameters<NonNullable<typeof signAuthEntryFn>>[1],
          ) =>
            signAuthEntryFn(authEntry, {
              ...opts,
              address,
              networkPassphrase: passphrase,
            }),
        });
      }

      await tx.signAndSend({
        signTransaction: (
          xdr: Parameters<NonNullable<typeof signTransactionFn>>[0],
          opts: Parameters<NonNullable<typeof signTransactionFn>>[1],
        ) =>
          signTransactionFn(xdr, {
            ...opts,
            address,
          }),
      });

      setWithdrawModalOpen(false);
      setWithdrawAmount("");
      addNotification(
        `Withdrew ${withdrawDisplay.toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 7,
        })} USDC`,
        "success",
      );
      await refreshVaultBalance();
      await refreshSmartWallet();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Withdrawal failed.";
      setWithdrawError(message);
      if (submissionStarted) {
        console.error(error);
        addNotification(message, "error");
      }
    } finally {
      setIsWithdrawing(false);
    }
  };

  const handleGrantRunner = async () => {
    if (!address) {
      setRunnerMessage("Connect your wallet to authorize the runner.");
      return;
    }
    if (!runnerAddress) {
      setRunnerMessage("Runner address is unavailable.");
      return;
    }
    if (!signTransactionFn) {
      setRunnerMessage("Wallet signing is unavailable.");
      return;
    }

    let submissionStarted = false;

    try {
      setIsGrantingRunner(true);
      setRunnerMessage(undefined);

      const vaultClient = createPrepaidVaultClient({
        publicKey: address,
      });

      const tx = await vaultClient.grant_runner({
        user: address,
        runner: runnerAddress,
        agent_id: DEFAULT_AGENT_ID,
        expires_at: undefined as unknown as Option<u64>,
      });

      const needsAdditionalSignatures = (() => {
        try {
          return tx.needsNonInvokerSigningBy().length > 0;
        } catch {
          return false;
        }
      })();

      if (needsAdditionalSignatures) {
        if (!signAuthEntryFn) {
          throw new Error(
            "Wallet cannot sign authorization entries required for this action.",
          );
        }
        const passphrase =
          walletNetworkPassphrase ?? defaultNetworkPassphrase ?? "";
        await tx.signAuthEntries({
          address,
          signAuthEntry: (
            authEntry: Parameters<NonNullable<typeof signAuthEntryFn>>[0],
            opts: Parameters<NonNullable<typeof signAuthEntryFn>>[1],
          ) =>
            signAuthEntryFn(authEntry, {
              ...opts,
              address,
              networkPassphrase: passphrase,
            }),
        });
      }

      submissionStarted = true;

      await tx.signAndSend({
        signTransaction: (
          xdr: Parameters<NonNullable<typeof signTransactionFn>>[0],
          opts: Parameters<NonNullable<typeof signTransactionFn>>[1],
        ) =>
          signTransactionFn(xdr, {
            ...opts,
            address,
          }),
      });

      addNotification("Runner authorized", "success");
      await loadRunnerSettings();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to authorize the runner.";
      setRunnerMessage(message);
      if (submissionStarted) {
        console.error(error);
        addNotification(message, "error");
      }
    } finally {
      setIsGrantingRunner(false);
    }
  };

  const handleRevokeRunner = async () => {
    if (!address) {
      setRunnerMessage("Connect your wallet to revoke access.");
      return;
    }
    if (!runnerAddress) {
      setRunnerMessage("Runner address is unavailable.");
      return;
    }
    if (!signTransactionFn) {
      setRunnerMessage("Wallet signing is unavailable.");
      return;
    }

    let submissionStarted = false;

    try {
      setIsRevokingRunner(true);
      setRunnerMessage(undefined);

      const vaultClient = createPrepaidVaultClient({
        publicKey: address,
      });

      const tx = await vaultClient.revoke_runner({
        user: address,
        runner: runnerAddress,
        agent_id: DEFAULT_AGENT_ID,
      });

      const needsAdditionalSignatures = (() => {
        try {
          return tx.needsNonInvokerSigningBy().length > 0;
        } catch {
          return false;
        }
      })();

      if (needsAdditionalSignatures) {
        if (!signAuthEntryFn) {
          throw new Error(
            "Wallet cannot sign authorization entries required for this action.",
          );
        }
        const passphrase =
          walletNetworkPassphrase ?? defaultNetworkPassphrase ?? "";
        await tx.signAuthEntries({
          address,
          signAuthEntry: (
            authEntry: Parameters<NonNullable<typeof signAuthEntryFn>>[0],
            opts: Parameters<NonNullable<typeof signAuthEntryFn>>[1],
          ) =>
            signAuthEntryFn(authEntry, {
              ...opts,
              address,
              networkPassphrase: passphrase,
            }),
        });
      }

      submissionStarted = true;

      await tx.signAndSend({
        signTransaction: (
          xdr: Parameters<NonNullable<typeof signTransactionFn>>[0],
          opts: Parameters<NonNullable<typeof signTransactionFn>>[1],
        ) =>
          signTransactionFn(xdr, {
            ...opts,
            address,
          }),
      });

      addNotification("Runner access revoked", "success");
      await loadRunnerSettings();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to revoke runner access.";
      setRunnerMessage(message);
      if (submissionStarted) {
        console.error(error);
        addNotification(message, "error");
      }
    } finally {
      setIsRevokingRunner(false);
    }
  };

  const handleRetryRunner = async (runId: string) => {
    try {
      await retryRunnerRun(runId);
      addNotification("Retry submitted", "success");
      await refreshRunnerRuns();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to retry the run.";
      addNotification(message, "error");
    }
  };

  return (
    <Layout.Content>
      <Layout.Inset>
        <div className={styles.heading}>
          <div>
            <Text as="h1" size="xl">
              Wallet & policy controls
            </Text>
            <Text as="p" size="md">
              Escrow funds live on Stellar. Adjust caps, pause new runs, and
              reconcile refunds without leaving the dashboard.
            </Text>
          </div>
        </div>

        <div className={styles.primaryGrid}>
          <div className={styles.panel}>
            <div className={styles.cardContent}>
              <Text as="h3" size="md">
                Balances
              </Text>
              {!address && !isWalletPending ? (
                <div className={styles.callout}>
                  <Icon.InfoCircle />
                  <div>
                    <Text as="span" size="sm">
                      Connect your wallet from the header to deposit funds and
                      manage withdrawals.
                    </Text>
                  </div>
                </div>
              ) : null}
              <div className={styles.balanceRow}>
                <Text as="span" size="md" className={styles.balanceLabel}>
                  Escrow balance
                </Text>
                <Text as="span" size="lg" className={styles.balanceValue}>
                  {balanceDisplay}
                </Text>
              </div>
              <div className={styles.balanceRow}>
                <Text as="span" size="md" className={styles.balanceLabel}>
                  Reserved for open runs
                </Text>
                <Text as="span" size="md" className={styles.balanceValue}>
                  {formatCurrency(reservedBalance)}
                </Text>
              </div>
              <div className={styles.balanceRow}>
                <Text as="span" size="md" className={styles.balanceLabel}>
                  Pending withdrawals
                </Text>
                <Text as="span" size="md" className={styles.balanceValue}>
                  {formatCurrency(pendingWithdrawals)}
                </Text>
              </div>
              <div className={styles.balanceRow}>
                <Text as="span" size="md" className={styles.balanceLabel}>
                  Available to run
                </Text>
                <Text as="span" size="lg" className={styles.balanceValue}>
                  {availableDisplay}
                </Text>
              </div>
              {vaultBalanceError ? (
                <Text
                  as="span"
                  size="xs"
                  style={{ color: "var(--sds-clr-red-06)" }}
                >
                  {vaultBalanceError.message}
                </Text>
              ) : null}
              <div className={styles.actions}>
                <Button
                  variant="primary"
                  size="lg"
                  disabled={!address || isWalletPending}
                  onClick={handleOpenDeposit}
                  className={styles.actionButton}
                >
                  <Icon.ArrowCircleDown />
                  Deposit
                </Button>
                <Button
                  variant="tertiary"
                  size="lg"
                  disabled={
                    !address || isWalletPending || availableBalance <= 0
                  }
                  onClick={handleOpenWithdraw}
                  className={styles.actionButtonSecondary}
                >
                  <Icon.ArrowCircleUp />
                  Withdraw
                </Button>
              </div>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.cardContent}>
              <div className={styles.sectionHeader}>
                <Text as="h3" size="md">
                  Spending policy
                </Text>
                <span
                  className={`${styles.statusPill} ${policyStatusToneClass}`}
                >
                  {policyStatusLabel}
                </span>
              </div>
              <Text as="p" size="sm">
                Caps apply to any on-demand or scheduled run before the Max
                Charge is escrowed.
              </Text>
              <div className={styles.policyHighlights}>
                <div className={styles.policyHighlight}>
                  <span className={styles.policyHighlightLabel}>
                    Per-run cap
                  </span>
                  <span className={styles.policyHighlightValue}>
                    {perRunCapDisplay}
                  </span>
                </div>
                <div className={styles.policyHighlight}>
                  <span className={styles.policyHighlightLabel}>Daily cap</span>
                  <span className={styles.policyHighlightValue}>
                    {dailyCapDisplay}
                  </span>
                </div>
              </div>
              <div className={styles.policyInputs}>
                <Input
                  id="per-run-cap"
                  fieldSize="md"
                  type="number"
                  min={0}
                  label="Per-run cap"
                  note="USDC"
                  value={perRunCap}
                  onChange={(event) => setPerRunCap(Number(event.target.value))}
                />
                <Input
                  id="daily-cap"
                  fieldSize="md"
                  type="number"
                  min={0}
                  label="Daily cap"
                  note="USDC"
                  value={dailyCap}
                  onChange={(event) => setDailyCap(Number(event.target.value))}
                />
              </div>
              <Button
                variant="primary"
                size="md"
                className={`${styles.fullWidthButton} ${styles.policyButton}`}
              >
                Update caps
              </Button>
            </div>
          </div>
        </div>

        <div className={styles.secondaryGrid}>
          <div className={styles.panel}>
            <div className={styles.cardContent}>
              <div className={styles.sectionHeader}>
                <Text as="h3" size="md">
                  Pause new runs
                </Text>
                <span
                  className={`${styles.statusPill} ${pauseStatusToneClass}`}
                >
                  {pauseStatusLabel}
                </span>
              </div>
              <Text as="p" size="sm">
                Pausing stops any new `open_run` calls while preserving existing
                escrows. Use when rotating credentials or investigating usage.
              </Text>
              <div className={styles.pauseControls}>
                <div className={styles.pauseToggle}>
                  <Toggle
                    id="pause-toggle"
                    checked={isPaused}
                    fieldSize="lg"
                    onChange={() => setIsPaused((prev) => !prev)}
                    iconChecked={<Icon.PauseCircle />}
                    iconUnchecked={<Icon.PlayCircle />}
                  />
                </div>
                <div className={styles.pauseCopy}>
                  <Text as="span" size="sm">
                    {isPaused ? "Account paused" : "Account active"}
                  </Text>
                  <Text as="span" size="xs" className={styles.pauseHint}>
                    Toggle anytime — changes apply immediately for new runs.
                  </Text>
                </div>
              </div>
              <Button
                variant={isPaused ? "primary" : "tertiary"}
                size="md"
                disabled={!isPaused}
                className={styles.fullWidthButton}
              >
                Resume runs
              </Button>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.cardContent}>
              <div className={styles.sectionHeader}>
                <Text as="h3" size="md">
                  Smart runner
                </Text>
                <span
                  className={`${styles.statusPill} ${runnerStatusTone(
                    isRunnerAuthorized ? "finalized" : undefined,
                  )}`}
                >
                  {isRunnerAuthorized ? "Runner authorized" : "Grant access"}
                </span>
              </div>
              <Text as="p" size="sm">
                Delegate workflow execution to the automation runner. It opens
                runs, executes the agent, and finalizes usage without prompting
                your wallet.
              </Text>
              <div className={styles.runnerSummary}>
                <div>
                  <span className={styles.runnerSummaryLabel}>Runner</span>
                  <span className={styles.runnerSummaryValue}>
                    {runnerAddress ?? "Unavailable"}
                  </span>
                </div>
                <div>
                  <span className={styles.runnerSummaryLabel}>Queue depth</span>
                  <span className={styles.runnerSummaryValue}>
                    {runnerQueueDepth}
                  </span>
                </div>
              </div>
              {runnerMessage ? (
                <Text
                  as="span"
                  size="xs"
                  style={{ color: "var(--sds-clr-red-06)" }}
                >
                  {runnerMessage}
                </Text>
              ) : null}
              <div className={styles.runnerActions}>
                <Button
                  variant={isRunnerAuthorized ? "tertiary" : "primary"}
                  size="md"
                  disabled={
                    !address ||
                    isWalletPending ||
                    isRunnerLoading ||
                    isGrantingRunner ||
                    isRevokingRunner ||
                    !runnerAddress
                  }
                  onClick={() => {
                    if (isRunnerAuthorized) {
                      void handleRevokeRunner();
                      return;
                    }
                    void handleGrantRunner();
                  }}
                >
                  {isRunnerAuthorized ? (
                    <>
                      <Icon.MinusCircle />
                      Revoke access
                    </>
                  ) : (
                    <>
                      <Icon.CheckCircle />
                      Authorize runner
                    </>
                  )}
                </Button>
              </div>
              <div className={styles.runnerQueue}>
                <div className={styles.runnerQueueHeader}>
                  <Text as="span" size="sm">
                    Recent runs
                  </Text>
                  {runnerRunsError ? (
                    <Text
                      as="span"
                      size="xs"
                      style={{ color: "var(--sds-clr-red-06)" }}
                    >
                      {runnerRunsError}
                    </Text>
                  ) : null}
                </div>
                {recentRunnerRuns.length === 0 ? (
                  <Text as="span" size="xs">
                    No runs yet.
                  </Text>
                ) : (
                  <ul className={styles.runnerQueueList}>
                    {recentRunnerRuns.map((run) => (
                      <li key={run.id} className={styles.runnerQueueItem}>
                        <div>
                          <span className={styles.runnerQueueId}>
                            #{run.receipt?.runId ?? run.runId ?? "—"}
                          </span>
                          <span className={styles.runnerQueueMeta}>
                            {new Date(run.updatedAt).toLocaleString()}
                          </span>
                        </div>
                        <div className={styles.runnerQueueStatus}>
                          <span
                            className={`${styles.statusPill} ${runnerStatusTone(
                              run.status,
                            )}`}
                          >
                            {formatRunnerStatus(run.status)}
                          </span>
                          {run.status === "failed" ? (
                            <Button
                              variant="tertiary"
                              size="sm"
                              onClick={() => void handleRetryRunner(run.id)}
                              disabled={isRunnerLoading}
                            >
                              Retry
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      </Layout.Inset>

      <Modal
        parentId={WALLET_MODAL_ROOT_ID}
        visible={isDepositModalOpen}
        onClose={handleCloseDeposit}
      >
        <Modal.Heading>Deposit funds</Modal.Heading>
        <Modal.Body>
          <div className={styles.modalCard}>
            <div className={styles.modalCardHeader}>
              <span
                className={`${styles.modalCardIcon} ${styles.modalCardIconAccent}`}
                aria-hidden
              >
                <Icon.ArrowCircleDown />
              </span>
              <div>
                <Text as="h3" size="sm">
                  Move balance into escrow
                </Text>
                <Text as="p" size="xs">
                  Deposits settle immediately and unlock additional run budget.
                </Text>
              </div>
            </div>
            <div className={styles.modalStats}>
              <div className={styles.modalStat}>
                <span className={styles.modalStatLabel}>Escrow balance</span>
                <span className={styles.modalStatValue}>{balanceDisplay}</span>
              </div>
              <div className={styles.modalStat}>
                <span className={styles.modalStatLabel}>Available to run</span>
                <span className={styles.modalStatValue}>
                  {availableDisplay}
                </span>
              </div>
              <div className={styles.modalStat}>
                <span className={styles.modalStatLabel}>Wallet balance</span>
                <span className={styles.modalStatValue}>
                  {isWalletBalanceLoading
                    ? "Loading..."
                    : walletBalanceError
                      ? "Unavailable"
                      : `${walletXlmBalance} XLM`}
                </span>
              </div>
            </div>
            <form
              id="deposit-form"
              className={styles.depositForm}
              onSubmit={(event) => {
                event.preventDefault();
                void handleDeposit();
              }}
            >
              <Text as="p" size="sm">
                1 XLM is treated as 1 USDC for vault deposits.
              </Text>
              <div className={styles.modalField}>
                <Input
                  id="deposit-amount"
                  fieldSize="md"
                  label="Amount to deposit"
                  type="number"
                  step="0.0000001"
                  min="0"
                  note="Displayed in USDC, deposited as XLM"
                  value={depositAmount}
                  onChange={(event) => setDepositAmount(event.target.value)}
                  error={depositError}
                  placeholder="e.g. 50"
                />
                <div className={styles.modalFieldActions}>
                  {QUICK_DEPOSIT_AMOUNTS.map((amount) => (
                    <Button
                      key={amount}
                      type="button"
                      size="sm"
                      variant="secondary"
                      className={styles.quickButton}
                      onClick={() => setDepositAmount(amount)}
                      disabled={!address || isWalletPending}
                    >
                      {`${amount} USDC`}
                    </Button>
                  ))}
                </div>
              </div>
              <Text as="span" size="xs" className={styles.modalHint}>
                Need more XLM? Use the fund button next to the connect wallet
                control in the header.
              </Text>
            </form>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button
            form="deposit-form"
            type="submit"
            size="md"
            variant="primary"
            disabled={isDepositing}
          >
            {isDepositing ? "Depositing..." : "Deposit"}
          </Button>
          <Button size="md" variant="tertiary" onClick={handleCloseDeposit}>
            Cancel
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        parentId={WALLET_MODAL_ROOT_ID}
        visible={isWithdrawModalOpen}
        onClose={handleCloseWithdraw}
      >
        <Modal.Heading>Withdraw funds</Modal.Heading>
        <Modal.Body>
          <div className={styles.modalCard}>
            <div className={styles.modalCardHeader}>
              <span
                className={`${styles.modalCardIcon} ${styles.modalCardIconWarning}`}
                aria-hidden
              >
                <Icon.ArrowCircleUp />
              </span>
              <div>
                <Text as="h3" size="sm">
                  Release funds back to wallet
                </Text>
                <Text as="p" size="xs">
                  Withdrawals hit your Stellar wallet after a single signed
                  transaction.
                </Text>
              </div>
            </div>
            <div className={styles.modalStats}>
              <div className={styles.modalStat}>
                <span className={styles.modalStatLabel}>Available escrow</span>
                <span className={styles.modalStatValue}>
                  {availableDisplay}
                </span>
              </div>
              <div className={styles.modalStat}>
                <span className={styles.modalStatLabel}>Reserved</span>
                <span className={styles.modalStatValue}>
                  {formatCurrency(reservedBalance)}
                </span>
              </div>
              <div className={styles.modalStat}>
                <span className={styles.modalStatLabel}>
                  Pending withdrawals
                </span>
                <span className={styles.modalStatValue}>
                  {formatCurrency(pendingWithdrawals)}
                </span>
              </div>
            </div>
            <form
              id="withdraw-form"
              className={styles.depositForm}
              onSubmit={(event) => {
                event.preventDefault();
                void handleWithdraw();
              }}
            >
              <div className={styles.modalField}>
                <Input
                  id="withdraw-amount"
                  fieldSize="md"
                  label="Amount to withdraw"
                  type="number"
                  step="0.0000001"
                  min="0"
                  note="Displayed in USDC, withdrawn as XLM"
                  value={withdrawAmount}
                  onChange={(event) => setWithdrawAmount(event.target.value)}
                  error={withdrawError}
                  placeholder="e.g. 25"
                />
                <div className={styles.modalFieldActions}>
                  {QUICK_WITHDRAW_AMOUNTS.map((amount) => {
                    const amountNumber = Number(amount);
                    const disableQuick =
                      !address ||
                      isWalletPending ||
                      amountNumber <= 0 ||
                      amountNumber > availableBalance;
                    return (
                      <Button
                        key={amount}
                        type="button"
                        size="sm"
                        variant="secondary"
                        className={styles.quickButton}
                        onClick={() => setWithdrawAmount(amount)}
                        disabled={disableQuick}
                      >
                        {`${amount} USDC`}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <Text as="span" size="xs" className={styles.modalHint}>
                Escrow stays available for runs until withdrawn. Paused runs
                keep their reserved totals intact.
              </Text>
            </form>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button
            form="withdraw-form"
            type="submit"
            size="md"
            variant="primary"
            disabled={isWithdrawing}
          >
            {isWithdrawing ? "Withdrawing..." : "Withdraw"}
          </Button>
          <Button size="md" variant="tertiary" onClick={handleCloseWithdraw}>
            Cancel
          </Button>
        </Modal.Footer>
      </Modal>
    </Layout.Content>
  );
};

export default Wallet;
