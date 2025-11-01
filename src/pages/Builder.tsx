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
import { DEFAULT_HTTP_CONFIG } from "../types/workflows";
import type {
  GeminiNodeConfig,
  HttpKeyValue,
  HttpMethod,
  HttpNodeConfig,
  WorkflowDefinition,
  WorkflowDraftState,
  WorkflowNode,
  WorkflowNodeKind,
} from "../types/workflows";
import styles from "./Builder.module.css";

const GRID_SIZE = 48;
const NODE_WIDTH = 240;
const NODE_HEIGHT = 128;
const BASE_CANVAS_WIDTH = GRID_SIZE * 1200;
const BASE_CANVAS_HEIGHT = GRID_SIZE * 1200;
const MIN_CANVAS_SCALE = 0.01;
const MAX_CANVAS_SCALE = 64;
const CANVAS_ZOOM_FACTOR = 1.2;
const GEMINI_MODEL_OPTIONS = [
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

const EMPTY_NODES: WorkflowNode[] = [];

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

const snapPosition = ({ x, y }: { x: number; y: number }) => ({
  x: Math.round(x / GRID_SIZE) * GRID_SIZE,
  y: Math.round(y / GRID_SIZE) * GRID_SIZE,
});

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
  isSelected: boolean;
  onDrag: (id: string, position: { x: number; y: number }) => void;
  getCanvasMetrics: () => CanvasMetrics | null;
}> = ({ node, onSelect, isSelected, onDrag, getCanvasMetrics }) => {
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const metrics = getCanvasMetrics();
    if (!metrics) return;

    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startTarget = event.currentTarget;
    const { rect, scale, panX, panY } = metrics;
    const pointerCanvasX = (event.clientX - rect.left - panX) / scale;
    const pointerCanvasY = (event.clientY - rect.top - panY) / scale;
    const originX = pointerCanvasX - node.position.x;
    const originY = pointerCanvasY - node.position.y;

    const handlePointerMove = (moveEvent: PointerEvent) => {
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
      onDrag(node.id, { x: nextX, y: nextY });
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      try {
        startTarget.releasePointerCapture(pointerId);
      } catch {
        /* noop */
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
      className={[styles.node, isSelected ? styles.nodeSelected : ""]
        .join(" ")
        .trim()}
      style={{
        left: node.position.x,
        top: node.position.y,
        width: NODE_WIDTH,
      }}
      onClick={() => onSelect(node.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node.id);
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
        <span className={styles.nodePort} aria-hidden />
        <span className={styles.nodePort} aria-hidden />
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
  const {
    apiKey: geminiApiKey,
    persistedKey: storedGeminiKey,
    setApiKey: persistGeminiKey,
    clearApiKey,
  } = useGeminiApiKey();

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
        setPreviewError("Add a Gemini API key above to run previews.");
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
    [],
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

  const [isPreviewRunning, setIsPreviewRunning] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState(storedGeminiKey);
  const [isHttpPreviewRunning, setIsHttpPreviewRunning] = useState(false);
  const [httpPreviewError, setHttpPreviewError] = useState<string | null>(null);
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
    setApiKeyDraft(storedGeminiKey);
  }, [storedGeminiKey]);

  useEffect(() => {
    setPreviewError(null);
    setIsPreviewRunning(false);
    setHttpPreviewError(null);
    setIsHttpPreviewRunning(false);
  }, [selectedNodeId]);

  useEffect(() => {
    setPreviewError(null);
  }, [geminiApiKey]);

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
              <Button variant="tertiary" size="md">
                <Icon.Eye />
                Preview run
              </Button>
              <Button variant="primary" size="md">
                <Icon.PlayCircle />
                Save & run
              </Button>
            </div>
          </header>

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
                      {nodes.map((node) => (
                        <CanvasNode
                          key={node.id}
                          node={node}
                          isSelected={selectedNodeId === node.id}
                          onSelect={(id) => setSelectedNodeId(id)}
                          onDrag={moveNode}
                          getCanvasMetrics={getCanvasMetrics}
                        />
                      ))}
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
              <div className={styles.apiKeyPanel}>
                <div className={styles.sectionHeader}>
                  <Text as="h3" size="xs">
                    Gemini API key
                  </Text>
                  <Text as="p" size="xs" className={styles.inspectorHint}>
                    {storedGeminiKey
                      ? "Stored locally"
                      : geminiApiKey
                        ? "Using VITE_GEMINI_API_KEY"
                        : "No key configured"}
                  </Text>
                </div>
                <div className={styles.apiKeyRow}>
                  <Input
                    id="gemini-api-key"
                    fieldSize="sm"
                    type="password"
                    placeholder="Paste or override key"
                    value={apiKeyDraft}
                    onChange={(event) =>
                      setApiKeyDraft(event.currentTarget.value)
                    }
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => persistGeminiKey(apiKeyDraft)}
                    disabled={apiKeyDraft.trim() === storedGeminiKey.trim()}
                  >
                    Save
                  </Button>
                  {storedGeminiKey ? (
                    <Button
                      variant="tertiary"
                      size="sm"
                      onClick={() => {
                        clearApiKey();
                        setApiKeyDraft("");
                      }}
                    >
                      Clear
                    </Button>
                  ) : null}
                </div>
                <Text as="p" size="xs" className={styles.inspectorHint}>
                  Keys are stored in this browser only. Leave blank to fall back
                  to VITE_GEMINI_API_KEY.
                </Text>
              </div>
              {selectedNode ? (
                selectedNode.kind === "gemini" && selectedGeminiNode ? (
                  <div className={styles.inspectorDetails}>
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
      </Layout.Inset>
    </Layout.Content>
  );
};

export default Builder;
