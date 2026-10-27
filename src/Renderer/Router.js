/*
 * Orthogonal routing around obstacles, for the edges of nodes moved by hand.
 *
 * The candidate lines are the sides of the obstacles (pushed out by a margin), the port stubs and
 * the middles between them; the route is the cheapest path on that sparse grid (A*), counting
 * a penalty for every bend so the lines stay simple.
 *
 * Running along another line closer than SPACING costs extra, so routes keep their distance
 * (the grid gets candidate lines on both sides of the existing ones for that).
 *
 *  ports:      { x, y, dx, dy, stub? }, dx / dy pointing out of their node
 *  obstacles:  [{ x, y, width, height }]
 *  lines:      [[{ x, y }, { x, y }, ...]] the other routes (orthogonal polylines)
 */

const MARGIN        = 14;       // Distance kept from the obstacles
const STUB          = 28;       // Straight part out of / into a port
const BEND          = 60;       // Cost of a bend, in length
const REGION        = 250;      // First try around the two ports only
const GREED         = 1.5;      // Weight of the A* estimate
const SPACING       = 16;       // Distance kept from the other lines
const ALONG         = 4;        // Cost factor of the length run too close to another line

const DIRECTIONS    = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export function routeAround(source, target, obstacles, lines = [])
{
    // Other routes as horizontal / vertical segments
    const segments = [];
        for(const line of lines)
        {
            for(let i = 1; i < line.length; i++)
            {
                const a = line[i - 1], b = line[i];
                    if(Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.x - b.x) > 1e-6)     { segments.push({ horizontal: true,  at: a.y, from: Math.min(a.x, b.x), to: Math.max(a.x, b.x) }); }
                    else if(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) > 1e-6){ segments.push({ horizontal: false, at: a.x, from: Math.min(a.y, b.y), to: Math.max(a.y, b.y) }); }
            }
        }

    // Ports may ask for a longer straight part (to run past their label)
    const start     = { x: source.x + source.dx * (source.stub ?? STUB), y: source.y + source.dy * (source.stub ?? STUB) };
    const end       = { x: target.x + target.dx * (target.stub ?? STUB), y: target.y + target.dy * (target.stub ?? STUB) };

    // Around the ports first (fast while dragging), then the whole drawing
    const region    = {
        x1  : Math.min(start.x, end.x) - REGION,
        y1  : Math.min(start.y, end.y) - REGION,
        x2  : Math.max(start.x, end.x) + REGION,
        y2  : Math.max(start.y, end.y) + REGION
    };
    const near      = obstacles.filter(box => box.x < region.x2 && box.x + box.width > region.x1 && box.y < region.y2 && box.y + box.height > region.y1);

    const nearLines = segments.filter(segment => segment.horizontal
        ? (segment.at > region.y1 && segment.at < region.y2 && segment.to > region.x1 && segment.from < region.x2)
        : (segment.at > region.x1 && segment.at < region.x2 && segment.to > region.y1 && segment.from < region.y2));

    const path = search(start, end, source, target, near, nearLines, region) ?? search(start, end, source, target, obstacles, segments, null);
        if(path === null)
        {
            return null;
        }

    return simplify([{ x: source.x, y: source.y }, ...path, { x: target.x, y: target.y }]);
}

// Does the segment a-b go through one of the obstacles?
export function crossesObstacle(a, b, box, margin = 1)
{
    const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
    const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);

    return x2 > box.x + margin && x1 < box.x + box.width - margin && y2 > box.y + margin && y1 < box.y + box.height - margin;
}

function search(start, end, source, target, obstacles, segments, region)
{
    const boxes = obstacles.map(box => ({ x1: box.x - MARGIN, y1: box.y - MARGIN, x2: box.x + box.width + MARGIN, y2: box.y + box.height + MARGIN }));

    // Candidate coordinates
    let xs = [start.x, end.x];
    let ys = [start.y, end.y];
        for(const box of boxes)
        {
            xs.push(box.x1, box.x2);
            ys.push(box.y1, box.y2);
        }
        if(region !== null)
        {
            xs.push(region.x1, region.x2);
            ys.push(region.y1, region.y2);
        }
        // Room to run beside the other lines
        for(const segment of segments)
        {
            (segment.horizontal ? ys : xs).push(segment.at - SPACING, segment.at + SPACING);
        }

    const prepare = (values, low, high) => {
        let sorted = [...new Set(values.map(value => Math.round(value * 100) / 100))].sort((a, b) => a - b);
            if(region !== null){ sorted = sorted.filter(value => value >= low && value <= high); }

        // Middles between neighbours: routes run centred in the free space
        const result = [];
            sorted.forEach((value, index) => {
                if(index > 0 && value - sorted[index - 1] > 2 * MARGIN){ result.push((value + sorted[index - 1]) / 2); }
                result.push(value);
            });
        return result;
    };
    xs = prepare(xs, region?.x1, region?.x2);
    ys = prepare(ys, region?.y1, region?.y2);

    const W = xs.length, H = ys.length;

    // Blocked points and moves (strictly inside an obstacle)
    const blockedPoint  = new Uint8Array(W * H);
    const blockedH      = new Uint8Array(W * H);    // From (i, j) to (i + 1, j)
    const blockedV      = new Uint8Array(W * H);    // From (i, j) to (i, j + 1)
    const range         = (values, low, high) => {
        let first = 0;
            while(first < values.length && values[first] <= low){ first++; }
        let last = values.length - 1;
            while(last >= 0 && values[last] >= high){ last--; }
        return [first, last];
    };

    for(const box of boxes)
    {
        const [i1, i2] = range(xs, box.x1, box.x2);
        const [j1, j2] = range(ys, box.y1, box.y2);

        for(let i = i1; i <= i2; i++)
        {
            for(let j = j1; j <= j2; j++){ blockedPoint[j * W + i] = 1; }
        }
        // Moves crossing the inside, including the ones starting / ending on the border
        for(let j = j1; j <= j2; j++)
        {
            for(let i = Math.max(0, i1 - 1); i <= i2 && i < W - 1; i++){ blockedH[j * W + i] = 1; }
        }
        for(let i = i1; i <= i2; i++)
        {
            for(let j = Math.max(0, j1 - 1); j <= j2 && j < H - 1; j++){ blockedV[j * W + i] = 1; }
        }
    }

    // Lines close to each grid row / column, for the cost of running along them
    const nearRows      = ys.map(y => segments.filter(segment => segment.horizontal && Math.abs(segment.at - y) < SPACING - 1e-6));
    const nearColumns   = xs.map(x => segments.filter(segment => segment.horizontal === false && Math.abs(segment.at - x) < SPACING - 1e-6));
    const alongCost     = (list, from, to) => {
        let length = 0;
            for(const segment of list)
            {
                length += Math.max(0, Math.min(to, segment.to) - Math.max(from, segment.from));
            }
        return length * ALONG;
    };

    const si = xs.indexOf(Math.round(start.x * 100) / 100), sj = ys.indexOf(Math.round(start.y * 100) / 100);
    const ei = xs.indexOf(Math.round(end.x * 100) / 100),   ej = ys.indexOf(Math.round(end.y * 100) / 100);
        if(si < 0 || sj < 0 || ei < 0 || ej < 0){ return null; }

    // Leave the source outward, come into the target inward
    const startDirection    = DIRECTIONS.findIndex(([dx, dy]) => dx === Math.sign(source.dx) && dy === Math.sign(source.dy));
    const endDirection      = DIRECTIONS.findIndex(([dx, dy]) => dx === -Math.sign(target.dx) && dy === -Math.sign(target.dy));

    const key       = (i, j, d) => (j * W + i) * 4 + d;
    const cost      = new Float64Array(W * H * 4).fill(Infinity);
    const previous  = new Int32Array(W * H * 4).fill(-1);
    const heap      = new Heap();
    // Distance left, plus one bend when not aligned with the end yet (never over-estimates)
    // Weighted (x GREED): far fewer cells explored, routes barely longer than the best ones
    const guess     = (i, j) => GREED * (Math.abs(xs[i] - xs[ei]) + Math.abs(ys[j] - ys[ej]) + ((i !== ei && j !== ej) ? BEND : 0));

    cost[key(si, sj, startDirection)] = 0;
    heap.push(guess(si, sj), key(si, sj, startDirection));

    let found = -1;
        while(heap.size > 0)
        {
            const [priority, current] = heap.pop();
            const d     = current % 4;
            const cell  = (current - d) / 4;
            const i     = cell % W;
            const j     = (cell - i) / W;

                if(priority - guess(i, j) > cost[current] + 1e-6){ continue; }
                if(i === ei && j === ej)
                {
                    // Arriving the wrong way costs the bends needed to turn into the port
                    const turns = (d === endDirection) ? 0 : ((d + 2) % 4 === endDirection ? 2 : 1);
                        if(turns === 0){ found = current; break; }
                }

            for(let nd = 0; nd < 4; nd++)
            {
                if((nd + 2) % 4 === d){ continue; }     // No U-turn on the spot

                const ni = i + DIRECTIONS[nd][0];
                const nj = j + DIRECTIONS[nd][1];
                    if(ni < 0 || nj < 0 || ni >= W || nj >= H){ continue; }

                // Start and end points can sit on an obstacle border (ports): only moves are checked there
                if(blockedPoint[nj * W + ni] === 1 && (ni !== ei || nj !== ej)){ continue; }

                const blocked = (nd === 0) ? blockedH[j * W + i] : (nd === 2) ? blockedH[j * W + ni] : (nd === 1) ? blockedV[j * W + i] : blockedV[nj * W + i];
                    if(blocked === 1){ continue; }

                const next      = key(ni, nj, nd);
                const length    = Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]);
                const along     = (nd % 2 === 0)
                                ? alongCost(nearRows[j], Math.min(xs[i], xs[ni]), Math.max(xs[i], xs[ni]))
                                : alongCost(nearColumns[i], Math.min(ys[j], ys[nj]), Math.max(ys[j], ys[nj]));
                const total     = cost[current] + length + along + ((nd === d) ? 0 : BEND);
                    if(total < cost[next])
                    {
                        cost[next]      = total;
                        previous[next]  = current;
                        heap.push(total + guess(ni, nj), next);
                    }
            }
        }

    if(found < 0){ return null; }

    const points = [];
        for(let current = found; current >= 0; current = previous[current])
        {
            const cell = (current - current % 4) / 4;
                points.push({ x: xs[cell % W], y: ys[Math.floor(cell / W)] });
        }

    return points.reverse();
}

function simplify(points)
{
    const result = [];
        for(const point of points)
        {
            const last = result[result.length - 1];
                if(last !== undefined && Math.abs(last.x - point.x) < 1e-6 && Math.abs(last.y - point.y) < 1e-6){ continue; }

            if(result.length >= 2)
            {
                const before = result[result.length - 2];
                    if((Math.abs(before.x - last.x) < 1e-6 && Math.abs(last.x - point.x) < 1e-6) || (Math.abs(before.y - last.y) < 1e-6 && Math.abs(last.y - point.y) < 1e-6))
                    {
                        result[result.length - 1] = point;
                        continue;
                    }
            }
            result.push(point);
        }
    return result;
}

// Binary heap of (priority, value) in typed arrays: no allocation per entry
class Heap
{
    constructor(capacity = 1024)
    {
        this.priorities = new Float64Array(capacity);
        this.values     = new Int32Array(capacity);
        this.size       = 0;
        this.popped     = [0, 0];
    }

    push(priority, value)
    {
        if(this.size === this.values.length)
        {
            const priorities = new Float64Array(this.size * 2); priorities.set(this.priorities); this.priorities = priorities;
            const values     = new Int32Array(this.size * 2);   values.set(this.values);         this.values     = values;
        }

        const p = this.priorities, v = this.values;
        let index = this.size++;
            while(index > 0)
            {
                const parent = (index - 1) >> 1;
                    if(p[parent] <= priority){ break; }

                p[index] = p[parent];
                v[index] = v[parent];
                index    = parent;
            }
        p[index] = priority;
        v[index] = value;
    }

    // Returns [priority, value] (the same array every time)
    pop()
    {
        const p = this.priorities, v = this.values;
            this.popped[0] = p[0];
            this.popped[1] = v[0];

        const last      = --this.size;
        const priority  = p[last], value = v[last];
        let index       = 0;
            for(;;)
            {
                const left = index * 2 + 1;
                    if(left >= last){ break; }

                const child = (left + 1 < last && p[left + 1] < p[left]) ? left + 1 : left;
                    if(p[child] >= priority){ break; }

                p[index] = p[child];
                v[index] = v[child];
                index    = child;
            }
        p[index] = priority;
        v[index] = value;

        return this.popped;
    }
}