import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Icon,
  Input,
  Modal,
  Select,
  Text,
  Toggle,
} from "@stellar/design-system";
import type { AgentBudgets, AgentDefinition } from "../../data/mock";
import { computeMaxCharge, metersInDisplayOrder } from "../../util/pricing";
import { formatCurrency } from "../../util/format";
import styles from "./RunAgentModal.module.css";

type ScheduleCadence = "Hourly" | "Daily" | "Weekly";

type RunAgentModalProps = {
  agent: AgentDefinition | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (payload: {
    agentId: string;
    budgets: AgentBudgets;
    schedule?: {
      enabled: boolean;
      cadence: ScheduleCadence;
      startNow: boolean;
    };
  }) => void;
};

const scheduleCadenceOptions: ScheduleCadence[] = ["Hourly", "Daily", "Weekly"];

export const RunAgentModal = ({
  agent,
  isOpen,
  onClose,
  onConfirm,
}: RunAgentModalProps) => {
  const [budgets, setBudgets] = useState<AgentBudgets | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleCadence, setScheduleCadence] =
    useState<ScheduleCadence>("Daily");
  const [startImmediately, setStartImmediately] = useState(true);

  useEffect(() => {
    if (agent) {
      setBudgets(agent.defaultBudgets);
      setScheduleEnabled(false);
      setScheduleCadence("Daily");
      setStartImmediately(true);
    }
  }, [agent, isOpen]);

  const maxCharge = useMemo(() => {
    if (!agent || !budgets) {
      return 0;
    }

    return computeMaxCharge(budgets, agent.rateCard);
  }, [agent, budgets]);

  if (!agent || !budgets) {
    return (
      <Modal visible={isOpen} onClose={onClose}>
        <Modal.Heading>Loading agent</Modal.Heading>
      </Modal>
    );
  }

  const handleBudgetChange = (key: keyof AgentBudgets, value: number) => {
    setBudgets((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        [key]: Number.isNaN(value) ? prev[key] : value,
      };
    });
  };

  const confirmRun = () => {
    onConfirm({
      agentId: agent.id,
      budgets,
      schedule: {
        enabled: scheduleEnabled,
        cadence: scheduleCadence,
        startNow: startImmediately,
      },
    });
    onClose();
  };

  return (
    <Modal visible={isOpen} onClose={onClose}>
      <Modal.Heading>{agent.name}</Modal.Heading>
      <Modal.Body>
        <div className={styles.section}>
          <Text as="p" size="sm">
            {agent.headline}
          </Text>
          <div className={styles.rateCard}>
            {metersInDisplayOrder
              .map((meter) => agent.rateCard.find((rate) => rate.key === meter))
              .filter(Boolean)
              .map((rate) => (
                <Badge
                  key={rate!.key}
                  variant="secondary"
                >{`${rate!.label}: ${rate!.unit} — ${formatCurrency(rate!.rate, "USDC")}`}</Badge>
              ))}
          </div>
        </div>

        <div className={styles.section}>
          <Text as="h4" size="md">
            Budgets
          </Text>
          <div className={styles.grid}>
            {metersInDisplayOrder
              .map((meter) => agent.rateCard.find((rate) => rate.key === meter))
              .filter(Boolean)
              .map((rate) => (
                <Input
                  key={rate!.key}
                  id={`${agent.id}-${rate!.key}`}
                  fieldSize="md"
                  type="number"
                  min={0}
                  step={rate!.unitSize}
                  label={rate!.label}
                  note={rate!.unit}
                  value={budgets[rate!.key]}
                  onChange={(event) =>
                    handleBudgetChange(
                      rate!.key,
                      Number(event.currentTarget.value),
                    )
                  }
                />
              ))}
          </div>
        </div>

        <div className={styles.section}>
          <Text as="h4" size="md">
            Scheduling
          </Text>
          <div className={styles.scheduleRow}>
            <Toggle
              id="enable-schedule"
              checked={scheduleEnabled}
              fieldSize="md"
              onChange={() => setScheduleEnabled((prev) => !prev)}
            />
            <Text as="span" size="sm">
              Enable recurring runs
            </Text>
          </div>

          {scheduleEnabled ? (
            <div className={styles.scheduleFields}>
              <Select
                id="schedule-cadence"
                fieldSize="md"
                value={scheduleCadence}
                onChange={(event) =>
                  setScheduleCadence(
                    event.currentTarget.value as ScheduleCadence,
                  )
                }
                label="Cadence"
              >
                {scheduleCadenceOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
              <Toggle
                id="run-now"
                checked={startImmediately}
                fieldSize="sm"
                onChange={() => setStartImmediately((prev) => !prev)}
                title="Start immediately"
                iconChecked={<Icon.PlayCircle />}
                iconUnchecked={<Icon.ClockPlus />}
              />
              <Text as="span" size="sm">
                Start now
              </Text>
            </div>
          ) : null}
        </div>

        <div className={styles.section}>
          <Text as="p" size="sm">
            Estimated Max Charge:
          </Text>
          <Text as="p" size="lg">
            {formatCurrency(maxCharge)}
          </Text>
          <Text as="p" size="xs">
            Unused funds are automatically refunded at settlement.
          </Text>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="tertiary" size="md" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={confirmRun}
          disabled={maxCharge <= 0}
        >
          Confirm Max {formatCurrency(maxCharge)}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
