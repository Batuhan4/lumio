import type {
  StellarAccountNodeConfig,
  StellarNetwork,
} from "../types/workflows";

const DEFAULT_HORIZON_BASE: Record<StellarNetwork, string> = {
  PUBLIC: "https://horizon.stellar.org",
  TESTNET: "https://horizon-testnet.stellar.org",
  FUTURENET: "https://horizon-futurenet.stellar.org",
  LOCAL: "http://localhost:8000",
};

const buildHorizonUrl = (
  network: StellarNetwork,
  override?: string,
): string => {
  const trimmed = override?.trim();
  if (trimmed) {
    return trimmed.endsWith("/")
      ? trimmed.slice(0, trimmed.length - 1)
      : trimmed;
  }
  return DEFAULT_HORIZON_BASE[network];
};

const normalizeLimit = (limit: number) =>
  Math.min(200, Math.max(1, Math.round(limit)));

export type FetchStellarAccountParams = Pick<
  StellarAccountNodeConfig,
  "accountId" | "network" | "horizonUrl" | "paymentsLimit" | "includeFailed"
>;

export type StellarAccountFetchResult =
  | {
      ok: true;
      accountId: string;
      network: StellarNetwork;
      horizonUrl: string;
      balances: unknown;
      payments: unknown[];
    }
  | { ok: false; error: string; horizonUrl: string };

type HorizonAccountResponse = {
  balances?: unknown;
};

type HorizonPaymentsResponse = {
  _embedded?: {
    records?: unknown[];
  };
};

const readJsonSafely = async <T>(response: Response): Promise<T> => {
  try {
    return (await response.json()) as T;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to parse response.";
    throw new Error(message);
  }
};

const deriveErrorMessage = (response: Response, fallback: string) => {
  if (response.status === 404) {
    return "Account not found on the selected network.";
  }
  if (response.status === 0) {
    return "Request blocked — check CORS or network settings.";
  }
  return fallback;
};

export const fetchStellarAccount = async (
  params: FetchStellarAccountParams,
): Promise<StellarAccountFetchResult> => {
  const horizonBase = buildHorizonUrl(params.network, params.horizonUrl);
  const accountId = params.accountId.trim();
  if (!accountId) {
    return {
      ok: false,
      error: "Enter a Stellar account ID (public key).",
      horizonUrl: horizonBase,
    };
  }

  try {
    const accountResponse = await fetch(
      `${horizonBase}/accounts/${encodeURIComponent(accountId)}`,
    );
    if (!accountResponse.ok) {
      const message = deriveErrorMessage(
        accountResponse,
        "Failed to load account from Horizon.",
      );
      return { ok: false, error: message, horizonUrl: horizonBase };
    }

    const accountJson =
      await readJsonSafely<HorizonAccountResponse>(accountResponse);
    const balances: unknown =
      accountJson.balances !== undefined
        ? accountJson.balances
        : (accountJson as unknown);

    const paymentsLimit = normalizeLimit(params.paymentsLimit);
    const paymentsUrl = new URL(
      `${horizonBase}/accounts/${encodeURIComponent(accountId)}/payments`,
    );
    paymentsUrl.searchParams.set("order", "desc");
    paymentsUrl.searchParams.set("limit", paymentsLimit.toString());
    if (params.includeFailed) {
      paymentsUrl.searchParams.set("include_failed", "true");
    }

    let payments: unknown[] = [];
    try {
      const paymentsResponse = await fetch(paymentsUrl.toString());
      if (paymentsResponse.ok) {
        const paymentsJson =
          await readJsonSafely<HorizonPaymentsResponse>(paymentsResponse);
        const records = paymentsJson._embedded?.records;
        if (Array.isArray(records)) {
          payments = [...records];
        }
      }
    } catch (error) {
      console.warn("Failed to fetch payments from Horizon", error);
    }

    return {
      ok: true,
      accountId,
      network: params.network,
      horizonUrl: horizonBase,
      balances,
      payments,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reach Horizon.";
    return { ok: false, error: message, horizonUrl: horizonBase };
  }
};
