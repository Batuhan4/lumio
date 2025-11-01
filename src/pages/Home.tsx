import { Badge, Button, Icon, Layout, Text } from "@stellar/design-system";
import { AgentCard } from "../components/agents/AgentCard";
import { MOCK_AGENTS, MOCK_RUN_HISTORY } from "../data/mock";
import styles from "./Home.module.css";

const heroStats = [
  {
    value: "$12.4M",
    label: "Escrowed & settled",
    detail: "Closed pilot on Stellar testnet",
  },
  {
    value: "58%",
    label: "Average refund",
    detail: "Auto-returned to users",
  },
  {
    value: "42s",
    label: "Median settlement",
    detail: "Open → finalize",
  },
];

const highlights = [
  {
    icon: <Icon.Shield02 />,
    title: "Deterministic escrow",
    description:
      "Escrow Max Charge on-chain and enforce meter budgets with Soroban contracts.",
  },
  {
    icon: <Icon.CoinsStacked02 />,
    title: "Refunds by default",
    description:
      "Runner usage reports finalize payouts instantly and send unused funds straight back.",
  },
  {
    icon: <Icon.ClockCheck />,
    title: "Simple schedules",
    description:
      "Ship daily digests or guardians with pause switches, per-run caps, and audit trails.",
  },
];

const workflow = [
  {
    title: "Approve the Max Charge",
    description:
      "Users pick the agent’s rate card and budgets. Lumio escrows the upper bound immediately.",
  },
  {
    title: "Runner executes inside caps",
    description:
      "Authorized keys stream live usage, halting when any meter hits its budget.",
  },
  {
    title: "Finalize and refund",
    description:
      "Contracts push the actual cost to the developer and refund the difference automatically.",
  },
];

const Home = () => {
  const showcaseAgents = MOCK_AGENTS.slice(0, 3);
  const latestReceipt = MOCK_RUN_HISTORY[0];

  return (
    <Layout.Content>
      <Layout.Inset>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.heroBadge}>
              <Badge size="sm" variant="secondary">
                Built for autonomous finance
              </Badge>
            </div>
            <Text as="h1" size="xl" className={styles.headline}>
              One-click AI agents with escrowed spend and instant refunds.
            </Text>
            <Text as="p" size="md" className={styles.subheadline}>
              Lumio lets you launch an agent marketplace that finance teams can
              trust—predictable max charges, automatic refunds, and receipts
              anyone can audit.
            </Text>
            <div className={styles.heroActions}>
              <Button size="lg" variant="primary">
                Launch a run
              </Button>
              <Button size="lg" variant="tertiary">
                See escrow flow
              </Button>
            </div>
          </div>
          <div className={styles.heroPanel}>
            <div className={styles.panelHeader}>
              <Text as="h3" size="sm">
                Lumio snapshot
              </Text>
              <Text as="p" size="xs" className={styles.panelSubhead}>
                Numbers pulled from pilot data.
              </Text>
            </div>
            <div className={styles.panelStats}>
              {heroStats.map((item) => (
                <div key={item.label} className={styles.panelStat}>
                  <Text as="div" size="lg" className={styles.statValue}>
                    {item.value}
                  </Text>
                  <Text as="div" size="sm" className={styles.statLabel}>
                    {item.label}
                  </Text>
                  <Text as="div" size="xs" className={styles.statDetail}>
                    {item.detail}
                  </Text>
                </div>
              ))}
            </div>
            {latestReceipt ? (
              <div className={styles.panelFooter}>
                <Icon.Receipt size="sm" />
                <Text as="p" size="xs">
                  Latest run refunded {latestReceipt.refundAmount.toFixed(2)}{" "}
                  USDC from a max charge of {latestReceipt.maxCharge.toFixed(2)}{" "}
                  USDC.
                </Text>
              </div>
            ) : null}
          </div>
        </section>

        <section className={`${styles.section} ${styles.surface}`}>
          <div className={styles.sectionIntro}>
            <Text as="h2" size="lg">
              Transparent rails from day one.
            </Text>
            <Text as="p" size="sm">
              Focus on building agents—Lumio handles escrow, enforcement, and
              refunds with the stellar-native primitives outlined in the PRD.
            </Text>
          </div>
          <div className={styles.highlightGrid}>
            {highlights.map((feature) => (
              <div key={feature.title} className={styles.highlightCard}>
                <div className={styles.featureIcon}>{feature.icon}</div>
                <Text as="h3" size="md">
                  {feature.title}
                </Text>
                <Text as="p" size="sm" className={styles.featureCopy}>
                  {feature.description}
                </Text>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionIntro}>
            <Badge size="sm" variant="secondary">
              Agents
            </Badge>
            <Text as="h2" size="lg">
              Ready-to-run lineup
            </Text>
            <Text as="p" size="sm">
              Three agents that showcase escrowed spend and automatic
              micro-refunds.
            </Text>
          </div>
          <div className={styles.agentGrid}>
            {showcaseAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} onRun={() => undefined} />
            ))}
          </div>
        </section>

        <section className={`${styles.section} ${styles.surface}`}>
          <div className={styles.sectionIntro}>
            <Badge size="sm" variant="secondary">
              Flow
            </Badge>
            <Text as="h2" size="lg">
              Escrow in three moves
            </Text>
          </div>
          <div className={styles.workflow}>
            {workflow.map((item, index) => (
              <div key={item.title} className={styles.workflowStep}>
                <span className={styles.stepNumber}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <Text as="h3" size="md">
                    {item.title}
                  </Text>
                  <Text as="p" size="sm" className={styles.workflowCopy}>
                    {item.description}
                  </Text>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={`${styles.section} ${styles.surfaceCta}`}>
          <div className={styles.sectionIntro}>
            <Text as="h2" size="lg">
              Spin up your first refund run
            </Text>
            <Text as="p" size="sm">
              Drop in a manifest, set rates, and Lumio handles escrow and
              refunds for you.
            </Text>
          </div>
          <div className={styles.heroActions}>
            <Button size="lg" variant="primary">
              Request builder access
            </Button>
            <Button size="lg" variant="tertiary">
              Read integration guide
            </Button>
          </div>
        </section>
      </Layout.Inset>
    </Layout.Content>
  );
};

export default Home;
