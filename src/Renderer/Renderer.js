/* global ResizeObserver, Intl */

import { computeLayout }                  from './Layout.js';
import { routeAround, crossesObstacle }  from './Router.js';

/*
 * Canvas 2D renderer for the production graph
 */

const THEME = {
    card            : '#22272e',
    cardBorder      : '#444c56',
    cardItem        : '#1b1f24',
    mainBorder      : '#fa9549',
    clicked         : 'rgba(0, 255, 0, 0.35)',
    somersloop      : 'rgba(166, 113, 166, 0.45)',
    text            : '#ffffff',
    textMuted       : '#adbac7',
    edge            : '#2b7ce9',
    portEmpty       : '#545d68',
    labelBackground : 'rgba(22, 27, 34, 0.85)',
    font            : '"Helvetica Neue", Helvetica, Arial, sans-serif'
};

const SIZES = {
    // Square cards; they grow (still square) when a building has many slots
    building    : { width: 230, height: 230, square: true },
    item        : { width: 200, height: 200, square: true },
    logistic    : { width: 96,  height: 96,  square: true, pitch: 32 },    // Tight slots, short labels
    radius      : 18,
    image       : 112,
    portRadius  : 7,        // Slots of mergers / splitters
    slotRadius  : 18,       // Slots of the other nodes, showing the item icon
    edgeWidth   : 4,
    corner      : 14,
    arrow       : 16,
    grid        : 32,       // Dragged nodes move by steps of the grid
    stub        : 28,       // Straight part out of a port when a moved node's edges are re-routed
    track       : 20,       // Distance between the jogs of a moved node's lines
    sameLabelDistance : 700 // Under that, a line labelled alike at both ends keeps only the end label
};

export default class Renderer
{
    /*
     * portLabels:  item + quantity labels on the slots (graphs without quantities, like the balancers, turn them off)
     * nodeSize:    optional (data) => { width, height, square? } for other node kinds (default: card sizes below)
     * Generic nodes may carry a `color` (card border) and no `image` (the label is then centred alone).
     */
    constructor(container, { buildings = {}, items = {}, language = 'en', onNodeClick = null, portLabels = true, nodeSize = null } = {})
    {
        this.container      = container;
        this.buildings      = buildings;
        this.items          = items;
        this.numberFormat   = new Intl.NumberFormat(language, { maximumFractionDigits: 2 });
        this.onNodeClick    = onNodeClick;
        this.portLabels     = portLabels;
        this.customNodeSize = nodeSize;

        this.layout         = null;
        this.view           = { x: 0, y: 0, k: 1 };
        this.images         = new Map();
        this.hovered        = null;
        this.dragging       = null;
        this.pendingDrag    = null;
        this.animate        = (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== true);
        this.frame          = null;

        this.canvas         = document.createElement('canvas');
        this.canvas.style.display       = 'block';
        this.canvas.style.width         = '100%';
        this.canvas.style.height        = '100%';
        this.canvas.style.touchAction   = 'none';
        this.canvas.style.cursor        = 'grab';
        this.container.appendChild(this.canvas);
        this.context        = this.canvas.getContext('2d');

        this.bindEvents();

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.container);
        this.resize();
    }

    destroy()
    {
        this.resizeObserver.disconnect();
        this.unbindEvents();
        this.canvas.remove();
    }

    /*
     * DATA
     */
    /*
     * edgeStyle:   'orthogonal' (right angles) or 'oblique' (the jogs become slanted, at 30° or 45° only)
     */
    setGraph(nodes, edges, direction = 'RIGHT', edgeStyle = 'orthogonal')
    {
        this.edgeStyle = (edgeStyle === 'oblique') ? 'oblique' : 'orthogonal';

        this.layout = computeLayout(nodes, edges, {
            direction   : direction,
            nodeSize    : (data) => this.nodeSize(data),
            nodeSlots   : (data) => this.nodeSlots(data),
            portPerEdge : (data) => ({ inputs: data.nodeType === 'merger', outputs: data.nodeType === 'splitter' })
        });

        for(const node of this.layout.nodes)
        {
            const logistic = node.data.nodeType === 'merger' || node.data.nodeType === 'splitter';
                for(const port of [...node.inPorts, ...node.outPorts])
                {
                    port.radius     = (logistic || (port.edges.length > 0 && (port.item ?? null) === null)) ? SIZES.portRadius : SIZES.slotRadius;     // Lines without item: no icon, small slot
                    port.logistic   = logistic;
                }
        }

        // Edges by node (highlight, moves) and the ports each edge links
        const nodesById     = new Map(this.layout.nodes.map(node => [node.id, node]));
        this.nodesById      = nodesById;
        this.edgesByNode    = new Map(this.layout.nodes.map(node => [node.id, []]));
        this.edgeByData     = new Map(this.layout.edges.map(edge => [edge.data, edge]));
            for(const edge of this.layout.edges)
            {
                this.edgesByNode.get(edge.source)?.push(edge);
                this.edgesByNode.get(edge.target)?.push(edge);

                edge.sourcePort = nodesById.get(edge.source).outPorts.find(port => port.edges.includes(edge.data));
                edge.targetPort = nodesById.get(edge.target).inPorts.find(port => port.edges.includes(edge.data));
                edge.drawPoints = edge.points;
                edge.bounds     = boundsOf(edge.points);
            }
        // Slants are checked against the lines already drawn: shape once all ports are known
        this.shapeAll();

        // Where the layout put things: a node dragged back there gets its lines back as they were
        for(const node of this.layout.nodes){ node.home = { x: node.x, y: node.y }; }
        for(const edge of this.layout.edges){ edge.home = { points: edge.points, drawPoints: edge.drawPoints }; }

        this.hovered = null;
        this.fit();
    }

    clear()
    {
        this.layout     = null;
        this.hovered    = null;
        this.requestDraw();
    }

    nodeSize(data)
    {
        const custom = this.customNodeSize?.(data);
            if(custom !== undefined && custom !== null){ return custom; }

        switch(data.nodeType)
        {
            case 'productionBuilding':
                return SIZES.building;
            case 'merger':
            case 'splitter':
                return SIZES.logistic;
            default:
                return SIZES.item;
        }
    }

    nodeSlots(data)
    {
        switch(data.nodeType)
        {
            case 'productionBuilding':
            {
                const building = this.buildings[data.buildingType];
                    return { inputs: building?.input ?? 0, outputs: building?.output ?? 0 };
            }
            case 'merger':
                return { inputs: 3, outputs: 1 };
            case 'splitter':
                return { inputs: 1, outputs: 3 };
            default:
                return { inputs: 0, outputs: 0 };
        }
    }

    /*
     * VIEW
     */
    resize()
    {
        const ratio     = window.devicePixelRatio || 1;
        const width     = this.container.clientWidth;
        const height    = this.container.clientHeight;

        this.canvas.width   = Math.max(1, Math.round(width * ratio));
        this.canvas.height  = Math.max(1, Math.round(height * ratio));
        this.ratio          = ratio;

        this.requestDraw();
    }

    fit(padding = 40)
    {
        if(this.layout === null || this.layout.nodes.length === 0){ return this.requestDraw(); }

        const width     = this.container.clientWidth;
        const height    = this.container.clientHeight;
        const bounds    = this.layout.bounds;
        const k         = Math.min((width - padding * 2) / Math.max(1, bounds.width), (height - padding * 2) / Math.max(1, bounds.height), 1.5);

        this.view = {
            k,
            x   : (width - bounds.width * k) / 2 - bounds.x * k,
            y   : (height - bounds.height * k) / 2 - bounds.y * k
        };

        this.requestDraw();
    }

    zoomAt(screenX, screenY, factor)
    {
        const k     = Math.min(4, Math.max(0.02, this.view.k * factor));
        const ratio = k / this.view.k;

        this.view.x = screenX - (screenX - this.view.x) * ratio;
        this.view.y = screenY - (screenY - this.view.y) * ratio;
        this.view.k = k;

        this.requestDraw();
    }

    toWorld(screenX, screenY)
    {
        return { x: (screenX - this.view.x) / this.view.k, y: (screenY - this.view.y) / this.view.k };
    }

    nodeAt(screenX, screenY)
    {
        if(this.layout === null){ return null; }

        const { x, y } = this.toWorld(screenX, screenY);
            for(let i = this.layout.nodes.length - 1; i >= 0; i--)
            {
                const node = this.layout.nodes[i];
                    if(x >= node.x && x <= node.x + node.width && y >= node.y && y <= node.y + node.height)
                    {
                        return node;
                    }
            }

        return null;
    }

    /*
     * EVENTS
     */
    bindEvents()
    {
        const pointers  = new Map();
        let gesture     = null;

        const local = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        };

        this.handlers = {
            pointerdown : (e) => {
                this.canvas.setPointerCapture(e.pointerId);
                pointers.set(e.pointerId, local(e));

                if(pointers.size === 1)
                {
                    const point = local(e);
                    const node  = this.nodeAt(point.x, point.y);
                        gesture = { start: point, last: point, moved: false, node, origin: (node !== null) ? { x: node.x, y: node.y } : null };

                    if(node !== null)
                    {
                        this.hovered = node;
                    }
                    this.canvas.style.cursor = (node !== null) ? 'move' : 'grabbing';
                }
                else
                {
                    gesture = { pinch: this.pinchState(pointers), moved: true };
                }
            },
            pointermove : (e) => {
                const point = local(e);

                if(pointers.has(e.pointerId) === false)
                {
                    // Hover only
                    const node = this.nodeAt(point.x, point.y);
                        if(node !== this.hovered)
                        {
                            this.hovered                = node;
                            this.canvas.style.cursor    = (node !== null) ? 'pointer' : 'grab';
                            this.requestDraw();
                        }
                    return;
                }

                pointers.set(e.pointerId, point);

                if(gesture?.pinch !== undefined && pointers.size >= 2)
                {
                    const pinch = this.pinchState(pointers);
                        this.view.x += pinch.x - gesture.pinch.x;
                        this.view.y += pinch.y - gesture.pinch.y;
                        this.zoomAt(pinch.x, pinch.y, pinch.distance / gesture.pinch.distance);
                    gesture.pinch = pinch;
                    return;
                }

                if(gesture !== null)
                {
                    if(Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 4){ gesture.moved = true; }

                    if(gesture.node !== null && gesture.node !== undefined)
                    {
                        if(gesture.moved)
                        {
                            // Applied once per frame (re-routing has a cost on big plans)
                            this.dragging       = gesture.node;
                            this.pendingDrag    = [gesture.node, gesture.origin, (point.x - gesture.start.x) / this.view.k, (point.y - gesture.start.y) / this.view.k];
                            this.requestDraw();
                        }
                        return;
                    }

                    this.view.x    += point.x - gesture.last.x;
                    this.view.y    += point.y - gesture.last.y;
                    gesture.last    = point;
                    this.requestDraw();
                }
            },
            pointerup   : (e) => {
                const point = local(e);
                    pointers.delete(e.pointerId);

                if(gesture !== null && gesture.moved === false && pointers.size === 0)
                {
                    this.click(this.nodeAt(point.x, point.y));
                }
                if(pointers.size === 0)
                {
                    gesture                     = null;
                    this.canvas.style.cursor    = 'grab';

                    if(this.dragging !== null)
                    {
                        if(this.pendingDrag !== null)
                        {
                            this.dragNode(...this.pendingDrag);
                            this.pendingDrag = null;
                        }
                        this.dragging = null;

                        this.updateBounds();
                        this.requestDraw();
                    }
                }
                else if(pointers.size === 1)
                {
                    const [remaining] = pointers.values();
                        gesture = { start: remaining, last: remaining, moved: true };
                }
            },
            pointerleave: () => {
                if(this.hovered !== null && pointers.size === 0)
                {
                    this.hovered = null;
                    this.requestDraw();
                }
            },
            wheel       : (e) => {
                e.preventDefault();
                const point = local(e);
                    this.zoomAt(point.x, point.y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
            },
            dblclick    : () => this.fit()
        };
        this.handlers.pointercancel = this.handlers.pointerup;

        for(const [type, handler] of Object.entries(this.handlers))
        {
            this.canvas.addEventListener(type, handler, (type === 'wheel') ? { passive: false } : undefined);
        }
    }

    unbindEvents()
    {
        for(const [type, handler] of Object.entries(this.handlers))
        {
            this.canvas.removeEventListener(type, handler);
        }
    }

    /*
     * MOVING NODES
     *
     * The node moves by steps of the grid from where it was, so it stays aligned with the layout;
     * then, if one of its ports is close to the port it is linked to, it snaps to make that line straight.
     */
    dragNode(node, origin, deltaX, deltaY)
    {
        let x = origin.x + Math.round(deltaX / SIZES.grid) * SIZES.grid;
        let y = origin.y + Math.round(deltaY / SIZES.grid) * SIZES.grid;

        const snap = SIZES.grid / 2;
        let bestX = null, bestY = null;
            for(const edge of this.edgesByNode.get(node.id))
            {
                const own   = (edge.source === node.id) ? edge.sourcePort : edge.targetPort;
                const other = (edge.source === node.id) ? edge.targetPort : edge.sourcePort;
                    if(own === undefined || other === undefined || edge.source === edge.target){ continue; }

                // Lines leave horizontally: align the y; vertically: align the x
                if(own.dx !== 0)
                {
                    const gap = other.y - (own.y - node.y + y);
                        if(Math.abs(gap) < snap && (bestY === null || Math.abs(gap) < Math.abs(bestY))){ bestY = gap; }
                }
                else
                {
                    const gap = other.x - (own.x - node.x + x);
                        if(Math.abs(gap) < snap && (bestX === null || Math.abs(gap) < Math.abs(bestX))){ bestX = gap; }
                }
            }
        x += bestX ?? 0;
        y += bestY ?? 0;

        // Back to its place in the layout, even when the grid and the snapping do not fall on it
        // (within a few screen pixels: zoomed out, one pixel is many grid steps)
        const home = Math.max(SIZES.grid, 16 / this.view.k);
        if(Math.abs(x - node.home.x) < home && Math.abs(y - node.home.y) < home)
        {
            x = node.home.x;
            y = node.home.y;
        }

        // Never on another node: slide along the free axis, or stay where it was
        for(const [cx, cy] of [[x, y], [x, node.y], [node.x, y]])
        {
            if(this.isFree(node, cx, cy))
            {
                return this.moveNode(node, cx - node.x, cy - node.y);
            }
        }
    }

    // Keeps room between the cards for the lines to go around
    isFree(node, x, y)
    {
        // Along the flow the port labels and the lines need more room than across it
        const flowX     = this.layout.direction === 'RIGHT' || this.layout.direction === 'LEFT';
        const along     = SIZES.grid * 9;       // Room for an output label, the jogs and an input label
        const across    = SIZES.grid * 2;
        const gapX      = (flowX ? along : across) - 0.5;      // Tolerance: the layout spacing is exactly the minimum
        const gapY      = (flowX ? across : along) - 0.5;

        // Its own place in the layout is always free from the nodes still at theirs
        const atHome = (n, nx, ny) => nx === n.home.x && ny === n.home.y;
        const back   = atHome(node, x, y);

        return this.layout.nodes.every(other => other === node || (back && atHome(other, other.x, other.y))
            || x + node.width + gapX <= other.x || other.x + other.width + gapX <= x
            || y + node.height + gapY <= other.y || other.y + other.height + gapY <= y);
    }

    moveNode(node, dx, dy)
    {
        if(dx === 0 && dy === 0){ return; }

        node.x += dx;
        node.y += dy;

        for(const port of [...node.inPorts, ...node.outPorts])
        {
            port.x += dx;
            port.y += dy;
        }

        // Its edges (same routing while dragging and once dropped), and the edges it now covers
        const own = new Set(this.edgesByNode.get(node.id));
            this.routeOwn(node);

            for(const edge of this.layout.edges)
            {
                if(own.has(edge) === false && this.edgeCrosses(edge, node)){ this.reroute(edge); }
            }

        // Lines whose both ends are back in place take their layout route again, if nothing moved onto it
        const atHome = (id) => {
            const other = this.nodesById.get(id);
            return other.x === other.home.x && other.y === other.home.y;
        };
            for(const edge of this.layout.edges)
            {
                if(edge.points !== edge.home.points && atHome(edge.source) && atHome(edge.target) && this.routeIsClear(edge.home.points))
                {
                    edge.points     = edge.home.points;
                    edge.drawPoints = edge.home.drawPoints;
                    edge.bounds     = boundsOf(edge.drawPoints);
                }
            }

        this.requestDraw();
    }

    /*
     * Lines of a moved node, like the automatic layout draws them: one jog each, the jogs of
     * its inputs (and of its outputs) side by side on tracks, ordered so they do not cross,
     * kept clear of the labels at both ends. A line that cannot be drawn so (a node in the way,
     * the target behind the source) goes around the nodes instead.
     */
    routeOwn(node)
    {
        const flow          = { RIGHT: [1, 0], LEFT: [-1, 0], DOWN: [0, 1], UP: [0, -1] }[this.layout.direction] ?? [1, 0];
        const horizontal    = flow[0] !== 0;
        const along         = (point) => point.x * flow[0] + point.y * flow[1];
        const across        = (point) => horizontal ? point.y : point.x;
        const back          = (a, c) => horizontal ? { x: a * flow[0], y: c } : { x: c, y: a * flow[1] };

        // Room kept straight in front of a slot: its label when it has one
        const room          = (port) => {
                if(port.edges.length === 0){ return SIZES.stub; }
            if(port.logistic){ return 100; }
            return horizontal ? ((port.side === 'in') ? 160 : 130) : 100;
        };

        const edges = this.edgesByNode.get(node.id).filter(edge => edge.source !== edge.target && edge.sourcePort !== undefined && edge.targetPort !== undefined);

        for(const side of ['in', 'out'])
        {
            const group = edges.filter(edge => (side === 'in') ? edge.target === node.id : edge.source === node.id);
            const jogs  = [];

            for(const edge of group)
            {
                const s = edge.sourcePort, t = edge.targetPort;
                const sc = across(s), tc = across(t);
                const lo = along(s) + room(s), hi = along(t) - room(t);

                    if(Math.abs(sc - tc) < 0.5 && along(t) > along(s))
                    {
                        this.setRoute(edge, [{ x: s.x, y: s.y }, { x: t.x, y: t.y }]);
                    }
                    else if(lo <= hi)
                    {
                        jogs.push({ edge, sc, tc, lo, hi });
                    }
                    else
                    {
                        this.reroute(edge, room(s), room(t));
                    }
            }

            // Same ordering as the layout: descending lines first (the later one starts, the more to the left), then rising ones
            jogs.sort((a, b) => {
                const da = a.tc > a.sc ? 0 : 1, db = b.tc > b.sc ? 0 : 1;
                    if(da !== db){ return da - db; }
                return (da === 0) ? (b.sc - a.sc) : (a.sc - b.sc);
            });

            // Side by side around the middle of the common free stretch, each kept in its own free stretch
            const lo        = Math.max(...jogs.map(jog => jog.lo));
            const hi        = Math.min(...jogs.map(jog => jog.hi));
            const middle    = (lo + hi) / 2;
            const spacing   = (jogs.length > 1 && hi > lo) ? Math.min(SIZES.track, (hi - lo) / (jogs.length - 1)) : SIZES.track;
                jogs.forEach((jog, index) => {
                    jog.a = Math.min(jog.hi, Math.max(jog.lo, middle + (index - (jogs.length - 1) / 2) * Math.max(spacing, 10)));
                });

            jogs.forEach((jog, index) => {
                const s         = jog.edge.sourcePort, t = jog.edge.targetPort;
                const points    = [{ x: s.x, y: s.y }, back(jog.a, jog.sc), back(jog.a, jog.tc), { x: t.x, y: t.y }];
                // Two jogs on (almost) the same track would read as one line
                const crowded   = jogs.some((other, k) => k !== index && Math.abs(other.a - jog.a) < 10
                                    && Math.min(Math.max(other.sc, other.tc), Math.max(jog.sc, jog.tc)) > Math.max(Math.min(other.sc, other.tc), Math.min(jog.sc, jog.tc)) - 10);

                    if(crowded === false && this.routeIsClear(points)){ this.setRoute(jog.edge, points); }
                    else { this.reroute(jog.edge, room(s), room(t)); }
            });
        }
    }

    routeIsClear(points)
    {
        const box = boundsOf(points);

        return this.layout.nodes.every(node => node.x > box.x + box.width || node.x + node.width < box.x || node.y > box.y + box.height || node.y + node.height < box.y
            || points.every((point, index) => index === 0 || segmentHitsBox(points[index - 1], point, node) === false));
    }

    setRoute(edge, points)
    {
        edge.points = points;
        this.shapeEdge(edge);
    }

    edgeCrosses(edge, node)
    {
        if(crossesObstacle({ x: edge.bounds.x, y: edge.bounds.y }, { x: edge.bounds.x + edge.bounds.width, y: edge.bounds.y + edge.bounds.height }, node) === false){ return false; }

        for(let i = 1; i < edge.points.length; i++)
        {
            if(crossesObstacle(edge.points[i - 1], edge.points[i], node)){ return true; }
        }
        return false;
    }

    // Around the nodes; startRoom / endRoom: straight part asked out of / into the slots (their labels)
    reroute(edge, startRoom = null, endRoom = null)
    {
        if(edge.sourcePort === undefined || edge.targetPort === undefined){ return; }

        // Keep away from the other lines, except the ones sharing a port (they merge there anyway)
        const lines = [];
            for(const other of this.layout.edges)
            {
                if(other !== edge && other.sourcePort !== edge.sourcePort && other.targetPort !== edge.targetPort)
                {
                    lines.push(other.points);
                }
            }

        const port  = (p, stub) => ({ x: p.x, y: p.y, dx: p.dx, dy: p.dy, stub: stub ?? undefined });
        edge.points = ((startRoom !== null || endRoom !== null) ? routeAround(port(edge.sourcePort, startRoom), port(edge.targetPort, endRoom), this.layout.nodes, lines) : null)
                   ?? routeAround(edge.sourcePort, edge.targetPort, this.layout.nodes, lines)
                   ?? routeBetween(edge.sourcePort, edge.targetPort);
        this.shapeEdge(edge);
    }

    /*
     * Oblique lines for the whole graph: every line is first slanted on its own (nodes only),
     * so two lines swapping places cross cleanly in an X; then the lines whose slants run along
     * or graze another line are slanted again against the others, until nothing changes.
     */
    shapeAll()
    {
        if(this.edgeStyle !== 'oblique')
        {
            for(const edge of this.layout.edges){ this.shapeEdge(edge); }
            return;
        }

        for(const edge of this.layout.edges)
        {
            edge.drawPoints = slantJogs(edge.points, SIZES.stub, SIZES.arrow + (edge.targetPort?.radius ?? SIZES.portRadius) + 12, this.layout.nodes);
            edge.bounds     = boundsOf(edge.drawPoints);
        }

        for(let round = 0; round < 3; round++)
        {
            let changed = false;
                for(const edge of this.layout.edges)
                {
                    if(this.slantConflicts(edge))
                    {
                        this.shapeEdge(edge);
                        changed = true;
                    }
                }
                if(changed === false){ break; }
        }
    }

    // Lines a line must keep away from (lines sharing a port meet there anyway), as segments near a box
    otherSegments(edge, box)
    {
        const segments = [];
            for(const other of this.layout.edges)
            {
                if(other === edge || other.sourcePort === edge.sourcePort || other.targetPort === edge.targetPort){ continue; }

                const b = other.bounds;
                    if(b.x > box.x + box.width + 10 || b.x + b.width < box.x - 10 || b.y > box.y + box.height + 10 || b.y + b.height < box.y - 10){ continue; }

                const points = other.drawPoints ?? other.points;
                    for(let i = 1; i < points.length; i++){ segments.push([points[i - 1], points[i]]); }
            }
        return segments;
    }

    // Does one of the slanted segments of this line run along or graze another line?
    slantConflicts(edge)
    {
        const points = edge.drawPoints;
            for(let i = 1; i < points.length; i++)
            {
                const a = points[i - 1], b = points[i];
                    if(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6){ continue; }

                if(this.otherSegments(edge, boundsOf([a, b])).some(([p, q]) => keepsAway(a, b, p, q, SLANT_SPACING) === false))
                {
                    return true;
                }
            }
        return false;
    }

    // Points actually drawn: the route itself, or with its jogs slanted
    shapeEdge(edge)
    {
        if(this.edgeStyle !== 'oblique')
        {
            edge.drawPoints = edge.points;
            edge.bounds     = boundsOf(edge.points);
            return;
        }

        const others = (box) => this.otherSegments(edge, box);

        edge.drawPoints = slantJogs(edge.points, SIZES.stub, SIZES.arrow + (edge.targetPort?.radius ?? SIZES.portRadius) + 12, this.layout.nodes, others);
        edge.bounds     = boundsOf(edge.drawPoints);
    }

    updateBounds()
    {
        const boxes = [...this.layout.nodes, ...this.layout.edges.map(edge => edge.bounds)];
        const x     = Math.min(...boxes.map(box => box.x));
        const y     = Math.min(...boxes.map(box => box.y));

        this.layout.bounds = { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y };
    }

    pinchState(pointers)
    {
        const [a, b] = pointers.values();
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
    }

    click(node)
    {
        if(node === null){ return; }

        // Same behaviour as before: any node but the requested outputs can be marked
        if(node.data.nodeType !== 'mainNode')
        {
            if(node.data.wasClicked === undefined){ node.data.wasClicked = true; }
            else { delete node.data.wasClicked; }
        }

        if(this.onNodeClick !== null){ this.onNodeClick(node.data); }

        this.requestDraw();
    }

    /*
     * DRAW
     */
    requestDraw()
    {
        if(this.frame !== null){ return; }

        this.frame = requestAnimationFrame(() => {
            this.frame = null;
            this.draw();
        });
    }

    image(url)
    {
        if(url === undefined || url === null){ return null; }

        let image = this.images.get(url);
            if(image === undefined)
            {
                image           = new Image();
                image.onload    = () => this.requestDraw();
                image.onerror   = () => { image.failed = true; };
                image.src       = url;
                this.images.set(url, image);
            }

        return (image.complete && image.naturalWidth > 0) ? image : null;
    }

    draw()
    {
        const ctx = this.context;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if(this.layout === null){ return; }

        if(this.pendingDrag !== null)
        {
            const drag          = this.pendingDrag;
                this.pendingDrag = null;
                this.dragNode(...drag);
        }

        ctx.setTransform(this.ratio * this.view.k, 0, 0, this.ratio * this.view.k, this.ratio * this.view.x, this.ratio * this.view.y);

        // Visible part of the world, to skip what is off screen
        const topLeft       = this.toWorld(0, 0);
        const bottomRight   = this.toWorld(this.container.clientWidth, this.container.clientHeight);
        const visible       = (box) => box.x + box.width >= topLeft.x && box.x <= bottomRight.x && box.y + box.height >= topLeft.y && box.y <= bottomRight.y;

        const k             = this.view.k;
        const highlighted   = (this.hovered !== null) ? new Set(this.edgesByNode.get(this.hovered.id)) : null;
        const neighbours    = (this.hovered !== null) ? new Set([...highlighted].flatMap(edge => [edge.source, edge.target])) : null;

        if(this.dragging !== null)
        {
            this.drawGrid(topLeft, bottomRight);
        }

        // Edges, the highlighted ones on top
        for(const edge of this.layout.edges)
        {
            if(highlighted?.has(edge) || visible(edge.bounds) === false){ continue; }
            this.drawEdge(edge, (highlighted !== null) ? 0.15 : 1, 1);
        }
        if(highlighted !== null)
        {
            for(const edge of highlighted){ this.drawEdge(edge, 1, 1.8, this.animate); }
        }

        // Nodes
        for(const node of this.layout.nodes)
        {
            if(visible(node) === false){ continue; }

            ctx.globalAlpha = (neighbours === null || neighbours.has(node.id) || node === this.hovered) ? 1 : 0.35;
            this.drawNode(node, k);
        }
        ctx.globalAlpha = 1;

        // Port labels last, so lines never hide them
        if(k >= 0.3 && this.portLabels)
        {
            for(const node of this.layout.nodes)
            {
                if(visible({ x: node.x - 200, y: node.y - 60, width: node.width + 400, height: node.height + 120 }) === false){ continue; }
                if(neighbours !== null && neighbours.has(node.id) === false && node !== this.hovered){ continue; }

                for(const port of node.inPorts)
                {
                    if(port.edges.length > 0){ this.drawPortLabel(port, node); }
                }
                for(const port of node.outPorts)
                {
                    // Hidden duplicates come back while their line is highlighted
                    if(port.edges.length > 0 && (this.sameLabelNearby(port) === false || highlighted?.has(this.edgeByData.get(port.edges[0])) === true))
                    {
                        this.drawPortLabel(port, node);
                    }
                }
            }
        }

        if(this.hovered !== null && k < 0.45)
        {
            this.drawTooltip(this.hovered);
        }

        // Keep the flow moving while something is highlighted
        if(highlighted !== null && this.animate)
        {
            this.requestDraw();
        }
    }

    // Grid shown while a node is moved, aligned on the dragged node
    drawGrid(topLeft, bottomRight)
    {
        const step = SIZES.grid * Math.max(1, Math.pow(2, Math.ceil(Math.log2(6 / (SIZES.grid * this.view.k)))));
        const ctx  = this.context;
        const size = Math.max(2, 1.5 / this.view.k);
        const ox   = this.dragging.x % step;
        const oy   = this.dragging.y % step;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
            for(let x = Math.floor((topLeft.x - ox) / step) * step + ox; x <= bottomRight.x; x += step)
            {
                for(let y = Math.floor((topLeft.y - oy) / step) * step + oy; y <= bottomRight.y; y += step)
                {
                    ctx.fillRect(x - size / 2, y - size / 2, size, size);
                }
            }
    }

    /*
     * An output going to a single input that carries exactly the same (one line, both ends labelled
     * alike) close by: only the label at the end is drawn.
     */
    sameLabelNearby(port)
    {
        if(port.edges.length !== 1){ return false; }

        const edge      = this.edgeByData.get(port.edges[0]);
        const target    = edge?.targetPort;
            if(target === undefined || target.edges.length !== 1){ return false; }

        return Math.hypot(target.x - port.x, target.y - port.y) < SIZES.sameLabelDistance;
    }

    drawEdge(edge, alpha, widthFactor, animated = false)
    {
        const ctx       = this.context;
        const points    = edge.drawPoints ?? edge.points;
        const color     = readable(edge.data.color ?? THEME.edge);
        const width     = Math.max(SIZES.edgeWidth, 1.2 / this.view.k) * widthFactor;

        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.fillStyle   = color;
        ctx.lineWidth   = width;
        ctx.lineJoin    = 'round';

        // Stop the line under the arrow head
        const last      = points[points.length - 1];
        const before    = points[points.length - 2];
        const length    = Math.hypot(last.x - before.x, last.y - before.y) || 1;
        const ux        = (last.x - before.x) / length;
        const uy        = (last.y - before.y) / length;
        const arrow     = Math.max(SIZES.arrow, width * 3);
        const slot      = edge.targetPort?.radius ?? SIZES.portRadius;
        const end       = { x: last.x - ux * (arrow + slot) * 0.9, y: last.y - uy * (arrow + slot) * 0.9 };

        const path = () => {
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
                for(let i = 1; i < points.length - 1; i++)
                {
                    const previous  = points[i - 1];
                    const next      = (i === points.length - 2) ? end : points[i + 1];
                    const radius    = Math.min(SIZES.corner, distance(previous, points[i]) / 2, distance(points[i], next) / 2);
                        ctx.arcTo(points[i].x, points[i].y, next.x, next.y, radius);
                }
            ctx.lineTo(end.x, end.y);
        };
        path();
        ctx.stroke();

        // Highlighted: what it carries flows along the line (items as beads, fluids as a stream)
        if(animated)
        {
            const item  = this.items[edge.data.itemId] ?? {};
            const fluid = item.category === 'liquid' || item.category === 'gas';
            const dash  = fluid ? [16, 10] : [1, 17];

                ctx.save();
                ctx.setLineDash(dash);
                ctx.lineDashOffset  = -((performance.now() / 1000) * 48) % (dash[0] + dash[1]);
                ctx.lineCap         = 'round';
                ctx.lineWidth       = fluid ? width * 0.45 : width * 0.8;
                ctx.strokeStyle     = 'rgba(255, 255, 255, 0.8)';
                path();
                ctx.stroke();
                ctx.restore();
        }

        // Arrow head, its tip on the slot border
        const tip = { x: last.x - ux * slot, y: last.y - uy * slot };
            ctx.beginPath();
            ctx.moveTo(tip.x, tip.y);
            ctx.lineTo(tip.x - ux * arrow - uy * arrow * 0.55, tip.y - uy * arrow + ux * arrow * 0.55);
            ctx.lineTo(tip.x - ux * arrow + uy * arrow * 0.55, tip.y - uy * arrow - ux * arrow * 0.55);
            ctx.closePath();
            ctx.fill();

        ctx.globalAlpha = 1;
    }

    drawNode(node, k)
    {
        const ctx           = this.context;
        const data          = node.data;
        const isBuilding    = data.nodeType === 'productionBuilding';
        const isLogistic    = data.nodeType === 'merger' || data.nodeType === 'splitter';
        const radius        = isLogistic ? 12 : SIZES.radius;
        const globalAlpha   = ctx.globalAlpha;

        // Card
        roundedRect(ctx, node.x, node.y, node.width, node.height, radius);
        ctx.fillStyle = isBuilding || isLogistic ? THEME.card : THEME.cardItem;
        ctx.fill();

        if(data.isProductionBoosted !== undefined)
        {
            ctx.fillStyle = THEME.somersloop;
            ctx.fill();
        }
        if(data.wasClicked !== undefined)
        {
            ctx.fillStyle = THEME.clicked;
            ctx.fill();
        }

        // Border: performance colour for buildings (thicker with power shards), orange for the outputs
        ctx.lineWidth   = Math.max(3, 1.5 / k);     // Still visible when zoomed out
        ctx.strokeStyle = THEME.cardBorder;
        ctx.setLineDash([]);
            if(isBuilding && data.performanceColor !== undefined)
            {
                ctx.strokeStyle = data.performanceColor;
                ctx.lineWidth   = Math.max(3 + Math.max(0, (parseFloat(data.borderWidth) || 15) / 15 - 1) * 3, 1.5 / k);
            }
            if(data.nodeType === 'mainNode')
            {
                ctx.strokeStyle = THEME.mainBorder;
                ctx.lineWidth   = Math.max(5, 2 / k);
            }
            if(data.nodeType === 'byProductItem')
            {
                ctx.setLineDash([10, 8]);
            }
            if(isBuilding === false && data.color !== undefined)
            {
                ctx.strokeStyle = readable(data.color);
            }
        roundedRect(ctx, node.x, node.y, node.width, node.height, radius);
        ctx.stroke();
        ctx.setLineDash([]);

        // Image and label centred together in the card
        const showLabel = isLogistic === false && k >= 0.12 && data.label !== undefined;
        const lines     = showLabel ? this.labelLines(node) : [];
        const textSize  = lines.reduce((sum, line) => sum + line.size + 4, 0);
        const image     = this.image(data.image);
        const imageSize = (data.image === undefined) ? 0 : (isLogistic ? node.width * 0.7 : SIZES.image);
        const imageX    = node.x + (node.width - imageSize) / 2;
        const imageY    = node.y + Math.max(10, (node.height - imageSize - (textSize > 0 ? textSize + 10 : 0)) / 2);
            if(image !== null)
            {
                ctx.drawImage(image, imageX, imageY, imageSize, imageSize);
            }
            else if(k > 0.08 && imageSize > 0)
            {
                roundedRect(ctx, imageX + imageSize * 0.15, imageY + imageSize * 0.15, imageSize * 0.7, imageSize * 0.7, 10);
                ctx.fillStyle = '#2d333b';
                ctx.fill();
            }

        // Label under the image
        if(showLabel)
        {
            this.drawNodeLabel(node, imageY + ((imageSize > 0) ? imageSize + 10 : 0));
        }

        // Slots: the connected item's icon in a ring of its colour, empty slots hollow
        for(const port of [...node.inPorts, ...node.outPorts])
        {
            const used      = port.edges.length > 0;
            const radius    = (used || port.logistic) ? port.radius : port.radius * 0.6;
            const icon      = (used && port.logistic === false && k >= 0.15) ? this.image(this.items[port.item]?.image) : null;

            ctx.beginPath();
            ctx.arc(port.x, port.y, radius, 0, Math.PI * 2);
                if(used)
                {
                    const color = readable(port.edges[0].color ?? THEME.edge);
                        ctx.fillStyle   = (icon !== null) ? THEME.cardItem : color;
                        ctx.fill();
                        if(icon !== null)
                        {
                            const size = radius * 1.45;
                                ctx.drawImage(icon, port.x - size / 2, port.y - size / 2, size, size);
                        }
                        ctx.lineWidth   = (port.logistic) ? 2 : 3;
                        ctx.strokeStyle = (icon !== null) ? color : THEME.text;
                        ctx.stroke();
                }
                else
                {
                    ctx.fillStyle   = THEME.card;
                    ctx.fill();
                    ctx.lineWidth   = 2;
                    ctx.strokeStyle = THEME.portEmpty;
                    ctx.stroke();
                }
        }

        ctx.globalAlpha = globalAlpha;
    }

    labelLines(node)
    {
        return node.labelLines ?? (node.labelLines = this.wrapLabel(node.data.label, node.width - 20));
    }

    drawNodeLabel(node, top)
    {
        const ctx       = this.context;
        const maxWidth  = node.width - 20;
        const lines     = this.labelLines(node);
        let y           = top;

        ctx.textAlign       = 'center';
        ctx.textBaseline    = 'top';

        lines.forEach((line, index) => {
            if(y + line.size > node.y + node.height - 6){ return; }

            ctx.font        = line.font;
            ctx.fillStyle   = (index === 0) ? THEME.text : THEME.textMuted;
            ctx.fillText(line.text, node.x + node.width / 2, y, maxWidth);
            y += line.size + 4;
        });
    }

    // First line bold, the rest (recipe, shards, somersloops) smaller; long lines wrapped
    wrapLabel(label, maxWidth)
    {
        const ctx   = this.context;
        const lines = [];

        String(label).split('\n').forEach((part, index) => {
            const size  = (index === 0) ? 17 : 14;
            const font  = ((index === 0) ? 'bold ' : '') + size + 'px ' + THEME.font;
                ctx.font = font;

            let current = '';
                for(const word of part.split(' '))
                {
                    const test = current === '' ? word : current + ' ' + word;
                        if(ctx.measureText(test).width > maxWidth && current !== '')
                        {
                            lines.push({ text: current, font, size });
                            current = word;
                        }
                        else
                        {
                            current = test;
                        }
                }
                if(current !== ''){ lines.push({ text: current, font, size }); }
        });

        return lines;
    }

    /*
     * Item icon + name + quantity next to the port, on the side the line comes from.
     * Mergers / splitters have tight slots: quantity only.
     */
    drawPortLabel(port, node)
    {
        if(node.data.nodeType === 'merger' || node.data.nodeType === 'splitter')
        {
            return this.drawCompactPortLabel(port);
        }

        const ctx       = this.context;
        const item      = this.items[port.item] ?? {};
        const amount    = this.portAmount(port);
        const name      = item.name ?? port.item;

        // The icon is on the slot: name + quantity here
        ctx.font        = '12px ' + THEME.font;
        const nameWidth = Math.min(110, ctx.measureText(name).width);
        ctx.font        = 'bold 13px ' + THEME.font;
        const qtyWidth  = ctx.measureText(amount).width;

        const width     = Math.max(nameWidth, qtyWidth) + 12;
        const height    = 34;

        const { x, y }  = this.portLabelPosition(port, width, height);

        roundedRect(ctx, x, y, width, height, 6);
        ctx.fillStyle = THEME.labelBackground;
        ctx.fill();

        ctx.textAlign       = 'left';
        ctx.textBaseline    = 'top';
        ctx.font            = '12px ' + THEME.font;
        ctx.fillStyle       = THEME.textMuted;
        ctx.fillText(name, x + 6, y + 3, 110);
        ctx.font            = 'bold 13px ' + THEME.font;
        ctx.fillStyle       = THEME.text;
        ctx.fillText(amount, x + 6, y + 18);
    }

    // Total carried by a port, per minute (fluids are stored x1000, shown in m³)
    portAmount(port)
    {
        const item  = this.items[port.item] ?? {};
        const qty   = port.edges.reduce((sum, edge) => sum + (edge.qty ?? 0), 0);

        return (item.category === 'liquid' || item.category === 'gas')
             ? this.numberFormat.format(Math.round(qty) / 1000) + ' m³/min'
             : this.numberFormat.format(Math.round(qty * 100) / 100) + '/min';
    }

    drawCompactPortLabel(port)
    {
        const ctx       = this.context;
        const item      = this.items[port.item] ?? {};
        const amount    = this.portAmount(port);
        const icon      = this.image(item.image);
        const iconSize  = 16;

        // Mergers / splitters slots are too small for an icon: it goes on the label
        ctx.font        = 'bold 12px ' + THEME.font;
        const textX     = (icon !== null) ? iconSize + 7 : 5;
        const width     = textX + ctx.measureText(amount).width + 5;
        const height    = 20;
        const { x, y }  = this.portLabelPosition(port, width, height);

        roundedRect(ctx, x, y, width, height, 5);
        ctx.fillStyle = THEME.labelBackground;
        ctx.fill();

        if(icon !== null)
        {
            ctx.drawImage(icon, x + 4, y + (height - iconSize) / 2, iconSize, iconSize);
        }

        ctx.textAlign       = 'left';
        ctx.textBaseline    = 'top';
        ctx.fillStyle       = THEME.text;
        ctx.fillText(amount, x + textX, y + 4);
    }

    /*
     * Horizontal flow: above the line, toward the channel.
     * Vertical flow: centred on the line, on two alternating rows so neighbours never overlap.
     */
    portLabelPosition(port, width, height)
    {
        // Inputs: clear of the arrow head (port radius + arrow + a margin)
        const gap = (port.side === 'in') ? (port.radius ?? SIZES.portRadius) + SIZES.arrow + 8 : (port.radius ?? SIZES.portRadius) + 7;

        if(port.dx !== 0)
        {
            return { x: (port.dx < 0) ? port.x - gap - width : port.x + gap, y: port.y - height - 4 };
        }

        const distance = gap + (port.index % 2) * (height + 6);
            return { x: port.x - width / 2, y: (port.dy < 0) ? port.y - distance - height : port.y + distance };
    }

    // When zoomed out the labels are hidden: show the hovered one in screen space
    drawTooltip(node)
    {
        const ctx   = this.context;
        const lines = String(node.data.label ?? '').split('\n').filter(line => line !== '');
            if(lines.length === 0){ return; }

        ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
        ctx.font = '13px ' + THEME.font;

        const width     = Math.max(...lines.map(line => ctx.measureText(line).width)) + 16;
        const height    = lines.length * 18 + 10;
        let x           = node.x * this.view.k + this.view.x + node.width * this.view.k / 2 - width / 2;
        let y           = (node.y + node.height) * this.view.k + this.view.y + 8;
            x = Math.max(4, Math.min(x, this.container.clientWidth - width - 4));
            y = Math.min(y, this.container.clientHeight - height - 4);

        roundedRect(ctx, x, y, width, height, 6);
        ctx.fillStyle = THEME.labelBackground;
        ctx.fill();

        ctx.textAlign       = 'left';
        ctx.textBaseline    = 'top';
        lines.forEach((line, index) => {
            ctx.fillStyle = (index === 0) ? THEME.text : THEME.textMuted;
            ctx.fillText(line, x + 8, y + 6 + index * 18);
        });
    }
}

/*
 * Some item colours are almost black (Copper Ingot, Crude Oil): lighten them on the dark background.
 */
const readableColors = new Map();
function readable(color)
{
    if(readableColors.has(color)){ return readableColors.get(color); }

    let rgb = null;
    const hex = /^#([0-9a-f]{6})$/i.exec(color);
        if(hex !== null)
        {
            rgb = [0, 2, 4].map(i => parseInt(hex[1].substr(i, 2), 16));
        }
        else
        {
            const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color);
                if(match !== null){ rgb = match.slice(1, 4).map(Number); }
        }

    let result = color;
        if(rgb !== null)
        {
            const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
                if(luminance < 0.35)
                {
                    const mix = (0.35 - luminance) / (1 - luminance);
                        result = 'rgb(' + rgb.map(value => Math.round(value + (255 - value) * mix)).join(', ') + ')';
                }
        }

    readableColors.set(color, result);
    return result;
}

function roundedRect(ctx, x, y, width, height, radius)
{
    const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
}

/*
 * Orthogonal route between two ports once a node was moved by hand.
 * dx / dy of a port point outward of its node: the line leaves the source that way and
 * comes into the target from that way. Target ahead: one jog halfway; behind: around both.
 */
function routeBetween(source, target)
{
    const horizontal    = source.dx !== 0;
    // Work as if the flow went along +a, the other axis being c
    const along         = (point) => horizontal ? point.x * source.dx : point.y * source.dy;
    const cross         = (point) => horizontal ? point.y : point.x;
    const back          = (a, c) => horizontal ? { x: a * source.dx, y: c } : { x: c, y: a * source.dy };

    const sa = along(source), sc = cross(source);
    const ta = along(target), tc = cross(target);

    if(Math.abs(sc - tc) < 0.5 && ta > sa)
    {
        return [back(sa, sc), back(ta, tc)];
    }
    if(ta - sa >= 2 * SIZES.stub)
    {
        const middle = (sa + ta) / 2;
            return [back(sa, sc), back(middle, sc), back(middle, tc), back(ta, tc)];
    }

    // Behind: out of the source, across halfway between the ports (or past both), back into the target
    const outA      = sa + SIZES.stub;
    const inA       = ta - SIZES.stub;
    const across    = (Math.abs(sc - tc) > 4 * SIZES.stub) ? (sc + tc) / 2 : Math.max(sc, tc) + 4 * SIZES.stub;

    return [back(sa, sc), back(outA, sc), back(outA, across), back(inA, across), back(inA, tc), back(ta, tc)];
}

/*
 * Turns each jog of an orthogonal route (a segment across the flow, between two segments along it)
 * into a slanted one, at 30° from the flow when there is room, else 45°, else it stays square:
 * only two angles, so the drawing keeps a regular look.
 * The first and last straight parts keep at least startGap / endGap, so lines leave and enter the slots straight.
 * A slant must stay clear of the nodes, and must not run along or graze another line
 * (crossing one is fine): otherwise the other angle is tried, then the jog stays square.
 */
function slantJogs(route, startGap, endGap, nodes, others = () => [])
{
    const points = route.map(point => ({ x: point.x, y: point.y }));
    const n      = points.length;

    for(let i = 1; i < n - 2; i++)
    {
        const previous = points[i - 1], a = points[i], b = points[i + 1], next = points[i + 2];

        // Jog across a horizontal flow (vertical segment) or across a vertical flow (horizontal segment)
        const vertical = Math.abs(a.x - b.x) < 1e-6 && Math.abs(previous.y - a.y) < 1e-6 && Math.abs(next.y - b.y) < 1e-6;
        const horizontal = Math.abs(a.y - b.y) < 1e-6 && Math.abs(previous.x - a.x) < 1e-6 && Math.abs(next.x - b.x) < 1e-6;
            if(vertical === false && horizontal === false){ continue; }

        const along     = vertical ? 'x' : 'y';
        const across    = vertical ? 'y' : 'x';
        const sign      = Math.sign(a[along] - previous[along]);
            if(sign === 0 || Math.sign(next[along] - b[along]) !== sign){ continue; }     // U-turns stay square

        const before    = Math.abs(a[along] - previous[along]) - ((i - 1 === 0) ? startGap : SIZES.corner);
        const after     = Math.abs(next[along] - b[along]) - ((i + 2 === n - 1) ? endGap : SIZES.corner);
        const jog       = Math.abs(b[across] - a[across]);

        // The three segments around the jog must stay clear of the nodes
        const clear = (h) => {
            const na = { ...a }, nb = { ...b };
                na[along] -= sign * h;
                nb[along] += sign * h;

            const box = boundsOf([previous, na, nb, next]);
            const freeOfNodes = nodes.every(node => (node.x > box.x + box.width || node.x + node.width < box.x || node.y > box.y + box.height || node.y + node.height < box.y)
                    || (segmentHitsBox(previous, na, node) === false && segmentHitsBox(na, nb, node) === false && segmentHitsBox(nb, next, node) === false));
                if(freeOfNodes === false){ return false; }

            return others(boundsOf([na, nb])).every(([p, q]) => keepsAway(na, nb, p, q, SLANT_SPACING));
        };
        // Half the length along the flow taken by the slant: jog / tan(angle) / 2
        const half = [jog / Math.tan(Math.PI / 6) / 2, jog / 2].find(h => h >= 4 && h <= before && h <= after && clear(h));
            if(half === undefined){ continue; }

        a[along] -= sign * half;
        b[along] += sign * half;
    }

    return points;
}

const SLANT_SPACING = 14;

/*
 * Segment a-b and segment p-q either cross cleanly or stay at least `spacing` apart
 * (no running along each other, no touching at a sharp angle).
 */
function keepsAway(a, b, p, q, spacing)
{
    const cross = (o, u, v) => (u.x - o.x) * (v.y - o.y) - (u.y - o.y) * (v.x - o.x);
    const d1 = cross(p, q, a), d2 = cross(p, q, b), d3 = cross(a, b, p), d4 = cross(a, b, q);

    // Proper crossing, away from the ends of both segments
    if(((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
    {
        // Lines are drawn with rounded corners: a crossing next to a corner reads as the lines touching
        const ends = Math.min(pointToSegment(a, p, q), pointToSegment(b, p, q), pointToSegment(p, a, b), pointToSegment(q, a, b));
        return ends >= spacing + SIZES.corner;
    }

    return Math.min(pointToSegment(a, p, q), pointToSegment(b, p, q), pointToSegment(p, a, b), pointToSegment(q, a, b)) >= spacing;
}

function pointToSegment(point, a, b)
{
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = (length === 0) ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
    return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

// Segment p-q against a node, a few pixels inside its border (Liang-Barsky clipping)
function segmentHitsBox(p, q, box, inset = 2)
{
    const x1 = box.x + inset, y1 = box.y + inset, x2 = box.x + box.width - inset, y2 = box.y + box.height - inset;
    const dx = q.x - p.x, dy = q.y - p.y;
    let t0 = 0, t1 = 1;

    for(const [edge, value] of [[-dx, p.x - x1], [dx, x2 - p.x], [-dy, p.y - y1], [dy, y2 - p.y]])
    {
        if(edge === 0)
        {
            if(value < 0){ return false; }
            continue;
        }

        const t = value / edge;
            if(edge < 0){ if(t > t1){ return false; } if(t > t0){ t0 = t; } }
            else        { if(t < t0){ return false; } if(t < t1){ t1 = t; } }
    }

    return t0 < t1;
}

function distance(a, b)
{
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function boundsOf(points)
{
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const x  = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}