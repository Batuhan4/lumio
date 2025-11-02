# Wallet Activity Summary Workflow

## Goal

- Demonstrate how Lumio Builder can pull live wallet data from the Stellar network and turn it into an actionable summary with portfolio suggestions.
- Keep the flow minimal (only `stellar-account` → `gemini`) so it runs with the features currently enabled on the website.

## Nodes & Configuration

- **Node 1 – `stellar-account`**
  - Title: `Wallet activity`
  - Inputs: none (first node).
  - Config fields:
    - `Account ID`: address you want to monitor (for demos, pick a public account such as `GBZXN7PIRZGNMHGA7DXDLGRKWQOMYV5W7MT325Z3CXPWWAGLODJ4Y5Y2`).
    - Network: choose the appropriate network option (testnet vs pubnet).
    - Preview: run once so you can copy the returned balances and payment history JSON.
- **Node 2 – `gemini`**
  - Title: `Summarize wallet activity`
  - Prompt template (use the provided request):

    ```
    Summarize wallet activity; highlight incoming vs outgoing payments; note unusual large transactions.
    Wallet data:
    {{wallet_json}}

    Provide:
    - Key balance changes
    - Net flow (incoming vs outgoing)
    - Any unusually large transactions
    - Suggestions for how to rebalance or hedge the portfolio
    ```

  - Input variables: add `wallet_json`.
    - In **Preview inputs**, paste the JSON returned from the `stellar-account` preview into `wallet_json`.
  - Optional tweaks for the demo:
    - Set `Response MIME type` to `text/plain`.
    - Adjust temperature (e.g., `0.4`) for a balanced tone.

## Canvas Flow

1. Drag **Wallet activity (`stellar-account`)** onto the canvas; place it left.
2. Drag **Summarize wallet activity (`gemini`)** to the right.
3. Connect the output port of the Stellar node to the Gemini node’s input.
4. In the Gemini node’s inspector, under **Input variables**, ensure `wallet_json` is shown as satisfied (the connection populates it at runtime).
5. Run **Preview** on both nodes:
   - First the Stellar node (ensures fresh JSON).
   - Then the Gemini node to show the human-readable summary with portfolio suggestions.

## Demo Tips

- Before presenting, refresh the Stellar preview to capture up-to-date transactions so the summary feels current.
- Highlight how variable templating lets Gemini ingest the exact JSON payload without custom code.
- Point out that additional nodes (e.g., conditional alerts or HTTP webhooks) can be added later, but this baseline flow already showcases on-chain data + AI commentary.
