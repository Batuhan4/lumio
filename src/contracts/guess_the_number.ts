import * as Client from "guess_the_number";
import { rpcUrl } from "./util";

export default new Client.Client({
  networkPassphrase: "Standalone Network ; February 2017",
  contractId: "CAO7CUEEWBIFDBLBIPBYX7YQTSW44XWYAMM4GC4F6AET5PQM6CWU5TSM",
  rpcUrl,
  allowHttp: true,
  publicKey: undefined,
});
