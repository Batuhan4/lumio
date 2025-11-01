import {
  Badge,
  Button,
  Icon,
  Layout,
  Table,
  Text,
} from "@stellar/design-system";
import { MOCK_RUN_HISTORY } from "../data/mock";
import {
  formatCurrency,
  formatPercent,
  formatRelativeDate,
} from "../util/format";
import styles from "./History.module.css";

const statusToBadge: Record<
  (typeof MOCK_RUN_HISTORY)[number]["status"],
  {
    label: string;
    variant: "primary" | "secondary" | "success" | "warning" | "error";
  }
> = {
  completed: { label: "Settled", variant: "success" },
  refunded: { label: "Refunded", variant: "secondary" },
  running: { label: "Running", variant: "primary" },
  cancelled: { label: "Cancelled", variant: "warning" },
};

const History = () => (
  <Layout.Content>
    <Layout.Inset>
      <div className={styles.heading}>
        <div>
          <Text as="h1" size="xl">
            Run history & receipts
          </Text>
          <Text as="p" size="md">
            Every run is settled on Stellar. Track Max Charge, Actual, and
            refund flows with direct links to transaction receipts.
          </Text>
        </div>
        <Button variant="tertiary" size="md">
          <Icon.Download02 />
          Export CSV
        </Button>
      </div>

      <div className={styles.tableSurface}>
        <Table
          id="run-history"
          data={MOCK_RUN_HISTORY}
          breakpoint={600}
          columnLabels={[
            { id: "agent", label: "Agent" },
            { id: "maxCharge", label: "Max Charge" },
            { id: "actual", label: "Actual / Refund" },
            { id: "status", label: "Status" },
            { id: "time", label: "Timestamp" },
            { id: "actions", label: "" },
          ]}
          renderItemRow={(run) => {
            const badge = statusToBadge[run.status];
            const refundRate =
              run.maxCharge > 0 ? run.refundAmount / run.maxCharge : 0;

            return (
              <>
                <td>
                  <div className={styles.agentCell}>
                    <Text as="span" size="sm">
                      {run.agentName}
                    </Text>
                    <Text as="span" size="xs" className={styles.muted}>
                      Run #{run.id}
                    </Text>
                  </div>
                </td>
                <td>{formatCurrency(run.maxCharge)}</td>
                <td>
                  <div className={styles.chargeCell}>
                    <span>{formatCurrency(run.actualCharge)}</span>
                    <span className={styles.refundChip}>
                      {formatCurrency(run.refundAmount)} refund ·{" "}
                      {formatPercent(refundRate, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </td>
                <td>
                  <Badge variant={badge.variant} size="sm">
                    {badge.label}
                  </Badge>
                </td>
                <td>
                  <div className={styles.agentCell}>
                    <Text as="span" size="sm">
                      {formatRelativeDate(run.finalizedAt)}
                    </Text>
                    <Text as="span" size="xs" className={styles.muted}>
                      Opened {formatRelativeDate(run.startedAt)}
                    </Text>
                  </div>
                </td>
                <td>
                  <div className={styles.actions}>
                    <Button variant="tertiary" size="sm">
                      <Icon.LinkExternal01 />
                      View tx
                    </Button>
                    <Button variant="tertiary" size="sm">
                      <Icon.Link01 />
                      Output
                    </Button>
                  </div>
                </td>
              </>
            );
          }}
        />
      </div>
    </Layout.Inset>
  </Layout.Content>
);

export default History;
