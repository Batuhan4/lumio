import { useCallback, useMemo, useRef, useState } from "react";
import { Button, Icon, Layout, Text } from "@stellar/design-system";
import styles from "./Builder.module.css";

const GRID_SIZE = 24;
const NODE_WIDTH = 240;
const NODE_HEIGHT = 128;

type PaletteKind =
  | "http"
  | "stellar-account"
  | "gemini"
  | "classifier"
  | "conditional"
  | "ipfs";

type PaletteItemDefinition = {
  kind: PaletteKind;
  title: string;
  description: string;
  icon: React.ReactNode;
  group: "Data & APIs" | "AI & Automation" | "System";
};

type WorkflowNode = {
  id: string;
  kind: PaletteKind;
  title: string;
  description: string;
  position: { x: number; y: number };
};

const snapPosition = ({ x, y }: { x: number; y: number }) => ({
  x: Math.max(0, Math.round(x / GRID_SIZE) * GRID_SIZE),
  y: Math.max(0, Math.round(y / GRID_SIZE) * GRID_SIZE),
});

const createNodeId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `node-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;

const PaletteItem: React.FC<{
  item: PaletteItemDefinition;
  onDragStart: (
    event: React.DragEvent<HTMLButtonElement>,
    kind: PaletteKind,
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
  getCanvasRect: () => DOMRect | null;
}> = ({ node, onSelect, isSelected, onDrag, getCanvasRect }) => {
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const canvasRect = getCanvasRect();
    if (!canvasRect) return;

    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startTarget = event.currentTarget;
    const offsetX = event.clientX - canvasRect.left - node.position.x;
    const offsetY = event.clientY - canvasRect.top - node.position.y;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const rect = getCanvasRect();
      if (!rect) return;

      const nextX = moveEvent.clientX - rect.left - offsetX;
      const nextY = moveEvent.clientY - rect.top - offsetY;
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
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
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
    const lookup = new Map<PaletteKind, PaletteItemDefinition>();
    paletteItems.forEach((item) => lookup.set(item.kind, item));
    return lookup;
  }, [paletteItems]);

  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const addNode = useCallback(
    (kind: PaletteKind, position: { x: number; y: number }) => {
      const definition = paletteLookup.get(kind);
      if (!definition) return;

      const nodePosition = snapPosition({
        x: position.x - NODE_WIDTH / 2,
        y: position.y - NODE_HEIGHT / 2,
      });

      const newNode: WorkflowNode = {
        id: createNodeId(),
        kind,
        title: definition.title,
        description: definition.description,
        position: nodePosition,
      };

      setNodes((prev) => [...prev, newNode]);
      setSelectedNodeId(newNode.id);
    },
    [paletteLookup],
  );

  const moveNode = useCallback(
    (id: string, nextPosition: { x: number; y: number }) => {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === id
            ? {
                ...node,
                position: snapPosition(nextPosition),
              }
            : node,
        ),
      );
    },
    [],
  );

  const handlePaletteDragStart = useCallback(
    (event: React.DragEvent<HTMLButtonElement>, kind: PaletteKind) => {
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
        | PaletteKind
        | "";
      if (!kind) return;

      const canvasBounds = canvasRef.current?.getBoundingClientRect();
      if (!canvasBounds) return;

      const position = {
        x: event.clientX - canvasBounds.left,
        y: event.clientY - canvasBounds.top,
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

  const getCanvasRect = useCallback(() => {
    return canvasRef.current?.getBoundingClientRect() ?? null;
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
                  <Button variant="tertiary" size="sm" disabled>
                    <Icon.ZoomIn />
                  </Button>
                  <Button variant="tertiary" size="sm" disabled>
                    <Icon.ZoomOut />
                  </Button>
                  <Button
                    variant="tertiary"
                    size="sm"
                    disabled={nodes.length === 0}
                    onClick={() => {
                      setNodes([]);
                      setSelectedNodeId(undefined);
                    }}
                  >
                    <Icon.MinusCircle />
                    Clear canvas
                  </Button>
                </div>
              </div>
              <div
                ref={canvasRef}
                className={styles.canvas}
                onDragOver={handleCanvasDragOver}
                onDrop={handleCanvasDrop}
              >
                <div className={styles.canvasInner}>
                  {nodes.map((node) => (
                    <CanvasNode
                      key={node.id}
                      node={node}
                      isSelected={selectedNodeId === node.id}
                      onSelect={(id) => setSelectedNodeId(id)}
                      onDrag={moveNode}
                      getCanvasRect={getCanvasRect}
                    />
                  ))}
                  {nodes.length === 0 ? (
                    <div className={styles.canvasEmpty}>
                      <Icon.CursorClick02 size="lg" />
                      <Text as="p" size="sm">
                        Drag an action from the palette to start shaping your
                        agent.
                      </Text>
                      <Text as="p" size="xs">
                        Snap-to-grid placement and connector handles appear once
                        the first node is added.
                      </Text>
                    </div>
                  ) : null}
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
              {selectedNodeId ? (
                <div className={styles.inspectorDetails}>
                  <Text as="p" size="sm">
                    Node configuration coming soon.
                  </Text>
                  <Text as="p" size="xs" className={styles.inspectorHint}>
                    Drag nodes to rearrange; wiring and budget controls land in
                    the next iteration.
                  </Text>
                </div>
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
