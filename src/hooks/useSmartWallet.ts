import { use } from "react";
import {
  SmartWalletContext,
  type SmartWalletContextValue,
} from "../providers/SmartWalletProvider";

export const useSmartWallet = (): SmartWalletContextValue => {
  const context = use(SmartWalletContext);
  if (!context) {
    throw new Error("useSmartWallet must be used within a SmartWalletProvider");
  }
  return context;
};
