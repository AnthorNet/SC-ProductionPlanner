/*
 * Layered layout for the production graph (no dependency).
 *
 * The graph is laid out in a canonical frame where the flow goes along the "a" axis (left to right)
 * and the nodes of a layer are stacked along the "c" axis (top to bottom). The result is then turned
 * into screen coordinates following the chosen direction (RIGHT, LEFT, DOWN, UP).
 *
 *  1. Ranks       longest path from the sources, loops broken by reversing their back edges.
 *  2. Dummies     edges spanning several layers get one dummy node per crossed layer.
 *  3. Order       barycenter sweeps, the order with the fewest crossings is kept.
 *  4. Ports       each node gets its input / output slots, connected items are spread on them.
 *  5. Positions   nodes are pulled toward their neighbours' ports (weighted isotonic regression,
 *                 so the layer order and spacing are kept), dummies pulled harder to keep lines straight.
 *  6. Routing     orthogonal: every edge jogs in the channel between two layers on its own track;
 *                 edges leaving the same port (or entering the same port) share their track.
 *
 * Input nodes / edges use the format sent by the workers ({data: {...}}).
 */

const HORIZONTAL    = { RIGHT: true, LEFT: true, DOWN: false, UP: false };
const EPSILON       = 0.5;

export const DEFAULT_LAYOUT_OPTIONS = {
    direction       : 'RIGHT',
    nodeSpacing     : 64,           // Between two nodes of a layer
    dummySpacing    : 24,           // Between two edges going through a layer
    trackSpacing    : 18,           // Between two vertical tracks of a channel
    portPitch       : null,         // Minimal distance between two ports (defaults to 56 horizontal, 72 vertical)
    labelSpace      : null,         // Room kept in a channel for the port labels (defaults to 150 horizontal, 96 vertical)
    minChannel      : 120,
    nodeSize        : () => ({ width: 200, height: 200 }), // Optional: pitch (port spacing of that node), square (keeps it square when it grows)
    nodeSlots       : () => ({ inputs: 0, outputs: 0 }),    // Slots available on the building (0: as needed)
    portPerEdge     : () => ({ inputs: false, outputs: false }) // Mergers / splitters: one port per edge
};

export function computeLayout(dataNodes, dataEdges, userOptions = {})
{
    const options       = Object.assign({}, DEFAULT_LAYOUT_OPTIONS, userOptions);
    const horizontal    = HORIZONTAL[options.direction] ?? true;
        options.direction   = (HORIZONTAL[options.direction] === undefined) ? 'RIGHT' : options.direction;
        options.portPitch   = options.portPitch ?? (horizontal ? 56 : 72);
        options.labelSpace  = options.labelSpace ?? (horizontal ? 150 : 96);

    const graph = buildGraph(dataNodes, dataEdges, options, horizontal);
        if(graph.nodes.length === 0)
        {
            return { nodes: [], edges: [], bounds: { x: 0, y: 0, width: 0, height: 0 } };
        }

    breakCycles(graph);
    assignRanks(graph);
    insertDummies(graph);
    orderLayers(graph);
    assignPorts(graph, options);
    assignPositions(graph, options);
    assignPorts(graph, options);        // Second round: ports follow the final neighbours
    assignPositions(graph, options);
    straightenChains(graph, options);

    const routes = routeEdges(graph, options);

    return toScreen(graph, routes, options, horizontal);
}

/*
 * GRAPH
 */
function buildGraph(dataNodes, dataEdges, options, horizontal)
{
    const nodes = [];
    const byId  = new Map();

    for(const { data } of dataNodes)
    {
        if(byId.has(data.id)){ continue; }

        const size  = options.nodeSize(data);
        const node  = {
            id          : data.id,
            data        : data,
            dummy       : false,
            width       : size.width,
            height      : size.height,
            along       : horizontal ? size.width : size.height,
            cross       : horizontal ? size.height : size.width,
            pitch       : size.pitch ?? null,
            square      : size.square === true,
            slots       : options.nodeSlots(data),
            perEdge     : options.portPerEdge(data),
            in          : [],
            out         : []
        };

        nodes.push(node);
        byId.set(node.id, node);
    }

    const edges = [];
        for(const { data } of dataEdges)
        {
            const source = byId.get(data.source);
            const target = byId.get(data.target);
                if(source === undefined || target === undefined || source === target){ continue; }

            const edge = { data, source, target, reversed: false, chain: [] };
                edges.push(edge);
                source.out.push(edge);
                target.in.push(edge);
        }

    return { nodes, edges, byId, layers: [] };
}

/*
 * 1. RANKS
 */
function breakCycles(graph)
{
    // Iterative DFS from the sources first, so the natural flow keeps its direction
    const state     = new Map();    // 1: on stack, 2: done
    const starts    = graph.nodes.filter(node => node.in.length === 0).concat(graph.nodes);

    for(const start of starts)
    {
        if(state.has(start)){ continue; }

        const stack = [[start, 0]];
            state.set(start, 1);

        while(stack.length > 0)
        {
            const top = stack[stack.length - 1];
            const [node, index] = top;

                if(index >= node.out.length)
                {
                    state.set(node, 2);
                    stack.pop();
                    continue;
                }

            top[1]++;

            const edge = node.out[index];
                if(state.get(edge.target) === 1)
                {
                    edge.reversed = true;           // Back edge: closes a loop
                }
                else if(state.has(edge.target) === false)
                {
                    state.set(edge.target, 1);
                    stack.push([edge.target, 0]);
                }
        }
    }
}

// Edges of the acyclic graph: back edges count in the reverse direction
const upper = (edge) => edge.reversed ? edge.target : edge.source;
const lower = (edge) => edge.reversed ? edge.source : edge.target;

function assignRanks(graph)
{
    const preds     = new Map(graph.nodes.map(node => [node, []]));
    const succs     = new Map(graph.nodes.map(node => [node, []]));
        for(const edge of graph.edges)
        {
            preds.get(lower(edge)).push(upper(edge));
            succs.get(upper(edge)).push(lower(edge));
        }

    // Longest path from the sources (Kahn order)
    const indegree  = new Map(graph.nodes.map(node => [node, preds.get(node).length]));
    const queue     = graph.nodes.filter(node => indegree.get(node) === 0);
    const order     = [];
        for(const node of queue){ node.rank = 0; }

        while(queue.length > 0)
        {
            const node = queue.shift();
                order.push(node);

            for(const next of succs.get(node))
            {
                next.rank = Math.max(next.rank ?? 0, node.rank + 1);
                indegree.set(next, indegree.get(next) - 1);

                if(indegree.get(next) === 0)
                {
                    queue.push(next);
                }
            }
        }

    // Sources sit right before their first consumer (raw water used at the end stays there)
    for(let i = order.length - 1; i >= 0; i--)
    {
        const node = order[i];
            if(preds.get(node).length === 0 && succs.get(node).length > 0)
            {
                node.rank = Math.min(...succs.get(node).map(next => next.rank)) - 1;
            }
    }

    // Requested outputs all end on the last layer
    const last = Math.max(...graph.nodes.map(node => node.rank));
        for(const node of graph.nodes)
        {
            if(node.data.nodeType === 'mainNode' && succs.get(node).length === 0)
            {
                node.rank = last;
            }
        }

    // Isolated nodes (no edge) stay on the first layer
    const first = Math.min(...graph.nodes.map(node => node.rank));
        for(const node of graph.nodes){ node.rank -= first; }

    graph.layerCount = Math.max(...graph.nodes.map(node => node.rank)) + 1;
}

/*
 * 2. DUMMIES
 *
 * Forward edge u -> v:   dummies on the layers strictly between u and v.
 * Back edge u -> v:      the line leaves u on its output side, then goes back through
 *                        the layers of u .. v (both included) and enters v from its input side.
 */
function insertDummies(graph)
{
    const makeDummy = (rank, edge) => {
        const dummy = { id: '__dummy' + graph.nodes.length, dummy: true, edge, rank, along: 0, cross: 0, width: 0, height: 0, in: [], out: [] };
            graph.nodes.push(dummy);
        return dummy;
    };

    for(const edge of graph.edges)
    {
        if(edge.reversed === false)
        {
            for(let rank = edge.source.rank + 1; rank < edge.target.rank; rank++)
            {
                edge.chain.push(makeDummy(rank, edge));
            }
        }
        else
        {
            for(let rank = edge.source.rank; rank >= edge.target.rank; rank--)
            {
                edge.chain.push(makeDummy(rank, edge));
            }
        }
    }

    graph.layers = Array.from({ length: graph.layerCount }, () => []);
        for(const node of graph.nodes)
        {
            graph.layers[node.rank].push(node);
        }
}

/*
 * Links between two consecutive layers, used for the ordering:
 * pairs [nodeOnLayer k, nodeOnLayer k+1].
 */
function layerLinks(graph)
{
    const links = Array.from({ length: graph.layerCount }, () => []);
    const add   = (a, b) => {
        if(a.rank + 1 === b.rank){ links[a.rank].push([a, b]); }
        else if(b.rank + 1 === a.rank){ links[b.rank].push([b, a]); }
    };

    for(const edge of graph.edges)
    {
        const path = [edge.source, ...edge.chain, edge.target];
            for(let i = 0; i < path.length - 1; i++)
            {
                add(path[i], path[i + 1]);
            }
    }

    return links;
}

/*
 * 3. ORDER
 */
function orderLayers(graph)
{
    const links     = layerLinks(graph);
    const up        = new Map(graph.nodes.map(node => [node, []]));
    const down      = new Map(graph.nodes.map(node => [node, []]));
        for(const layerLinks of links)
        {
            for(const [a, b] of layerLinks)
            {
                down.get(a).push(b);
                up.get(b).push(a);
            }
        }

    // Initial order: depth first from the last layer, so a node's suppliers are grouped
    const visited   = new Set();
    const initial   = graph.layers.map(() => []);
    const visit     = (node) => {
        const stack = [node];
            while(stack.length > 0)
            {
                const current = stack.pop();
                    if(visited.has(current)){ continue; }

                visited.add(current);
                initial[current.rank].push(current);

                const next = up.get(current).concat(down.get(current));
                    for(let i = next.length - 1; i >= 0; i--)
                    {
                        if(visited.has(next[i]) === false){ stack.push(next[i]); }
                    }
            }
    };
        for(let rank = graph.layerCount - 1; rank >= 0; rank--)
        {
            for(const node of graph.layers[rank]){ visit(node); }
        }

    graph.layers = initial;
    setOrder(graph);

    let best        = graph.layers.map(layer => layer.slice());
    let bestCross   = countCrossings(graph, links);

    for(let iteration = 0; iteration < 24 && bestCross > 0; iteration++)
    {
        const downward = (iteration % 2 === 0);
            for(let step = 1; step < graph.layerCount; step++)
            {
                const rank      = downward ? step : graph.layerCount - 1 - step;
                const neighbors = downward ? up : down;

                sortByBarycenter(graph.layers[rank], neighbors);
                graph.layers[rank].forEach((node, index) => { node.order = index; });
            }

        transpose(graph, links, up, down);

        const crossings = countCrossings(graph, links);
            if(crossings < bestCross)
            {
                bestCross   = crossings;
                best        = graph.layers.map(layer => layer.slice());
            }
    }

    graph.layers = best;
    setOrder(graph);
}

function setOrder(graph)
{
    for(const layer of graph.layers)
    {
        layer.forEach((node, index) => { node.order = index; });
    }
}

function sortByBarycenter(layer, neighbors)
{
    const keys = new Map();
        for(const node of layer)
        {
            const others = neighbors.get(node);
                keys.set(node, (others.length === 0) ? node.order : others.reduce((sum, other) => sum + other.order, 0) / others.length);
        }

    // Stable: nodes without neighbours keep their place relative to the others
    layer.sort((a, b) => (keys.get(a) - keys.get(b)) || (a.order - b.order));
}

function countCrossings(graph, links)
{
    let total = 0;
        for(const layerLinks of links)
        {
            total += crossingsBetween(layerLinks);
        }
    return total;
}

function crossingsBetween(pairs)
{
    /*
     * Inversions of the lower positions once sorted by the upper ones: sorted as single numbers,
     * counted with a Fenwick tree (no allocation per step, this runs a lot while ordering).
     */
    const count = pairs.length;
        if(count < 2){ return 0; }

    let width = 0;
        for(const [, b] of pairs){ width = Math.max(width, b.order + 1); }

    const keys = new Float64Array(count);
        for(let i = 0; i < count; i++){ keys[i] = pairs[i][0].order * width + pairs[i][1].order; }
        keys.sort();

    const tree      = new Int32Array(width + 1);
    let crossings   = 0;
        for(let i = 0; i < count; i++)
        {
            const lower = keys[i] % width;

            // Already placed with a strictly greater lower position: i - (placed at or below this one)
            let below = 0;
                for(let k = lower + 1; k > 0; k -= k & -k){ below += tree[k]; }
            crossings += i - below;

            for(let k = lower + 1; k <= width; k += k & -k){ tree[k]++; }
        }

    return crossings;
}

// Swap neighbours of a layer while it reduces the crossings with both adjacent layers
function transpose(graph, links, up, down)
{
    /*
     * Crossings between the edges of a and b only: (a placed before b) - (b placed before a).
     * Positive: swapping them removes crossings. Neighbour lists are looked up once per node.
     */
    const lists = new Map();
        for(const node of graph.nodes){ lists.set(node, [up.get(node), down.get(node)]); }

    const gain = (a, b) => {
        const la = lists.get(a), lb = lists.get(b);
        let difference = 0;
            for(let side = 0; side < 2; side++)
            {
                const na = la[side], nb = lb[side];
                    for(let i = 0; i < na.length; i++)
                    {
                        const x = na[i].order;
                            for(let j = 0; j < nb.length; j++)
                            {
                                const y = nb[j].order;
                                    if(x > y){ difference++; }
                                    else if(x < y){ difference--; }
                            }
                    }
            }
        return difference;
    };

    let improved = true;
        for(let pass = 0; pass < 4 && improved; pass++)
        {
            improved = false;

            for(const layer of graph.layers)
            {
                for(let i = 0; i < layer.length - 1; i++)
                {
                    const a = layer[i], b = layer[i + 1];
                        if(gain(a, b) > 0)
                        {
                            layer[i]        = b;
                            layer[i + 1]    = a;
                            b.order         = i;
                            a.order         = i + 1;
                            improved        = true;
                        }
                }
            }
        }
}

/*
 * 4. PORTS
 *
 * A port is a slot on the input side ("in") or the output side ("out") of a node.
 * Edges of the same item share a port, except on mergers / splitters (one port per edge).
 * Every available slot of the building is kept, even unused, so the drawing shows them.
 */
function assignPorts(graph, options)
{
    const otherPosition = (edge, node) => {
        // Where the edge comes from / goes to, seen from the node
        const path      = [edge.source, ...edge.chain, edge.target];
        const index     = path.indexOf(node);
        const other     = (index === 0) ? path[1] : path[index - 1];
        return (other.c ?? other.order * 100);
    };

    for(const node of graph.nodes)
    {
        if(node.dummy){ continue; }

        for(const side of ['in', 'out'])
        {
            const edges     = node[side];
            const perEdge   = (side === 'in') ? node.perEdge.inputs : node.perEdge.outputs;
            const groups    = new Map();
                for(const edge of edges)
                {
                    const key = perEdge ? edge.data.id : edge.data.itemId;
                        if(groups.has(key) === false){ groups.set(key, { item: edge.data.itemId, edges: [] }); }
                        groups.get(key).edges.push(edge);
                }

            // Ports ordered like what they connect to, to avoid crossings in front of the node
            const used = [...groups.values()];
                for(const group of used)
                {
                    group.key = group.edges.reduce((sum, edge) => sum + otherPosition(edge, node), 0) / group.edges.length;
                }
                used.sort((a, b) => a.key - b.key);

            const available = (side === 'in') ? node.slots.inputs : node.slots.outputs;
            const count     = Math.max(available ?? 0, used.length);
            const ports     = Array.from({ length: count }, (_, index) => ({ node, side, index, count, item: null, edges: [] }));

                // Used ports spread over the slots
                used.forEach((group, i) => {
                    const slot  = (used.length === count) ? i : Math.round((i + 0.5) * count / used.length - 0.5);
                    const port  = ports[slot];
                        port.item   = group.item;
                        port.edges  = group.edges;

                    for(const edge of group.edges)
                    {
                        if(side === 'in'){ edge.targetPort = port; }
                        else             { edge.sourcePort = port; }
                    }
                });

            node[side + 'Ports'] = ports;
        }

        // The node grows so its ports keep a readable spacing (both ways if it stays square)
        const most      = Math.max(node.inPorts.length, node.outPorts.length);
            node.cross  = Math.max(node.cross, most * (node.pitch ?? options.portPitch));
            if(node.square)
            {
                node.along = node.cross = Math.max(node.along, node.cross);
            }

        // Each port in the middle of its share of the side
        for(const port of [...node.inPorts, ...node.outPorts])
        {
            port.offset = -node.cross / 2 + (port.index + 0.5) * node.cross / port.count;
        }
    }
}

const portOffset = (port) => port?.offset ?? 0;

/*
 * 5. POSITIONS (c axis)
 */
function assignPositions(graph, options)
{
    // Spring between two points that should be aligned: (node a + offset a) == (node b + offset b)
    const springs = new Map(graph.nodes.map(node => [node, []]));
    const spring  = (a, offsetA, b, offsetB, weight) => {
        springs.get(a).push({ other: b, delta: offsetB - offsetA, weight });
        springs.get(b).push({ other: a, delta: offsetA - offsetB, weight });
    };

    for(const edge of graph.edges)
    {
        const path      = [edge.source, ...edge.chain, edge.target];
        const offsets   = path.map((node, index) => (index === 0) ? portOffset(edge.sourcePort) : ((index === path.length - 1) ? portOffset(edge.targetPort) : 0));

        for(let i = 0; i < path.length - 1; i++)
        {
            const dummies   = (path[i].dummy ? 1 : 0) + (path[i + 1].dummy ? 1 : 0);
            const weight    = [1, 2, 8][dummies];
                spring(path[i], offsets[i], path[i + 1], offsets[i + 1], weight);
        }
    }

    const gap = (a, b) => gapBetween(a, b, options);

    // Start packed, unless positions exist from a previous round
    for(const layer of graph.layers)
    {
        if(layer.some(node => node.c === undefined))
        {
            let c = 0;
                layer.forEach((node, index) => {
                    if(index > 0){ c += (layer[index - 1].cross + node.cross) / 2 + gap(layer[index - 1], node); }
                    node.c = c;
                });
        }
    }

    // Minimal distance of each node from the first one of its layer (fixed while placing)
    const shifts    = graph.layers.map(layer => {
        const shift = new Float64Array(layer.length);
            for(let i = 1; i < layer.length; i++)
            {
                shift[i] = shift[i - 1] + (layer[i - 1].cross + layer[i].cross) / 2 + gap(layer[i - 1], layer[i]);
            }
        return shift;
    });
    const widest    = Math.max(...graph.layers.map(layer => layer.length));
    const values    = new Float64Array(widest);
    const weights   = new Float64Array(widest);

    for(let iteration = 0; iteration < 30; iteration++)
    {
        const forward = (iteration % 2 === 0);
            for(let step = 0; step < graph.layerCount; step++)
            {
                const rank  = forward ? step : graph.layerCount - 1 - step;
                const layer = graph.layers[rank];

                for(let i = 0; i < layer.length; i++)
                {
                    const list = springs.get(layer[i]);
                        if(list.length === 0)
                        {
                            values[i]   = layer[i].c;
                            weights[i]  = 0.01;
                            continue;
                        }

                    let sum = 0, weight = 0;
                        for(const { other, delta, weight: w } of list)
                        {
                            sum     += (other.c + delta) * w;
                            weight  += w;
                        }
                    values[i]   = sum / weight;
                    weights[i]  = weight;
                }

                placeLayer(layer, values, weights, shifts[rank]);
            }
    }

    // Top of the drawing at 0
    const top = Math.min(...graph.nodes.map(node => node.c - node.cross / 2));
        for(const node of graph.nodes){ node.c -= top; }
}

function gapBetween(a, b, options)
{
    if(a.dummy && b.dummy){ return options.dummySpacing; }
    if(a.dummy || b.dummy){ return options.nodeSpacing / 2; }
    return options.nodeSpacing;
}

/*
 * Long edges: the springs leave their dummies a little apart from layer to layer, which draws
 * a staircase. Each chain is set on as few straight runs as possible: a run keeps one position
 * free in all its layers (between the neighbours), preferably the one of its source port, then
 * of its target port, so the line has one jog instead of one per layer.
 * Moving a dummy inside its free interval keeps every spacing, so chains can be done one by one.
 */
function straightenChains(graph, options)
{
    const freeInterval = (dummy) => {
        const layer     = graph.layers[dummy.rank];
        const before    = layer[dummy.order - 1];
        const after     = layer[dummy.order + 1];
        return [
            (before === undefined) ? -Infinity : before.c + before.cross / 2 + gapBetween(before, dummy, options),
            (after === undefined)  ?  Infinity : after.c - after.cross / 2 - gapBetween(dummy, after, options)
        ];
    };

    const portC = (port) => port.node.c + port.offset;

    // Longest first: they cross the most layers and gain the most
    const edges = graph.edges.filter(edge => edge.chain.length > 1).sort((a, b) => b.chain.length - a.chain.length);

    for(const edge of edges)
    {
        // Seen from the source: a back edge's chain starts next to its source as well
        const chain     = edge.chain;
        const from      = portC(edge.sourcePort);
        const to        = portC(edge.targetPort);

        let start = 0;
        let level = from;
            while(start < chain.length)
            {
                // Longest run from here sharing a free position
                let low = -Infinity, high = Infinity, end = start;
                    while(end < chain.length)
                    {
                        const [a, b] = freeInterval(chain[end]);
                        const nextLow = Math.max(low, a), nextHigh = Math.min(high, b);
                            if(nextLow > nextHigh){ break; }

                        low = nextLow; high = nextHigh; end++;
                    }

                if(end === start)
                {
                    // Should not happen (a dummy always fits where it is): keep it
                    level = chain[start].c;
                    start++;
                    continue;
                }

                // Keep the current level if possible, else go to the target's level, else the closest
                const clamp = (value) => Math.min(high, Math.max(low, value));
                const pick  = (clamp(level) === level) ? level : ((clamp(to) === to) ? to : clamp(level));
                    for(let i = start; i < end; i++){ chain[i].c = pick; }

                level = pick;
                start = end;
            }

        // A last run that could reach the target's level does so: the jog moves away from the target
        const last = chain[chain.length - 1];
            if(last.c !== to)
            {
                let index = chain.length - 1;
                    while(index >= 0 && chain[index].c === last.c)
                    {
                        const [a, b] = freeInterval(chain[index]);
                            if(to < a || to > b){ break; }
                        index--;
                    }
                // Only when the whole run fits at the target's level
                if(index < 0 || chain[index].c !== last.c)
                {
                    for(let i = index + 1; i < chain.length; i++){ chain[i].c = to; }
                }
            }
    }
}

/*
 * Closest positions to the desired ones (weighted least squares) keeping the order and spacing:
 * with S_i the minimal distance from the first node, q_i = c_i - S_i must be non decreasing,
 * which is an isotonic regression solved by pooling adjacent violators.
 */
function placeLayer(layer, values, weights, shift)
{
    // Pooled blocks as a stack of parallel arrays: sum of weighted targets, weight, node count
    const n         = layer.length;
    const sums      = new Float64Array(n);
    const totals    = new Float64Array(n);
    const counts    = new Int32Array(n);
    let blocks      = 0;

        for(let i = 0; i < n; i++)
        {
            sums[blocks]    = (values[i] - shift[i]) * weights[i];
            totals[blocks]  = weights[i];
            counts[blocks]  = 1;
            blocks++;

            while(blocks > 1 && sums[blocks - 2] / totals[blocks - 2] > sums[blocks - 1] / totals[blocks - 1])
            {
                sums[blocks - 2]    += sums[blocks - 1];
                totals[blocks - 2]  += totals[blocks - 1];
                counts[blocks - 2]  += counts[blocks - 1];
                blocks--;
            }
        }

    let i = 0;
        for(let b = 0; b < blocks; b++)
        {
            const value = sums[b] / totals[b];
                for(let k = 0; k < counts[b]; k++, i++)
                {
                    layer[i].c = value + shift[i];
                }
        }
}

/*
 * 6. ROUTING
 *
 * Channel k is the gap before layer k (channel layerCount is after the last layer).
 * Each edge is cut into channel segments; a segment with a jog needs a vertical track.
 */
function routeEdges(graph, options)
{
    const channels = Array.from({ length: graph.layerCount + 1 }, () => []);
    const routes   = [];

    const portC     = (port) => port.node.c + port.offset;
    const portKey   = (port) => port.node.id + '|' + port.side + '|' + port.index;

    for(const edge of graph.edges)
    {
        const steps = [];       // { channel, from, to, fromKey, toKey, uturn }

        if(edge.reversed === false)
        {
            const points = [portC(edge.sourcePort), ...edge.chain.map(dummy => dummy.c), portC(edge.targetPort)];
                for(let i = 0; i < points.length - 1; i++)
                {
                    steps.push({
                        channel : edge.source.rank + 1 + i,
                        from    : points[i],
                        to      : points[i + 1],
                        fromKey : (i === 0) ? portKey(edge.sourcePort) : null,
                        toKey   : (i === points.length - 2) ? portKey(edge.targetPort) : null,
                        uturn   : 0
                    });
                }
        }
        else
        {
            // Out of the source to the right, back to the left through the dummies, into the target
            const chain = edge.chain;
                steps.push({ channel: edge.source.rank + 1, from: portC(edge.sourcePort), to: chain[0].c, fromKey: portKey(edge.sourcePort), toKey: null, uturn: -1 });
                for(let i = 0; i < chain.length - 1; i++)
                {
                    steps.push({ channel: chain[i].rank, from: chain[i].c, to: chain[i + 1].c, fromKey: null, toKey: null, uturn: 0, backward: true });
                }
                steps.push({ channel: edge.target.rank, from: chain[chain.length - 1].c, to: portC(edge.targetPort), fromKey: null, toKey: portKey(edge.targetPort), uturn: 1 });
        }

        for(const step of steps)
        {
            step.edge = edge;
            channels[step.channel].push(step);
        }

        routes.push({ edge, steps });
    }

    graph.channelTracks = channels.map(segments => assignTracks(segments, options.trackSpacing));

    return routes;
}

function assignTracks(segments, trackSpacing)
{
    // Segments sharing a port share a track: union-find on the port keys
    const parent    = new Map();
    const find      = (key) => {
        while(parent.get(key) !== key){ key = parent.get(key); }
        return key;
    };
    const union     = (a, b) => { parent.set(find(a), find(b)); };

    const jogs = [];
        segments.forEach((segment, index) => {
            const straight = Math.abs(segment.from - segment.to) < EPSILON && segment.uturn === 0;
                if(straight){ segment.track = null; return; }

            const own = 'segment' + index;
                parent.set(own, own);
                for(const key of [segment.fromKey, segment.toKey])
                {
                    if(key !== null)
                    {
                        if(parent.has(key) === false){ parent.set(key, key); }
                        union(own, key);
                    }
                }
            jogs.push([own, segment]);
        });

    const groups = new Map();
        for(const [own, segment] of jogs)
        {
            const root = find(own);
                if(groups.has(root) === false){ groups.set(root, { segments: [], min: Infinity, max: -Infinity, left: [], right: [], uturn: 0 }); }

            const group = groups.get(root);
                group.segments.push(segment);
                group.min   = Math.min(group.min, segment.from, segment.to);
                group.max   = Math.max(group.max, segment.from, segment.to);
                group.uturn = segment.uturn || group.uturn;

            // Which side each end of the segment is on (backward segments run from right to left)
            if(segment.uturn === -1)        { group.left.push(segment.from, segment.to); }
            else if(segment.uturn === 1)    { group.right.push(segment.from, segment.to); }
            else if(segment.backward)       { group.right.push(segment.from); group.left.push(segment.to); }
            else                            { group.left.push(segment.from); group.right.push(segment.to); }
        }

    /*
     * Track order, left to right, to avoid crossings in the channel:
     *  - U-turns back to the left first, U-turns back to the right last;
     *  - descending lines: the later one starts, the more to the left;
     *  - rising lines: the earlier one starts, the more to the left.
     */
    const average = (list) => list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
    const sorted  = [...groups.values()].map(group => {
        const left  = average(group.left);
        const right = average(group.right);
            if(group.uturn === -1){ group.sortKey = [0, left]; }
            else if(group.uturn === 1){ group.sortKey = [3, right]; }
            else if(right >= left){ group.sortKey = [1, -left]; }
            else { group.sortKey = [2, left]; }
        return group;
    }).sort((a, b) => (a.sortKey[0] - b.sortKey[0]) || (a.sortKey[1] - b.sortKey[1]));

    /*
     * Packed in order: a group goes right after the last overlapping group already placed.
     * Groups that merely follow each other also get their own track when they are close:
     * on one track they would read as a single line.
     */
    const near   = 3 * trackSpacing;
    const placed = [];
    let tracks   = 0;
        for(const group of sorted)
        {
            let track = 0;
                for(const other of placed)
                {
                    if(other.min <= group.max + near && group.min <= other.max + near)
                    {
                        track = Math.max(track, other.track + 1);
                    }
                }

            group.track = track;
            tracks      = Math.max(tracks, track + 1);
            placed.push(group);

            for(const segment of group.segments){ segment.track = track; }
        }

    return tracks;
}

/*
 * SCREEN
 */
function toScreen(graph, routes, options, horizontal)
{
    // Along positions: channel, layer, channel, layer, ..., channel
    const thickness = graph.layers.map(layer => Math.max(0, ...layer.map(node => node.along)));
    const channel   = graph.channelTracks.map(tracks => ({
        tracks,
        width       : Math.max(options.minChannel, 2 * options.labelSpace + tracks * options.trackSpacing)
    }));
        // Nothing to label before the first layer / after the last one
        channel[0].width                    = Math.max(options.trackSpacing * 2, channel[0].tracks * options.trackSpacing + options.trackSpacing * 2);
        channel[channel.length - 1].width   = Math.max(options.trackSpacing * 2, channel[channel.length - 1].tracks * options.trackSpacing + options.trackSpacing * 2);

    const layerStart = [];
    let a = 0;
        for(let k = 0; k < graph.layerCount; k++)
        {
            channel[k].start    = a;
            a                  += channel[k].width;
            layerStart.push(a);
            a                  += thickness[k];
        }
        channel[graph.layerCount].start = a;
        a += channel[graph.layerCount].width;

    const length = a;

    const trackA = (k, track) => {
        const ch    = channel[k];
        const used  = ch.tracks * options.trackSpacing;
        return ch.start + (ch.width - used) / 2 + (track + 0.5) * options.trackSpacing;
    };

    const nodeA = (node) => layerStart[node.rank] + thickness[node.rank] / 2;

    // Canonical (a, c) -> screen (x, y)
    const transform = (pa, pc) => {
        switch(options.direction)
        {
            case 'LEFT':    return { x: length - pa, y: pc };
            case 'DOWN':    return { x: pc, y: pa };
            case 'UP':      return { x: pc, y: length - pa };
            default:        return { x: pa, y: pc };
        }
    };
    // Unit vector of the flow on screen
    const flow = { RIGHT: { x: 1, y: 0 }, LEFT: { x: -1, y: 0 }, DOWN: { x: 0, y: 1 }, UP: { x: 0, y: -1 } }[options.direction];

    const portPoint = (port) => {
        const center = nodeA(port.node);
        const pa     = (port.side === 'in') ? center - port.node.along / 2 : center + port.node.along / 2;
        return { a: pa, c: port.node.c + port.offset };
    };

    const nodes = [];
        for(const node of graph.nodes)
        {
            if(node.dummy){ continue; }

            const center    = transform(nodeA(node), node.c);
            const width     = horizontal ? node.along : node.cross;
            const height    = horizontal ? node.cross : node.along;

            const ports = (list, side) => list.map(port => {
                const point = portPoint(port);
                const sign  = (side === 'in') ? -1 : 1;
                    return {
                        side,
                        index   : port.index,
                        item    : port.item,
                        edges   : port.edges.map(edge => edge.data),
                        ...transform(point.a, point.c),
                        // Outward direction of the port on screen
                        dx      : flow.x * sign,
                        dy      : flow.y * sign
                    };
            });

            nodes.push({
                id      : node.id,
                data    : node.data,
                x       : center.x - width / 2,
                y       : center.y - height / 2,
                width,
                height,
                inPorts : ports(node.inPorts, 'in'),
                outPorts: ports(node.outPorts, 'out')
            });
        }

    const edges = routes.map(({ edge, steps }) => {
        const start     = portPoint(edge.sourcePort);
        const end       = portPoint(edge.targetPort);
        const points    = [start];

            for(const step of steps)
            {
                if(step.track !== null && step.track !== undefined)
                {
                    const ta = trackA(step.channel, step.track);
                        points.push({ a: ta, c: step.from }, { a: ta, c: step.to });
                }
                else if(step.from !== step.to)
                {
                    // Almost straight (under half a pixel): tiny jog in the middle of the channel
                    const ma = channel[step.channel].start + channel[step.channel].width / 2;
                        points.push({ a: ma, c: step.from }, { a: ma, c: step.to });
                }
            }
            points.push({ a: end.a, c: end.c });

        return {
            data        : edge.data,
            source      : edge.source.id,
            target      : edge.target.id,
            reversed    : edge.reversed,
            points      : simplify(points).map(point => transform(point.a, point.c))
        };
    });

    // Bounds of the drawing
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const extend = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
        for(const node of nodes){ extend(node.x, node.y); extend(node.x + node.width, node.y + node.height); }
        for(const edge of edges){ for(const point of edge.points){ extend(point.x, point.y); } }

    return { nodes, edges, direction: options.direction, bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } };
}

// Drop repeated and aligned points
function simplify(points)
{
    const result = [];
        for(const point of points)
        {
            const last = result[result.length - 1];
                if(last !== undefined && Math.abs(last.a - point.a) < 1e-6 && Math.abs(last.c - point.c) < 1e-6){ continue; }

            if(result.length >= 2)
            {
                const before = result[result.length - 2];
                    if((Math.abs(before.a - last.a) < 1e-6 && Math.abs(last.a - point.a) < 1e-6) || (Math.abs(before.c - last.c) < 1e-6 && Math.abs(last.c - point.c) < 1e-6))
                    {
                        result[result.length - 1] = point;
                        continue;
                    }
            }
            result.push(point);
        }
    return result;
}