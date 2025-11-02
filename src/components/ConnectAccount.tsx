import React from "react";
import { WalletButton } from "./WalletButton";
import NetworkPill from "./NetworkPill";
import styles from "./ConnectAccount.module.css";

const ConnectAccount: React.FC = () => {
  return (
    <div className={styles.connectAccount}>
      <WalletButton />
      <NetworkPill />
    </div>
  );
};

export default ConnectAccount;
