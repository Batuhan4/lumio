import { useMemo, useState } from "react";
import { Button, Modal, Profile } from "@stellar/design-system";
import { useWallet } from "../hooks/useWallet";
import { useWalletBalance } from "../hooks/useWalletBalance";
import { connectWallet, disconnectWallet } from "../util/wallet";
import styles from "./WalletButton.module.css";

export const WalletButton = () => {
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const { address, isPending } = useWallet();
  const { xlm, ...balance } = useWalletBalance();
  const buttonLabel = isPending ? "Loading..." : "Connect";
  const truncatedAddress = useMemo(() => {
    if (!address) {
      return "";
    }
    return `${address.slice(0, 5)}…${address.slice(-5)}`;
  }, [address]);

  const balanceLabel = balance.isLoading ? "…" : `${xlm} XLM`;

  if (!address) {
    return (
      <Button
        className={styles.connectButton}
        variant="primary"
        size="md"
        onClick={() => void connectWallet()}
      >
        {buttonLabel}
      </Button>
    );
  }

  return (
    <>
      <div className={styles.walletCard} data-loading={balance.isLoading}>
        <div className={styles.balanceStack}>
          <span className={styles.balanceLabel}>Wallet Balance</span>
          <span className={styles.balanceValue}>{balanceLabel}</span>
        </div>

        <span className={styles.divider} aria-hidden />

        <button
          type="button"
          className={styles.addressButton}
          aria-label={`Wallet address ${address}`}
          title={address}
          onClick={() => setShowDisconnectModal(true)}
        >
          <span className={styles.profile}>
            <Profile publicAddress={address} size="md" isShort />
          </span>
          <span className={styles.addressStack}>
            <span className={styles.addressLabel}>Connected</span>
            <span className={styles.addressValue}>{truncatedAddress}</span>
          </span>
        </button>
      </div>

      <div id="modalContainer">
        <Modal
          visible={showDisconnectModal}
          onClose={() => setShowDisconnectModal(false)}
          parentId="modalContainer"
        >
          <Modal.Heading>
            Connected as{" "}
            <code style={{ lineBreak: "anywhere" }}>{address}</code>. Do you
            want to disconnect?
          </Modal.Heading>
          <Modal.Footer itemAlignment="stack">
            <Button
              size="md"
              variant="primary"
              onClick={() => {
                void disconnectWallet().then(() =>
                  setShowDisconnectModal(false),
                );
              }}
            >
              Disconnect
            </Button>
            <Button
              size="md"
              variant="tertiary"
              onClick={() => {
                setShowDisconnectModal(false);
              }}
            >
              Cancel
            </Button>
          </Modal.Footer>
        </Modal>
      </div>
    </>
  );
};
