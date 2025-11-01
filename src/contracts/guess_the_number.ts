import * as Client from "guess_the_number";
import { rpcUrl } from "./util";

export default new Client.Client({
  networkPassphrase: "Standalone Network ; February 2017",
  contractId: "CAD3JCMTM624CDXAJBTPHMBVQNBFYOFXBON5NWHTALTR4NJRELN6GVFG",
  rpcUrl,
  allowHttp: true,
  publicKey: undefined,
});
