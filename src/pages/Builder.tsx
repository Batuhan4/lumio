import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, Icon, Layout, Text } from "@stellar/design-system";
import styles from "./Builder.module.css";

const GRID_SIZE = 48;
const NODE_WIDTH = 240;
const NODE_HEIGHT = 128;
const BASE_CANVAS_WIDTH = GRID_SIZE * 1200;
const BASE_CANVAS_HEIGHT = GRID_SIZE * 1200;
const MIN_CANVAS_SCALE = 0.01;
const MAX_CANVAS_SCALE = 64;
const CANVAS_ZOOM_FACTOR = 1.2;

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
    const lookup = new Map<PaletteKind, PaletteItemDefinition>();
    paletteItems.forEach((item) => lookup.set(item.kind, item));
    return lookup;
  }, [paletteItems]);

  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
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
                      setNodes([]);
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
