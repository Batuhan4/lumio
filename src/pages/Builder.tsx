import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  Icon,
  Input,
  Layout,
  Modal,
  Select,
  Text,
  Textarea,
} from "@stellar/design-system";
import {
  createWorkflowDefinition,
  createWorkflowNode,
  loadWorkflowState,
  saveWorkflowState,
  upsertWorkflow,
} from "../util/workflows";
import { generateText as generateGeminiText } from "../services/gemini";
import { executeHttpRequest } from "../services/http";
import type { HttpRequestExecution } from "../services/http";
import { interpolateTemplate } from "../util/templates";
import { useGeminiApiKey } from "../hooks/useGeminiApiKey";
import { useNotification } from "../hooks/useNotification";
import { useWallet } from "../hooks/useWallet";
import { useSmartWallet } from "../hooks/useSmartWallet";
import {
  DEFAULT_HTTP_CONFIG,
  DEFAULT_STELLAR_ACCOUNT_CONFIG,
} from "../types/workflows";
import type {
  GeminiNodeConfig,
  HttpKeyValue,
  HttpMethod,
  HttpNodeConfig,
  StellarAccountNodeConfig,
  StellarNetwork,
  WorkflowConnection,
  WorkflowDefinition,
  WorkflowDraftState,
  WorkflowNode,
  WorkflowNodeKind,
} from "../types/workflows";
import { fetchStellarAccount } from "../services/stellarAccount";
import {
  computeUsageCharge,
  createEmptyUsage,
  DEFAULT_RATE_CARD,
  PLATFORM_FEE,
  type AgentUsage,
} from "../util/pricing";
import { formatCurrency, formatRelativeDate } from "../util/format";
import styles from "./Builder.module.css";

const GRID_SIZE = 48;
const NODE_WIDTH = 240;
const NODE_HEIGHT = 128;
const BASE_CANVAS_WIDTH = GRID_SIZE * 1200;
const BASE_CANVAS_HEIGHT = GRID_SIZE * 1200;
const MIN_CANVAS_SCALE = 0.01;
const MAX_CANVAS_SCALE = 64;
const CANVAS_ZOOM_FACTOR = 1.2;
const CONNECTION_PIPE_HEIGHT = 12;
const GEMINI_MODEL_OPTIONS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-pro",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash-8b",
];
const GEMINI_RESPONSE_MIME_TYPES: Array<{
  value: "text/plain" | "application/json";
  label: string;
}> = [
  { value: "text/plain", label: "Plain text" },
  { value: "application/json", label: "JSON" },
];

const HTTP_METHOD_OPTIONS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
];

const HTTP_BODY_MIME_TYPES: Array<{
  value: "application/json" | "text/plain";
  label: string;
}> = [
  { value: "application/json", label: "JSON" },
  { value: "text/plain", label: "Plain text" },
];

const STELLAR_NETWORK_OPTIONS: Array<{
  value: StellarNetwork;
  label: string;
}> = [
  { value: "PUBLIC", label: "Public" },
  { value: "TESTNET", label: "Testnet" },
  { value: "FUTURENET", label: "Futurenet" },
  { value: "LOCAL", label: "Local" },
];

type HttpAuthType = HttpNodeConfig["auth"]["type"];

const createHttpKeyValue = (): HttpKeyValue => ({
  id:
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `kv-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`,
  key: "",
  value: "",
  enabled: true,
});

const createConnectionId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `conn-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;

const EMPTY_NODES: WorkflowNode[] = [];
const EMPTY_CONNECTIONS: WorkflowConnection[] = [];

type PaletteItemDefinition = {
  kind: WorkflowNodeKind;
  title: string;
  description: string;
  icon: React.ReactNode;
  group: "Data & APIs" | "AI & Automation" | "System";
};

type CanvasMetrics = {
  rect: DOMRect;
  scale: number;
  panX: number;
  panY: number;
};

type WorkflowRunStepSummary = {
  nodeId: string;
  title: string;
  status: "success" | "error" | "skipped";
  detail?: string;
};

type WorkflowRunResultEntry = {
  nodeId: string;
  title: string;
  status: WorkflowRunStepSummary["status"];
  detail?: string;
  outputs: Record<string, string>;
};

type WorkflowRunResult = {
  executedAt: string;
  runType: "preview" | "run";
  workflowLabel: string;
  entries: WorkflowRunResultEntry[];
};

const formatOutputLabel = (key: string) => {
  const suffix = key.split(".").pop() ?? key;
  switch (suffix) {
    case "output_text":
      return "Gemini output";
    case "output_json":
      return "Gemini JSON";
    case "status":
      return "HTTP status";
    case "body_text":
      return "HTTP body";
    case "body_json":
      return "HTTP JSON";
    case "wallet_json":
      return "Wallet snapshot";
    case "balances_json":
      return "Balances";
    case "payments_json":
      return "Payments";
    default:
      return suffix.replace(/_/g, " ");
  }
};

const GEMINI_DEFAULT_INPUT_PLACEHOLDER =
  "Lumio escrows the max charge for each agent run, then refunds the unused amount automatically.";

const DEFAULT_WALLET_SYSTEM_PROMPT = `
You are Lumio's financial co-pilot. Analyse Stellar wallet telemetry and respond as a pragmatic portfolio strategist.
- Read balances, asset types and liabilities.
- Review payments to detect inflows/outflows, cadence, and counterparties.
- Surface risk signals and liquidity warnings.
- Recommend a diversified basket across XLM, stablecoins, and two speculative tokens; justify with wallet context and macros.
- ALWAYS end with three concrete next actions and a confidence score (0-100).
Stay concise (<= 220 words) but data-backed.`;

const WALLET_ANALYSIS_GUIDE = `
Respond using the following structure:
Overview: concise narrative on solvency and runway.
Balances & Positions: bullet list with token, amount, % share, and notes.
Recent Activity: key payments or trends detected.
Suggested Basket: table-like list with asset, target %, rationale.
Actions: three numbered tasks.
Confidence: integer 0-100.
`;

const snapshotFromPreview = (
  preview: StellarAccountNodeConfig["lastPreview"],
) => {
  if (!preview) {
    return "";
  }
  return safeStringify({
    accountId: preview.accountId,
    network: preview.network,
    horizonUrl: preview.horizonUrl,
    balances: preview.balances ?? [],
    payments: preview.payments ?? [],
  });
};

const snapPosition = ({ x, y }: { x: number; y: number }) => ({
  x: Math.round(x / GRID_SIZE) * GRID_SIZE,
  y: Math.round(y / GRID_SIZE) * GRID_SIZE,
});

const getNodeCenter = (node: WorkflowNode) => ({
  x: node.position.x + NODE_WIDTH / 2,
  y: node.position.y + NODE_HEIGHT / 2,
});

const getNodeEdgePoint = (
  node: WorkflowNode,
  towardPoint: { x: number; y: number },
) => {
  const center = getNodeCenter(node);
  const dx = towardPoint.x - center.x;
  const dy = towardPoint.y - center.y;
  if (dx === 0 && dy === 0) {
    return center;
  }
  const halfWidth = NODE_WIDTH / 2;
  const halfHeight = NODE_HEIGHT / 2;
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx);
  const scaleY =
    dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  };
};

const findDisconnectedNodes = (
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
) => {
  if (nodes.length <= 1) {
    return [] as WorkflowNode[];
  }

  const adjacency = new Map<string, Set<string>>();
  nodes.forEach((node) => adjacency.set(node.id, new Set()));
  connections.forEach((connection) => {
    const fromNeighbors = adjacency.get(connection.from);
    const toNeighbors = adjacency.get(connection.to);
    if (!fromNeighbors || !toNeighbors) {
      return;
    }
    fromNeighbors.add(connection.to);
    toNeighbors.add(connection.from);
  });

  const startNode =
    nodes.find((node) => (adjacency.get(node.id)?.size ?? 0) > 0) ?? nodes[0];
  if (!startNode) {
    return [] as WorkflowNode[];
  }

  const stack = [startNode.id];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId || visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);
    const neighbors = adjacency.get(currentId);
    neighbors?.forEach((neighborId) => {
      if (!visited.has(neighborId)) {
        stack.push(neighborId);
      }
    });
  }

  return nodes.filter((node) => !visited.has(node.id));
};

const safeStringify = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const sortWorkflowNodes = (
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
): { success: true; order: WorkflowNode[] } | { success: false } => {
  const nodeMap = new Map<string, WorkflowNode>();
  nodes.forEach((node) => nodeMap.set(node.id, node));

  const inDegree = new Map<string, number>();
  nodeMap.forEach((_, id) => inDegree.set(id, 0));

  const adjacency = new Map<string, string[]>();

  connections.forEach((connection) => {
    const fromExists = nodeMap.has(connection.from);
    const toExists = nodeMap.has(connection.to);
    if (!fromExists || !toExists) {
      return;
    }
    const list = adjacency.get(connection.from) ?? [];
    list.push(connection.to);
    adjacency.set(connection.from, list);
    inDegree.set(connection.to, (inDegree.get(connection.to) ?? 0) + 1);
  });

  const queue: WorkflowNode[] = nodes
    .filter((node) => (inDegree.get(node.id) ?? 0) === 0)
    .sort((a, b) => {
      if (a.position.x !== b.position.x) {
        return a.position.x - b.position.x;
      }
      return a.position.y - b.position.y;
    });

  const order: WorkflowNode[] = [];
  const queueCopy = [...queue];

  while (queueCopy.length > 0) {
    const current = queueCopy.shift();
    if (!current) break;
    order.push(current);

    const outgoing = adjacency.get(current.id) ?? [];
    outgoing.forEach((targetId) => {
      const nextDegree = (inDegree.get(targetId) ?? 0) - 1;
      inDegree.set(targetId, nextDegree);
      if (nextDegree === 0) {
        const targetNode = nodeMap.get(targetId);
        if (targetNode) {
          queueCopy.push(targetNode);
          queueCopy.sort((a, b) => {
            if (a.position.x !== b.position.x) {
              return a.position.x - b.position.x;
            }
            return a.position.y - b.position.y;
          });
        }
      }
    });
  }

  if (order.length !== nodeMap.size) {
    return { success: false };
  }

  return { success: true, order };
};

const PaletteItem: React.FC<{
  item: PaletteItemDefinition;
  onDragStart: (
    event: React.DragEvent<HTMLButtonElement>,
    kind: WorkflowNodeKind,
  ) => void;
}> = ({ item, onDragStart }) => (
  <button
    type="button"
    className={styles.paletteItem}
    draggable
    onDragStart={(event) => onDragStart(event, item.kind)}
  >
    {item.icon}
    <div>
      <span>{item.title}</span>
      <small>{item.description}</small>
    </div>
  </button>
);

const CanvasNode: React.FC<{
  node: WorkflowNode;
  onSelect: (id: string) => void;
  onActivate: (id: string) => void;
  isSelected: boolean;
  onDrag: (id: string, position: { x: number; y: number }) => void;
  getCanvasMetrics: () => CanvasMetrics | null;
  onStartConnection: (id: string) => void;
  onCompleteConnection: (id: string) => void;
  isConnectionSource: boolean;
  canAcceptConnection: boolean;
}> = ({
  node,
  onSelect,
  onActivate,
  isSelected,
  onDrag,
  getCanvasMetrics,
  onStartConnection,
  onCompleteConnection,
  isConnectionSource,
  canAcceptConnection,
}) => {
  const didDragRef = useRef(false);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const metrics = getCanvasMetrics();
    if (!metrics) return;
    if (event.button !== 0 && event.pointerType !== "touch") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startTarget = event.currentTarget;
    const { rect, scale, panX, panY } = metrics;
    const pointerCanvasX = (event.clientX - rect.left - panX) / scale;
    const pointerCanvasY = (event.clientY - rect.top - panY) / scale;
    const originX = pointerCanvasX - node.position.x;
    const originY = pointerCanvasY - node.position.y;
    const startPosition = { x: node.position.x, y: node.position.y };

    didDragRef.current = false;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      const currentMetrics = getCanvasMetrics();
      if (!currentMetrics) return;
      const {
        rect: moveRect,
        scale: moveScale,
        panX: currentPanX,
        panY: currentPanY,
      } = currentMetrics;

      const pointerX =
        (moveEvent.clientX - moveRect.left - currentPanX) / moveScale - originX;
      const pointerY =
        (moveEvent.clientY - moveRect.top - currentPanY) / moveScale - originY;
      const nextX = pointerX;
      const nextY = pointerY;

      if (
        !didDragRef.current &&
        (Math.abs(nextX - startPosition.x) > 2 ||
          Math.abs(nextY - startPosition.y) > 2)
      ) {
        didDragRef.current = true;
      }

      onDrag(node.id, { x: nextX, y: nextY });
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      try {
        startTarget.releasePointerCapture(pointerId);
      } catch {
        /* noop */
      }
      if (!didDragRef.current) {
        onActivate(node.id);
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    startTarget.setPointerCapture(pointerId);
    onSelect(node.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        styles.node,
        isSelected ? styles.nodeSelected : "",
        isConnectionSource ? styles.nodeAsSource : "",
        canAcceptConnection ? styles.nodeReadyTarget : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        left: node.position.x,
        top: node.position.y,
        width: NODE_WIDTH,
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node.id);
          onActivate(node.id);
        }
      }}
      onPointerDown={handlePointerDown}
    >
      <div className={styles.nodeHeader}>
        <span className={styles.nodeTitle}>{node.title}</span>
        <span className={styles.nodeBadge}>{node.kind}</span>
      </div>
      <div className={styles.nodeBody}>
        <Text as="p" size="xs">
          {node.description}
        </Text>
      </div>
      <div className={styles.nodePorts}>
        <button
          type="button"
          className={styles.nodePort}
          title="Connect as target"
          disabled={!canAcceptConnection}
          onClick={(event) => {
            event.stopPropagation();
            if (canAcceptConnection) {
              onCompleteConnection(node.id);
            }
          }}
        />
        <button
          type="button"
          className={styles.nodePort}
          title={
            isConnectionSource
              ? "Cancel connection"
              : "Connect to another action"
          }
          onClick={(event) => {
            event.stopPropagation();
            onStartConnection(node.id);
          }}
        />
      </div>
    </div>
  );
};

const Builder = () => {
  const [scale, setScale] = useState(1);
  const paletteItems = useMemo<PaletteItemDefinition[]>(
    () => [
      {
        kind: "http",
        title: "HTTP request",
        description: "REST, GraphQL, webhooks",
        group: "Data & APIs",
        icon: <Icon.Globe02 />,
      },
      {
        kind: "stellar-account",
        title: "Stellar account",
        description: "Query balances and history",
        group: "Data & APIs",
        icon: <Icon.Database01 />,
      },
      {
        kind: "gemini",
        title: "Gemini prompt",
        description: "Generate text & JSON",
        group: "AI & Automation",
        icon: <Icon.MagicWand02 />,
      },
      {
        kind: "classifier",
        title: "Classifier",
        description: "Route by intent",
        group: "AI & Automation",
        icon: <Icon.CpuChip02 />,
      },
      {
        kind: "conditional",
        title: "Conditional",
        description: "Branch on fields",
        group: "System",
        icon: <Icon.GitBranch02 />,
      },
      {
        kind: "ipfs",
        title: "Pin to IPFS",
        description: "Store agent output",
        group: "System",
        icon: <Icon.UploadCloud02 />,
      },
    ],
    [],
  );

  const paletteLookup = useMemo(() => {
    const lookup = new Map<WorkflowNodeKind, PaletteItemDefinition>();
    paletteItems.forEach((item) => lookup.set(item.kind, item));
    return lookup;
  }, [paletteItems]);

  const [workflowState, setWorkflowState] = useState<WorkflowDraftState>(() => {
    const stored = loadWorkflowState();
    if (stored.activeWorkflowId) {
      return stored;
    }
    const initialWorkflow = createWorkflowDefinition("Untitled workflow");
    const initialState: WorkflowDraftState = {
      activeWorkflowId: initialWorkflow.id,
      workflows: {
        [initialWorkflow.id]: initialWorkflow,
      },
    };
    saveWorkflowState(initialState);
    return initialState;
  });

  const activeWorkflowId = workflowState.activeWorkflowId;
  const activeWorkflow =
    activeWorkflowId && workflowState.workflows[activeWorkflowId]
      ? workflowState.workflows[activeWorkflowId]
      : null;
  const nodes = activeWorkflow?.nodes ?? EMPTY_NODES;
  const connections = activeWorkflow?.connections ?? EMPTY_CONNECTIONS;
  const {
    apiKey: geminiApiKey,
    persistedKey: geminiStoredKey,
    setApiKey: persistGeminiKey,
    clearApiKey: removeGeminiKey,
  } = useGeminiApiKey();
  const { address: walletAddress } = useWallet();
  const { balance: smartWalletBalance, deduct: deductFromSmartWallet } =
    useSmartWallet();
  const { addNotification } = useNotification();
  const [isGeminiKeyModalOpen, setGeminiKeyModalOpen] = useState(false);
  const [geminiKeyDraft, setGeminiKeyDraft] = useState(
    () => geminiStoredKey ?? "",
  );

  const updateActiveWorkflow = useCallback(
    (
      mutator: (
        workflow: WorkflowDefinition,
      ) => WorkflowDefinition | null | undefined,
    ) => {
      setWorkflowState((previous) => {
        const id = previous.activeWorkflowId;
        if (!id) {
          return previous;
        }
        const current = previous.workflows[id];
        if (!current) {
          return previous;
        }
        const updated = mutator(current);
        if (!updated || updated === current) {
          return previous;
        }
        return upsertWorkflow(previous, updated);
      });
    },
    [],
  );

  const updateGeminiNode = useCallback(
    (
      nodeId: string,
      mutator: (
        node: WorkflowNode<"gemini">,
      ) => WorkflowNode<"gemini"> | null | undefined,
    ) => {
      updateActiveWorkflow((workflow) => {
        const index = workflow.nodes.findIndex((node) => node.id === nodeId);
        if (index === -1) {
          return workflow;
        }
        const currentNode = workflow.nodes[index];
        if (currentNode.kind !== "gemini") {
          return workflow;
        }
        const updated = mutator(currentNode as WorkflowNode<"gemini">);
        if (!updated || updated === currentNode) {
          return workflow;
        }
        const nextNodes = [...workflow.nodes];
        nextNodes[index] = updated;
        return {
          ...workflow,
          nodes: nextNodes,
        };
      });
    },
    [updateActiveWorkflow],
  );

  const updateGeminiConfig = useCallback(
    (
      nodeId: string,
      mutator: (config: GeminiNodeConfig) => GeminiNodeConfig,
      options?: { resetPreview?: boolean },
    ) => {
      updateGeminiNode(nodeId, (node) => {
        const nextConfig = mutator(node.config);
        const shouldReset = options?.resetPreview !== false;
        const finalConfig = shouldReset
          ? { ...nextConfig, lastPreview: undefined }
          : nextConfig;
        if (finalConfig === node.config) {
          return node;
        }
        return {
          ...node,
          config: finalConfig,
        };
      });
    },
    [updateGeminiNode],
  );

  const updateHttpNode = useCallback(
    (
      nodeId: string,
      mutator: (
        node: WorkflowNode<"http">,
      ) => WorkflowNode<"http"> | null | undefined,
    ) => {
      updateActiveWorkflow((workflow) => {
        const index = workflow.nodes.findIndex((node) => node.id === nodeId);
        if (index === -1) {
          return workflow;
        }
        const currentNode = workflow.nodes[index];
        if (currentNode.kind !== "http") {
          return workflow;
        }
        const updated = mutator(currentNode as WorkflowNode<"http">);
        if (!updated || updated === currentNode) {
          return workflow;
        }
        const nextNodes = [...workflow.nodes];
        nextNodes[index] = updated;
        return {
          ...workflow,
          nodes: nextNodes,
        };
      });
    },
    [updateActiveWorkflow],
  );

  const updateHttpConfig = useCallback(
    (
      nodeId: string,
      mutator: (config: HttpNodeConfig) => HttpNodeConfig,
      options?: { resetPreview?: boolean },
    ) => {
      updateHttpNode(nodeId, (node) => {
        const nextConfig = mutator(node.config);
        const shouldReset = options?.resetPreview !== false;
        const finalConfig = shouldReset
          ? { ...nextConfig, lastPreview: undefined }
          : nextConfig;
        if (finalConfig === node.config) {
          return node;
        }
        return {
          ...node,
          config: finalConfig,
        };
      });
    },
    [updateHttpNode],
  );

  const updateStellarNode = useCallback(
    (
      nodeId: string,
      mutator: (
        node: WorkflowNode<"stellar-account">,
      ) => WorkflowNode<"stellar-account"> | null | undefined,
    ) => {
      updateActiveWorkflow((workflow) => {
        const index = workflow.nodes.findIndex((node) => node.id === nodeId);
        if (index === -1) {
          return workflow;
        }
        const currentNode = workflow.nodes[index];
        if (currentNode.kind !== "stellar-account") {
          return workflow;
        }
        const updated = mutator(currentNode as WorkflowNode<"stellar-account">);
        if (!updated || updated === currentNode) {
          return workflow;
        }
        const nextNodes = [...workflow.nodes];
        nextNodes[index] = updated;
        return {
          ...workflow,
          nodes: nextNodes,
        };
      });
    },
    [updateActiveWorkflow],
  );

  const updateStellarConfig = useCallback(
    (
      nodeId: string,
      mutator: (config: StellarAccountNodeConfig) => StellarAccountNodeConfig,
      options?: { resetPreview?: boolean },
    ) => {
      updateStellarNode(nodeId, (node) => {
        const nextConfig = mutator(node.config);
        const shouldReset = options?.resetPreview !== false;
        const finalConfig = shouldReset
          ? { ...nextConfig, lastPreview: undefined }
          : nextConfig;
        if (finalConfig === node.config) {
          return node;
        }
        return {
          ...node,
          config: finalConfig,
        };
      });
    },
    [updateStellarNode],
  );

  const addConnection = useCallback(
    (fromId: string, toId: string) => {
      if (!fromId || !toId || fromId === toId) {
        return;
      }

      updateActiveWorkflow((workflow) => {
        const hasFrom = workflow.nodes.some((node) => node.id === fromId);
        const hasTo = workflow.nodes.some((node) => node.id === toId);
        if (!hasFrom || !hasTo) {
          return workflow;
        }

        if (
          workflow.connections.some(
            (connection) =>
              connection.from === fromId && connection.to === toId,
          )
        ) {
          return workflow;
        }

        const connection = {
          id: createConnectionId(),
          from: fromId,
          to: toId,
        };

        return {
          ...workflow,
          connections: [...workflow.connections, connection],
        };
      });
    },
    [updateActiveWorkflow],
  );

  const removeConnection = useCallback(
    (connectionId: string) => {
      updateActiveWorkflow((workflow) => {
        const nextConnections = workflow.connections.filter(
          (connection) => connection.id !== connectionId,
        );
        if (nextConnections.length === workflow.connections.length) {
          return workflow;
        }
        return {
          ...workflow,
          connections: nextConnections,
        };
      });
    },
    [updateActiveWorkflow],
  );

  const cancelPendingConnection = useCallback(() => {
    pendingConnectionSourceRef.current = null;
    setPendingConnectionSourceId(null);
  }, []);

  const handleStartConnection = useCallback(
    (nodeId: string) => {
      if (pendingConnectionSourceRef.current === nodeId) {
        cancelPendingConnection();
        return;
      }
      pendingConnectionSourceRef.current = nodeId;
      setPendingConnectionSourceId(nodeId);
    },
    [cancelPendingConnection],
  );

  const handleCompleteConnection = useCallback(
    (targetId: string) => {
      const sourceId = pendingConnectionSourceRef.current;
      if (sourceId && sourceId !== targetId) {
        addConnection(sourceId, targetId);
      }
      cancelPendingConnection();
    },
    [addConnection, cancelPendingConnection],
  );

  const handleNodeActivate = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      const sourceId = pendingConnectionSourceRef.current;
      if (!sourceId) {
        pendingConnectionSourceRef.current = nodeId;
        setPendingConnectionSourceId(nodeId);
        return;
      }
      if (sourceId === nodeId) {
        cancelPendingConnection();
        return;
      }

      const alreadyConnected = connections.some(
        (connection) =>
          connection.from === sourceId && connection.to === nodeId,
      );
      if (!alreadyConnected) {
        addConnection(sourceId, nodeId);
      }
      cancelPendingConnection();
    },
    [addConnection, cancelPendingConnection, connections],
  );

  const addGeminiVariable = useCallback(
    (node: WorkflowNode<"gemini">) => {
      const existing = new Set(node.config.inputVariables);
      let counter = node.config.inputVariables.length + 1;
      let candidate = `input${counter}`;
      while (existing.has(candidate)) {
        counter += 1;
        candidate = `input${counter}`;
      }

      updateGeminiConfig(node.id, (config) => ({
        ...config,
        inputVariables: [...config.inputVariables, candidate],
        testInputs: {
          ...config.testInputs,
          [candidate]: "",
        },
      }));
    },
    [updateGeminiConfig],
  );

  const renameGeminiVariable = useCallback(
    (node: WorkflowNode<"gemini">, index: number, rawName: string) => {
      const currentName = node.config.inputVariables[index];
      const trimmed = rawName.trim();
      if (!trimmed) {
        return;
      }

      const sanitized = trimmed.replace(/[^a-zA-Z0-9_]/g, "_");
      const others = node.config.inputVariables.filter((_, i) => i !== index);
      let candidate = sanitized;
      let suffix = 1;
      while (others.includes(candidate)) {
        candidate = `${sanitized}_${suffix}`;
        suffix += 1;
      }

      if (candidate === currentName) {
        return;
      }

      updateGeminiConfig(
        node.id,
        (config) => {
          const nextVariables = [...config.inputVariables];
          nextVariables[index] = candidate;
          const { [currentName]: previousValue, ...restInputs } =
            config.testInputs;
          return {
            ...config,
            inputVariables: nextVariables,
            testInputs: {
              ...restInputs,
              [candidate]: previousValue ?? "",
            },
          };
        },
        { resetPreview: false },
      );
    },
    [updateGeminiConfig],
  );

  const removeGeminiVariable = useCallback(
    (node: WorkflowNode<"gemini">, variableName: string) => {
      updateGeminiConfig(node.id, (config) => {
        if (!config.inputVariables.includes(variableName)) {
          return config;
        }
        const nextVariables = config.inputVariables.filter(
          (name) => name !== variableName,
        );
        const restInputs = { ...config.testInputs };
        delete restInputs[variableName];
        return {
          ...config,
          inputVariables: nextVariables,
          testInputs: restInputs,
        };
      });
    },
    [updateGeminiConfig],
  );

  const updateGeminiTestInput = useCallback(
    (node: WorkflowNode<"gemini">, variableName: string, value: string) => {
      updateGeminiConfig(
        node.id,
        (config) => ({
          ...config,
          testInputs: {
            ...config.testInputs,
            [variableName]: value,
          },
        }),
        { resetPreview: false },
      );
    },
    [updateGeminiConfig],
  );

  const addHttpVariable = useCallback(
    (node: WorkflowNode<"http">) => {
      const existing = new Set(node.config.inputVariables);
      let counter = node.config.inputVariables.length + 1;
      let candidate = `input${counter}`;
      while (existing.has(candidate)) {
        counter += 1;
        candidate = `input${counter}`;
      }

      updateHttpConfig(node.id, (config) => ({
        ...config,
        inputVariables: [...config.inputVariables, candidate],
        testInputs: {
          ...config.testInputs,
          [candidate]: "",
        },
      }));
    },
    [updateHttpConfig],
  );

  const renameHttpVariable = useCallback(
    (node: WorkflowNode<"http">, index: number, rawName: string) => {
      const currentName = node.config.inputVariables[index];
      const trimmed = rawName.trim();
      if (!trimmed) {
        return;
      }

      const sanitized = trimmed.replace(/[^a-zA-Z0-9_]/g, "_");
      const others = node.config.inputVariables.filter((_, i) => i !== index);
      let candidate = sanitized;
      let suffix = 1;
      while (others.includes(candidate)) {
        candidate = `${sanitized}_${suffix}`;
        suffix += 1;
      }

      if (candidate === currentName) {
        return;
      }

      updateHttpConfig(
        node.id,
        (config) => {
          const nextVariables = [...config.inputVariables];
          nextVariables[index] = candidate;
          const { [currentName]: previousValue, ...restInputs } =
            config.testInputs;
          return {
            ...config,
            inputVariables: nextVariables,
            testInputs: {
              ...restInputs,
              [candidate]: previousValue ?? "",
            },
          };
        },
        { resetPreview: false },
      );
    },
    [updateHttpConfig],
  );

  const removeHttpVariable = useCallback(
    (node: WorkflowNode<"http">, variableName: string) => {
      updateHttpConfig(node.id, (config) => {
        if (!config.inputVariables.includes(variableName)) {
          return config;
        }
        const nextVariables = config.inputVariables.filter(
          (variable) => variable !== variableName,
        );
        const restInputs = { ...config.testInputs };
        delete restInputs[variableName];
        return {
          ...config,
          inputVariables: nextVariables,
          testInputs: restInputs,
        };
      });
    },
    [updateHttpConfig],
  );

  const updateHttpTestInput = useCallback(
    (node: WorkflowNode<"http">, variableName: string, value: string) => {
      updateHttpConfig(
        node.id,
        (config) => ({
          ...config,
          testInputs: {
            ...config.testInputs,
            [variableName]: value,
          },
        }),
        { resetPreview: false },
      );
    },
    [updateHttpConfig],
  );

  const addHttpKeyValue = useCallback(
    (node: WorkflowNode<"http">, field: "headers" | "queryParams") => {
      updateHttpConfig(node.id, (config) => {
        const entries = config[field] ?? [];
        return {
          ...config,
          [field]: [...entries, createHttpKeyValue()],
        };
      });
    },
    [updateHttpConfig],
  );

  const updateHttpKeyValue = useCallback(
    (
      node: WorkflowNode<"http">,
      field: "headers" | "queryParams",
      keyValueId: string,
      mutator: (entry: HttpKeyValue) => HttpKeyValue,
    ) => {
      updateHttpConfig(node.id, (config) => {
        const entries = config[field] ?? [];
        const index = entries.findIndex((entry) => entry.id === keyValueId);
        if (index === -1) {
          return {
            ...config,
            [field]: entries,
          };
        }
        const nextEntries = [...entries];
        nextEntries[index] = mutator(nextEntries[index]);
        return {
          ...config,
          [field]: nextEntries,
        };
      });
    },
    [updateHttpConfig],
  );

  const removeHttpKeyValue = useCallback(
    (
      node: WorkflowNode<"http">,
      field: "headers" | "queryParams",
      id: string,
    ) => {
      updateHttpConfig(node.id, (config) => {
        const entries = config[field] ?? [];
        if (entries.length === 0) {
          return {
            ...config,
            [field]: [],
          };
        }
        return {
          ...config,
          [field]: entries.filter((entry) => entry.id !== id),
        };
      });
    },
    [updateHttpConfig],
  );

  const runGeminiPreview = useCallback(
    async (node: WorkflowNode<"gemini">) => {
      if (!geminiApiKey) {
        setPreviewError(
          "Set VITE_GEMINI_API_KEY (for example in .env.local) before running Gemini previews.",
        );
        return;
      }

      setIsPreviewRunning(true);
      setPreviewError(null);

      const compiledPrompt = interpolateTemplate(
        node.config.promptTemplate,
        node.config.inputVariables.reduce<Record<string, string>>(
          (accumulator, variable) => {
            accumulator[variable] = node.config.testInputs[variable] ?? "";
            return accumulator;
          },
          {},
        ),
      );

      try {
        const { text, usage } = await generateGeminiText({
          apiKey: geminiApiKey,
          model: node.config.model,
          prompt: compiledPrompt,
          systemInstruction: node.config.systemInstruction,
          temperature: node.config.temperature,
          topP: node.config.topP,
          topK: node.config.topK,
          maxOutputTokens: node.config.maxOutputTokens,
          responseMimeType: node.config.responseMimeType,
        });

        updateGeminiConfig(
          node.id,
          (config) => ({
            ...config,
            lastPreview: {
              executedAt: new Date().toISOString(),
              outputText: text,
              responseMimeType: config.responseMimeType,
              usage,
            },
          }),
          { resetPreview: false },
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to run Gemini preview.";
        setPreviewError(message);
      } finally {
        setIsPreviewRunning(false);
      }
    },
    [geminiApiKey, updateGeminiConfig],
  );

  const runHttpPreview = useCallback(
    async (node: WorkflowNode<"http">) => {
      setIsHttpPreviewRunning(true);
      setHttpPreviewError(null);

      const inputVariables = node.config.inputVariables ?? [];
      const testInputs = node.config.testInputs ?? {};
      const variables = inputVariables.reduce<Record<string, string>>(
        (accumulator, variable) => {
          accumulator[variable] = testInputs[variable] ?? "";
          return accumulator;
        },
        {},
      );

      const queryParams = node.config.queryParams ?? [];
      const headers = node.config.headers ?? [];

      try {
        const result: HttpRequestExecution = await executeHttpRequest({
          method: node.config.method,
          url: node.config.url,
          queryParams,
          headers,
          bodyTemplate: node.config.bodyTemplate,
          bodyMimeType: node.config.bodyMimeType,
          auth: node.config.auth,
          timeoutMs: node.config.timeoutMs,
          variables,
        });

        if (result.error && result.error.type === "validation") {
          setHttpPreviewError(result.error.message);
          return;
        }

        updateHttpConfig(
          node.id,
          (config) => ({
            ...config,
            lastPreview: {
              executedAt: new Date().toISOString(),
              request: {
                method: node.config.method,
                url: result.requestUrl,
              },
              response: result.response,
              error: result.error?.message,
              usage: {
                httpCalls: result.response ? 1 : 0,
                runtimeMs: result.response?.durationMs ?? 0,
              },
            },
          }),
          { resetPreview: false },
        );

        if (result.error) {
          setHttpPreviewError(result.error.message);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to run request.";
        setHttpPreviewError(message);
      } finally {
        setIsHttpPreviewRunning(false);
      }
    },
    [updateHttpConfig],
  );

  const runStellarPreview = useCallback(
    async (node: WorkflowNode<"stellar-account">) => {
      setIsStellarPreviewRunning(true);
      setStellarPreviewError(null);

      const trimmedAccountId = (node.config.accountId ?? "").trim();
      const walletFallback = walletAddress?.trim() ?? "";
      const accountId = trimmedAccountId || walletFallback;
      if (!accountId) {
        setStellarPreviewError(
          "Connect a wallet or enter a Stellar account ID (public key).",
        );
        setIsStellarPreviewRunning(false);
        return;
      }

      if (accountId !== trimmedAccountId) {
        updateStellarConfig(
          node.id,
          (config) => ({
            ...config,
            accountId,
          }),
          { resetPreview: false },
        );
      }

      try {
        const result = await fetchStellarAccount({
          accountId,
          network: node.config.network,
          horizonUrl: node.config.horizonUrl,
          paymentsLimit: node.config.paymentsLimit,
          includeFailed: node.config.includeFailed,
        });

        const executedAt = new Date().toISOString();

        if (!result.ok) {
          setStellarPreviewError(result.error);
          updateStellarConfig(
            node.id,
            (config) => ({
              ...config,
              horizonUrl: result.horizonUrl ?? config.horizonUrl,
              lastPreview: {
                executedAt,
                accountId,
                network: node.config.network,
                horizonUrl: result.horizonUrl,
                error: result.error,
              },
            }),
            { resetPreview: false },
          );
          return;
        }

        updateStellarConfig(
          node.id,
          (config) => ({
            ...config,
            accountId: result.accountId,
            horizonUrl: result.horizonUrl,
            lastPreview: {
              executedAt,
              accountId: result.accountId,
              network: result.network,
              horizonUrl: result.horizonUrl,
              balances: result.balances,
              payments: result.payments,
            },
          }),
          { resetPreview: false },
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to query Horizon.";
        setStellarPreviewError(message);
      } finally {
        setIsStellarPreviewRunning(false);
      }
    },
    [updateStellarConfig, walletAddress],
  );

  const [isPreviewRunning, setIsPreviewRunning] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isHttpPreviewRunning, setIsHttpPreviewRunning] = useState(false);
  const [httpPreviewError, setHttpPreviewError] = useState<string | null>(null);
  const [isStellarPreviewRunning, setIsStellarPreviewRunning] = useState(false);
  const [stellarPreviewError, setStellarPreviewError] = useState<string | null>(
    null,
  );
  const [isWorkflowRunning, setIsWorkflowRunning] = useState(false);
  const [workflowRunError, setWorkflowRunError] = useState<string | null>(null);
  const [workflowRunSummary, setWorkflowRunSummary] = useState<
    WorkflowRunStepSummary[]
  >([]);
  const [workflowRunLabel, setWorkflowRunLabel] = useState<
    "preview" | "run" | null
  >(null);
  const [latestRunResult, setLatestRunResult] =
    useState<WorkflowRunResult | null>(null);
  const [isResultModalOpen, setResultModalOpen] = useState(false);
  useEffect(() => {
    setGeminiKeyDraft(geminiStoredKey ?? "");
  }, [geminiStoredKey]);

  const workflowRunStats = useMemo(() => {
    if (workflowRunSummary.length === 0) {
      return null;
    }
    const success = workflowRunSummary.filter(
      (step) => step.status === "success",
    ).length;
    const skipped = workflowRunSummary.filter(
      (step) => step.status === "skipped",
    ).length;
    const failed = workflowRunSummary.filter(
      (step) => step.status === "error",
    ).length;
    return { success, skipped, failed };
  }, [workflowRunSummary]);

  const dismissRunSummary = useCallback(() => {
    setWorkflowRunError(null);
    setWorkflowRunSummary([]);
    setWorkflowRunLabel(null);
  }, []);

  const handleSaveGeminiKey = useCallback(() => {
    const trimmed = geminiKeyDraft.trim();
    if (!trimmed) {
      addNotification("Enter a Gemini API key before saving.", "warning");
      return;
    }
    persistGeminiKey(trimmed);
    addNotification("Gemini API key saved.", "success");
    setGeminiKeyModalOpen(false);
  }, [geminiKeyDraft, persistGeminiKey, addNotification]);

  const handleClearGeminiKey = useCallback(() => {
    removeGeminiKey();
    setGeminiKeyDraft("");
    addNotification("Gemini API key cleared.", "secondary");
    setGeminiKeyModalOpen(false);
  }, [removeGeminiKey, addNotification]);

  const runWorkflow = useCallback(
    async (label: "preview" | "run") => {
      if (!activeWorkflow) {
        setWorkflowRunLabel(label);
        setWorkflowRunError("Create a workflow before running it.");
        setWorkflowRunSummary([]);
        return;
      }

      if (isWorkflowRunning) {
        return;
      }

      cancelPendingConnection();
      setResultModalOpen(false);
      setWorkflowRunLabel(label);
      setWorkflowRunError(null);
      setWorkflowRunSummary([]);
      setIsWorkflowRunning(true);

      const { nodes: workflowNodes, connections: workflowConnections } =
        activeWorkflow;

      if (workflowNodes.length === 0) {
        setWorkflowRunError("Add at least one node to run the workflow.");
        setIsWorkflowRunning(false);
        return;
      }

      const disconnectedNodes = findDisconnectedNodes(
        workflowNodes,
        workflowConnections,
      );
      if (disconnectedNodes.length > 0) {
        const formatNodeLabel = (node: WorkflowNode) =>
          (node.title?.trim() ?? "") || node.kind;
        const labels = disconnectedNodes.map(formatNodeLabel);
        const summaryLabel =
          labels.length <= 3
            ? labels.join(", ")
            : `${labels.slice(0, 3).join(", ")} + ${labels.length - 3} more`;
        const message =
          disconnectedNodes.length === 1
            ? `Connect "${labels[0]}" to the rest of the flow before running.`
            : `Connect all actions before running. Disconnected nodes: ${summaryLabel}.`;
        setWorkflowRunError(message);
        setIsWorkflowRunning(false);
        return;
      }

      const sorted = sortWorkflowNodes(workflowNodes, workflowConnections);
      if (!sorted.success) {
        setWorkflowRunError(
          "Unable to compute execution order. Check for circular connections.",
        );
        setIsWorkflowRunning(false);
        return;
      }

      try {
        const order = sorted.order;
        const incomingByNode = new Map<string, WorkflowConnection[]>();
        workflowConnections.forEach((connection) => {
          const list = incomingByNode.get(connection.to) ?? [];
          list.push(connection);
          incomingByNode.set(connection.to, list);
        });

        const outputs = new Map<string, Record<string, string>>();
        const summary: WorkflowRunStepSummary[] = [];
        const usageTotals: AgentUsage = createEmptyUsage();
        let encounteredError = false;

        const collectUpstream = (nodeId: string) => {
          const aggregate: Record<string, string> = {};
          const incoming = incomingByNode.get(nodeId) ?? [];
          incoming.forEach((connection) => {
            const upstream = outputs.get(connection.from);
            if (upstream) {
              Object.assign(aggregate, upstream);
            }
          });
          return aggregate;
        };

        for (const node of order) {
          if (encounteredError) {
            break;
          }

          if (node.kind === "stellar-account") {
            const config = node.config as StellarAccountNodeConfig;
            const trimmedAccountId = (config.accountId ?? "").trim();
            const walletFallback = walletAddress?.trim() ?? "";
            const accountId = trimmedAccountId || walletFallback;
            if (!accountId) {
              const message =
                "Connect a wallet or enter a Stellar account ID (public key).";
              encounteredError = true;
              summary.push({
                nodeId: node.id,
                title: node.title,
                status: "error",
                detail: message,
              });
              setWorkflowRunError(message);
              break;
            }

            if (accountId !== trimmedAccountId) {
              updateStellarConfig(
                node.id,
                (existing) => ({
                  ...existing,
                  accountId,
                }),
                { resetPreview: false },
              );
            }

            try {
              const result = await fetchStellarAccount({
                accountId,
                network: config.network,
                horizonUrl: config.horizonUrl,
                paymentsLimit: config.paymentsLimit,
                includeFailed: config.includeFailed,
              });

              if (!result.ok) {
                encounteredError = true;
                summary.push({
                  nodeId: node.id,
                  title: node.title,
                  status: "error",
                  detail: result.error,
                });
                setWorkflowRunError(result.error);
                break;
              }

              const executedAt = new Date().toISOString();
              updateStellarConfig(
                node.id,
                (existing) => ({
                  ...existing,
                  accountId: result.accountId,
                  horizonUrl: result.horizonUrl,
                  lastPreview: {
                    executedAt,
                    accountId: result.accountId,
                    network: result.network,
                    horizonUrl: result.horizonUrl,
                    balances: result.balances,
                    payments: result.payments,
                  },
                }),
                { resetPreview: false },
              );

              const aggregatedPayload = {
                accountId: result.accountId,
                network: result.network,
                horizonUrl: result.horizonUrl,
                balances: result.balances,
                payments: result.payments,
              };
              const walletJson = safeStringify(aggregatedPayload);
              const balancesJson = safeStringify(result.balances);
              const paymentsJson = safeStringify(result.payments);

              outputs.set(node.id, {
                wallet_json: walletJson,
                [`${node.id}.wallet_json`]: walletJson,
                [`${node.id}.balances_json`]: balancesJson,
                [`${node.id}.payments_json`]: paymentsJson,
              });

              const paymentCount = Array.isArray(result.payments)
                ? result.payments.length
                : 0;
              summary.push({
                nodeId: node.id,
                title: node.title,
                status: "success",
                detail: `Fetched ${paymentCount} recent payments`,
              });
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : "Failed to reach Horizon.";
              encounteredError = true;
              summary.push({
                nodeId: node.id,
                title: node.title,
                status: "error",
                detail: message,
              });
              setWorkflowRunError(message);
              break;
            }
            continue;
          }

          if (node.kind === "http") {
            const config = node.config as HttpNodeConfig;
            const normalizedConfig: HttpNodeConfig = {
              ...DEFAULT_HTTP_CONFIG,
              ...(config ?? {}),
              queryParams: Array.isArray(config?.queryParams)
                ? config.queryParams
                : [],
              headers: Array.isArray(config?.headers) ? config.headers : [],
              inputVariables: Array.isArray(config?.inputVariables)
                ? config.inputVariables
                : [],
              testInputs:
                config?.testInputs && typeof config.testInputs === "object"
                  ? config.testInputs
                  : {},
            };

            const variables = {
              ...normalizedConfig.testInputs,
              ...collectUpstream(node.id),
            };

            try {
              const result = await executeHttpRequest({
                method: normalizedConfig.method,
                url: normalizedConfig.url,
                queryParams: normalizedConfig.queryParams,
                headers: normalizedConfig.headers,
                bodyTemplate: normalizedConfig.bodyTemplate,
                bodyMimeType: normalizedConfig.bodyMimeType,
                auth: normalizedConfig.auth,
                timeoutMs: normalizedConfig.timeoutMs,
                variables,
              });

              if (result.error && result.error.type === "validation") {
                encounteredError = true;
                summary.push({
                  nodeId: node.id,
                  title: node.title,
                  status: "error",
                  detail: result.error.message,
                });
                setWorkflowRunError(result.error.message);
                break;
              }

              updateHttpConfig(
                node.id,
                (existing) => ({
                  ...existing,
                  lastPreview: {
                    executedAt: new Date().toISOString(),
                    request: {
                      method: normalizedConfig.method,
                      url: result.requestUrl,
                    },
                    response: result.response,
                    error: result.error?.message,
                    usage: {
                      httpCalls: result.response ? 1 : 0,
                      runtimeMs: result.response?.durationMs ?? 0,
                    },
                  },
                }),
                { resetPreview: false },
              );

              const payload: Record<string, string> = {};
              if (result.response) {
                payload[`${node.id}.status`] = String(result.response.status);
                if (result.response.bodyText) {
                  payload[`${node.id}.body_text`] = result.response.bodyText;
                }
                if (result.response.bodyJson !== undefined) {
                  payload[`${node.id}.body_json`] = safeStringify(
                    result.response.bodyJson,
                  );
                }
              }
              outputs.set(node.id, payload);

              summary.push({
                nodeId: node.id,
                title: node.title,
                status: result.error ? "error" : "success",
                detail: result.error?.message ?? "Request executed",
              });
              if (result.response) {
                usageTotals.httpCalls += 1;
                if (typeof result.response.durationMs === "number") {
                  usageTotals.runtimeMs += Math.max(
                    0,
                    Math.round(result.response.durationMs),
                  );
                }
              }

              if (result.error && !encounteredError) {
                encounteredError = true;
                setWorkflowRunError(result.error.message);
                break;
              }
            } catch (error) {
              const message =
                error instanceof Error ? error.message : "HTTP request failed.";
              encounteredError = true;
              summary.push({
                nodeId: node.id,
                title: node.title,
                status: "error",
                detail: message,
              });
              setWorkflowRunError(message);
              break;
            }
            continue;
          }

          if (node.kind === "gemini") {
            const geminiConfig = node.config as GeminiNodeConfig;
            if (!geminiApiKey) {
              const fallbackText =
                "Simulated Gemini output. Add VITE_GEMINI_API_KEY to run live.";
              const executedAt = new Date().toISOString();
              updateGeminiConfig(
                node.id,
                (existing) => ({
                  ...existing,
                  lastPreview: {
                    executedAt,
                    outputText: fallbackText,
                    responseMimeType: existing.responseMimeType,
                    usage: {
                      promptTokens: 0,
                      responseTokens: fallbackText.length,
                      totalTokens: fallbackText.length,
                    },
                  },
                }),
                { resetPreview: false },
              );

              outputs.set(node.id, {
                [`${node.id}.output_text`]: fallbackText,
                ...(geminiConfig.responseMimeType === "application/json"
                  ? { [`${node.id}.output_json`]: fallbackText }
                  : {}),
              });

              summary.push({
                nodeId: node.id,
                title: node.title,
                status: "success",
                detail: "Simulated Gemini output (API key missing)",
              });
              addNotification(
                "Simulated Gemini output — configure VITE_GEMINI_API_KEY for live calls.",
                "warning",
              );
              usageTotals.llmOutTokens += fallbackText.length;
              continue;
            }

            const config = node.config as GeminiNodeConfig;
            const upstream = collectUpstream(node.id);
            const variableValues = { ...config.testInputs, ...upstream };
            const directWalletContext =
              typeof upstream.wallet_json === "string"
                ? upstream.wallet_json.trim()
                : "";
            const fallbackWalletContext = () => {
              for (const valueMap of outputs.values()) {
                if (typeof valueMap.wallet_json === "string") {
                  const trimmed = valueMap.wallet_json.trim();
                  if (trimmed.length > 0) {
                    return trimmed;
                  }
                }
                for (const [outputKey, outputValue] of Object.entries(
                  valueMap,
                )) {
                  if (
                    outputKey.endsWith(".wallet_json") &&
                    typeof outputValue === "string"
                  ) {
                    const trimmed = outputValue.trim();
                    if (trimmed.length > 0) {
                      return trimmed;
                    }
                  }
                }
              }
              for (const candidate of workflowNodes) {
                if (candidate.kind === "stellar-account") {
                  const previewSnapshot = snapshotFromPreview(
                    (candidate.config as StellarAccountNodeConfig).lastPreview,
                  );
                  if (previewSnapshot.length > 0) {
                    return previewSnapshot;
                  }
                }
              }
              return "";
            };
            const walletContext =
              directWalletContext.length > 0
                ? directWalletContext
                : fallbackWalletContext();
            config.inputVariables.forEach((variable) => {
              if (!(variable in variableValues)) {
                variableValues[variable] = config.testInputs[variable] ?? "";
              }
            });
            const variableInputValue =
              typeof variableValues.input === "string"
                ? variableValues.input.trim()
                : "";
            const defaultInputPlaceholder = (
              config.testInputs.input ?? GEMINI_DEFAULT_INPUT_PLACEHOLDER
            ).trim();
            if (
              walletContext.length > 0 &&
              (variableInputValue.length === 0 ||
                variableInputValue === defaultInputPlaceholder)
            ) {
              variableValues.input = walletContext;
            }
            if (walletContext.length > 0 && !variableValues.wallet_json) {
              variableValues.wallet_json = walletContext;
            }

            const compiledPrompt = interpolateTemplate(
              config.promptTemplate,
              variableValues,
            );
            const shouldAppendWalletContext =
              walletContext.length > 0 &&
              !compiledPrompt.includes(walletContext);
            const walletAnalysisCue = `
Provide an actionable financial summary that references concrete balances, recent payments, and budget health. Highlight risk areas, spending trends, and suggested next steps.`;
            const finalPrompt = shouldAppendWalletContext
              ? `${compiledPrompt.trim()}\n\nWallet data (JSON):\n${walletContext}\n${walletAnalysisCue.trim()}`
              : compiledPrompt;
            const walletContextMissing = walletContext.length === 0;
            const finalSystemInstruction =
              walletContext.length > 0 &&
              (config.systemInstruction ?? "").trim().length === 0
                ? DEFAULT_WALLET_SYSTEM_PROMPT.trim()
                : config.systemInstruction;

            try {
              const { text, usage } = await generateGeminiText({
                apiKey: geminiApiKey,
                model: config.model,
                prompt: `${finalPrompt.trim()}\n\n${WALLET_ANALYSIS_GUIDE.trim()}`,
                systemInstruction: finalSystemInstruction,
                temperature: config.temperature,
                topP: config.topP,
                topK: config.topK,
                maxOutputTokens: config.maxOutputTokens,
                responseMimeType: config.responseMimeType,
              });

              updateGeminiConfig(
                node.id,
                (existing) => ({
                  ...existing,
                  lastPreview: {
                    executedAt: new Date().toISOString(),
                    outputText: text,
                    responseMimeType: existing.responseMimeType,
                    usage,
                  },
                }),
                { resetPreview: false },
              );

              const trimmedText = text.trim();
              const payload: Record<string, string> = {
                [`${node.id}.prompt_text`]: finalPrompt,
                [`${node.id}.output_text`]: trimmedText,
              };
              if (config.responseMimeType === "application/json") {
                payload[`${node.id}.output_json`] = trimmedText;
              }
              outputs.set(node.id, payload);

              summary.push({
                nodeId: node.id,
                title: node.title,
                status: "success",
                detail: walletContextMissing
                  ? `Generated ${trimmedText.length} characters (wallet data missing)`
                  : `Generated ${trimmedText.length} characters`,
              });
              if (usage?.promptTokens) {
                usageTotals.llmInTokens += Math.max(0, usage.promptTokens);
              }
              if (usage?.responseTokens) {
                usageTotals.llmOutTokens += Math.max(0, usage.responseTokens);
              }
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : "Gemini request failed.";
              encounteredError = true;
              summary.push({
                nodeId: node.id,
                title: node.title,
                status: "error",
                detail: message,
              });
              setWorkflowRunError(message);
              break;
            }
            continue;
          }

          summary.push({
            nodeId: node.id,
            title: node.title,
            status: "skipped",
            detail: "Node type not yet executable.",
          });
        }

        setWorkflowRunSummary(summary);
        if (!encounteredError) {
          const summaryByNode = new Map(
            summary.map((item) => [item.nodeId, item]),
          );
          const resultEntries = order
            .map((node) => {
              const payload = outputs.get(node.id) ?? {};
              const entry = summaryByNode.get(node.id);
              return {
                nodeId: node.id,
                title: node.title,
                status: entry?.status ?? "skipped",
                detail: entry?.detail,
                outputs: payload,
              };
            })
            .filter(
              (entry) =>
                Object.keys(entry.outputs).length > 0 ||
                (entry.detail && entry.detail.trim().length > 0),
            );

          setLatestRunResult({
            executedAt: new Date().toISOString(),
            runType: label,
            workflowLabel: activeWorkflow?.label ?? "Untitled workflow",
            entries: resultEntries,
          });
          setResultModalOpen(true);

          const usageCharge = computeUsageCharge(
            usageTotals,
            DEFAULT_RATE_CARD,
          );
          const totalCharge = Math.max(0, PLATFORM_FEE + usageCharge);
          if (totalCharge > 0) {
            const deduction = await deductFromSmartWallet(totalCharge, {
              label: activeWorkflow?.label ?? "Workflow run",
              runType: label,
              usage: usageTotals,
            });
            if (deduction.ok && deduction.applied > 0) {
              const actionLabel = label === "run" ? "Run" : "Preview";
              const baseMessage = `${actionLabel} charged ${formatCurrency(deduction.applied)} (includes ${formatCurrency(PLATFORM_FEE)} platform fee).`;
              const balanceMessage = deduction.insufficient
                ? "Smart wallet balance exhausted."
                : `New balance: ${formatCurrency(deduction.balance)}.`;
              addNotification(
                `${baseMessage} ${balanceMessage}`,
                deduction.insufficient ? "warning" : "success",
              );
            } else if (!deduction.ok) {
              addNotification(
                deduction.error ??
                  "Unable to charge smart wallet for this run.",
                "error",
              );
            }
          }
          setWorkflowRunError(null);
        }
      } finally {
        setIsWorkflowRunning(false);
      }
    },
    [
      activeWorkflow,
      cancelPendingConnection,
      deductFromSmartWallet,
      geminiApiKey,
      isWorkflowRunning,
      addNotification,
      updateGeminiConfig,
      updateHttpConfig,
      updateStellarConfig,
      walletAddress,
    ],
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string>();

  useEffect(() => {
    if (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(undefined);
    }
  }, [nodes, selectedNodeId]);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const scaleRef = useRef(scale);
  const panRef = useRef(pan);
  const panPointerRef = useRef<{
    pointerId: number | null;
    lastX: number;
    lastY: number;
  }>({ pointerId: null, lastX: 0, lastY: 0 });

  useLayoutEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const initialPan = {
      x: element.clientWidth / 2,
      y: element.clientHeight / 2,
    };
    setPan(initialPan);
    panRef.current = initialPan;
  }, []);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  const gridStyles = useMemo(() => {
    const rawSpacing = Math.abs(GRID_SIZE * scale);
    if (!Number.isFinite(rawSpacing) || rawSpacing <= 0) {
      return {};
    }

    const MIN_PIXEL_SPACING = 24;
    const safeSpacing = Math.max(rawSpacing, 0.5);
    const factorPower =
      safeSpacing >= MIN_PIXEL_SPACING
        ? 0
        : Math.ceil(Math.log2(MIN_PIXEL_SPACING / safeSpacing));
    const stepFactor = 2 ** factorPower;
    const majorSpacing = safeSpacing * stepFactor;

    const normalize = (value: number, spacing: number) => {
      const mod = value % spacing;
      return (mod + spacing) % spacing;
    };

    const rawMinorFactor =
      safeSpacing >= 4 ? 1 : 2 ** Math.ceil(Math.log2(4 / safeSpacing));
    const minorFactor = Math.min(rawMinorFactor, stepFactor);
    const minorSpacing = safeSpacing * minorFactor;

    const layers: {
      image: string;
      size: string;
      position: string;
    }[] = [];

    if (minorSpacing >= 4 && Number.isFinite(minorSpacing)) {
      layers.push(
        {
          image:
            "linear-gradient(to right, rgba(155, 92, 255, 0.08) 1px, transparent 1px)",
          size: `${minorSpacing}px ${minorSpacing}px`,
          position: `${normalize(pan.x, minorSpacing)}px ${normalize(pan.y, minorSpacing)}px`,
        },
        {
          image:
            "linear-gradient(to bottom, rgba(155, 92, 255, 0.08) 1px, transparent 1px)",
          size: `${minorSpacing}px ${minorSpacing}px`,
          position: `${normalize(pan.x, minorSpacing)}px ${normalize(pan.y, minorSpacing)}px`,
        },
      );
    }

    layers.push(
      {
        image:
          "linear-gradient(to right, rgba(65, 240, 192, 0.14) 1px, transparent 1px)",
        size: `${majorSpacing}px ${majorSpacing}px`,
        position: `${normalize(pan.x, majorSpacing)}px ${normalize(pan.y, majorSpacing)}px`,
      },
      {
        image:
          "linear-gradient(to bottom, rgba(65, 240, 192, 0.14) 1px, transparent 1px)",
        size: `${majorSpacing}px ${majorSpacing}px`,
        position: `${normalize(pan.x, majorSpacing)}px ${normalize(pan.y, majorSpacing)}px`,
      },
    );

    const backgroundImage = layers.map((layer) => layer.image).join(", ");
    const backgroundSize = layers.map((layer) => layer.size).join(", ");
    const backgroundPosition = layers.map((layer) => layer.position).join(", ");

    return {
      backgroundImage,
      backgroundSize,
      backgroundPosition,
    };
  }, [pan, scale]);

  const centerCanvas = useCallback(() => {
    const element = canvasRef.current;
    if (!element) return;
    const currentScale = scaleRef.current;
    const nextPan = {
      x: element.clientWidth / 2,
      y: element.clientHeight / 2,
    };
    setPan(nextPan);
    panRef.current = nextPan;
    // Ensure scale ref stays in sync if center is called after zoom adjustments.
    scaleRef.current = currentScale;
  }, []);

  useEffect(() => {
    centerCanvas();
  }, [centerCanvas]);

  useEffect(() => {
    if (nodes.length === 0) {
      centerCanvas();
    }
  }, [nodes.length, centerCanvas]);

  const clampScale = useCallback(
    (next: number) =>
      Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, next)),
    [],
  );

  const zoomCanvas = useCallback(
    (factor: number, pivot?: { clientX: number; clientY: number }) => {
      if (!canvasRef.current || !Number.isFinite(factor) || factor === 0) {
        return;
      }

      const element = canvasRef.current;
      const rect = element.getBoundingClientRect();
      const pivotLocal = pivot
        ? {
            x: pivot.clientX - rect.left,
            y: pivot.clientY - rect.top,
          }
        : {
            x: rect.width / 2,
            y: rect.height / 2,
          };

      setScale((previousScale) => {
        const candidate = previousScale * factor;
        const nextScale = clampScale(candidate);
        if (!Number.isFinite(nextScale) || nextScale === previousScale) {
          return previousScale;
        }

        setPan((prevPan) => {
          const worldX = (pivotLocal.x - prevPan.x) / previousScale;
          const worldY = (pivotLocal.y - prevPan.y) / previousScale;
          const nextPan = {
            x: pivotLocal.x - worldX * nextScale,
            y: pivotLocal.y - worldY * nextScale,
          };
          panRef.current = nextPan;
          return nextPan;
        });
        scaleRef.current = nextScale;

        return nextScale;
      });
    },
    [clampScale],
  );

  const handleZoomIn = useCallback(() => {
    zoomCanvas(CANVAS_ZOOM_FACTOR);
  }, [zoomCanvas]);

  const handleZoomOut = useCallback(() => {
    zoomCanvas(1 / CANVAS_ZOOM_FACTOR);
  }, [zoomCanvas]);

  const handleWheelZoom = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      const factor =
        event.deltaY > 0 ? 1 / CANVAS_ZOOM_FACTOR : CANVAS_ZOOM_FACTOR;
      zoomCanvas(factor, { clientX: event.clientX, clientY: event.clientY });
    },
    [zoomCanvas],
  );

  const handleCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (pendingConnectionSourceRef.current) {
        cancelPendingConnection();
      }
      if (event.button !== 0 && event.button !== 1) {
        return;
      }
      if (!canvasRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      const pointerId = event.pointerId;
      panPointerRef.current = {
        pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
      };
      setIsPanning(true);
      try {
        event.currentTarget.setPointerCapture(pointerId);
      } catch {
        /* noop */
      }
    },
    [cancelPendingConnection],
  );

  const handleCanvasPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = panPointerRef.current;
      if (state.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      const deltaX = event.clientX - state.lastX;
      const deltaY = event.clientY - state.lastY;
      if (deltaX === 0 && deltaY === 0) {
        return;
      }
      state.lastX = event.clientX;
      state.lastY = event.clientY;
      setPan((previous) => {
        const next = { x: previous.x + deltaX, y: previous.y + deltaY };
        panRef.current = next;
        return next;
      });
    },
    [],
  );

  const endPan = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = panPointerRef.current;
    if (state.pointerId !== event.pointerId) {
      return;
    }
    panPointerRef.current = { pointerId: null, lastX: 0, lastY: 0 };
    setIsPanning(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* noop */
    }
  }, []);

  const addNode = useCallback(
    (kind: WorkflowNodeKind, position: { x: number; y: number }) => {
      const definition = paletteLookup.get(kind);
      if (!definition) return;

      const nodePosition = snapPosition({
        x: position.x - NODE_WIDTH / 2,
        y: position.y - NODE_HEIGHT / 2,
      });

      const newNode = createWorkflowNode({
        kind,
        title: definition.title,
        description: definition.description,
        position: nodePosition,
      });

      updateActiveWorkflow((workflow) => ({
        ...workflow,
        nodes: [...workflow.nodes, newNode],
      }));
      setSelectedNodeId(newNode.id);
    },
    [paletteLookup, updateActiveWorkflow],
  );

  const moveNode = useCallback(
    (id: string, nextPosition: { x: number; y: number }) => {
      updateActiveWorkflow((workflow) => {
        const target = workflow.nodes.find((node) => node.id === id);
        if (!target) return workflow;

        const snapped = snapPosition(nextPosition);
        if (
          target.position.x === snapped.x &&
          target.position.y === snapped.y
        ) {
          return workflow;
        }

        const nextNodes = workflow.nodes.map((node) =>
          node.id === id ? { ...node, position: snapped } : node,
        );

        return {
          ...workflow,
          nodes: nextNodes,
        };
      });
    },
    [updateActiveWorkflow],
  );

  const handlePaletteDragStart = useCallback(
    (event: React.DragEvent<HTMLButtonElement>, kind: WorkflowNodeKind) => {
      event.dataTransfer.setData("application/lumio-node", kind);
      event.dataTransfer.setData("text/plain", kind);
      event.dataTransfer.effectAllowed = "copy";
    },
    [],
  );

  const handleCanvasDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (event.dataTransfer.types.includes("application/lumio-node")) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    },
    [],
  );

  const handleCanvasDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData("application/lumio-node") as
        | WorkflowNodeKind
        | "";
      if (!kind) return;

      const canvasElement = canvasRef.current;
      if (!canvasElement) return;
      const canvasBounds = canvasElement.getBoundingClientRect();
      const currentPan = panRef.current;
      const currentScale = scaleRef.current;

      const position = {
        x: (event.clientX - canvasBounds.left - currentPan.x) / currentScale,
        y: (event.clientY - canvasBounds.top - currentPan.y) / currentScale,
      };
      addNode(kind, position);
    },
    [addNode],
  );

  const groupedPalette = useMemo(() => {
    return paletteItems.reduce<Record<string, PaletteItemDefinition[]>>(
      (accumulator, item) => {
        const itemsForGroup = accumulator[item.group] ?? [];
        itemsForGroup.push(item);
        accumulator[item.group] = itemsForGroup;
        return accumulator;
      },
      {} as Record<string, PaletteItemDefinition[]>,
    );
  }, [paletteItems]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId),
    [nodes, selectedNodeId],
  );

  const selectedStellarNode = useMemo(() => {
    if (selectedNode?.kind !== "stellar-account") {
      return null;
    }

    const config = selectedNode.config as StellarAccountNodeConfig | undefined;

    const isValidNetwork = STELLAR_NETWORK_OPTIONS.some(
      (option) => option.value === config?.network,
    );

    const normalizedConfig: StellarAccountNodeConfig = {
      ...DEFAULT_STELLAR_ACCOUNT_CONFIG,
      ...(config ?? {}),
      accountId: typeof config?.accountId === "string" ? config.accountId : "",
      network: isValidNetwork
        ? (config?.network as StellarNetwork)
        : DEFAULT_STELLAR_ACCOUNT_CONFIG.network,
      horizonUrl:
        typeof config?.horizonUrl === "string" ? config.horizonUrl : "",
      paymentsLimit:
        typeof config?.paymentsLimit === "number" &&
        Number.isFinite(config.paymentsLimit)
          ? Math.min(200, Math.max(1, Math.round(config.paymentsLimit)))
          : DEFAULT_STELLAR_ACCOUNT_CONFIG.paymentsLimit,
      includeFailed:
        typeof config?.includeFailed === "boolean"
          ? config.includeFailed
          : DEFAULT_STELLAR_ACCOUNT_CONFIG.includeFailed,
      lastPreview: config?.lastPreview,
    };

    return {
      ...(selectedNode as WorkflowNode<"stellar-account">),
      config: normalizedConfig,
    };
  }, [selectedNode]);

  const selectedGeminiNode =
    selectedNode?.kind === "gemini"
      ? (selectedNode as WorkflowNode<"gemini">)
      : null;
  const geminiLastPreview = selectedGeminiNode?.config.lastPreview;
  const formattedPreviewOutput = useMemo(() => {
    if (!geminiLastPreview?.outputText) {
      return null;
    }
    if (geminiLastPreview.responseMimeType === "application/json") {
      try {
        return JSON.stringify(
          JSON.parse(geminiLastPreview.outputText),
          null,
          2,
        );
      } catch {
        return geminiLastPreview.outputText;
      }
    }
    return geminiLastPreview.outputText;
  }, [geminiLastPreview]);
  const previewTimestamp = geminiLastPreview?.executedAt
    ? new Date(geminiLastPreview.executedAt).toLocaleTimeString()
    : null;

  const stellarLastPreview = selectedStellarNode?.config.lastPreview;
  const formattedStellarBalances = useMemo(() => {
    const balances = stellarLastPreview?.balances;
    if (balances == null) {
      return null;
    }
    try {
      return JSON.stringify(balances, null, 2);
    } catch {
      return "[Unable to format balances]";
    }
  }, [stellarLastPreview]);
  const formattedStellarPayments = useMemo(() => {
    const payments = stellarLastPreview?.payments;
    if (!Array.isArray(payments)) {
      return null;
    }
    try {
      return JSON.stringify(payments, null, 2);
    } catch {
      return "[Unable to format payments]";
    }
  }, [stellarLastPreview]);
  const aggregatedWalletJson = useMemo(() => {
    if (!stellarLastPreview) {
      return null;
    }
    const payload = {
      accountId: stellarLastPreview.accountId,
      network: stellarLastPreview.network,
      horizonUrl: stellarLastPreview.horizonUrl,
      balances: stellarLastPreview.balances ?? [],
      payments: Array.isArray(stellarLastPreview.payments)
        ? stellarLastPreview.payments
        : [],
    };
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return JSON.stringify(payload);
    }
  }, [stellarLastPreview]);
  const stellarPreviewTimestamp = stellarLastPreview?.executedAt
    ? new Date(stellarLastPreview.executedAt).toLocaleTimeString()
    : null;

  const connectionRenderData = useMemo(() => {
    return connections
      .map((connection) => {
        const fromNode = nodes.find((node) => node.id === connection.from);
        const toNode = nodes.find((node) => node.id === connection.to);
        if (!fromNode || !toNode) {
          return null;
        }

        const fromCenter = getNodeCenter(fromNode);
        const toCenter = getNodeCenter(toNode);

        const fromPoint = getNodeEdgePoint(fromNode, toCenter);
        const toPoint = getNodeEdgePoint(toNode, fromCenter);

        const dx = toPoint.x - fromPoint.x;
        const dy = toPoint.y - fromPoint.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        return {
          id: connection.id,
          fromId: connection.from,
          toId: connection.to,
          midpoint: {
            x: (fromPoint.x + toPoint.x) / 2,
            y: (fromPoint.y + toPoint.y) / 2,
          },
          fromPoint,
          toPoint,
          length,
          angle,
        };
      })
      .filter(
        (
          value,
        ): value is {
          id: string;
          fromId: string;
          toId: string;
          midpoint: { x: number; y: number };
          fromPoint: { x: number; y: number };
          toPoint: { x: number; y: number };
          length: number;
          angle: number;
        } => value !== null,
      );
  }, [connections, nodes]);

  const nodeLookup = useMemo(() => {
    const lookup = new Map<string, WorkflowNode>();
    nodes.forEach((node) => lookup.set(node.id, node));
    return lookup;
  }, [nodes]);

  const incomingConnections = useMemo(() => {
    if (!selectedNodeId) {
      return [] as WorkflowConnection[];
    }
    return connections.filter((connection) => connection.to === selectedNodeId);
  }, [connections, selectedNodeId]);

  const outgoingConnections = useMemo(() => {
    if (!selectedNodeId) {
      return [] as WorkflowConnection[];
    }
    return connections.filter(
      (connection) => connection.from === selectedNodeId,
    );
  }, [connections, selectedNodeId]);

  const [pendingConnectionSourceId, setPendingConnectionSourceId] = useState<
    string | null
  >(null);
  const pendingConnectionSourceRef = useRef<string | null>(null);
  const connectionsPanel = selectedNode ? (
    <div className={styles.inspectorSection}>
      <div className={styles.sectionHeader}>
        <Text as="h4" size="xs">
          Connections
        </Text>
        {pendingConnectionSourceId ? (
          <Text as="p" size="xs" className={styles.inspectorHint}>
            Select a target node to finish the link.
          </Text>
        ) : null}
      </div>
      {incomingConnections.length === 0 && outgoingConnections.length === 0 ? (
        <Text as="p" size="xs" className={styles.inspectorHint}>
          Click any node, then another, to link your actions. Port handles are
          still available for precise connections.
        </Text>
      ) : (
        <div className={styles.connectionList}>
          {incomingConnections.map((connection) => {
            const sourceNode = nodeLookup.get(connection.from);
            return (
              <div key={connection.id} className={styles.connectionRow}>
                <span className={styles.connectionDirection}>←</span>
                <span className={styles.connectionLabel}>
                  {sourceNode?.title ?? connection.from}
                </span>
                <Button
                  variant="tertiary"
                  size="sm"
                  onClick={() => removeConnection(connection.id)}
                >
                  Remove
                </Button>
              </div>
            );
          })}
          {outgoingConnections.map((connection) => {
            const targetNode = nodeLookup.get(connection.to);
            return (
              <div key={connection.id} className={styles.connectionRow}>
                <span className={styles.connectionDirection}>→</span>
                <span className={styles.connectionLabel}>
                  {targetNode?.title ?? connection.to}
                </span>
                <Button
                  variant="tertiary"
                  size="sm"
                  onClick={() => removeConnection(connection.id)}
                >
                  Remove
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  ) : null;
  const selectedHttpNode = useMemo(() => {
    if (selectedNode?.kind !== "http") {
      return null;
    }

    const config = selectedNode.config as HttpNodeConfig | undefined;
    const normalizedConfig: HttpNodeConfig = {
      ...DEFAULT_HTTP_CONFIG,
      ...(config ?? {}),
      queryParams: Array.isArray(config?.queryParams)
        ? config?.queryParams
        : [],
      headers: Array.isArray(config?.headers) ? config?.headers : [],
      inputVariables: Array.isArray(config?.inputVariables)
        ? config?.inputVariables
        : [],
      testInputs:
        config?.testInputs && typeof config.testInputs === "object"
          ? config.testInputs
          : {},
      lastPreview: config?.lastPreview,
    };

    return {
      ...(selectedNode as WorkflowNode<"http">),
      config: normalizedConfig,
    };
  }, [selectedNode]);
  const httpLastPreview = selectedHttpNode?.config.lastPreview;
  const formattedHttpBody = useMemo(() => {
    const bodyJson = httpLastPreview?.response?.bodyJson;
    if (bodyJson != null) {
      try {
        return JSON.stringify(bodyJson, null, 2);
      } catch {
        // Fall back to text rendering
      }
    }
    return httpLastPreview?.response?.bodyText ?? null;
  }, [httpLastPreview]);
  const formattedHttpHeaders = useMemo(() => {
    if (!httpLastPreview?.response?.headers.length) {
      return null;
    }
    return httpLastPreview.response.headers
      .map(({ key, value }) => `${key}: ${value}`)
      .join("\n");
  }, [httpLastPreview]);
  const httpPreviewTimestamp = httpLastPreview?.executedAt
    ? new Date(httpLastPreview.executedAt).toLocaleTimeString()
    : null;

  useEffect(() => {
    setPreviewError(null);
    setIsPreviewRunning(false);
    setHttpPreviewError(null);
    setIsHttpPreviewRunning(false);
    setStellarPreviewError(null);
    setIsStellarPreviewRunning(false);
  }, [selectedNodeId]);

  useEffect(() => {
    setPreviewError(null);
  }, [geminiApiKey]);

  useEffect(() => {
    if (!walletAddress) {
      return;
    }
    const stellarNodeCount = nodes.filter(
      (node) => node.kind === "stellar-account",
    ).length;
    if (stellarNodeCount === 0) {
      return;
    }
    updateActiveWorkflow((workflow) => {
      let didChange = false;
      const updatedNodes = workflow.nodes.map((node) => {
        if (node.kind !== "stellar-account") {
          return node;
        }
        const config = node.config as StellarAccountNodeConfig;
        const accountId = (config.accountId ?? "").trim();
        if (accountId !== "") {
          return node;
        }
        didChange = true;
        return {
          ...node,
          config: {
            ...config,
            accountId: walletAddress,
          },
        };
      });
      if (!didChange) {
        return workflow;
      }
      return {
        ...workflow,
        nodes: updatedNodes,
      };
    });
  }, [walletAddress, nodes, updateActiveWorkflow]);

  useEffect(() => {
    cancelPendingConnection();
  }, [activeWorkflowId, nodes.length, cancelPendingConnection]);

  const getCanvasMetrics = useCallback(() => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      rect,
      scale: scaleRef.current,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
  }, []);

  return (
    <Layout.Content>
      <Layout.Inset>
        <div className={styles.page}>
          <header className={styles.header}>
            <div>
              <Text as="h1" size="lg">
                Compose a run
              </Text>
              <Text as="p" size="sm">
                Connect APIs, models, and post-run actions. Drag actions into
                the canvas and wire outputs to build your flow.
              </Text>
            </div>
            <div className={styles.headerActions}>
              <div
                className={styles.walletIndicator}
                title="Smart wallet balance"
              >
                <Icon.Wallet02 size="sm" />
                <span>Smart wallet</span>
                <strong>{formatCurrency(smartWalletBalance)}</strong>
              </div>
              <Button
                variant="tertiary"
                size="md"
                onClick={() => setGeminiKeyModalOpen(true)}
                disabled={isWorkflowRunning}
              >
                <Icon.Key01 size="sm" />
                Gemini API key
              </Button>
              {latestRunResult ? (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setResultModalOpen(true)}
                  disabled={isWorkflowRunning}
                >
                  <Icon.Receipt size="sm" />
                  View result
                </Button>
              ) : null}
              <Button
                variant="tertiary"
                size="md"
                onClick={() => void runWorkflow("preview")}
                disabled={
                  isWorkflowRunning || !activeWorkflow || nodes.length === 0
                }
              >
                <Icon.Eye />
                {isWorkflowRunning && workflowRunLabel === "preview"
                  ? "Running..."
                  : "Preview run"}
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => void runWorkflow("run")}
                disabled={
                  isWorkflowRunning || !activeWorkflow || nodes.length === 0
                }
              >
                <Icon.PlayCircle />
                {isWorkflowRunning && workflowRunLabel === "run"
                  ? "Running..."
                  : "Save & run"}
              </Button>
            </div>
          </header>

          {workflowRunError ? (
            <div className={styles.runBannerError}>
              <Icon.AlertTriangle size="sm" />
              <Text as="p" size="sm" className={styles.runBannerText}>
                {workflowRunError}
              </Text>
              <Button variant="tertiary" size="sm" onClick={dismissRunSummary}>
                Dismiss
              </Button>
            </div>
          ) : workflowRunStats ? (
            <div className={styles.runBanner}>
              <Icon.CheckCircle size="sm" />
              <div className={styles.runBannerBody}>
                <Text as="p" size="sm" className={styles.runBannerText}>
                  Last {workflowRunLabel === "run" ? "run" : "preview"}{" "}
                  completed: {workflowRunStats.success} success ·{" "}
                  {workflowRunStats.skipped} skipped · {workflowRunStats.failed}{" "}
                  errors
                </Text>
                <ul className={styles.runSummaryList}>
                  {workflowRunSummary.slice(0, 3).map((step) => (
                    <li key={step.nodeId}>
                      <span
                        className={styles.runSummaryStatus}
                        data-status={step.status}
                      >
                        {step.status === "success"
                          ? "✔"
                          : step.status === "error"
                            ? "⚠"
                            : "…"}
                      </span>
                      <span className={styles.runSummaryLabel}>
                        {step.title}
                      </span>
                      {step.detail ? (
                        <span className={styles.runSummaryDetail}>
                          {" "}
                          · {step.detail}
                        </span>
                      ) : null}
                    </li>
                  ))}
                  {workflowRunSummary.length > 3 ? (
                    <li className={styles.runSummaryMore}>
                      + {workflowRunSummary.length - 3} more
                    </li>
                  ) : null}
                </ul>
              </div>
              <Button variant="tertiary" size="sm" onClick={dismissRunSummary}>
                Clear
              </Button>
            </div>
          ) : null}

          <section className={styles.workspace}>
            <aside className={styles.palette}>
              <div className={styles.panelHeader}>
                <Text as="h2" size="sm">
                  Palette
                </Text>
                <Text as="p" size="xs">
                  Drag to add actions
                </Text>
              </div>
              {Object.entries(groupedPalette).map(([group, items]) => (
                <div key={group} className={styles.paletteGroup}>
                  <Text as="h3" size="xs" className={styles.groupLabel}>
                    {group}
                  </Text>
                  {items.map((item) => (
                    <PaletteItem
                      key={item.kind}
                      item={item}
                      onDragStart={handlePaletteDragStart}
                    />
                  ))}
                </div>
              ))}
            </aside>

            <div className={styles.canvasShell}>
              <div className={styles.canvasHeader}>
                <Text as="h2" size="sm">
                  Flow canvas
                </Text>
                <div className={styles.canvasControls}>
                  <Button
                    variant="tertiary"
                    size="sm"
                    onClick={handleZoomIn}
                    disabled={scale >= MAX_CANVAS_SCALE}
                    aria-label="Zoom in"
                  >
                    <Icon.ZoomIn />
                  </Button>
                  <Button
                    variant="tertiary"
                    size="sm"
                    onClick={handleZoomOut}
                    disabled={scale <= MIN_CANVAS_SCALE}
                    aria-label="Zoom out"
                  >
                    <Icon.ZoomOut />
                  </Button>
                  <span className={styles.canvasScaleLabel}>
                    {Math.round(scale * 100)}%
                  </span>
                  <Button
                    variant="tertiary"
                    size="sm"
                    disabled={nodes.length === 0}
                    onClick={() => {
                      updateActiveWorkflow((workflow) => {
                        if (workflow.nodes.length === 0) {
                          return workflow;
                        }
                        return {
                          ...workflow,
                          nodes: [],
                          connections: [],
                        };
                      });
                      setSelectedNodeId(undefined);
                      centerCanvas();
                    }}
                  >
                    <Icon.MinusCircle />
                    Clear canvas
                  </Button>
                </div>
              </div>
              <div className={styles.canvas}>
                <div
                  ref={canvasRef}
                  className={[
                    styles.canvasSurface,
                    isPanning ? styles.canvasSurfacePanning : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={gridStyles}
                  onPointerDown={handleCanvasPointerDown}
                  onPointerMove={handleCanvasPointerMove}
                  onPointerUp={endPan}
                  onPointerCancel={endPan}
                  onPointerLeave={(event) => {
                    if (panPointerRef.current.pointerId === event.pointerId) {
                      endPan(event);
                    }
                  }}
                  onDragOver={handleCanvasDragOver}
                  onDrop={handleCanvasDrop}
                  onWheel={handleWheelZoom}
                >
                  <div
                    className={styles.canvasTransform}
                    style={{
                      transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
                    }}
                  >
                    <div
                      className={styles.canvasInner}
                      style={{
                        transform: `scale(${scale})`,
                        width: BASE_CANVAS_WIDTH,
                        height: BASE_CANVAS_HEIGHT,
                      }}
                    >
                      <div className={styles.canvasConnections}>
                        {connectionRenderData.map((connection) => {
                          const isActive =
                            pendingConnectionSourceId === connection.fromId;
                          return (
                            <div
                              key={connection.id}
                              className={[
                                styles.connectionPipe,
                                isActive ? styles.connectionPipeActive : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              style={{
                                width: `${connection.length}px`,
                                left: `${connection.fromPoint.x}px`,
                                top: `${connection.fromPoint.y - CONNECTION_PIPE_HEIGHT / 2}px`,
                                transform: `rotate(${connection.angle}rad)`,
                              }}
                            />
                          );
                        })}
                      </div>
                      {connectionRenderData.map((connection) => (
                        <button
                          key={`${connection.id}-remove`}
                          type="button"
                          className={styles.connectionRemove}
                          style={{
                            left: connection.midpoint.x - 10,
                            top: connection.midpoint.y - 10,
                          }}
                          title="Remove connection"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeConnection(connection.id);
                          }}
                        >
                          ×
                        </button>
                      ))}
                      {nodes.map((node) => {
                        const isSource = pendingConnectionSourceId === node.id;
                        const canAccept =
                          pendingConnectionSourceId !== null &&
                          pendingConnectionSourceId !== node.id &&
                          !connections.some(
                            (connection) =>
                              connection.from === pendingConnectionSourceId &&
                              connection.to === node.id,
                          );
                        return (
                          <CanvasNode
                            key={node.id}
                            node={node}
                            isSelected={selectedNodeId === node.id}
                            onSelect={(id) => setSelectedNodeId(id)}
                            onActivate={handleNodeActivate}
                            onDrag={moveNode}
                            getCanvasMetrics={getCanvasMetrics}
                            onStartConnection={handleStartConnection}
                            onCompleteConnection={handleCompleteConnection}
                            isConnectionSource={isSource}
                            canAcceptConnection={canAccept}
                          />
                        );
                      })}
                      {nodes.length === 0 ? (
                        <div className={styles.canvasEmpty}>
                          <Icon.CursorClick02 size="lg" />
                          <Text as="p" size="sm">
                            Drag an action from the palette to start shaping
                            your agent.
                          </Text>
                          <Text as="p" size="xs">
                            Snap-to-grid placement and connector handles appear
                            once the first node is added.
                          </Text>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <aside className={styles.inspector}>
              <div className={styles.panelHeader}>
                <Text as="h2" size="sm">
                  Inspector
                </Text>
                <Text as="p" size="xs">
                  Select a node to edit inputs, outputs, and budgets.
                </Text>
              </div>
              {selectedNode ? (
                selectedNode.kind === "stellar-account" &&
                selectedStellarNode ? (
                  <div className={styles.inspectorDetails}>
                    {connectionsPanel}
                    <Input
                      id={`node-title-${selectedStellarNode.id}`}
                      fieldSize="sm"
                      label="Node title"
                      value={selectedStellarNode.title}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        updateStellarNode(selectedStellarNode.id, (node) => ({
                          ...node,
                          title: value,
                        }));
                      }}
                    />
                    <Input
                      id={`stellar-account-id-${selectedStellarNode.id}`}
                      fieldSize="md"
                      label="Account ID"
                      placeholder="GBZX..."
                      value={selectedStellarNode.config.accountId}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        updateStellarConfig(
                          selectedStellarNode.id,
                          (config) => ({
                            ...config,
                            accountId: value,
                          }),
                        );
                      }}
                    />
                    <Select
                      id={`stellar-network-${selectedStellarNode.id}`}
                      fieldSize="sm"
                      label="Network"
                      value={selectedStellarNode.config.network}
                      onChange={(event) => {
                        const value = event.currentTarget
                          .value as StellarNetwork;
                        if (value === selectedStellarNode.config.network) {
                          return;
                        }
                        updateStellarConfig(
                          selectedStellarNode.id,
                          (config) => ({
                            ...config,
                            network: value,
                          }),
                        );
                      }}
                    >
                      {STELLAR_NETWORK_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    <Input
                      id={`stellar-horizon-${selectedStellarNode.id}`}
                      fieldSize="md"
                      label="Custom Horizon URL"
                      placeholder="https://horizon.stellar.org"
                      value={selectedStellarNode.config.horizonUrl}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        updateStellarConfig(
                          selectedStellarNode.id,
                          (config) => ({
                            ...config,
                            horizonUrl: value,
                          }),
                        );
                      }}
                    />
                    <div className={styles.parameterGrid}>
                      <Input
                        id={`stellar-limit-${selectedStellarNode.id}`}
                        fieldSize="sm"
                        type="number"
                        min="1"
                        max="200"
                        step="1"
                        label="Payments to fetch"
                        value={selectedStellarNode.config.paymentsLimit}
                        onChange={(event) => {
                          const parsed = Number(event.currentTarget.value);
                          updateStellarConfig(
                            selectedStellarNode.id,
                            (config) => {
                              const normalized = Number.isNaN(parsed)
                                ? config.paymentsLimit
                                : Math.min(
                                    200,
                                    Math.max(1, Math.round(parsed)),
                                  );
                              if (normalized === config.paymentsLimit) {
                                return config;
                              }
                              return {
                                ...config,
                                paymentsLimit: normalized,
                              };
                            },
                          );
                        }}
                      />
                      <Select
                        id={`stellar-include-failed-${selectedStellarNode.id}`}
                        fieldSize="sm"
                        label="Include failed"
                        value={
                          selectedStellarNode.config.includeFailed
                            ? "true"
                            : "false"
                        }
                        onChange={(event) => {
                          const value = event.currentTarget.value === "true";
                          if (
                            value === selectedStellarNode.config.includeFailed
                          ) {
                            return;
                          }
                          updateStellarConfig(
                            selectedStellarNode.id,
                            (config) => ({
                              ...config,
                              includeFailed: value,
                            }),
                          );
                        }}
                      >
                        <option value="false">No</option>
                        <option value="true">Yes</option>
                      </Select>
                    </div>
                    <Text as="p" size="xs" className={styles.inspectorHint}>
                      Fetch balances and recent payments; leave Horizon blank to
                      use the default for the selected network.
                    </Text>
                    <div className={styles.inspectorActions}>
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() =>
                          void runStellarPreview(selectedStellarNode)
                        }
                        disabled={isStellarPreviewRunning}
                      >
                        {isStellarPreviewRunning
                          ? "Fetching..."
                          : "Fetch from Horizon"}
                      </Button>
                    </div>
                    {stellarPreviewError ? (
                      <Text as="p" size="xs" className={styles.errorMessage}>
                        {stellarPreviewError}
                      </Text>
                    ) : null}
                    {stellarLastPreview ? (
                      <div className={styles.previewPanel}>
                        <Text
                          as="h4"
                          size="xs"
                          className={styles.previewHeader}
                        >
                          Last preview
                          {stellarPreviewTimestamp
                            ? ` · ${stellarPreviewTimestamp}`
                            : ""}
                        </Text>
                        <Text as="p" size="xs" className={styles.previewMeta}>
                          Network {stellarLastPreview.network} · Horizon{" "}
                          {stellarLastPreview.horizonUrl}
                        </Text>
                        {aggregatedWalletJson ? (
                          <>
                            <Text
                              as="p"
                              size="xs"
                              className={styles.previewMeta}
                            >
                              Use this JSON as{" "}
                              <span
                                className={styles.codeInline}
                              >{`{{wallet_json}}`}</span>{" "}
                              input for Gemini prompts.
                            </Text>
                            <pre className={styles.previewOutput}>
                              {aggregatedWalletJson}
                            </pre>
                          </>
                        ) : null}
                        {stellarLastPreview.error ? (
                          <Text
                            as="p"
                            size="xs"
                            className={styles.errorMessage}
                          >
                            {stellarLastPreview.error}
                          </Text>
                        ) : null}
                        {formattedStellarBalances ||
                        formattedStellarPayments ? (
                          <details className={styles.previewDetails}>
                            <summary>Raw Horizon fields</summary>
                            {formattedStellarBalances ? (
                              <>
                                <Text
                                  as="h5"
                                  size="xs"
                                  className={styles.previewHeader}
                                >
                                  Balances
                                </Text>
                                <pre className={styles.previewOutput}>
                                  {formattedStellarBalances}
                                </pre>
                              </>
                            ) : null}
                            {formattedStellarPayments ? (
                              <>
                                <Text
                                  as="h5"
                                  size="xs"
                                  className={styles.previewHeader}
                                >
                                  Recent payments
                                </Text>
                                <pre className={styles.previewOutput}>
                                  {formattedStellarPayments}
                                </pre>
                              </>
                            ) : null}
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : selectedNode.kind === "gemini" && selectedGeminiNode ? (
                  <div className={styles.inspectorDetails}>
                    {connectionsPanel}
                    <Input
                      id={`node-title-${selectedGeminiNode.id}`}
                      fieldSize="sm"
                      label="Node title"
                      value={selectedGeminiNode.title}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        updateGeminiNode(selectedGeminiNode.id, (node) => ({
                          ...node,
                          title: value,
                        }));
                      }}
                    />
                    <Select
                      id={`gemini-model-${selectedGeminiNode.id}`}
                      fieldSize="sm"
                      label="Model"
                      value={selectedGeminiNode.config.model}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        if (value === selectedGeminiNode.config.model) {
                          return;
                        }
                        updateGeminiConfig(selectedGeminiNode.id, (config) => ({
                          ...config,
                          model: value,
                        }));
                      }}
                    >
                      {GEMINI_MODEL_OPTIONS.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </Select>
                    <Textarea
                      id={`gemini-system-${selectedGeminiNode.id}`}
                      fieldSize="md"
                      label="System instruction"
                      placeholder="Optional guardrails for tone or format."
                      value={selectedGeminiNode.config.systemInstruction}
                      onChange={(event) =>
                        updateGeminiConfig(selectedGeminiNode.id, (config) => ({
                          ...config,
                          systemInstruction: event.currentTarget.value,
                        }))
                      }
                    />
                    <Textarea
                      id={`gemini-template-${selectedGeminiNode.id}`}
                      fieldSize="md"
                      label="Prompt template"
                      note="Use {{variable}} placeholders to insert inputs."
                      value={selectedGeminiNode.config.promptTemplate}
                      onChange={(event) =>
                        updateGeminiConfig(selectedGeminiNode.id, (config) => ({
                          ...config,
                          promptTemplate: event.currentTarget.value,
                        }))
                      }
                    />
                    <div className={styles.parameterGrid}>
                      <Input
                        id={`gemini-temperature-${selectedGeminiNode.id}`}
                        fieldSize="sm"
                        type="number"
                        step="0.05"
                        min="0"
                        max="2"
                        label="Temperature"
                        value={selectedGeminiNode.config.temperature}
                        onChange={(event) => {
                          const next = Number(event.currentTarget.value);
                          if (
                            Number.isNaN(next) ||
                            next === selectedGeminiNode.config.temperature
                          ) {
                            return;
                          }
                          updateGeminiConfig(
                            selectedGeminiNode.id,
                            (config) => ({
                              ...config,
                              temperature: next,
                            }),
                          );
                        }}
                      />
                      <Input
                        id={`gemini-top-p-${selectedGeminiNode.id}`}
                        fieldSize="sm"
                        type="number"
                        step="0.01"
                        min="0"
                        max="1"
                        label="Top P"
                        value={selectedGeminiNode.config.topP}
                        onChange={(event) => {
                          const next = Number(event.currentTarget.value);
                          if (
                            Number.isNaN(next) ||
                            next === selectedGeminiNode.config.topP
                          ) {
                            return;
                          }
                          updateGeminiConfig(
                            selectedGeminiNode.id,
                            (config) => ({
                              ...config,
                              topP: next,
                            }),
                          );
                        }}
                      />
                      <Input
                        id={`gemini-top-k-${selectedGeminiNode.id}`}
                        fieldSize="sm"
                        type="number"
                        step="1"
                        min="0"
                        label="Top K"
                        value={selectedGeminiNode.config.topK}
                        onChange={(event) => {
                          const next = Number(event.currentTarget.value);
                          const rounded = Math.max(0, Math.round(next));
                          if (
                            Number.isNaN(next) ||
                            rounded === selectedGeminiNode.config.topK
                          ) {
                            return;
                          }
                          updateGeminiConfig(
                            selectedGeminiNode.id,
                            (config) => ({
                              ...config,
                              topK: rounded,
                            }),
                          );
                        }}
                      />
                      <Input
                        id={`gemini-max-output-${selectedGeminiNode.id}`}
                        fieldSize="sm"
                        type="number"
                        step="1"
                        min="1"
                        label="Max output tokens"
                        value={selectedGeminiNode.config.maxOutputTokens ?? ""}
                        onChange={(event) => {
                          const raw = event.currentTarget.value;
                          const parsed = Number(raw);
                          const normalized =
                            raw === "" || Number.isNaN(parsed)
                              ? undefined
                              : Math.max(1, Math.round(parsed));
                          if (
                            normalized ===
                              selectedGeminiNode.config.maxOutputTokens &&
                            (normalized !== undefined || raw !== "")
                          ) {
                            return;
                          }
                          updateGeminiConfig(
                            selectedGeminiNode.id,
                            (config) => ({
                              ...config,
                              maxOutputTokens: normalized,
                            }),
                          );
                        }}
                      />
                      <Select
                        id={`gemini-mime-${selectedGeminiNode.id}`}
                        fieldSize="sm"
                        label="Response type"
                        value={
                          selectedGeminiNode.config.responseMimeType ??
                          "text/plain"
                        }
                        onChange={(event) => {
                          const value = event.currentTarget.value as
                            | "text/plain"
                            | "application/json";
                          if (
                            value === selectedGeminiNode.config.responseMimeType
                          ) {
                            return;
                          }
                          updateGeminiConfig(
                            selectedGeminiNode.id,
                            (config) => ({
                              ...config,
                              responseMimeType: value,
                            }),
                          );
                        }}
                      >
                        {GEMINI_RESPONSE_MIME_TYPES.map(({ value, label }) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div className={styles.inspectorSection}>
                      <div className={styles.sectionHeader}>
                        <Text as="h4" size="xs">
                          Input variables
                        </Text>
                        <Button
                          variant="tertiary"
                          size="sm"
                          onClick={() => addGeminiVariable(selectedGeminiNode)}
                        >
                          <Icon.PlusCircle size="sm" />
                          Add variable
                        </Button>
                      </div>
                      {selectedGeminiNode.config.inputVariables.length === 0 ? (
                        <Text as="p" size="xs" className={styles.inspectorHint}>
                          Variables insert dynamic values into the prompt using{" "}
                          <span
                            className={styles.codeInline}
                          >{`{{name}}`}</span>{" "}
                          placeholders.
                        </Text>
                      ) : (
                        selectedGeminiNode.config.inputVariables.map(
                          (variable, index) => (
                            <div key={variable} className={styles.variableRow}>
                              <Input
                                id={`gemini-variable-${selectedGeminiNode.id}-${variable}`}
                                fieldSize="sm"
                                label={`Variable ${index + 1}`}
                                value={variable}
                                onChange={(event) =>
                                  renameGeminiVariable(
                                    selectedGeminiNode,
                                    index,
                                    event.currentTarget.value,
                                  )
                                }
                              />
                              <Button
                                variant="tertiary"
                                size="sm"
                                title="Remove variable"
                                onClick={() =>
                                  removeGeminiVariable(
                                    selectedGeminiNode,
                                    variable,
                                  )
                                }
                              >
                                <Icon.MinusCircle size="sm" />
                              </Button>
                            </div>
                          ),
                        )
                      )}
                    </div>

                    <div className={styles.inspectorSection}>
                      <Text as="h4" size="xs">
                        Preview inputs
                      </Text>
                      {selectedGeminiNode.config.inputVariables.length === 0 ? (
                        <Text as="p" size="xs" className={styles.inspectorHint}>
                          Add a variable to configure preview inputs.
                        </Text>
                      ) : (
                        selectedGeminiNode.config.inputVariables.map(
                          (variable) => (
                            <Textarea
                              key={variable}
                              id={`gemini-test-${selectedGeminiNode.id}-${variable}`}
                              fieldSize="md"
                              label={variable}
                              value={
                                selectedGeminiNode.config.testInputs[
                                  variable
                                ] ?? ""
                              }
                              onChange={(event) =>
                                updateGeminiTestInput(
                                  selectedGeminiNode,
                                  variable,
                                  event.currentTarget.value,
                                )
                              }
                            />
                          ),
                        )
                      )}
                    </div>

                    <div className={styles.inspectorActions}>
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() =>
                          void runGeminiPreview(selectedGeminiNode)
                        }
                        disabled={isPreviewRunning}
                      >
                        <Icon.MagicWand02 size="sm" />
                        {isPreviewRunning
                          ? "Running preview..."
                          : "Run preview"}
                      </Button>
                    </div>
                    {previewError ? (
                      <Text as="p" size="xs" className={styles.errorMessage}>
                        {previewError}
                      </Text>
                    ) : null}
                    {formattedPreviewOutput ? (
                      <div className={styles.previewPanel}>
                        <Text
                          as="h4"
                          size="xs"
                          className={styles.previewHeader}
                        >
                          Last preview
                          {previewTimestamp ? ` · ${previewTimestamp}` : ""}
                        </Text>
                        <pre className={styles.previewOutput}>
                          {formattedPreviewOutput}
                        </pre>
                        {geminiLastPreview?.usage ? (
                          <Text as="p" size="xs" className={styles.previewMeta}>
                            Prompt {geminiLastPreview.usage.promptTokens ?? "—"}
                            {" · "}
                            Response{" "}
                            {geminiLastPreview.usage.responseTokens ?? "—"}
                            {" · "}
                            Total {geminiLastPreview.usage.totalTokens ?? "—"}
                          </Text>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : selectedNode.kind === "http" && selectedHttpNode ? (
                  <div className={styles.inspectorDetails}>
                    {connectionsPanel}
                    <Input
                      id={`node-title-${selectedHttpNode.id}`}
                      fieldSize="sm"
                      label="Node title"
                      value={selectedHttpNode.title}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        updateHttpNode(selectedHttpNode.id, (node) => ({
                          ...node,
                          title: value,
                        }));
                      }}
                    />

                    <div className={styles.inspectorSection}>
                      <div className={styles.parameterGrid}>
                        <Select
                          id={`http-method-${selectedHttpNode.id}`}
                          fieldSize="sm"
                          label="Method"
                          value={selectedHttpNode.config.method}
                          onChange={(event) => {
                            const value = event.currentTarget
                              .value as HttpMethod;
                            if (value === selectedHttpNode.config.method) {
                              return;
                            }
                            updateHttpConfig(selectedHttpNode.id, (config) => ({
                              ...config,
                              method: value,
                            }));
                          }}
                        >
                          {HTTP_METHOD_OPTIONS.map((method) => (
                            <option key={method} value={method}>
                              {method}
                            </option>
                          ))}
                        </Select>
                        <Input
                          id={`http-url-${selectedHttpNode.id}`}
                          fieldSize="md"
                          label="Request URL"
                          placeholder="https://api.example.com/resource"
                          value={selectedHttpNode.config.url}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            updateHttpConfig(selectedHttpNode.id, (config) => ({
                              ...config,
                              url: value,
                            }));
                          }}
                        />
                        <Input
                          id={`http-timeout-${selectedHttpNode.id}`}
                          fieldSize="sm"
                          type="number"
                          min="0"
                          step="100"
                          label="Timeout (ms)"
                          value={selectedHttpNode.config.timeoutMs}
                          onChange={(event) => {
                            const parsed = Number(event.currentTarget.value);
                            updateHttpConfig(selectedHttpNode.id, (config) => {
                              const normalized = Number.isNaN(parsed)
                                ? config.timeoutMs
                                : Math.max(0, Math.round(parsed));
                              if (normalized === config.timeoutMs) {
                                return config;
                              }
                              return {
                                ...config,
                                timeoutMs: normalized,
                              };
                            });
                          }}
                        />
                      </div>
                    </div>

                    <div className={styles.inspectorSection}>
                      <div className={styles.sectionHeader}>
                        <Text as="h4" size="xs">
                          Query parameters
                        </Text>
                        <Button
                          variant="tertiary"
                          size="sm"
                          onClick={() =>
                            addHttpKeyValue(selectedHttpNode, "queryParams")
                          }
                        >
                          <Icon.PlusCircle size="sm" />
                          Add query param
                        </Button>
                      </div>
                      {selectedHttpNode.config.queryParams.length === 0 ? (
                        <Text as="p" size="xs" className={styles.inspectorHint}>
                          Append query string values to the request.
                        </Text>
                      ) : (
                        selectedHttpNode.config.queryParams.map(
                          (param, index) => (
                            <div key={param.id} className={styles.keyValueRow}>
                              <Input
                                id={`http-query-key-${selectedHttpNode.id}-${param.id}`}
                                fieldSize="sm"
                                label={`Key ${index + 1}`}
                                value={param.key}
                                onChange={(event) =>
                                  updateHttpKeyValue(
                                    selectedHttpNode,
                                    "queryParams",
                                    param.id,
                                    (entry) => ({
                                      ...entry,
                                      key: event.currentTarget.value,
                                    }),
                                  )
                                }
                              />
                              <Input
                                id={`http-query-value-${selectedHttpNode.id}-${param.id}`}
                                fieldSize="sm"
                                label={`Value ${index + 1}`}
                                value={param.value}
                                onChange={(event) =>
                                  updateHttpKeyValue(
                                    selectedHttpNode,
                                    "queryParams",
                                    param.id,
                                    (entry) => ({
                                      ...entry,
                                      value: event.currentTarget.value,
                                    }),
                                  )
                                }
                              />
                              <Button
                                variant="tertiary"
                                size="sm"
                                title="Remove query param"
                                onClick={() =>
                                  removeHttpKeyValue(
                                    selectedHttpNode,
                                    "queryParams",
                                    param.id,
                                  )
                                }
                              >
                                <Icon.MinusCircle size="sm" />
                              </Button>
                            </div>
                          ),
                        )
                      )}
                    </div>

                    <div className={styles.inspectorSection}>
                      <div className={styles.sectionHeader}>
                        <Text as="h4" size="xs">
                          Headers
                        </Text>
                        <Button
                          variant="tertiary"
                          size="sm"
                          onClick={() =>
                            addHttpKeyValue(selectedHttpNode, "headers")
                          }
                        >
                          <Icon.PlusCircle size="sm" />
                          Add header
                        </Button>
                      </div>
                      {selectedHttpNode.config.headers.length === 0 ? (
                        <Text as="p" size="xs" className={styles.inspectorHint}>
                          Include custom headers such as Authorization or
                          Content-Type.
                        </Text>
                      ) : (
                        selectedHttpNode.config.headers.map((header, index) => (
                          <div key={header.id} className={styles.keyValueRow}>
                            <Input
                              id={`http-header-key-${selectedHttpNode.id}-${header.id}`}
                              fieldSize="sm"
                              label={`Key ${index + 1}`}
                              value={header.key}
                              onChange={(event) =>
                                updateHttpKeyValue(
                                  selectedHttpNode,
                                  "headers",
                                  header.id,
                                  (entry) => ({
                                    ...entry,
                                    key: event.currentTarget.value,
                                  }),
                                )
                              }
                            />
                            <Input
                              id={`http-header-value-${selectedHttpNode.id}-${header.id}`}
                              fieldSize="sm"
                              label={`Value ${index + 1}`}
                              value={header.value}
                              onChange={(event) =>
                                updateHttpKeyValue(
                                  selectedHttpNode,
                                  "headers",
                                  header.id,
                                  (entry) => ({
                                    ...entry,
                                    value: event.currentTarget.value,
                                  }),
                                )
                              }
                            />
                            <Button
                              variant="tertiary"
                              size="sm"
                              title="Remove header"
                              onClick={() =>
                                removeHttpKeyValue(
                                  selectedHttpNode,
                                  "headers",
                                  header.id,
                                )
                              }
                            >
                              <Icon.MinusCircle size="sm" />
                            </Button>
                          </div>
                        ))
                      )}
                    </div>

                    <div className={styles.inspectorSection}>
                      <div className={styles.sectionHeader}>
                        <Text as="h4" size="xs">
                          Body
                        </Text>
                      </div>
                      <Select
                        id={`http-body-mime-${selectedHttpNode.id}`}
                        fieldSize="sm"
                        label="Content type"
                        value={selectedHttpNode.config.bodyMimeType}
                        onChange={(event) => {
                          const value = event.currentTarget.value as
                            | "application/json"
                            | "text/plain";
                          if (value === selectedHttpNode.config.bodyMimeType) {
                            return;
                          }
                          updateHttpConfig(selectedHttpNode.id, (config) => ({
                            ...config,
                            bodyMimeType: value,
                          }));
                        }}
                      >
                        {HTTP_BODY_MIME_TYPES.map(({ value, label }) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                      <Textarea
                        id={`http-body-${selectedHttpNode.id}`}
                        fieldSize="md"
                        label="Request body"
                        note="Ignored for GET and HEAD requests. Use {{variable}} placeholders to inject values."
                        value={selectedHttpNode.config.bodyTemplate}
                        onChange={(event) =>
                          updateHttpConfig(selectedHttpNode.id, (config) => ({
                            ...config,
                            bodyTemplate: event.currentTarget.value,
                          }))
                        }
                      />
                      {(selectedHttpNode.config.method === "GET" ||
                        selectedHttpNode.config.method === "HEAD") && (
                        <Text as="p" size="xs" className={styles.inspectorHint}>
                          Bodies are automatically skipped for{" "}
                          {selectedHttpNode.config.method} requests.
                        </Text>
                      )}
                    </div>

                    <div className={styles.inspectorSection}>
                      <div className={styles.sectionHeader}>
                        <Text as="h4" size="xs">
                          Authentication
                        </Text>
                      </div>
                      <Select
                        id={`http-auth-${selectedHttpNode.id}`}
                        fieldSize="sm"
                        label="Scheme"
                        value={selectedHttpNode.config.auth.type}
                        onChange={(event) => {
                          const value = event.currentTarget
                            .value as HttpAuthType;
                          if (value === selectedHttpNode.config.auth.type) {
                            return;
                          }
                          updateHttpConfig(selectedHttpNode.id, (config) => {
                            switch (value) {
                              case "basic":
                                return {
                                  ...config,
                                  auth: {
                                    type: "basic",
                                    username: "",
                                    password: "",
                                  },
                                };
                              case "bearer":
                                return {
                                  ...config,
                                  auth: { type: "bearer", token: "" },
                                };
                              default:
                                return {
                                  ...config,
                                  auth: { type: "none" },
                                };
                            }
                          });
                        }}
                      >
                        <option value="none">No auth</option>
                        <option value="basic">HTTP Basic</option>
                        <option value="bearer">Bearer token</option>
                      </Select>
                      {selectedHttpNode.config.auth.type === "basic" ? (
                        <div className={styles.parameterGrid}>
                          <Input
                            id={`http-auth-user-${selectedHttpNode.id}`}
                            fieldSize="sm"
                            label="Username"
                            value={selectedHttpNode.config.auth.username}
                            onChange={(event) =>
                              updateHttpConfig(
                                selectedHttpNode.id,
                                (config) => ({
                                  ...config,
                                  auth: {
                                    type: "basic",
                                    username: event.currentTarget.value,
                                    password:
                                      config.auth.type === "basic"
                                        ? config.auth.password
                                        : "",
                                  },
                                }),
                              )
                            }
                          />
                          <Input
                            id={`http-auth-pass-${selectedHttpNode.id}`}
                            fieldSize="sm"
                            type="password"
                            label="Password"
                            value={selectedHttpNode.config.auth.password}
                            onChange={(event) =>
                              updateHttpConfig(
                                selectedHttpNode.id,
                                (config) => ({
                                  ...config,
                                  auth: {
                                    type: "basic",
                                    username:
                                      config.auth.type === "basic"
                                        ? config.auth.username
                                        : "",
                                    password: event.currentTarget.value,
                                  },
                                }),
                              )
                            }
                          />
                        </div>
                      ) : null}
                      {selectedHttpNode.config.auth.type === "bearer" ? (
                        <Input
                          id={`http-auth-token-${selectedHttpNode.id}`}
                          fieldSize="md"
                          type="password"
                          label="Bearer token"
                          value={selectedHttpNode.config.auth.token}
                          onChange={(event) =>
                            updateHttpConfig(selectedHttpNode.id, (config) => ({
                              ...config,
                              auth: {
                                type: "bearer",
                                token: event.currentTarget.value,
                              },
                            }))
                          }
                        />
                      ) : null}
                      <Text as="p" size="xs" className={styles.inspectorHint}>
                        Secrets are stored locally for previews only. Use
                        environment variables in production runners.
                      </Text>
                    </div>

                    <div className={styles.inspectorSection}>
                      <div className={styles.sectionHeader}>
                        <Text as="h4" size="xs">
                          Input variables
                        </Text>
                        <Button
                          variant="tertiary"
                          size="sm"
                          onClick={() => addHttpVariable(selectedHttpNode)}
                        >
                          <Icon.PlusCircle size="sm" />
                          Add variable
                        </Button>
                      </div>
                      {selectedHttpNode.config.inputVariables.length === 0 ? (
                        <Text as="p" size="xs" className={styles.inspectorHint}>
                          Variables insert dynamic values using{" "}
                          <span
                            className={styles.codeInline}
                          >{`{{name}}`}</span>
                          {" placeholders."}
                        </Text>
                      ) : (
                        selectedHttpNode.config.inputVariables.map(
                          (variable, index) => (
                            <div key={variable} className={styles.variableRow}>
                              <Input
                                id={`http-variable-${selectedHttpNode.id}-${variable}`}
                                fieldSize="sm"
                                label={`Variable ${index + 1}`}
                                value={variable}
                                onChange={(event) =>
                                  renameHttpVariable(
                                    selectedHttpNode,
                                    index,
                                    event.currentTarget.value,
                                  )
                                }
                              />
                              <Button
                                variant="tertiary"
                                size="sm"
                                title="Remove variable"
                                onClick={() =>
                                  removeHttpVariable(selectedHttpNode, variable)
                                }
                              >
                                <Icon.MinusCircle size="sm" />
                              </Button>
                            </div>
                          ),
                        )
                      )}
                    </div>

                    <div className={styles.inspectorSection}>
                      <Text as="h4" size="xs">
                        Preview inputs
                      </Text>
                      {selectedHttpNode.config.inputVariables.length === 0 ? (
                        <Text as="p" size="xs" className={styles.inspectorHint}>
                          Add a variable to configure preview inputs.
                        </Text>
                      ) : (
                        selectedHttpNode.config.inputVariables.map(
                          (variable) => (
                            <Textarea
                              key={variable}
                              id={`http-test-${selectedHttpNode.id}-${variable}`}
                              fieldSize="md"
                              label={variable}
                              value={
                                selectedHttpNode.config.testInputs[variable] ??
                                ""
                              }
                              onChange={(event) =>
                                updateHttpTestInput(
                                  selectedHttpNode,
                                  variable,
                                  event.currentTarget.value,
                                )
                              }
                            />
                          ),
                        )
                      )}
                    </div>

                    <div className={styles.inspectorActions}>
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() => void runHttpPreview(selectedHttpNode)}
                        disabled={isHttpPreviewRunning}
                      >
                        <Icon.Globe02 size="sm" />
                        {isHttpPreviewRunning
                          ? "Sending request..."
                          : "Send request"}
                      </Button>
                    </div>
                    {httpPreviewError ? (
                      <Text as="p" size="xs" className={styles.errorMessage}>
                        {httpPreviewError}
                      </Text>
                    ) : null}
                    {httpLastPreview ? (
                      <div className={styles.previewPanel}>
                        <Text
                          as="h4"
                          size="xs"
                          className={styles.previewHeader}
                        >
                          Last response
                          {httpPreviewTimestamp
                            ? ` · ${httpPreviewTimestamp}`
                            : ""}
                        </Text>
                        {httpLastPreview.response ? (
                          <>
                            <Text
                              as="p"
                              size="xs"
                              className={styles.previewMeta}
                            >
                              Status {httpLastPreview.response.status}
                              {" · "}
                              {httpLastPreview.response.ok ? "OK" : "Error"}
                              {" · "}
                              {Math.round(httpLastPreview.response.durationMs)}
                              ms
                            </Text>
                            {formattedHttpBody ? (
                              <pre className={styles.previewOutput}>
                                {formattedHttpBody}
                              </pre>
                            ) : null}
                            {formattedHttpHeaders ? (
                              <details className={styles.previewDetails}>
                                <summary>Headers</summary>
                                <pre className={styles.previewOutput}>
                                  {formattedHttpHeaders}
                                </pre>
                              </details>
                            ) : null}
                          </>
                        ) : null}
                        {httpLastPreview.error ? (
                          <Text
                            as="p"
                            size="xs"
                            className={styles.errorMessage}
                          >
                            {httpLastPreview.error}
                          </Text>
                        ) : null}
                        <Text as="p" size="xs" className={styles.previewMeta}>
                          HTTP calls {httpLastPreview.usage.httpCalls}
                          {" · "}
                          Runtime {Math.round(httpLastPreview.usage.runtimeMs)}
                          ms
                        </Text>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className={styles.inspectorDetails}>
                    {connectionsPanel}
                    <Text as="h3" size="sm">
                      {selectedNode.title}
                    </Text>
                    <Text as="p" size="xs" className={styles.inspectorHint}>
                      {selectedNode.kind} configuration is coming soon.
                    </Text>
                  </div>
                )
              ) : (
                <div className={styles.inspectorEmpty}>
                  <Icon.Edit03 size="lg" />
                  <Text as="p" size="sm">
                    Nothing selected
                  </Text>
                  <Text as="p" size="xs">
                    Choose a node in the canvas to view its configuration.
                  </Text>
                </div>
              )}
            </aside>
          </section>
        </div>
        <Modal
          visible={isGeminiKeyModalOpen}
          onClose={() => setGeminiKeyModalOpen(false)}
        >
          <Modal.Heading>Gemini API key</Modal.Heading>
          <Modal.Body>
            <Text as="p" size="sm">
              Paste your Gemini API key to enable live model calls. The key is
              stored locally in your browser only.
            </Text>
            <Input
              id="gemini-api-key"
              fieldSize="md"
              label="API key"
              type="password"
              value={geminiKeyDraft}
              onChange={(event) => setGeminiKeyDraft(event.currentTarget.value)}
              placeholder="AIza..."
            />
          </Modal.Body>
          <Modal.Footer>
            <Button variant="primary" size="md" onClick={handleSaveGeminiKey}>
              Save key
            </Button>
            <Button
              variant="tertiary"
              size="md"
              onClick={handleClearGeminiKey}
              disabled={!geminiStoredKey}
            >
              Clear
            </Button>
          </Modal.Footer>
        </Modal>
        {latestRunResult && isResultModalOpen ? (
          <div
            className={styles.resultOverlay}
            role="dialog"
            aria-modal="true"
            onClick={() => setResultModalOpen(false)}
          >
            <div
              className={styles.resultCard}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <div className={styles.resultHeader}>
                <div>
                  <Text as="h2" size="sm" className={styles.resultLabel}>
                    {latestRunResult.runType === "run"
                      ? "Workflow run"
                      : "Preview run"}
                  </Text>
                  <Text as="p" size="xs" className={styles.resultMeta}>
                    {formatRelativeDate(latestRunResult.executedAt)} ·{" "}
                    {latestRunResult.workflowLabel}
                  </Text>
                </div>
                <Button
                  variant="tertiary"
                  size="sm"
                  onClick={() => setResultModalOpen(false)}
                >
                  <Icon.X size="sm" />
                  Close
                </Button>
              </div>
              <div className={styles.resultBody}>
                {latestRunResult.entries.length === 0 ? (
                  <Text as="p" size="sm" className={styles.resultEmpty}>
                    This run did not emit any outputs. Try wiring nodes or
                    enabling previews.
                  </Text>
                ) : (
                  latestRunResult.entries.map((entry) => (
                    <div key={entry.nodeId} className={styles.resultNode}>
                      <div className={styles.resultNodeHeader}>
                        <Text as="h3" size="sm">
                          {entry.title}
                        </Text>
                        <span
                          className={styles.resultStatus}
                          data-status={entry.status}
                        >
                          {entry.status === "success"
                            ? "Success"
                            : entry.status === "error"
                              ? "Error"
                              : "Skipped"}
                        </span>
                      </div>
                      {entry.detail ? (
                        <Text as="p" size="xs" className={styles.resultDetail}>
                          {entry.detail}
                        </Text>
                      ) : null}
                      {Object.entries(entry.outputs).map(([key, value]) => (
                        <div key={key} className={styles.resultOutput}>
                          <Text
                            as="p"
                            size="xs"
                            className={styles.resultOutputKey}
                          >
                            {formatOutputLabel(key)}
                          </Text>
                          <pre className={styles.resultOutputValue}>
                            {value}
                          </pre>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Layout.Inset>
    </Layout.Content>
  );
};

export default Builder;
