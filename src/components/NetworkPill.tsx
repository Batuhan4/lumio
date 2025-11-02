import React from "react";
import { useWallet } from "../hooks/useWallet";
import { stellarNetwork } from "../contracts/util";
import styles from "./NetworkPill.module.css";

// Format network name with first letter capitalized
const formatNetworkName = (name: string) =>
  // TODO: This is a workaround until @creit-tech/stellar-wallets-kit uses the new name for a local network.
  name === "STANDALONE"
    ? "Local"
    : name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();

const appNetwork = formatNetworkName(stellarNetwork);

const NetworkPill: React.FC = () => {
  const { network, address } = useWallet();

  // Check if there's a network mismatch
  const walletNetwork = formatNetworkName(network ?? "");
  const isNetworkMismatch = walletNetwork !== appNetwork;

  let title = "";
  let color = "#2ED06E";
  if (!address) {
    title = "Connect your wallet using this network.";
    color = "#C1C7D0";
  } else if (isNetworkMismatch) {
    title = `Wallet is on ${walletNetwork}, connect to ${appNetwork} instead.`;
    color = "#FF3B30";
  }

  return (
    <div
      className={styles.networkPill}
      title={title}
      data-mismatch={isNetworkMismatch ? "true" : undefined}
      data-idle={!address ? "true" : undefined}
      style={{ cursor: isNetworkMismatch ? "help" : "default" }}
    >
      <span
        className={styles.statusDot}
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span>{appNetwork}</span>
    </div>
  );
};

export default NetworkPill;
