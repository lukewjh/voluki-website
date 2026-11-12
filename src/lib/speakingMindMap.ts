export interface SpeakingMapNode {
  id: string;
  label: string;
  children?: SpeakingMapNode[];
  href?: string;
}

interface Point {
  x: number;
  y: number;
}

interface PositionedNode extends Point {
  node: SpeakingMapNode;
}

const nodeHeight = 68;
const rowHeight = 90;
const gap = 48;
const minScale = 0.5;
const maxScale = 1.8;

export class SpeakingMindMap {
  private readonly viewport: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly layer: HTMLElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly root: SpeakingMapNode;
  private readonly nodes = new Map<string, SpeakingMapNode>();
  private readonly parents = new Map<string, string>();
  private readonly expanded = new Set<string>();
  private readonly positions = new Map<string, PositionedNode>();
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly pointers = new Map<number, Point>();
  private edges: [PositionedNode, PositionedNode][] = [];
  private offset: Point = { x: 0, y: 0 };
  private scale = 1;
  private width = 210;
  private selected?: string;
  private framed?: string;
  private frame = 0;
  private gestureStart?: Point;
  private dragged = false;
  private blockClickUntil = 0;
  private restoringFocus = false;

  constructor(viewport: HTMLElement, root: SpeakingMapNode, openQuestion: (node: SpeakingMapNode) => void) {
    this.viewport = viewport;
    this.canvas = viewport.querySelector("canvas")!;
    this.layer = viewport.querySelector("[data-map-nodes]")!;
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    this.context = context;
    this.root = root;

    const index = (node: SpeakingMapNode) => {
      this.nodes.set(node.id, node);
      for (const child of node.children ?? []) {
        this.parents.set(child.id, node.id);
        index(child);
      }
    };
    index(root);

    this.layer.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-map-node]");
      const node = button && this.nodes.get(button.dataset.mapNode!);
      if (!node || (event.detail > 0 && performance.now() < this.blockClickUntil)) return;
      if (node.href) {
        this.select(node.id);
        openQuestion(node);
      } else {
        this.toggleBranch(node, event.detail === 0);
      }
    });

    this.layer.addEventListener("focusin", (event) => {
      const button = event.target as HTMLButtonElement;
      const position = this.positions.get(button.dataset.mapNode ?? "");
      if (this.restoringFocus || this.pointers.size || !position) return;
      const nodeRect = button.getBoundingClientRect();
      const viewRect = viewport.getBoundingClientRect();
      if (nodeRect.left < viewRect.left || nodeRect.right > viewRect.right ||
          nodeRect.top < viewRect.top || nodeRect.bottom > viewRect.bottom) {
        this.center(position, false);
      }
    });

    this.bindGestures();
    new ResizeObserver(() => {
      if (!viewport.clientWidth) return;
      if (this.width !== this.nodeWidth()) {
        this.renderNodes();
        this.center(this.positions.get(this.framed ?? root.id) ?? this.positions.get(root.id)!, true);
      } else {
        this.drawSoon();
      }
    }).observe(viewport);
    new MutationObserver(() => this.drawSoon()).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });

    this.reset();
  }

  getNode(id: string) {
    return this.nodes.get(id);
  }

  focusSelected() {
    if (!this.selected) return;
    this.restoringFocus = true;
    this.buttons.get(this.selected)?.focus({ preventScroll: true });
    this.restoringFocus = false;
  }

  select(id: string) {
    if (this.selected) this.buttons.get(this.selected)?.removeAttribute("aria-current");
    this.selected = id;
    this.buttons.get(id)?.setAttribute("aria-current", "true");
  }

  reset() {
    this.expanded.clear();
    this.expanded.add(this.root.id);
    this.renderNodes();
    this.center(this.positions.get(this.root.id)!, true);
  }

  locate(id: string) {
    const target = this.nodes.get(id);
    if (!target) return;
    let parent = this.parents.get(id);
    while (parent) {
      this.expanded.add(parent);
      parent = this.parents.get(parent);
    }
    if (target.children?.length) this.expanded.add(id);
    if (target.href) this.select(id);
    this.renderNodes();
    this.center(this.positions.get(id)!, true);
  }

  zoom(factor: number) {
    const center = { x: this.viewport.clientWidth / 2, y: this.viewport.clientHeight / 2 };
    this.zoomAt(center, center, factor);
  }

  private nodeWidth() {
    return this.viewport.clientWidth < 470 ? 168 : 210;
  }

  private toggleBranch(node: SpeakingMapNode, keyboard: boolean) {
    if (this.expanded.has(node.id)) this.expanded.delete(node.id);
    else this.expanded.add(node.id);
    this.renderNodes();
    this.center(this.positions.get(node.id)!, true);
    if (keyboard) this.buttons.get(node.id)?.focus({ preventScroll: true });
  }

  private renderNodes() {
    this.width = this.nodeWidth();
    this.layer.style.setProperty("--map-node-width", this.width + "px");
    this.positions.clear();
    this.buttons.clear();
    this.edges = [];
    const fragment = document.createDocumentFragment();
    let y = 0;

    const place = (node: SpeakingMapNode, depth: number): PositionedNode => {
      const position = { node, x: depth * (this.width + gap), y };
      this.positions.set(node.id, position);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "speaking-map-node";
      button.dataset.mapNode = node.id;
      button.dataset.kind = depth === 0 ? "root" : node.href ? "question" : "branch";
      button.style.left = position.x + "px";
      button.style.top = position.y + "px";
      button.title = node.label;
      const label = document.createElement("span");
      label.className = "speaking-map-label";
      label.textContent = node.label;
      button.append(label);
      const expanded = Boolean(node.children?.length && this.expanded.has(node.id));
      if (node.children?.length) {
        button.setAttribute("aria-expanded", String(expanded));
        const mark = document.createElement("span");
        mark.className = "speaking-map-mark";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = expanded ? "−" : "+";
        button.append(mark);
      }
      if (node.id === this.selected) button.setAttribute("aria-current", "true");
      this.buttons.set(node.id, button);
      fragment.append(button);

      if (expanded) {
        for (const child of node.children!) this.edges.push([position, place(child, depth + 1)]);
      } else {
        y += rowHeight;
      }
      return position;
    };

    place(this.root, 0);
    this.layer.replaceChildren(fragment);
    this.drawSoon();
  }

  private center(position: PositionedNode, includeChild: boolean) {
    this.framed = position.node.id;
    const parent = includeChild && position.node.href && this.positions.get(this.parents.get(position.node.id)!);
    const child = includeChild && this.positions.get(position.node.children?.[0]?.id ?? "");
    const left = parent ? parent.x : position.x;
    const right = (child ? child.x : position.x) + this.width;
    const span = right - left;
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    this.scale = Math.max(minScale, Math.min(1, (width - 26) / span));
    this.offset.x = (width - span * this.scale) / 2 - left * this.scale;
    this.offset.y = height * 0.39 - (position.y + nodeHeight / 2) * this.scale;
    this.drawSoon();
  }

  private zoomAt(from: Point, to: Point, factor: number) {
    const scale = Math.max(minScale, Math.min(maxScale, this.scale * factor));
    const ratio = scale / this.scale;
    this.offset.x = to.x - (from.x - this.offset.x) * ratio;
    this.offset.y = to.y - (from.y - this.offset.y) * ratio;
    this.scale = scale;
    this.drawSoon();
  }

  private drawSoon() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw() {
    const { clientWidth: width, clientHeight: height } = this.viewport;
    if (!width || !height) return;
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const canvasWidth = Math.round(width * pixelRatio);
    const canvasHeight = Math.round(height * pixelRatio);
    if (this.canvas.width !== canvasWidth) this.canvas.width = canvasWidth;
    if (this.canvas.height !== canvasHeight) this.canvas.height = canvasHeight;
    const { x, y } = this.offset;
    this.layer.style.transform = "translate(" + x + "px," + y + "px) scale(" + this.scale + ")";
    const ctx = this.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    const scale = pixelRatio * this.scale;
    ctx.setTransform(scale, 0, 0, scale, x * pixelRatio, y * pixelRatio);
    ctx.strokeStyle = getComputedStyle(this.viewport).getPropertyValue("--map-connector").trim();
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const [parent, child] of this.edges) {
      const startX = parent.x + this.width;
      const startY = parent.y + nodeHeight / 2;
      const endY = child.y + nodeHeight / 2;
      const middle = startX + gap / 2;
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(middle, startY, middle, endY, child.x, endY);
    }
    ctx.stroke();
  }

  private bindGestures() {
    const viewport = this.viewport;
    const local = (event: PointerEvent | WheelEvent) => {
      const rect = viewport.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const centerOf = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

    viewport.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this.pointers.size >= 2) return;
      const point = local(event);
      if (!this.pointers.size) {
        this.gestureStart = point;
        this.dragged = false;
        this.blockClickUntil = 0;
      }
      this.pointers.set(event.pointerId, point);
      (event.target as Element).setPointerCapture(event.pointerId);
      if (this.pointers.size === 2) this.dragged = true;
    });

    viewport.addEventListener("pointermove", (event) => {
      const previous = this.pointers.get(event.pointerId);
      if (!previous) return;
      const current = local(event);
      this.pointers.set(event.pointerId, current);
      const other = [...this.pointers].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        this.zoomAt(centerOf(previous, other), centerOf(current, other),
          distance(current, other) / Math.max(1, distance(previous, other)));
      } else {
        if (!this.dragged && distance(current, this.gestureStart!) < 7) return;
        this.dragged = true;
        this.offset.x += current.x - previous.x;
        this.offset.y += current.y - previous.y;
        this.drawSoon();
      }
      viewport.dataset.dragging = "";
    });

    const end = (event: PointerEvent) => {
      if (!this.pointers.delete(event.pointerId)) return;
      if (this.dragged) this.blockClickUntil = performance.now() + 400;
      if (!this.pointers.size) delete viewport.dataset.dragging;
    };
    viewport.addEventListener("pointerup", end);
    viewport.addEventListener("pointercancel", end);
    viewport.addEventListener("lostpointercapture", end);
    viewport.addEventListener("wheel", (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const point = local(event);
      this.zoomAt(point, point, Math.exp(-event.deltaY * 0.005));
    }, { passive: false });
  }
}
