import { useState } from "react";
import {
  Badge,
  Button,
  Input,
  Layout,
  Select,
  Text,
  Textarea,
} from "@stellar/design-system";
import styles from "./Developers.module.css";

const categories = ["Automation", "Compliance", "Research", "Summaries"];

const Developers = () => {
  const [category, setCategory] = useState(categories[0]);

  return (
    <Layout.Content>
      <Layout.Inset>
        <div className={styles.heading}>
          <div>
            <Text as="h1" size="xl">
              Developer console
            </Text>
            <Text as="p" size="md">
              Publish an agent with a versioned rate card, register runner keys,
              and start receiving deterministic payouts per run.
            </Text>
          </div>
          <Badge size="md" variant="secondary">
            Soroban ready
          </Badge>
        </div>

        <div className={styles.grid}>
          <div className={styles.panel}>
            <div className={styles.cardContent}>
              <Text as="h3" size="md">
                Register agent metadata
              </Text>
              <Input
                id="agent-name"
                fieldSize="md"
                label="Agent name"
                placeholder="eg. Web Summarizer"
              />
              <Textarea
                id="agent-description"
                fieldSize="md"
                label="Summary"
                placeholder="One sentence that highlights the workflow and refund dynamics."
              />
              <Select
                id="agent-category"
                fieldSize="md"
                label="Category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
              <Input
                id="agent-manifest"
                fieldSize="md"
                label="Manifest CID"
                placeholder="ipfs://..."
              />
              <Input
                id="runner-key"
                fieldSize="md"
                label="Authorized runner key"
                placeholder="GABC..."
              />
              <Button variant="primary" size="md">
                Save draft
              </Button>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.cardContent}>
              <Text as="h3" size="md">
                Rate card preview
              </Text>
              <Text as="p" size="sm">
                Define deterministic meters and rates. Lumio derives the Max
                Charge and refunds automatically based on these values.
              </Text>
              <div className={styles.rates}>
                <Input
                  id="rate-llm-in"
                  fieldSize="sm"
                  label="LLM input (per 1K tokens)"
                  type="number"
                  min={0}
                  step={0.0001}
                />
                <Input
                  id="rate-llm-out"
                  fieldSize="sm"
                  label="LLM output (per 1K tokens)"
                  type="number"
                  min={0}
                  step={0.0001}
                />
                <Input
                  id="rate-http"
                  fieldSize="sm"
                  label="HTTP call (per request)"
                  type="number"
                  min={0}
                  step={0.0001}
                />
                <Input
                  id="rate-runtime"
                  fieldSize="sm"
                  label="Runtime (per 1K ms)"
                  type="number"
                  min={0}
                  step={0.0001}
                />
              </div>
              <Button variant="tertiary" size="md">
                Generate sample receipt
              </Button>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.cardContent}>
              <Text as="h3" size="md">
                Publish workflow
              </Text>
              <Text as="p" size="sm">
                1. Submit metadata to `AgentRegistry` <br />
                2. Upload rate card JSON + manifest hash <br />
                3. Register runner public key and signature scheme <br />
                4. Lumio indexes and lists your agent in minutes
              </Text>
              <Button variant="primary" size="md">
                Publish v1.0.0
              </Button>
            </div>
          </div>
        </div>
      </Layout.Inset>
    </Layout.Content>
  );
};

export default Developers;
