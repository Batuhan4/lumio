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
              <Text as="h3" size="md">
                Spending policy
              </Text>
              <Text as="p" size="sm">
                Caps apply to any on-demand or scheduled run before the Max
                Charge is escrowed.
              </Text>
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
              <Button variant="primary" size="md">
                Update caps
              </Button>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.cardContent}>
              <Text as="h3" size="md">
                Pause new runs
              </Text>
              <Text as="p" size="sm">
                Pausing stops any new `open_run` calls while preserving existing
                escrows. Use when rotating credentials or investigating usage.
              </Text>
              <div className={styles.pauseToggle}>
                <Toggle
                  id="pause-toggle"
                  checked={isPaused}
                  fieldSize="lg"
                  onChange={() => setIsPaused((prev) => !prev)}
                  iconChecked={<Icon.PauseCircle />}
                  iconUnchecked={<Icon.PlayCircle />}
                />
                <Text as="span" size="sm">
                  {isPaused ? "Account paused" : "Account active"}
                </Text>
              </div>
              <Button variant="tertiary" size="md" disabled={!isPaused}>
                Resume runs
              </Button>
            </div>
          </div>
        </div>
      </Layout.Inset>

      <Modal visible={isDepositModalOpen} onClose={handleCloseDeposit}>
        <Modal.Heading>Deposit funds</Modal.Heading>
        <Modal.Body>
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
            />
            <Text as="span" size="xs" className={styles.walletBalanceNote}>
              Wallet balance:{" "}
              {isWalletBalanceLoading
                ? "Loading..."
                : walletBalanceError
                  ? "Unavailable"
                  : `${walletXlmBalance} XLM`}
            </Text>
          </form>
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

      <Modal visible={isWithdrawModalOpen} onClose={handleCloseWithdraw}>
        <Modal.Heading>Withdraw funds</Modal.Heading>
        <Modal.Body>
          <form
            id="withdraw-form"
            className={styles.depositForm}
            onSubmit={(event) => {
              event.preventDefault();
              void handleWithdraw();
            }}
          >
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
            />
            <Text as="span" size="xs" className={styles.walletBalanceNote}>
              Available balance:{" "}
              {isVaultBalanceLoading
                ? "Loading..."
                : vaultBalanceError
                  ? "Unavailable"
                  : `${formatCurrency(availableBalance)} USDC`}
            </Text>
          </form>
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
