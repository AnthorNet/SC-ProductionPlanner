/*
 * Turns per-item balances into a flow graph usable by any renderer.
 *
 * Node ids:
 *      recipe:<recipeId>   resource:<itemId>   input:<itemId>   missing:<itemId>
 *      output:<itemId>     surplus:<itemId>
 *
 * For each item, producers are matched to consumers greedily (north-west corner rule):
 * this yields at most (producers + consumers − 1) edges per item, which keeps graphs readable,
 * and the matching is deterministic for a given plan.
 */

const ZERO = 1e-7;

export function buildFlows(plan)
{
    const nodes     = [];
    const byItem    = new Map();   // itemId → { producers: [], consumers: [] }

    const slot = (item) => {
        if(byItem.has(item) === false){ byItem.set(item, { producers: [], consumers: [] }); }
        return byItem.get(item);
    };

    for(const recipe of plan.recipes)
    {
        nodes.push({ id: 'recipe:' + recipe.id, type: 'recipe', recipe: recipe.id, building: recipe.building, machines: recipe.machines, count: recipe.count, clock: recipe.clock });

        const net = new Map();
            for(const { item, qty } of recipe.outputs){ net.set(item, (net.get(item) ?? 0) + qty); }
            for(const { item, qty } of recipe.inputs){ net.set(item, (net.get(item) ?? 0) - qty); }

        for(const [item, qty] of net)
        {
            if(qty > ZERO){ slot(item).producers.push({ node: 'recipe:' + recipe.id, qty }); }
            if(qty < -ZERO){ slot(item).consumers.push({ node: 'recipe:' + recipe.id, qty: -qty }); }
        }
    }

    const endpoint = (list, type, side) => {
        for(const { item, qty, ...extra } of list)
        {
            const id = type + ':' + item;
                nodes.push({ id, type, item, qty, ...extra });
                slot(item)[side].push({ node: id, qty });
        }
    };

    endpoint(plan.resources.map(r => ({ item: r.item, qty: r.qty, building: r.building, count: r.count })), 'resource', 'producers');
    endpoint(plan.inputs, 'input', 'producers');
    endpoint(plan.missing, 'missing', 'producers');
    endpoint(plan.outputs, 'output', 'consumers');
    endpoint(plan.surplus, 'surplus', 'consumers');

    const edges = [];
        for(const [item, { producers, consumers }] of byItem)
        {
            let p = 0, c = 0;
            let left = producers[0]?.qty ?? 0, need = consumers[0]?.qty ?? 0;

            while(p < producers.length && c < consumers.length)
            {
                const qty = Math.min(left, need);
                    if(qty > ZERO)
                    {
                        edges.push({ id: producers[p].node + '>' + consumers[c].node + '#' + item, source: producers[p].node, target: consumers[c].node, item, qty });
                    }

                left -= qty;
                need -= qty;

                if(left <= ZERO){ p++; left = producers[p]?.qty ?? 0; }
                if(need <= ZERO){ c++; need = consumers[c]?.qty ?? 0; }
            }
        }

    return { nodes, edges };
}