# 💡 Lumio: AI Agents with Light-Speed Transparency

**Lumio** lets anyone run or schedule AI agents with one click on the Stellar network.

> 🔮 **Our Brand Promise:** _Light-speed transparency._ You see the maximum cost upfront and get automatic refunds for any unused resources. No more surprise bills—just predictable, pay-per-use AI.

---

## ✨ Key Features

- 🛡️ **Predictable & Safe Spending:** Pre-approve a **Max Charge** for every run. Funds are held securely in an on-chain escrow, so you never spend more than you intend.
- 💸 **Automatic Refunds:** Unused funds are **instantly refunded** to your wallet after each run. You only pay for what you use, down to the millisecond.
- ⛓️ **Stellar-Native Payments:** Built on Stellar for fast, cheap, and transparent payments using stablecoins like USDC.
- 👩‍💻 **Simple Developer Monetization:** Agent developers can publish their work, set a public rate card, and get paid instantly for every run.
- 🧩 **Composable & Programmable:** With on-chain events and functions, other applications can easily trigger and integrate with Lumio agents for programmatic workflows.

---

## 🚀 How It Works

Lumio makes running AI agents as simple and transparent as possible.

1.  **Fund Your Wallet:** Deposit USDC into your personal on-chain `PrepaidVault`.
2.  **Pick an Agent:** Browse our marketplace of powerful AI agents.
3.  **Set Your Budget & Run:** Before running, you see a clear **Max Charge**. Click "Run" to approve and escrow that amount.
4.  **Agent Executes:** An off-chain "Runner" executes the agent's task, strictly enforcing the budget limits you approved.
5.  **Settle & Refund:** The Runner reports the **Actual Usage** to the smart contract. The contract pays the developer and instantly refunds the difference to you.

**Refund = Max Charge - Actual Cost**

It's that simple. All verifiable on-chain.

---

## 👥 Who is Lumio For?

### For Users ("Runners")

- ✅ **1-Click Runs:** A simple, beautiful interface to execute powerful AI agents.
- 💰 **Visible Max Charge:** Know the most you could possibly spend _before_ you commit.
- 🔄 **Automatic Refunds:** No need to claim or wait. Unused funds are sent back to your wallet automatically.
- 💵 **Predictable Platform Fee:** Every preview or run includes a fixed **USDC 0.01** Lumio fee, so operating costs stay transparent.
- 📈 **Full Audit Trail:** Every run, payment, and refund is a transaction on the Stellar ledger.
- 🗓️ **Scheduling:** Set agents to run on a schedule (e.g., hourly, daily) with daily spending caps for full control.

### For Developers

- 🚀 **Publish & Earn:** Easily list your AI agents on the marketplace and reach a wide audience.
- 💵 **Instant Payouts:** Receive your earnings in USDC the moment a run is successfully completed.
- 📢 **Public Rate Cards:** Define your own pricing for different resources (e.g., LLM tokens, CPU time, API calls).
- 🔗 **Simple Integration:** Just provide a manifest and a runner key to get your agent online.

---

## 🛠️ Technology Stack

Lumio is built with a modern, robust, and decentralized technology stack:

- **Frontend:** Next.js, React
- **Smart Contracts:** Rust, Soroban
- **Blockchain:** Stellar
- **Runner Service:** Node.js / TypeScript

---

## 💸 Pricing Model

- **Platform fee:** Every preview or full run deducts a flat **USDC 0.01** from the smart wallet before usage-based charges are applied.
- **Token metering:** We translate Gemini usage into USDC with midpoint rates derived from current public pricing:
  - Input tokens (text/image/video): **USDC 0.125 per 1M tokens**.
  - Output tokens (standard response mode): **USDC 0.50 per 1M tokens**.
  - HTTP calls and runtime meters retain their default rate card values for the MVP.
- **Automatic refunds:** If a run settles below its escrowed Max Charge, the difference is returned immediately—platform fees excluded.

This mirrors what the frontend enforces: smart wallet deductions equal `platform fee + metered usage`, ensuring even dry-run previews reflect real operating costs.

---

## 🎬 Live Demo Walkthrough

Here’s how to experience the magic of Lumio with our hackathon demo:

1.  **Deposit:** Add some testnet USDC to your wallet.
2.  **Run Once:** Choose the "Web Summarizer" agent, approve the **Max Charge**, and run it.
    - Want live Gemini responses? Click **Gemini API key** in the Builder header and paste your key before running.
3.  **See the Refund:** Check your run history. You'll see the `Actual Cost` and the `Refund` you automatically received!
4.  **Enable a Schedule:** Find the "RSS Digest" agent and set it to run hourly with a daily cap.
5.  **Pause It:** Go to your policy screen and hit "Pause." All scheduled and new runs will be stopped until you resume.
6.  **Test the Caps:** Try to run an agent with a `Max Charge` that exceeds your daily cap. The transaction will be safely rejected.

---

## 🔭 The Future of Lumio (Roadmap)

We're just getting started! Here's what we're dreaming of for P1 and beyond:

- ✅ **Verified Agents** & Reputation Systems
- 🤝 **Split Payments** for collaborative agents
- 🔐 **Private Data Vaults** for sensitive information
- 🖼️ A gallery of **workflow templates**
- 🏢 **Team accounts** with shared budgets and policies

---
