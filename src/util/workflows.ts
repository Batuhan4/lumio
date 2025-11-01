import storage from "./storage";
import {
  DEFAULT_GEMINI_CONFIG,
  DEFAULT_HTTP_CONFIG,
  EMPTY_WORKFLOW_STATE,
  type WorkflowDefinition,
  type WorkflowDraftState,
  type WorkflowNode,
  type WorkflowNodeConfigMap,
  type WorkflowNodeKind,
} from "../types/workflows";

const WORKFLOW_STORAGE_KEY = "workflowDrafts";

export const loadWorkflowState = (): WorkflowDraftState => {
  const stored = storage.getItem(WORKFLOW_STORAGE_KEY, "safe");
  if (stored && typeof stored === "object") {
    return stored;
  }
  return EMPTY_WORKFLOW_STATE;
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
