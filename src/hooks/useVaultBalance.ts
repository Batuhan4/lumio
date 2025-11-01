import { useCallback, useEffect, useState } from "react";
import prepaidVault from "../contracts/prepaid_vault";
import { contractUnitsToNumber } from "../util/amount";
import { useWallet } from "./useWallet";

type VaultBalanceState = {
  balance: number;
  rawBalance: bigint | null;
  isLoading: boolean;
  error: Error | null;
};

const initialState: VaultBalanceState = {
  balance: 0,
  rawBalance: null,
  isLoading: false,
  error: null,
};

export const useVaultBalance = () => {
  const { address } = useWallet();
  const [state, setState] = useState<VaultBalanceState>(initialState);

  const refresh = useCallback(async () => {
    if (!address) {
      setState(initialState);
      return;
    }

    try {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      const tx = await prepaidVault.balance_of({ user: address });
      const result = tx.result as bigint | undefined;

      if (typeof result !== "bigint") {
        throw new Error("No balance returned from vault.");
      }

      setState({
        balance: contractUnitsToNumber(result),
        rawBalance: result,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setState({
        balance: 0,
        rawBalance: null,
        isLoading: false,
        error:
          error instanceof Error
            ? error
            : new Error("Failed to fetch vault balance."),
      });
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    ...state,
    refresh,
    hasAddress: Boolean(address),
  };
};
