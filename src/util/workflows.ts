import storage from "./storage";
import {
  DEFAULT_GEMINI_CONFIG,
  DEFAULT_HTTP_CONFIG,
  EMPTY_WORKFLOW_STATE,
  type GeminiNodeConfig,
  type HttpAuthConfig,
  type HttpKeyValue,
  type HttpMethod,
  type HttpNodeConfig,
  type HttpPreview,
  type WorkflowConnection,
  type WorkflowDefinition,
  type WorkflowDraftState,
  type WorkflowNode,
  type WorkflowNodeConfigMap,
  type WorkflowNodeKind,
} from "../types/workflows";

const WORKFLOW_STORAGE_KEY = "workflowDrafts";

const WORKFLOW_NODE_KINDS: WorkflowNodeKind[] = [
  "http",
  "stellar-account",
  "gemini",
  "classifier",
  "conditional",
  "ipfs",
];

const HTTP_METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
];

const HTTP_BODY_MIME_TYPES = ["application/json", "text/plain"] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isWorkflowNodeKind = (value: unknown): value is WorkflowNodeKind =>
  typeof value === "string" &&
  WORKFLOW_NODE_KINDS.includes(value as WorkflowNodeKind);

const isHttpMethod = (value: unknown): value is HttpMethod =>
  typeof value === "string" && HTTP_METHODS.includes(value as HttpMethod);

const isHttpBodyMimeType = (
  value: unknown,
): value is HttpNodeConfig["bodyMimeType"] =>
  typeof value === "string" &&
  (HTTP_BODY_MIME_TYPES as readonly string[]).includes(value);

const sanitizeHttpKeyValue = (raw: unknown): HttpKeyValue => {
  if (!isObject(raw)) {
    return {
      id: createId(),
      key: "",
      value: "",
      enabled: true,
    };
  }

  const id =
    typeof raw.id === "string" && raw.id.trim().length > 0
      ? raw.id
      : createId();

  return {
    id,
    key: typeof raw.key === "string" ? raw.key : "",
    value: typeof raw.value === "string" ? raw.value : "",
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
  };
};

const sanitizeHttpAuth = (raw: unknown): HttpAuthConfig => {
  if (!isObject(raw)) {
    return { type: "none" };
  }

  switch (raw.type) {
    case "basic":
      return {
        type: "basic",
        username: typeof raw.username === "string" ? raw.username : "",
        password: typeof raw.password === "string" ? raw.password : "",
      };
    case "bearer":
      return {
        type: "bearer",
        token: typeof raw.token === "string" ? raw.token : "",
      };
    default:
      return { type: "none" };
  }
};

const sanitizeHttpPreview = (raw: unknown): HttpPreview | undefined => {
  if (!isObject(raw)) {
    return undefined;
  }

  if (!isObject(raw.request)) {
    return undefined;
  }

  const method = isHttpMethod(raw.request.method)
    ? raw.request.method
    : DEFAULT_HTTP_CONFIG.method;
  const url =
    typeof raw.request.url === "string"
      ? raw.request.url
      : DEFAULT_HTTP_CONFIG.url;

  const base: HttpPreview = {
    executedAt:
      typeof raw.executedAt === "string"
        ? raw.executedAt
        : new Date().toISOString(),
    request: { method, url },
    usage: {
      httpCalls:
        isObject(raw.usage) && typeof raw.usage.httpCalls === "number"
          ? Math.max(0, Math.round(raw.usage.httpCalls))
          : 0,
      runtimeMs:
        isObject(raw.usage) && typeof raw.usage.runtimeMs === "number"
          ? Math.max(0, Math.round(raw.usage.runtimeMs))
          : 0,
    },
  };

  if (isObject(raw.response)) {
    const headers = Array.isArray(raw.response.headers)
      ? raw.response.headers
          .map((entry) => {
            if (!isObject(entry)) return null;
            const key = typeof entry.key === "string" ? entry.key : null;
            const value = typeof entry.value === "string" ? entry.value : null;
            if (key === null || value === null) return null;
            return { key, value };
          })
          .filter(
            (item): item is { key: string; value: string } => item !== null,
          )
      : [];

    base.response = {
      status: typeof raw.response.status === "number" ? raw.response.status : 0,
      ok: typeof raw.response.ok === "boolean" ? raw.response.ok : false,
      durationMs:
        typeof raw.response.durationMs === "number"
          ? raw.response.durationMs
          : 0,
      headers,
      bodyText:
        typeof raw.response.bodyText === "string" ? raw.response.bodyText : "",
      bodyJson: raw.response.bodyJson,
    };
  }

  if (typeof raw.error === "string" && raw.error.trim().length > 0) {
    base.error = raw.error;
  }

  return base;
};

const sanitizeHttpConfig = (raw: unknown): HttpNodeConfig => {
  if (!isObject(raw)) {
    return {
      ...DEFAULT_HTTP_CONFIG,
      queryParams: [],
      headers: [],
      inputVariables: [],
      testInputs: {},
    };
  }

  const queryParams = Array.isArray(raw.queryParams)
    ? raw.queryParams.map(sanitizeHttpKeyValue)
    : [];
  const headers = Array.isArray(raw.headers)
    ? raw.headers.map(sanitizeHttpKeyValue)
    : [];
  const inputVariables = Array.isArray(raw.inputVariables)
    ? raw.inputVariables.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const testInputs = isObject(raw.testInputs)
    ? Object.entries(raw.testInputs).reduce<Record<string, string>>(
        (accumulator, [key, value]) => {
          accumulator[key] = typeof value === "string" ? value : "";
          return accumulator;
        },
        {},
      )
    : {};

  return {
    method: isHttpMethod(raw.method) ? raw.method : DEFAULT_HTTP_CONFIG.method,
    url: typeof raw.url === "string" ? raw.url : DEFAULT_HTTP_CONFIG.url,
    queryParams,
    headers,
    bodyTemplate:
      typeof raw.bodyTemplate === "string"
        ? raw.bodyTemplate
        : DEFAULT_HTTP_CONFIG.bodyTemplate,
    bodyMimeType: isHttpBodyMimeType(raw.bodyMimeType)
      ? raw.bodyMimeType
      : DEFAULT_HTTP_CONFIG.bodyMimeType,
    auth: sanitizeHttpAuth(raw.auth),
    timeoutMs:
      typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs)
        ? Math.max(0, Math.round(raw.timeoutMs))
        : DEFAULT_HTTP_CONFIG.timeoutMs,
    inputVariables,
    testInputs,
    lastPreview: sanitizeHttpPreview(raw.lastPreview),
  };
};

const sanitizeGeminiPreview = (
  raw: unknown,
): GeminiNodeConfig["lastPreview"] | undefined => {
  if (!isObject(raw)) {
    return undefined;
  }

  const usage =
    isObject(raw.usage) &&
    (typeof raw.usage.promptTokens === "number" ||
      typeof raw.usage.responseTokens === "number" ||
      typeof raw.usage.totalTokens === "number")
      ? {
          promptTokens:
            typeof raw.usage.promptTokens === "number"
              ? raw.usage.promptTokens
              : undefined,
          responseTokens:
            typeof raw.usage.responseTokens === "number"
              ? raw.usage.responseTokens
              : undefined,
          totalTokens:
            typeof raw.usage.totalTokens === "number"
              ? raw.usage.totalTokens
              : undefined,
        }
      : undefined;

  return {
    executedAt:
      typeof raw.executedAt === "string"
        ? raw.executedAt
        : new Date().toISOString(),
    outputText: typeof raw.outputText === "string" ? raw.outputText : undefined,
    responseMimeType:
      typeof raw.responseMimeType === "string"
        ? raw.responseMimeType
        : undefined,
    usage,
  };
};

const sanitizeGeminiConfig = (raw: unknown): GeminiNodeConfig => {
  if (!isObject(raw)) {
    return {
      ...DEFAULT_GEMINI_CONFIG,
      inputVariables: [...DEFAULT_GEMINI_CONFIG.inputVariables],
      testInputs: { ...DEFAULT_GEMINI_CONFIG.testInputs },
    };
  }

  const inputVariables = Array.isArray(raw.inputVariables)
    ? raw.inputVariables.filter(
        (value): value is string => typeof value === "string",
      )
    : [...DEFAULT_GEMINI_CONFIG.inputVariables];

  const testInputs = isObject(raw.testInputs)
    ? Object.entries(raw.testInputs).reduce<Record<string, string>>(
        (accumulator, [key, value]) => {
          accumulator[key] = typeof value === "string" ? value : "";
          return accumulator;
        },
        {},
      )
    : { ...DEFAULT_GEMINI_CONFIG.testInputs };

  return {
    model:
      typeof raw.model === "string" ? raw.model : DEFAULT_GEMINI_CONFIG.model,
    systemInstruction:
      typeof raw.systemInstruction === "string"
        ? raw.systemInstruction
        : DEFAULT_GEMINI_CONFIG.systemInstruction,
    promptTemplate:
      typeof raw.promptTemplate === "string"
        ? raw.promptTemplate
        : DEFAULT_GEMINI_CONFIG.promptTemplate,
    temperature:
      typeof raw.temperature === "number" && Number.isFinite(raw.temperature)
        ? raw.temperature
        : DEFAULT_GEMINI_CONFIG.temperature,
    topP:
      typeof raw.topP === "number" && Number.isFinite(raw.topP)
        ? raw.topP
        : DEFAULT_GEMINI_CONFIG.topP,
    topK:
      typeof raw.topK === "number" && Number.isFinite(raw.topK)
        ? raw.topK
        : DEFAULT_GEMINI_CONFIG.topK,
    maxOutputTokens:
      typeof raw.maxOutputTokens === "number" &&
      Number.isFinite(raw.maxOutputTokens)
        ? raw.maxOutputTokens
        : DEFAULT_GEMINI_CONFIG.maxOutputTokens,
    responseMimeType:
      typeof raw.responseMimeType === "string"
        ? (raw.responseMimeType as GeminiNodeConfig["responseMimeType"])
        : DEFAULT_GEMINI_CONFIG.responseMimeType,
    inputVariables,
    testInputs,
    lastPreview: sanitizeGeminiPreview(raw.lastPreview),
  };
};

const sanitizeWorkflowConnection = (
  raw: unknown,
): WorkflowConnection | null => {
  if (!isObject(raw)) {
    return null;
  }

  const from = typeof raw.from === "string" ? raw.from : null;
  const to = typeof raw.to === "string" ? raw.to : null;

  if (!from || !to) {
    return null;
  }

  return {
    id:
      typeof raw.id === "string" && raw.id.trim().length > 0
        ? raw.id
        : createId(),
    from,
    to,
  };
};

const sanitizeWorkflowNode = (raw: unknown): WorkflowNode | null => {
  if (!isObject(raw) || !isWorkflowNodeKind(raw.kind)) {
    return null;
  }

  const position = isObject(raw.position)
    ? {
        x:
          typeof raw.position.x === "number" && Number.isFinite(raw.position.x)
            ? raw.position.x
            : 0,
        y:
          typeof raw.position.y === "number" && Number.isFinite(raw.position.y)
            ? raw.position.y
            : 0,
      }
    : { x: 0, y: 0 };

  const id =
    typeof raw.id === "string" && raw.id.trim().length > 0
      ? raw.id
      : createId();
  const title = typeof raw.title === "string" ? raw.title : "Untitled node";
  const description =
    typeof raw.description === "string" ? raw.description : "";

  if (raw.kind === "http") {
    const config = sanitizeHttpConfig(raw.config);
    return {
      id,
      kind: "http",
      title,
      description,
      position,
      config,
    };
  }

  if (raw.kind === "gemini") {
    const config = sanitizeGeminiConfig(raw.config);
    return {
      id,
      kind: "gemini",
      title,
      description,
      position,
      config,
    };
  }

  return {
    id,
    kind: raw.kind,
    title,
    description,
    position,
    config: {},
  };
};

const sanitizeWorkflowDefinition = (
  raw: unknown,
  fallbackId: string,
): WorkflowDefinition | null => {
  if (!isObject(raw)) {
    return null;
  }

  const nodes: WorkflowNode[] = Array.isArray(raw.nodes)
    ? raw.nodes.flatMap((value) => {
        const node = sanitizeWorkflowNode(value);
        return node ? [node] : [];
      })
    : [];

  const connections: WorkflowConnection[] = Array.isArray(raw.connections)
    ? raw.connections.flatMap((value) => {
        const connection = sanitizeWorkflowConnection(value);
        return connection ? [connection] : [];
      })
    : [];

  const id =
    typeof raw.id === "string" && raw.id.trim().length > 0
      ? raw.id
      : fallbackId;

  return {
    id,
    label: typeof raw.label === "string" ? raw.label : "Untitled workflow",
    createdAt:
      typeof raw.createdAt === "string"
        ? raw.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof raw.updatedAt === "string"
        ? raw.updatedAt
        : new Date().toISOString(),
    nodes,
    connections,
  };
};

const sanitizeWorkflowDraftState = (raw: unknown): WorkflowDraftState => {
  if (!isObject(raw)) {
    return EMPTY_WORKFLOW_STATE;
  }

  const workflowsRaw = isObject(raw.workflows) ? raw.workflows : {};

  const workflows: Record<string, WorkflowDefinition> = {};

  for (const [key, value] of Object.entries(workflowsRaw)) {
    const normalized = sanitizeWorkflowDefinition(value, key);
    if (normalized) {
      workflows[normalized.id] = normalized;
    }
  }

  let activeWorkflowId: string | null =
    typeof raw.activeWorkflowId === "string" ? raw.activeWorkflowId : null;

  if (activeWorkflowId && !workflows[activeWorkflowId]) {
    const [firstWorkflowId] = Object.keys(workflows);
    activeWorkflowId = firstWorkflowId ?? null;
  }

  return {
    activeWorkflowId,
    workflows,
  };
};

export const loadWorkflowState = (): WorkflowDraftState => {
  const stored = storage.getItem(WORKFLOW_STORAGE_KEY, "safe");
  return sanitizeWorkflowDraftState(stored);
};

export const saveWorkflowState = (state: WorkflowDraftState) => {
  storage.setItem(WORKFLOW_STORAGE_KEY, state);
};

const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `wf-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;

const NODE_CONFIG_FACTORIES = {
  http: () => ({
    ...DEFAULT_HTTP_CONFIG,
    queryParams: [...DEFAULT_HTTP_CONFIG.queryParams],
    headers: [...DEFAULT_HTTP_CONFIG.headers],
    inputVariables: [...DEFAULT_HTTP_CONFIG.inputVariables],
    testInputs: { ...DEFAULT_HTTP_CONFIG.testInputs },
  }),
  gemini: () => ({ ...DEFAULT_GEMINI_CONFIG }),
  "stellar-account": () => ({}) as Record<string, never>,
  classifier: () => ({}) as Record<string, never>,
  conditional: () => ({}) as Record<string, never>,
  ipfs: () => ({}) as Record<string, never>,
} satisfies {
  [K in WorkflowNodeKind]: () => WorkflowNodeConfigMap[K];
};

const createNodeConfig = <K extends WorkflowNodeKind>(
  kind: K,
): WorkflowNodeConfigMap[K] => {
  const factory = NODE_CONFIG_FACTORIES[kind] as () => WorkflowNodeConfigMap[K];
  return factory();
};

export const createWorkflowDefinition = (
  label = "Untitled workflow",
): WorkflowDefinition => {
  const id = createId();
  const timestamp = new Date().toISOString();
  return {
    id,
    label,
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [],
    connections: [],
  };
};

export const createWorkflowNode = <K extends WorkflowNodeKind>(params: {
  kind: K;
  title: string;
  description: string;
  position: { x: number; y: number };
}): WorkflowNode<K> => ({
  id: createId(),
  kind: params.kind,
  title: params.title,
  description: params.description,
  position: params.position,
  config: createNodeConfig(params.kind),
});

export const upsertWorkflow = (
  state: WorkflowDraftState,
  workflow: WorkflowDefinition,
): WorkflowDraftState => {
  const next: WorkflowDraftState = {
    activeWorkflowId: state.activeWorkflowId ?? workflow.id,
    workflows: {
      ...state.workflows,
      [workflow.id]: { ...workflow, updatedAt: new Date().toISOString() },
    },
  };
  saveWorkflowState(next);
  return next;
};

export const removeWorkflow = (
  state: WorkflowDraftState,
  workflowId: string,
): WorkflowDraftState => {
  const others = { ...state.workflows };
  delete others[workflowId];
  const nextActive =
    state.activeWorkflowId === workflowId ? null : state.activeWorkflowId;
  const nextState: WorkflowDraftState = {
    activeWorkflowId: nextActive,
    workflows: others,
  };
  saveWorkflowState(nextState);
  return nextState;
};
