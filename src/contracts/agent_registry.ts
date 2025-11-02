import * as AgentRegistry from "agent_registry";
import { networkPassphrase, rpcUrl } from "./util";

type CreateClientOptions = {
  contractId?: string;
  rpcUrl?: string;
  networkPassphrase?: string;
  allowHttp?: boolean;
  publicKey?: string;
};

const DEFAULT_CONTRACT_ID =
  AgentRegistry.networks?.standalone?.contractId ??
  "CD52BQZKAX7MWRZEOLXRWUVNLYGW6M5INVKZ2JM363SI55VSI6VIFT34";

export const createAgentRegistryClient = (
  options: CreateClientOptions = {},
): AgentRegistry.Client => {
  return new AgentRegistry.Client({
    networkPassphrase: options.networkPassphrase ?? networkPassphrase,
    contractId: options.contractId ?? DEFAULT_CONTRACT_ID,
    rpcUrl: options.rpcUrl ?? rpcUrl,
    allowHttp: options.allowHttp ?? true,
    publicKey: options.publicKey,
  });
};

export default createAgentRegistryClient();
