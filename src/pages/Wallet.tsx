import { useState } from "react";
import {
  Badge,
  Button,
  Icon,
  Input,
  Layout,
  Text,
  Toggle,
} from "@stellar/design-system";
import { MOCK_WALLET_POLICY } from "../data/mock";
import { formatCurrency } from "../util/format";
import styles from "./Wallet.module.css";

const Wallet = () => {
  const [perRunCap, setPerRunCap] = useState(MOCK_WALLET_POLICY.perRunCap);
  const [dailyCap, setDailyCap] = useState(MOCK_WALLET_POLICY.dailyCap);
  const [isPaused, setIsPaused] = useState(MOCK_WALLET_POLICY.paused);

  const availableBalance =
    MOCK_WALLET_POLICY.balance -
    MOCK_WALLET_POLICY.reserved -
    MOCK_WALLET_POLICY.pendingWithdrawals;

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
                  {formatCurrency(MOCK_WALLET_POLICY.balance)}
                </Text>
              </div>
              <div className={styles.balanceRow}>
                <Text as="span" size="sm">
                  Reserved for open runs
                </Text>
                <Text as="span" size="sm">
                  {formatCurrency(MOCK_WALLET_POLICY.reserved)}
                </Text>
              </div>
              <div className={styles.balanceRow}>
                <Text as="span" size="sm">
                  Pending withdrawals
                </Text>
                <Text as="span" size="sm">
                  {formatCurrency(MOCK_WALLET_POLICY.pendingWithdrawals)}
                </Text>
              </div>
              <div className={styles.balanceRow}>
                <Text as="span" size="sm">
                  Available to run
                </Text>
                <Text as="span" size="md">
                  {formatCurrency(availableBalance)}
                </Text>
              </div>
              <div className={styles.actions}>
                <Button variant="primary" size="md">
                  <Icon.ArrowCircleDown />
                  Deposit
                </Button>
                <Button variant="tertiary" size="md">
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
    </Layout.Content>
  );
};

export default Wallet;
