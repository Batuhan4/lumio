import { Badge, Button, Card, Icon, Text } from "@stellar/design-system";
import { formatPercent } from "../../util/format";
import type { AgentDefinition } from "../../data/mock";
import styles from "./AgentCard.module.css";

type AgentCardProps = {
  agent: AgentDefinition;
  onRun: (agent: AgentDefinition) => void;
};

export const AgentCard = ({ agent, onRun }: AgentCardProps) => (
  <Card borderRadiusSize="md" variant="primary">
    <div className={styles.card}>
      <div className={styles.header}>
        <div>
          <Text as="h3" size="lg">
            {agent.name}
          </Text>
          <Text as="p" size="sm" className={styles.headline}>
            {agent.headline}
          </Text>
        </div>
        <Badge size="md">{agent.developer}</Badge>
      </div>

      <Text as="p" size="sm">
        {agent.description}
      </Text>

      <div className={styles.metrics}>
        <div>
          <Text as="div" size="md">
            {formatPercent(agent.refundRate, { maximumFractionDigits: 0 })} avg
            refund
          </Text>
          <Text as="div" size="sm">
            {agent.runsLast24h} runs in last 24h
          </Text>
        </div>
        <div>
          <Text as="div" size="md">
            {formatPercent(agent.successRate, { maximumFractionDigits: 0 })}{" "}
            success
          </Text>
          <Text as="div" size="sm">
            {agent.avgLatencySeconds}s avg latency
          </Text>
        </div>
      </div>

      <div className={styles.tags}>
        {agent.categories.map((category) => (
          <Badge key={category} size="sm" variant="secondary">
            {category}
          </Badge>
        ))}
      </div>

      <div className={styles.footer}>
        <Text as="div" size="xs">
          Updated {new Date(agent.lastUpdated).toLocaleDateString()}
        </Text>
        <Button size="md" variant="primary" onClick={() => onRun(agent)}>
          <Icon.Rocket02 size="md" />
          Run
        </Button>
      </div>
    </div>
  </Card>
);
