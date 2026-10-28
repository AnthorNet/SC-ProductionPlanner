/* global Intl */

import Worker_Wrapper       from '../Worker/Wrapper.js';
import { prepareGameData, AMPLIFIER_SLOTS } from '../LinearProgram/GameData.js';
import { solveProduction }  from '../LinearProgram/Solver.js';

export default class Solver_Realistic extends Worker_Wrapper
{
    constructor(worker)
    {
        super(worker);

        this.treePath       = new Set();

        // Keep Worker_Wrapper defaults (belt speeds, extraction) and add the Realistic options
        Object.assign(this.options, {
            useManifolds                : 1,
            mergeBuildings              : 1,
            maxLevel                    : null,

            availablePowerShards        : 0,
            availableSomerSloops        : 0,

            allowMinerOverclocking      : true,
            allowPumpOverclocking       : true,
            allowBuildingOverclocking   : true
        });
    }

    // Worker only receive main thread initial options
    initiate(formData)
    {
        this.url.view               = formData.view;

        if(formData.mergeBuildings !== undefined)
        {
            this.url.mergeBuildings     = formData.mergeBuildings;
            this.options.mergeBuildings = parseInt(formData.mergeBuildings);

            if(this.options.mergeBuildings !== 1)
            {
                delete formData.powerShards;
            }
        }

        if(formData.useManifolds !== undefined)
        {
            this.url.useManifolds       = formData.useManifolds;
            this.options.useManifolds   = parseInt(formData.useManifolds);
        }

        if(formData.maxLevel !== undefined)
        {
            this.url.maxLevel           = formData.maxLevel;
            this.options.maxLevel       = parseInt(formData.maxLevel);
        }

        if(formData.maxBeltSpeed !== undefined)
        {
            if(this.options.maxBeltSpeed !== parseInt(formData.maxBeltSpeed))
            {
                this.url.maxBeltSpeed   = formData.maxBeltSpeed;
            }

            this.options.maxBeltSpeed   = parseInt(formData.maxBeltSpeed);
        }

        if(formData.maxPipeSpeed !== undefined)
        {
            if(this.options.maxPipeSpeed !== parseInt(formData.maxPipeSpeed))
            {
                this.url.maxPipeSpeed   = formData.maxPipeSpeed;
            }

            this.options.maxPipeSpeed   = parseInt(formData.maxPipeSpeed);
        }

        this.postMessage({type: 'updateLoaderText', text: 'Applying extration rates...'});

        if(formData.oreExtraction !== undefined)
        {
            let oreOptions = formData.oreExtraction.split(';');
                if(oreOptions.length === 2)
                {
                    this.options.oreType    = oreOptions[0];
                    this.options.oreSpeed   = oreOptions[1];
                }

            if(this.options.oreType !== 'Build_MinerMk2_C' || this.options.oreSpeed !== 'RP_Normal')
            {
                this.url.oreExtraction = this.options.oreType + ';' + this.options.oreSpeed;
            }
        }
        if(formData.oilExtraction !== undefined)
        {
            let oilOptions = formData.oilExtraction.split(';');
                if(oilOptions.length === 2)
                {
                    this.options.oilType    = oilOptions[0];
                    this.options.oilSpeed   = oilOptions[1];
                }

            if(this.options.oilType !== 'Build_OilPump_C' || this.options.oilSpeed !== 'RP_Normal')
            {
                this.url.oilExtraction = this.options.oilType + ';' + this.options.oilSpeed;
            }
        }
        if(formData.waterExtraction !== undefined)
        {
            let waterOptions = formData.waterExtraction.split(';');
                if(waterOptions.length === 2)
                {
                    this.options.waterType  = waterOptions[0];
                    this.options.waterSpeed = waterOptions[1];
                }

            if(this.options.waterType !== 'Build_WaterPump_C' || this.options.waterSpeed !== 'RP_Normal')
            {
                this.url.waterExtraction = this.options.waterType + ';' + this.options.waterSpeed;
            }
        }
        if(formData.gasExtraction !== undefined)
        {
            let gasOptions = formData.gasExtraction.split(';');
                if(gasOptions.length === 2)
                {
                    this.options.gasType    = gasOptions[0];
                    this.options.gasSpeed   = gasOptions[1];
                }

            if(this.options.gasType !== 'Build_FrackingExtractor_C' || this.options.gasSpeed !== 'RP_Normal')
            {
                this.url.gasExtraction = this.options.gasType + ';' + this.options.gasSpeed;
            }
        }

        if(this.options.mergeBuildings === 1 && formData.powerShards !== undefined && formData.powerShards > 0)
        {
            this.options.availablePowerShards           = parseInt(formData.powerShards);
            this.url.powerShards                        = formData.powerShards;

            if(formData.minerOverclocking !== undefined && formData.minerOverclocking !== 1)
            {
                this.options.allowMinerOverclocking     = false;
                this.url.minerOverclocking              = formData.minerOverclocking;
            }
            if(formData.pumpOverclocking !== undefined && formData.pumpOverclocking !== 1)
            {
                this.options.allowPumpOverclocking      = false;
                this.url.pumpOverclocking               = formData.pumpOverclocking;
            }
            if(formData.buildingOverclocking !== undefined && formData.buildingOverclocking !== 1)
            {
                this.options.allowBuildingOverclocking  = false;
                this.url.buildingOverclocking           = formData.buildingOverclocking;
            }
        }

        if(this.options.mergeBuildings === 1 && formData.somerSloops !== undefined && formData.somerSloops > 0)
        {
            this.options.availableSomerSloops          = parseInt(formData.somerSloops);
            this.url.somerSloops                       = formData.somerSloops;
        }

        super.initiate(formData);
    }

    startCalculation()
    {
        super.startCalculation();

        // false: the "Maximize" button only wanted the quantities, the form runs again with them
        if(this.doCalculation() === false)
        {
            return this.postMessage({type: 'done'});
        }

        this.endCalculation();
    }

    doCalculation()
    {
        this.postMessage({type: 'updateLoaderText', text: 'Solving production plan...'});

        const game      = prepareGameData({ buildings: this.buildings, items: this.items, recipes: this.recipes }, { partsCostMultiplier: this.partsCostMultiplier });
        const request   = {
            ...this.solverRequest({
                ore     : { building: this.options.oreType,     purity: this.options.oreSpeed },
                oil     : { building: this.options.oilType,     purity: this.options.oilSpeed },
                water   : { building: this.options.waterType,   purity: this.options.waterSpeed },
                gas     : { building: this.options.gasType,     purity: this.options.gasSpeed }
            }),
            somersloops : this.options.availableSomerSloops,
            maxRates    : { solid: this.options.maxBeltSpeed, fluid: this.options.maxPipeSpeed / 1000 }
        };

        let plan = solveProduction(game, request);

        /*
         * With maxLevel, somersloops only make sense on what is kept: if the plan amplified recipes
         * that sit beyond the limit, solve again allowing only the recipes within it.
         */
        if(plan.status === 'optimal' && this.options.maxLevel !== null && plan.somersloops.used > 0)
        {
            const depths    = this.recipeDepths(plan.flows);
            const kept      = (recipeId) => (depths.get('recipe:' + recipeId) ?? Infinity) <= this.options.maxLevel - 1;

                if(plan.recipes.some(recipe => recipe.somersloops > 0 && kept(recipe.id) === false))
                {
                    plan = solveProduction(game, { ...request, amplifiable: plan.recipes.filter(recipe => kept(recipe.id)).map(recipe => recipe.id) });
                }
        }

        switch(this.sendMaximizedQuantities(plan))
        {
            case 'stop':
                return false;               // The form runs again with the maximized quantities
            case 'retry':
                return this.doCalculation();   // Nothing to maximize: requested quantities as usual
        }
        if(plan.status !== 'optimal')
        {
            this.showNotice(plan.message);
            return;
        }
        if(plan.warnings?.some(warning => warning.type === 'alternates_not_forced'))
        {
            this.showNotice('The selected alternate recipes cannot all be forced: the plan uses the cheapest recipes.');
        }

        const flows = (this.options.maxLevel !== null) ? this.cutAtMaxLevel(plan, plan.flows) : plan.flows;

        this.postMessage({type: 'updateLoaderText', text: 'Generating buildings layout...'});
        this.buildPhysicalGraph(game, plan, flows);

        if(this.options.useManifolds === 1)
        {
            this.buildManifolds();
        }

        // Remove empty arrays ;)
        this.graphNodes = this.graphNodes.filter(function(element){ return element !== undefined; });
        this.graphEdges = this.graphEdges.filter(function(element){ return element !== undefined; });
    }

    /*
     * Production steps away from the requested items (shortest path over the plan's flows)
     */
    recipeDepths(flows)
    {
        const byTarget = new Map();
            for(const edge of flows.edges)
            {
                if(byTarget.has(edge.target) === false){ byTarget.set(edge.target, []); }
                byTarget.get(edge.target).push(edge);
            }

        const depth = new Map();
        const queue = flows.nodes.filter(node => node.type === 'output').map(node => node.id);
            queue.forEach(id => depth.set(id, 0));

            while(queue.length > 0)
            {
                const id = queue.shift();

                for(const edge of byTarget.get(id) ?? [])
                {
                    if(edge.source.startsWith('recipe:') && depth.has(edge.source) === false)
                    {
                        depth.set(edge.source, depth.get(id) + 1);
                        queue.push(edge.source);
                    }
                }
            }

        return depth;
    }

    /*
     * maxLevel, with the same meaning as the legacy tree: a production step is cut when it sits
     * maxLevel levels away from a requested item *along the path that needs it*. Demand is pushed
     * from the requested items level by level over the plan's flows; by-products already made are
     * used before running a machine further. What lies beyond the limit becomes a "last node"
     * item, while raw resources keep their extractors.
     *
     * When a recipe is only partly kept, its amplified machines (somersloops) run first: they make
     * more for the same inputs, so the demand pushed upstream follows that split.
     */
    cutAtMaxLevel(plan, flows)
    {
        const keptLevels = this.options.maxLevel - 1;
            if(keptLevels < 1)
            {
                return flows;
            }

        const EPSILON   = 1e-9;
        const isRecipe  = (id) => id.startsWith('recipe:');

        /*
         * Each recipe as two parts, amplified then base. `share` u goes from 0 to 1 over the plan's
         * activity: the amplified part covers [0, α], the base part [α, 1], α being the amplified
         * share of the outputs. net(u) gives the net items made (> 0) or used (< 0) up to u.
         */
        const parts     = new Map(), incoming = new Map();
            for(const recipe of plan.recipes)
            {
                const amplifiedMachines = recipe.amplified.reduce((total, a) => total + a.machines, 0);
                const amplifiedOutput   = recipe.amplified.reduce((total, a) => total + a.machines * a.factor, 0);
                const baseMachines      = Math.max(0, recipe.machines - amplifiedMachines);
                const totalOutput       = baseMachines + amplifiedOutput;

                const ratesIn   = new Map(recipe.inputs.map(({ item, qty }) => [item, qty / recipe.machines]));
                const ratesOut  = new Map(recipe.outputs.map(({ item, qty }) => [item, qty / totalOutput]));
                const net       = (machines, output) => {
                    const values = new Map();
                        ratesOut.forEach((rate, item) => values.set(item, (values.get(item) ?? 0) + rate * output));
                        ratesIn.forEach((rate, item) => values.set(item, (values.get(item) ?? 0) - rate * machines));
                    return values;
                };

                parts.set('recipe:' + recipe.id, {
                    alpha       : totalOutput > 0 ? amplifiedOutput / totalOutput : 0,
                    amplified   : net(amplifiedMachines, amplifiedOutput),
                    base        : net(baseMachines, baseMachines)
                });
            }
            for(const edge of flows.edges)
            {
                const key = edge.target + '|' + edge.item;
                    if(incoming.has(key) === false){ incoming.set(key, []); }
                    incoming.get(key).push(edge);
            }

        // Net quantity of `item` up to share u (beyond 1 the last part keeps its rate, loops may ask for it)
        const netAt = (part, item, u) => {
            const a = part.amplified.get(item) ?? 0, b = part.base.get(item) ?? 0;

                if(part.alpha >= 1 - EPSILON){ return a * u; }
                if(part.alpha <= EPSILON){ return b * u; }
                if(u <= part.alpha){ return a * u / part.alpha; }

            return a + b * (u - part.alpha) / (1 - part.alpha);
        };

        // Smallest share making `target` of `item` (net production grows with u)
        const shareFor = (part, item, target) => {
            let low = 0, high = 1;
                while(netAt(part, item, high) < target - EPSILON){ high *= 2; }

            for(let i = 0; i < 60; i++)
            {
                const mid = (low + high) / 2;
                    if(netAt(part, item, mid) >= target){ high = mid; }else{ low = mid; }
            }

            return high;
        };

        const share     = new Map();   // recipe → kept share u
        const delivered = new Map();   // recipe|item → already promised
        const edges     = new Map();
        const queue     = [];

        const addEdge = (source, target, item, qty) => {
            const key = source + '>' + target + '#' + item;
                if(edges.has(key) === false){ edges.set(key, { id: key, source, target, item, qty: 0 }); }
                edges.get(key).qty += qty;
        };

        // `source` must deliver `qty` of `item` to `target`, standing `level` steps from the outputs
        const demand = (source, target, item, qty, level) => {
            if(isRecipe(source) === false)
            {
                addEdge(source, target, item, qty);     // extraction, provided input, missing item
                return;
            }
            if(level > keptLevels)
            {
                addEdge('lastNode:' + item, target, item, qty);
                return;
            }

            const part      = parts.get(source);
            const current   = share.get(source) ?? 0;
            const promised  = (delivered.get(source + '|' + item) ?? 0) + qty;

                if(netAt(part, item, current) < promised - EPSILON)
                {
                    const next = shareFor(part, item, promised);

                    share.set(source, next);
                    queue.push({ recipe: source, from: current, to: next, level });
                }

            delivered.set(source + '|' + item, promised);
            addEdge(source, target, item, qty);
        };

        for(const edge of flows.edges)
        {
            if(edge.target.startsWith('output:'))
            {
                demand(edge.source, edge.target, edge.item, edge.qty, 1);
            }
        }

        while(queue.length > 0)
        {
            const { recipe, from, to, level } = queue.shift();
            const part = parts.get(recipe);

            for(const item of new Set([...part.amplified.keys(), ...part.base.keys()]))
            {
                const needed = netAt(part, item, from) - netAt(part, item, to);    // consumption grows: net goes down
                    if(needed <= EPSILON){ continue; }

                const sources   = incoming.get(recipe + '|' + item) ?? [];
                const supplied  = sources.reduce((sum, edge) => sum + edge.qty, 0);

                for(const edge of sources)
                {
                    demand(edge.source, recipe, item, needed * edge.qty / supplied, level + 1);
                }
            }
        }

        // By-products made but not needed by the kept part of the tree are left over
        for(const [recipe, kept] of share)
        {
            const part = parts.get(recipe);

            for(const item of new Set([...part.amplified.keys(), ...part.base.keys()]))
            {
                const excess = netAt(part, item, kept) - (delivered.get(recipe + '|' + item) ?? 0);
                    if(excess > EPSILON){ addEdge(recipe, 'surplus:' + item, item, excess); }
            }
        }

        // Rebuild the nodes: recipes with the share kept of each part, endpoints sized by their edges
        const nodes     = [];
        const endpoints = new Map();
            for(const node of flows.nodes)
            {
                if(node.type === 'recipe' && share.has(node.id))
                {
                    const { alpha } = parts.get(node.id);
                    const u         = share.get(node.id);

                    nodes.push({
                        ...node,
                        amplifiedShare  : (alpha <= EPSILON) ? 0 : ((alpha >= 1 - EPSILON) ? u : Math.min(u, alpha) / alpha),
                        baseShare       : (alpha >= 1 - EPSILON) ? 0 : ((alpha <= EPSILON) ? u : Math.max(0, u - alpha) / (1 - alpha))
                    });
                }
            }
            for(const edge of edges.values())
            {
                for(const id of [edge.source, edge.target])
                {
                    if(isRecipe(id) || endpoints.has(id)){ continue; }

                    const [type, ...rest] = id.split(':');
                        endpoints.set(id, { id, type, item: rest.join(':'), qty: 0 });
                }

                if(endpoints.has(edge.source)){ endpoints.get(edge.source).qty += edge.qty; }
                if(endpoints.has(edge.target)){ endpoints.get(edge.target).qty += edge.qty; }
            }

        return { nodes: [...nodes, ...endpoints.values()], edges: [...edges.values()] };
    }

    /*
     * Turns the plan into physical buildings: each recipe runs on full machines plus one partial,
     * capped so no input or output exceeds a belt / pipe. Amplified machines (somersloops) chosen by
     * the LP become buildings holding their somersloops; power shards are then spent where they
     * remove the most buildings. Requested items and inputs are split per belt like before, and
     * machines are wired following the plan's flows.
     */
    buildPhysicalGraph(game, plan, flows)
    {
        const EPSILON   = 1e-6;
        const isFluid   = (itemId) => game.items[itemId]?.fluid === true;
        const internal  = (itemId, qty) => isFluid(itemId) ? qty * 1000 : qty;
        const beltMax   = (itemId) => isFluid(itemId) ? this.options.maxPipeSpeed : this.options.maxBeltSpeed;

        const recipes   = new Map(plan.recipes.map(recipe => [recipe.id, recipe]));
        const resources = new Map(plan.resources.map(resource => [resource.item, resource]));
        const physical  = new Map();   // flow node id → [{ id, out: Map, in: Map }]

        const addPhysical = (flowId, unit) => {
            if(physical.has(flowId) === false){ physical.set(flowId, []); }
            physical.get(flowId).push(unit);
        };

        // Split a quantity into machines running at `cap` (fraction of 100%), the last one partial
        const machineClocks = (machines, cap) => {
            if(machines <= EPSILON){ return []; }

            const count     = Math.max(1, Math.ceil(machines / cap - EPSILON));
            const clocks    = new Array(count).fill(cap);
                clocks[count - 1] = machines - cap * (count - 1);

            return clocks.filter(clock => clock > EPSILON);
        };

        // Split a quantity per belt, like the legacy requested items / inputs
        const beltChunks = (itemId, qty) => {
            const chunks = [];
                while(qty >= beltMax(itemId) - EPSILON)
                {
                    chunks.push(beltMax(itemId));
                    qty -= beltMax(itemId);
                }
                if(qty > EPSILON){ chunks.push(qty); }

            return chunks;
        };

        // Net internal rates for one machine at 100% (an item both used and made counts once)
        const netRates = (data, factor) => {
            const net = new Map();
                data.products.forEach(({ item, rate }) => net.set(item, (net.get(item) ?? 0) + internal(item, rate) * factor));
                data.ingredients.forEach(({ item, rate }) => net.set(item, (net.get(item) ?? 0) - internal(item, rate)));

            return net;
        };

        // Highest clock (1 = 100%) before one input or output of a single machine exceeds a belt / pipe
        const beltClock = (net) => {
            let clock = Infinity;
                for(const [itemId, rate] of net)
                {
                    if(rate !== 0){ clock = Math.min(clock, beltMax(itemId) / Math.abs(rate)); }
                }

            return clock;
        };

        const pushBuilding = (flowId, group, clock, net, extra = {}) => {
            const id = group.building + '_' + (this.nodeIdKey++);
            const data = {
                id                  : id,
                nodeType            : 'productionBuilding',
                buildingType        : group.building,
                recipe              : group.recipeId,
                itemOut             : group.itemOut,
                qtyProducedDefault  : group.rateOut,
                qtyUsed             : group.rateOut * clock,
                clockSpeed          : extra.clockSpeed ?? 100,
                image               : this.buildings[group.building].image
            };

                if(extra.somersloops !== undefined)
                {
                    data.isProductionBoosted    = extra.somersloops;
                }

            this.graphNodes.push({ data });

            const unit = { id, out: new Map(), in: new Map() };
                for(const [itemId, rate] of net)
                {
                    if(rate > 0){ unit.out.set(itemId, rate * clock); }
                    if(rate < 0){ unit.in.set(itemId, -rate * clock); }
                }

            addPhysical(flowId, unit);
        };

        const pushItem = (flowId, nodeType, itemId, qty, side) => {
            const id    = itemId + '_' + (this.nodeIdKey++) + ((nodeType === 'byProductItem') ? '_byProduct' : '');
            const data  = { id, nodeType, itemId, image: this.items[itemId].image };

                if(nodeType === 'mainNode')
                {
                    data.qty        = qty;
                }
                else
                {
                    data.neededQty  = qty;
                }

            this.graphNodes.push({ data });
            addPhysical(flowId, { id, out: new Map(side === 'out' ? [[itemId, qty]] : []), in: new Map(side === 'in' ? [[itemId, qty]] : []) });
        };

        // 1) Collect machine groups (recipes and extractors), place item nodes
        const groups = [];
            for(const node of flows.nodes)
            {
                switch(node.type)
                {
                    case 'recipe':
                    {
                        const recipe    = recipes.get(node.recipe);
                        const data      = game.recipes[recipe.id];
                        const mainOut   = data.products[0];
                        const net       = netRates(data, 1);

                        // maxLevel may keep only part of a recipe: amplified machines first, then base ones
                        const amplified = recipe.amplified.map(a => ({ ...a, machines: a.machines * (node.amplifiedShare ?? 1) }));
                        const base      = Math.max(0, recipe.machines - recipe.amplified.reduce((total, a) => total + a.machines, 0)) * (node.baseShare ?? 1);

                        groups.push({
                            flowId      : node.id,
                            building    : recipe.building,
                            recipeId    : recipe.id,
                            itemOut     : mainOut.item,
                            rateOut     : internal(mainOut.item, mainOut.rate),
                            net,
                            data,
                            clockLimit  : beltClock(net),
                            machines    : base,
                            amplified,
                            extractor   : false
                        });
                        break;
                    }

                    case 'resource':
                    {
                        const resource  = resources.get(node.item);
                        const rate      = (resource?.machines > 0) ? internal(node.item, resource.qty / resource.machines) : null;
                        const qty       = internal(node.item, node.qty);

                        if(rate === null || this.buildings[resource.building] === undefined)
                        {
                            pushItem(node.id, 'lastNodeItem', node.item, qty, 'out');
                            break;
                        }

                        groups.push({
                            flowId      : node.id,
                            building    : resource.building,
                            recipeId    : game.resources[node.item].recipes[0],
                            itemOut     : node.item,
                            rateOut     : rate,
                            net         : new Map([[node.item, rate]]),
                            clockLimit  : beltMax(node.item) / rate,
                            machines    : qty / rate,
                            amplified   : [],
                            extractor   : true
                        });
                        break;
                    }

                    case 'output':
                        beltChunks(node.item, internal(node.item, node.qty)).forEach(qty => pushItem(node.id, 'mainNode', node.item, qty, 'in'));
                        break;

                    case 'input':
                        beltChunks(node.item, internal(node.item, node.qty)).forEach(qty => pushItem(node.id, 'byProductItem', node.item, qty, 'out'));
                        break;

                    case 'surplus':
                        pushItem(node.id, 'byProductItem', node.item, internal(node.item, node.qty), 'in');
                        break;

                    case 'missing':
                    case 'lastNode':
                        pushItem(node.id, 'lastNodeItem', node.item, internal(node.item, node.qty), 'out');
                        break;
                }
            }

        // 2) Power shards
        this.allocatePowerShards(groups);

        // 3) Buildings
        for(const group of groups)
        {
            // Amplified machines hold their somersloops; the solver kept their boosted rates within belts
            for(const amplified of group.amplified)
            {
                const net = netRates(group.data, amplified.factor);

                for(const clock of machineClocks(amplified.machines, 1))
                {
                    pushBuilding(group.flowId, group, clock, net, { somersloops: amplified.somersloops });
                }
            }

            for(const { clock, shards } of this.machineClocksWithShards(group, machineClocks))
            {
                pushBuilding(group.flowId, group, clock, group.net, { clockSpeed: 100 + 50 * shards });
            }
        }

        /*
         * Wire machines item by item (north-west corner, deterministic): producers and consumers
         * are walked in order, so each machine feeds a contiguous run of consumers. This gives at
         * most (producers + consumers - 1) belts per item and keeps splitters / mergers low.
         */
        const producers = new Map(), consumers = new Map();
        const enlist    = (map, itemId, unit) => {
            if(map.has(itemId) === false){ map.set(itemId, []); }
            if(map.get(itemId).includes(unit) === false){ map.get(itemId).push(unit); }
        };

            // Only units that take part in a flow of the plan (maxLevel may have cut some)
            for(const flow of flows.edges)
            {
                (physical.get(flow.source) ?? []).forEach(unit => enlist(producers, flow.item, unit));
                (physical.get(flow.target) ?? []).forEach(unit => enlist(consumers, flow.item, unit));
            }

        const edges = new Map();
            for(const [itemId, sources] of producers)
            {
                const targets   = consumers.get(itemId) ?? [];
                let i = 0, j = 0;

                while(i < sources.length && j < targets.length)
                {
                    const available = sources[i].out.get(itemId) ?? 0;
                        if(available <= EPSILON){ i++; continue; }
                    const needed    = targets[j].in.get(itemId) ?? 0;
                        if(needed <= EPSILON){ j++; continue; }

                    const moved     = Math.min(available, needed);
                    const key       = sources[i].id + '_' + targets[j].id + '_' + itemId;

                        if(edges.has(key) === false)
                        {
                            edges.set(key, { id: key, source: sources[i].id, target: targets[j].id, itemId: itemId, qty: 0 });
                        }
                        edges.get(key).qty += moved;

                    sources[i].out.set(itemId, available - moved);
                    targets[j].in.set(itemId, needed - moved);
                }
            }

        for(const edge of edges.values())
        {
            this.graphEdges.push({ data: edge });
        }
    }

    /*
     * Power shards: each one adds 50% clock to a machine, up to 250% and never beyond a belt / pipe.
     * Shards go, one building at a time, where removing a building costs the fewest shards
     * (extraction first on ties, like the legacy merge pass), within the overclocking options.
     */
    allocatePowerShards(groups)
    {
        const EPSILON   = 1e-6;
        let available   = this.options.availablePowerShards;

        for(const group of groups)
        {
            const cap       = Math.min(1, group.clockLimit);

            group.count     = (group.machines > EPSILON) ? Math.ceil(group.machines / cap - EPSILON) : 0;
            group.shards    = 0;
            group.maxClock  = Math.min(2.5, group.clockLimit);
            group.overclock = group.machines > EPSILON && group.maxClock > 1 + EPSILON && this.canOverclock(group.building);
        }

        while(available > 0)
        {
            let best = null;
                for(const group of groups)
                {
                    if(group.overclock === false || group.count <= 1){ continue; }

                    const shards    = this.shardsNeeded(group.machines, group.count - 1, group.maxClock);
                    const cost      = shards - group.shards;

                    if(Number.isFinite(shards) && cost <= available
                        && (best === null || cost < best.cost || (cost === best.cost && group.extractor && best.group.extractor === false)))
                    {
                        best = { group, shards, cost };
                    }
                }

            if(best === null){ break; }

            available          -= best.cost;
            best.group.shards   = best.shards;
            best.group.count--;
        }
    }

    canOverclock(buildingId)
    {
        if(buildingId.startsWith('Build_MinerMk')){ return this.options.allowMinerOverclocking === true; }
        if(buildingId.startsWith('Build_OilPump')){ return this.options.allowPumpOverclocking === true; }

        return this.options.allowBuildingOverclocking === true;
    }

    /*
     * Fewest shards to run `machines` (in 100% units) on `count` buildings clocked up to `maxClock`:
     * whole 50% steps first, then the last partial step each building may still take below its cap.
     */
    shardsNeeded(machines, count, maxClock)
    {
        const EPSILON   = 1e-6;
        const extra     = machines - count;

            if(count * maxClock < machines - EPSILON){ return Infinity; }
            if(extra <= EPSILON){ return 0; }

        const steps     = Math.floor((maxClock - 1) / 0.5 + EPSILON);
        const partial   = (maxClock - 1) - 0.5 * steps;

            if(extra <= 0.5 * steps * count + EPSILON)
            {
                return Math.ceil(extra / 0.5 - EPSILON);
            }

        return steps * count + Math.ceil((extra - 0.5 * steps * count) / partial - EPSILON);
    }

    /*
     * Clocks of a group's (non amplified) buildings: without shards, full machines plus one partial;
     * with shards, buildings are overclocked one after the other, the last one only as needed.
     */
    machineClocksWithShards(group, machineClocks)
    {
        const EPSILON = 1e-6;

            if(group.shards === 0)
            {
                return machineClocks(group.machines, Math.min(1, group.clockLimit)).map(clock => ({ clock, shards: 0 }));
            }

        const clocks    = new Array(group.count).fill(1);
        const shards    = new Array(group.count).fill(0);
        const steps     = Math.floor((group.maxClock - 1) / 0.5 + EPSILON);
        const partial   = (group.maxClock - 1) - 0.5 * steps;
        let extra       = group.machines - group.count;
        let last        = 0;

            // Whole 50% steps first, then partial steps, as counted by shardsNeeded()
            for(const [limit, step] of [[steps, 0.5], [steps + 1, partial]])
            {
                for(let i = 0; i < group.count && extra > EPSILON && step > EPSILON; i++)
                {
                    while(extra > EPSILON && shards[i] < limit)
                    {
                        clocks[i]  += step;
                        shards[i]++;
                        extra      -= step;
                        last        = i;
                    }
                }
            }

        // The last overclocked building only runs as fast as needed
        clocks[last] += extra;

        return clocks.map((clock, i) => ({ clock, shards: shards[i] }));
    }

    buildManifolds()
    {
        this.postMessage({type: 'updateLoaderText', text: 'Building manifolds...'});

        // Add merger
        let mergers     = [];
        let mergerKey   = 0;

        for(let i = this.graphEdges.length - 1; i >= 0 ; i--)
        {
            if(this.graphEdges[i] === undefined)
            {
                continue;
            }

            let parentEdge      = this.graphEdges[i];
            let currentMerger   = [];
            let mergerQty       = 0;
            let maxMergedQty    = this.options.maxBeltSpeed;

                if(this.items[parentEdge.data.itemId].category === 'liquid' || this.items[parentEdge.data.itemId].category === 'gas')
                {
                    maxMergedQty = this.options.maxPipeSpeed;
                }

            for(let j = this.graphEdges.length - 1; j >= 0 ; j--)
            {
                if(this.graphEdges[j] === undefined)
                {
                    continue;
                }

                if(parentEdge.data.id !== this.graphEdges[j].data.id) // Not yet tested...
                {
                    if(parentEdge.data.itemId === this.graphEdges[j].data.itemId && parentEdge.data.target === this.graphEdges[j].data.target)
                    {
                        if((mergerQty + this.graphEdges[j].data.qty) <= maxMergedQty)
                        {
                            if(this.graphEdges[j].data.qty >= 0.1)
                            {
                                mergerQty += this.graphEdges[j].data.qty;
                                currentMerger.push(this.graphEdges[j]);
                            }

                            delete this.graphEdges[j];
                        }
                    }
                }
            }

            if(currentMerger.length > 0)
            {
                if(parentEdge.data.qty >= 0.1)
                {
                    mergerQty += parentEdge.data.qty;
                    currentMerger.push(parentEdge);

                    mergers.push({
                        origin: parentEdge,
                        mergerSources: currentMerger,
                        mergerQty: mergerQty
                    });
                }

                delete this.graphEdges[i];
            }
        }

        if(mergers.length > 0)
        {
            for(let i = 0; i < mergers.length; i++)
            {
                mergerKey++;

                let currentMergerTarget         = mergers[i].origin.data.target;
                let currentMergerId             = 'merger_' + mergerKey;
                let currentMergerTargetQty      = mergers[i].mergerQty;

                for(let k = 0; k < mergers[i].mergerSources.length; k++)
                {
                    if(k % 2 === 0)
                    {
                        if((k + 1) < mergers[i].mergerSources.length) // Prevent solo merger ^^
                        {
                            if(k > 0)
                            {
                                mergerKey++;
                                currentMergerTarget         = currentMergerId;
                                currentMergerId             = 'merger_' + mergerKey;
                            }

                            this.graphNodes.push({data: {
                                id          : currentMergerId,
                                nodeType    : 'merger',
                                itemId      : mergers[i].origin.data.itemId
                            }});

                            this.graphEdges.push({data: {
                                id                  : 'merger_' + mergerKey + '_' + currentMergerTarget,
                                source              : currentMergerId,
                                target              : currentMergerTarget,
                                itemId              : mergers[i].origin.data.itemId,
                                qty                 : currentMergerTargetQty
                            }});
                        }
                    }

                    this.graphEdges.push({data: {
                        id                  : mergers[i].mergerSources[k].data.source + '_' + currentMergerId,
                        source              : mergers[i].mergerSources[k].data.source,
                        target              : currentMergerId,
                        itemId              : mergers[i].mergerSources[k].data.itemId,
                        qty                 : mergers[i].mergerSources[k].data.qty
                    }});

                    currentMergerTargetQty -= mergers[i].mergerSources[k].data.qty;
                }
            }
        }

        // Add splitter
        let splitters   = [];
        let splitterKey = 0;
        for(let i = 0; i < this.graphEdges.length; i++)
        {
            let currentSplitter   = [];
            let splitterQty       = 0;

            for(let j = 0; j < this.graphEdges.length; j++)
            {
                if(i !== j && this.graphEdges[i] !== undefined && this.graphEdges[j] !== undefined) // Not yet tested...
                {
                    if(this.graphEdges[i].data.itemId === this.graphEdges[j].data.itemId && this.graphEdges[i].data.source === this.graphEdges[j].data.source)
                    {
                        if(this.graphEdges[j].data.qty >= 0.1)
                        {
                            splitterQty += this.graphEdges[j].data.qty;
                            currentSplitter.push(this.graphEdges[j]);
                        }
                        delete this.graphEdges[j];
                    }
                }
            }

            if(currentSplitter.length > 0)
            {
                if(this.graphEdges[i].data.qty >= 0.1)
                {
                    splitterQty += this.graphEdges[i].data.qty;
                    currentSplitter.push(this.graphEdges[i]);

                    splitters.push({
                        origin: this.graphEdges[i],
                        splitterTargets: currentSplitter,
                        splitterQty: splitterQty
                    });
                }

                delete this.graphEdges[i];
            }
        }

        if(splitters.length > 0)
        {
            for(let i = 0; i < splitters.length; i++)
            {
                splitterKey++;

                let currentSplitterSource       = splitters[i].origin.data.source;
                let currentSplitterId           = 'splitter_' + splitterKey;
                let currentSplitterSourceQty    = splitters[i].splitterQty;

                for(let k = 0; k < splitters[i].splitterTargets.length; k++)
                {
                    if(k % 2 === 0 && k < (splitters[i].splitterTargets.length - 1))
                    {
                        if(k > 0)
                        {
                            splitterKey++;
                            currentSplitterSource       = currentSplitterId;
                            currentSplitterId           = 'splitter_' + splitterKey;
                        }

                        this.graphNodes.push({data: {
                            id          : currentSplitterId,
                            nodeType    : 'splitter',
                            itemId      : splitters[i].origin.data.itemId
                        }});

                        this.graphEdges.push({data: {
                            id                  : currentSplitterSource + '_splitter_' + splitterKey,
                            source              : currentSplitterSource,
                            target              : currentSplitterId,
                            itemId              : splitters[i].origin.data.itemId,
                            qty                 : currentSplitterSourceQty
                        }});
                    }

                    this.graphEdges.push({data: {
                        id                  : currentSplitterId + '_' + splitters[i].splitterTargets[k].data.target,
                        source              : currentSplitterId,
                        target              : splitters[i].splitterTargets[k].data.target,
                        itemId              : splitters[i].splitterTargets[k].data.itemId,
                        qty                 : splitters[i].splitterTargets[k].data.qty
                    }});

                    currentSplitterSourceQty -= splitters[i].splitterTargets[k].data.qty;
                }
            }
        }
    }



    addLabels()
    {
        super.addLabels();

        let frackingExtractors = {};

        for(let i = 0; i < this.graphNodes.length; i++)
        {
            let nodeData = this.graphNodes[i].data;
                if(nodeData.nodeType === 'productionBuilding')
                {
                    let performance                     = (nodeData.qtyUsed / nodeData.qtyProducedDefault * 100);

                        this.graphNodes[i].data.label   = this.buildings[nodeData.buildingType].name
                                                        + ' (' + new Intl.NumberFormat(this.language).format(Math.round(performance)) + '%)'
                                                        + '\n' + '(' + this.recipes[this.graphNodes[i].data.recipe].name + ')';

                        if(this.graphNodes[i].data.clockSpeed > 100)
                        {
                            this.graphNodes[i].data.label  += '\n(' + Math.round((this.graphNodes[i].data.clockSpeed - 100) / 50) + ' power shards)';
                            this.graphNodes[i].data.borderWidth = Math.round((this.graphNodes[i].data.clockSpeed - 100) / 50) * 15 + 15 + 'px';
                        }

                    if(this.listBuildings[nodeData.buildingType] === undefined)
                    {
                        this.listBuildings[nodeData.buildingType] = 0;
                    }
                    this.listBuildings[nodeData.buildingType]++;

                    if(nodeData.isProductionBoosted !== undefined)
                    {
                        this.graphNodes[i].data.label           += '\n(x' + nodeData.isProductionBoosted + ' somersloop)';
                        this.graphNodes[i].data.font             = { color: 'rgb(166, 113, 166)' }; //"#a671a6";
                        this.graphNodes[i].data.backgroundColor  = 'rgb(166, 113, 166)';
                    }

                    // Calculate required power!
                        // Fracking extractor
                        if(nodeData.buildingType === 'Build_FrackingExtractor_C')
                        {
                            // Wait to have total building to do an average calculation based on used recipe...
                            if(frackingExtractors[nodeData.recipe] === undefined)
                            {
                                frackingExtractors[nodeData.recipe] = 0;
                            }
                            frackingExtractors[nodeData.recipe]++;
                        }
                        else
                        {
                            // Production amplification multiplies power by (1 + somersloops / slots)²
                            let amplification = 1;
                                if(nodeData.isProductionBoosted !== undefined && AMPLIFIER_SLOTS[nodeData.buildingType] > 0)
                                {
                                    amplification = Math.pow(1 + nodeData.isProductionBoosted / AMPLIFIER_SLOTS[nodeData.buildingType], 2);
                                }

                            this.requiredPower     += this.buildingPower(nodeData.buildingType, nodeData.recipe) * Math.pow(performance / 100, 1.321929) * amplification; // Update 7
                        }
                }
        }

        for(let recipeId in frackingExtractors)
        {
            this.requiredPower += Math.ceil(frackingExtractors[recipeId] / 6) * this.buildings.Build_FrackingSmasher_C.powerUsed;
        }
    }

    /*
     * The LP graph can contain loops (Recycled Rubber <-> Recycled Plastic): stop the recursion
     * when a node is already on the current branch. Shared nodes still show under each parent.
     */
    buildHierarchyTree(parentId)
    {
        if(this.treePath.has(parentId)){ return ''; }

        this.treePath.add(parentId);
        const html = super.buildHierarchyTree(parentId);
        this.treePath.delete(parentId);

        return html;
    }
}