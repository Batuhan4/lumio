import * as Client from "guess_the_number";
import { rpcUrl } from "./util";

export default new Client.Client({
  networkPassphrase: "Standalone Network ; February 2017",
  contractId: "CCZYFHK5PZQSRGHLKTVNT4BT3UBVTO2GOR6BLBBHS3GILZCSTBJF26NU",
  rpcUrl,
  allowHttp: true,
  publicKey: undefined,
});
