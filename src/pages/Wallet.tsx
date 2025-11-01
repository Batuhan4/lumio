import { useMemo, useState } from "react";
import {
  Badge,
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
import {
  contractUnitsToNumber,
  parseAmountToContractUnits,
} from "../util/amount";
import { createPrepaidVaultClient } from "../contracts/prepaid_vault";
import { networkPassphrase as defaultNetworkPassphrase } from "../contracts/util";
import { formatCurrency } from "../util/format";
import styles from "./Wallet.module.css";

const WALLET_MODAL_ROOT_ID = "wallet-modal-root";
const QUICK_DEPOSIT_AMOUNTS = ["25", "50", "100"];
const QUICK_WITHDRAW_AMOUNTS = ["10", "25", "50"];

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

  const {
    address,
    isPending: isWalletPending,
    signTransaction: signTransactionFn,
    signAuthEntry: signAuthEntryFn,
    networkPassphrase: walletNetworkPassphrase,
  } = useWallet();
  const { addNotification } = useNotification();
  const {
    balance: vaultBalance,
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
    return Math.max(0, vaultBalance - reservedBalance - pendingWithdrawals);
  }, [
    address,
    vaultBalance,
    vaultBalanceError,
    reservedBalance,
    pendingWithdrawals,
  ]);

  const balanceDisplay = useMemo(() => {
    if (!address) return "Connect wallet";
    if (isVaultBalanceLoading) return "Loading...";
    if (vaultBalanceError) return "—";
    return formatCurrency(vaultBalance);
  }, [address, isVaultBalanceLoading, vaultBalanceError, vaultBalance]);

  const availableDisplay = useMemo(() => {
    if (!address) return "Connect wallet";
    if (isVaultBalanceLoading) return "Loading...";
    if (vaultBalanceError) return "—";
    return formatCurrency(availableBalance);
  }, [address, isVaultBalanceLoading, vaultBalanceError, availableBalance]);

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
          signAuthEntry: (authEntry, opts) =>
            signAuthEntryFn(authEntry, {
              ...opts,
              address,
              networkPassphrase: passphrase,
            }),
        });
      }

      await tx.signAndSend({
        signTransaction: (xdr, opts) =>
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
          signAuthEntry: (authEntry, opts) =>
            signAuthEntryFn(authEntry, {
              ...opts,
              address,
              networkPassphrase: passphrase,
            }),
        });
      }

      await tx.signAndSend({
        signTransaction: (xdr, opts) =>
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
          <Badge variant="secondary" size="md">
            Testnet escrow
          </Badge>
        </div>

        <div className={styles.grid}>
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
                <Text as="span" size="sm">
                  Escrow balance
                </Text>
                <Text as="span" size="md">
                  {balanceDisplay}
                </Text>
              </div>
              <div className={styles.balanceRow}>
                <Text as="span" size="sm">
                  Reserved for open runs
                </Text>
                <Text as="span" size="sm">
                  {formatCurrency(reservedBalance)}
                </Text>
              </div>
              <div className={styles.balanceRow}>
                <Text as="span" size="sm">
                  Pending withdrawals
                </Text>
                <Text as="span" size="sm">
                  {formatCurrency(pendingWithdrawals)}
                </Text>
              </div>
              <div className={styles.balanceRow}>
                <Text as="span" size="sm">
                  Available to run
                </Text>
                <Text as="span" size="md">
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
                  size="md"
                  disabled={!address || isWalletPending}
                  onClick={handleOpenDeposit}
                >
                  <Icon.ArrowCircleDown />
                  Deposit
                </Button>
                <Button
                  variant="tertiary"
                  size="md"
                  disabled={
                    !address || isWalletPending || availableBalance <= 0
                  }
                  onClick={handleOpenWithdraw}
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
                className={styles.fullWidthButton}
              >
                Update caps
              </Button>
            </div>
          </div>

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
