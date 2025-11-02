import * as PrepaidVault from "prepaid_vault";
import { networkPassphrase, rpcUrl } from "./util";

type CreateClientOptions = {
  contractId?: string;
  rpcUrl?: string;
  networkPassphrase?: string;
  allowHttp?: boolean;
  publicKey?: string;
};

const DEFAULT_CONTRACT_ID =
  PrepaidVault.networks?.standalone?.contractId ??
  "CDPV6K6K5SSOOJ6Q22GJF67QQZ2TAUXWPDSC3ZS3ZZ3KXUX2VDVBAKMU";

export const createPrepaidVaultClient = (
  options: CreateClientOptions = {},
): PrepaidVault.Client => {
  return new PrepaidVault.Client({
    networkPassphrase: options.networkPassphrase ?? networkPassphrase,
    contractId: options.contractId ?? DEFAULT_CONTRACT_ID,
    rpcUrl: options.rpcUrl ?? rpcUrl,
    allowHttp: options.allowHttp ?? true,
    publicKey: options.publicKey,
  });
};

export default createPrepaidVaultClient();
