/*
 * Production planner as a linear program.
 *
 *  Variables (all >= 0, per minute):
 *      x_r   machines-equivalent running recipe r at 100% clock (fractional)
 *      s_i   raw resource i extracted from the map
 *      u_i   provided input i used (bounded by what the player provides)
 *      e_i   surplus of item i left over (by-products, overflow)
 *      d_i   deficit of item i: what no enabled recipe can produce (should be 0)
 *      λ     scale of the requested ratios, only in "maximise" mode
 *      y_rk  machines running recipe r with k somersloops (outputs x(1 + k/slots), power x(1 + k/slots)²)
 *
 *  For every item i:
 *      Σ_r rate_ir · x_r  +  s_i  +  u_i  +  d_i  −  e_i  =  target_i      (or ratio_i · λ)
 *
 *  Objectives are solved lexicographically, deficits first, so an impossible request still
 *  returns a usable plan along with the list of missing items.
 */
import { LinearProgram, solveLexicographic }       from './Simplex.js';
import { extractionRateFor }                        from './GameData.js';
import { buildFlows }                               from './Flows.js';

const ZERO = 1e-9;

/*
 * Default availability used to weight raw resources (per minute, fluids in m³): the rarer a
 * resource, the more it costs. Approximate 1.0 world totals at max extraction; replace them with
 * values computed from the map data when available.
 */
export const DEFAULT_RESOURCE_LIMITS = {
    Desc_OreIron_C      : 92100,
    Desc_Stone_C        : 69900,
    Desc_Coal_C         : 42300,
    Desc_OreCopper_C    : 36900,
    Desc_OreGold_C      : 15000,
    Desc_RawQuartz_C    : 13500,
    Desc_LiquidOil_C    : 12600,
    Desc_OreBauxite_C   : 12300,
    Desc_NitrogenGas_C  : 12000,
    Desc_Sulfur_C       : 10800,
    Desc_SAM_C          : 10200,
    Desc_OreUranium_C   : 2100
};

export const DEFAULT_EXTRACTION = {
    ore     : { building: 'Build_MinerMk2_C',           purity: 'RP_Normal' },
    oil     : { building: 'Build_OilPump_C',            purity: 'RP_Normal' },
    water   : { building: 'Build_WaterPump_C',          purity: 'RP_Normal' },
    gas     : { building: 'Build_FrackingExtractor_C',  purity: 'RP_Normal' }
};

export const OBJECTIVES = ['resources', 'power', 'buildings', 'sink'];

/**
 * @param {ReturnType<import('./GameData.js').prepareGameData>} game
 * @param {object}  request
 * @param {Object<string, number>}  [request.targets]       itemId → qty/min (fluids in m³)
 * @param {Object<string, number>}  [request.maximize]      itemId → ratio; maximises the output scale instead of fixed targets
 * @param {Object<string, number>}  [request.inputs]        itemId → qty/min available for free
 * @param {boolean}                 [request.capInputs]     the inputs are the only source of those items (maximize from inputs):
 *                                                          no extraction, no recipe whose main product they are
 * @param {object}                  [request.recipes]       { alternates: [], conversions: [], exclude: [], allowAll: false, forceOutputs: true }
 *                                                          forceOutputs: an alternate chosen for a requested item is the recipe
 *                                                          making it (the other recipes whose main product it is are left out)
 * @param {object}                  [request.extraction]    { ore|oil|water|gas: { building, purity } }
 * @param {Object<string, number>}  [request.resourceLimits]  itemId → max qty/min extracted (Infinity allowed)
 * @param {Object<string, number>}  [request.resourceWeights] itemId → cost per unit, overrides the defaults
 * @param {string[]}                [request.objectives]    ordered subset of OBJECTIVES, default ['resources', 'buildings']
 * @param {number}                  [request.somersloops]   somersloops available for production amplification
 * @param {string[]}                [request.amplifiable]   restricts somersloops to these recipes (all by default)
 * @param {object}                  [request.maxRates]      { solid, fluid } max per-machine input/output (belt / pipe, fluids in m³):
 *                                                          amplified machines whose boosted output would exceed it are not offered
 */
export function solveProduction(game, request = {})
{
    const options   = normaliseRequest(game, request);
    let model       = buildModel(game, options);
    let solution    = solveLexicographic(model.lp, model.objectives.map(o => o.terms));

    /*
     * Somersloops are whole items sitting in whole machines: a machine holding k of them uses
     * them whatever its clock, so what must be whole is the number of amplified machines. The LP
     * relaxation places them freely; a greedy rounding gives a first valid plan, then a small
     * branch and bound on the number of amplified machines looks for a better one.
     */
    if(solution.status === 'optimal' && model.vars.amplified.size > 0)
    {
        let best = roundAmplification(game, options, { model, solution });
            best = branchAndBoundAmplification(game, options, best);

        ({ model, solution }      = best);
        options.amplification     = best.amplification;
    }

    if(solution.status !== 'optimal')
    {
        return {
            status      : solution.status,
            message     : statusMessage(solution, model),
            warnings    : options.warnings,
            iterations  : solution.iterations
        };
    }

    return readSolution(game, options, model, solution);
}



function roundAmplification(game, options, relaxed)
{
    const kept      = new Map();    // recipe|used → whole amplified machines
    let remaining   = options.somersloops;
    let { model, solution } = relaxed;

    for(let round = 0; round < 4 && remaining > 0 && solution.status === 'optimal'; round++)
    {
        const candidates = [];
            for(const [key, { used, slots, variable }] of model.vars.amplified)
            {
                const machines = solution.values[variable];
                    if(kept.has(key) || machines <= 1e-6){ continue; }

                const whole = Math.ceil(machines - 1e-6);
                    candidates.push({ key, used, whole, machines, usage: machines / whole, contribution: machines * used / slots });
            }

        if(candidates.length === 0){ break; }

        // Best used machines first (least wasted somersloops), then the biggest contributions
        candidates.sort((a, b) => (b.usage - a.usage) || (b.contribution - a.contribution));

        for(const candidate of candidates)
        {
            // As many whole machines as the remaining stock allows
            const affordable = Math.min(candidate.whole, Math.floor(remaining / candidate.used));
                if(affordable > 0)
                {
                    kept.set(candidate.key, affordable);
                    remaining -= affordable * candidate.used;
                }
        }

        options.amplification   = { kept, freeBudget: remaining };
        model                   = buildModel(game, options);
        solution                = solveLexicographic(model.lp, model.objectives.map(o => o.terms));
    }

    // Final plan: only the kept amplified machines
    const amplification     = { kept, freeBudget: 0 };
        options.amplification   = amplification;
        model                   = buildModel(game, options);
        solution                = solveLexicographic(model.lp, model.objectives.map(o => o.terms));

    return { model, solution, amplification };
}

// Lexicographic comparison of two solutions of the same objective list
function isBetter(candidate, reference)
{
    for(let i = 0; i < candidate.objectiveValues.length; i++)
    {
        const a = candidate.objectiveValues[i], b = reference.objectiveValues[i];
        const tolerance = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

        if(a < b - tolerance){ return true; }
        if(a > b + tolerance){ return false; }
    }

    return false;
}

const BRANCH_AND_BOUND_NODES = 40;
const BRANCH_AND_BOUND_MS    = 400;     // the best plan found so far is kept when time is up

/*
 * Branch and bound on whole amplified machines w (y <= w, Σ used·w <= stock). Each node is the LP
 * with some w bounded; nodes that cannot beat the best plan found are cut. Depth-first, rounding
 * up first (amplifying more is usually what pays), with node and time limits to keep it fast.
 */
function branchAndBoundAmplification(game, options, incumbent)
{
    const stack     = [new Map()];
    const started   = performance.now();
    let nodes       = 0;

    while(stack.length > 0 && nodes < BRANCH_AND_BOUND_NODES && performance.now() - started < BRANCH_AND_BOUND_MS)
    {
        const bounds = stack.pop();
            nodes++;

        options.amplification = { bounds };
        const model     = buildModel(game, options);
        const solution  = solveLexicographic(model.lp, model.objectives.map(o => o.terms));

            if(solution.status !== 'optimal'){ continue; }
            if(incumbent.solution.status === 'optimal' && isBetter(solution, incumbent.solution) === false){ continue; }

        // Most significant fractional number of amplified machines
        let branch = null;
            for(const [key, { used, machinesVariable }] of model.vars.amplified)
            {
                const whole     = solution.values[machinesVariable];
                const fraction  = whole - Math.floor(whole);

                if(fraction > 1e-6 && fraction < 1 - 1e-6 && (branch === null || whole * used > branch.weight))
                {
                    branch = { key, whole, weight: whole * used };
                }
            }

        if(branch === null)
        {
            incumbent = { model, solution, amplification: { bounds } };
            continue;
        }

        const current = bounds.get(branch.key) ?? { lower: 0, upper: Infinity };
            stack.push(new Map(bounds).set(branch.key, { ...current, upper: Math.floor(branch.whole) }));
            stack.push(new Map(bounds).set(branch.key, { ...current, lower: Math.ceil(branch.whole) }));
    }

    return incumbent;
}

function normaliseRequest(game, request)
{
    const warnings  = [];
    const known     = (id) => {
        if(game.items[id] === undefined)
        {
            warnings.push({ type: 'unknown_item', item: id });
            return false;
        }
        return true;
    };
    const quantities = (map) => Object.fromEntries(
        Object.entries(map ?? {})
              .map(([id, qty]) => [id, Number(qty)])
              .filter(([id, qty]) => known(id) && Number.isFinite(qty) && qty > 0)
    );

    const maximize  = quantities(request.maximize);
    const targets   = quantities(request.targets);
        if(Object.keys(maximize).length > 0 && Object.keys(targets).length > 0)
        {
            warnings.push({ type: 'targets_ignored', reason: 'maximize mode' });
        }

    const recipeOptions = request.recipes ?? {};
    const enabled       = new Set();
    const exclude       = new Set(recipeOptions.exclude ?? []);
        for(const recipe of Object.values(game.recipes))
        {
            if(exclude.has(recipe.id)){ continue; }

            if(recipeOptions.allowAll === true || recipe.kind === 'standard')
            {
                enabled.add(recipe.id);
            }
        }
        for(const id of [...(recipeOptions.alternates ?? []), ...(recipeOptions.conversions ?? [])])
        {
            if(game.recipes[id] === undefined)
            {
                warnings.push({ type: 'unknown_recipe', recipe: id });
                continue;
            }
            if(exclude.has(id) === false){ enabled.add(id); }
        }

    // An alternate selected for a requested output is the one used for it, even if another recipe is cheaper
    if(recipeOptions.forceOutputs !== false)
    {
        const selected  = new Set(recipeOptions.alternates ?? []);
        const mainOf    = (id) => game.recipes[id]?.products?.[0]?.item;

        for(const item of new Set([...Object.keys(targets), ...Object.keys(maximize)]))
        {
            const chosen = [...enabled].filter(id => selected.has(id) && mainOf(id) === item);
                if(chosen.length === 0){ continue; }

            for(const id of [...enabled])
            {
                if(mainOf(id) === item && chosen.includes(id) === false){ enabled.delete(id); }
            }
        }
    }

    const extraction = {};
        for(const [type, defaults] of Object.entries(DEFAULT_EXTRACTION))
        {
            extraction[type] = {
                building    : request.extraction?.[type]?.building ?? defaults.building,
                purity      : request.extraction?.[type]?.purity ?? defaults.purity
            };
        }

    const objectives = (request.objectives ?? ['resources', 'buildings']).filter(o => {
        if(OBJECTIVES.includes(o)){ return true; }
        warnings.push({ type: 'unknown_objective', objective: o });
        return false;
    });

    return {
        mode            : Object.keys(maximize).length > 0 ? 'maximize' : 'targets',
        targets         : Object.keys(maximize).length > 0 ? {} : targets,
        maximize,
        inputs          : quantities(request.inputs),
        enabled,
        extraction,
        resourceLimits  : request.resourceLimits ?? {},
        resourceWeights : request.resourceWeights ?? {},
        objectives,
        somersloops     : Math.max(0, Math.floor(Number(request.somersloops) || 0)),
        amplifiable     : Array.isArray(request.amplifiable) ? new Set(request.amplifiable) : null,
        capInputs       : request.capInputs === true,
        maxRates        : { solid: request.maxRates?.solid ?? Infinity, fluid: request.maxRates?.fluid ?? Infinity },
        amplification   : null,     // set between solving rounds: { kept: Map(recipe|used → machines), freeBudget }
        warnings
    };
}


function buildModel(game, options)
{
    const lp        = new LinearProgram();
    const balance   = new Map();   // itemId → terms
    const vars      = { recipe: new Map(), amplified: new Map(), resource: new Map(), input: new Map(), surplus: new Map(), deficit: new Map(), lambda: null };
    const extractors = new Map();  // itemId → { building, rate, power }

    const addTerm = (item, variable, coefficient) => {
        if(balance.has(item) === false){ balance.set(item, []); }
        balance.get(item).push([variable, coefficient]);
    };

    // Recipes (when inputs are the only source of their items, recipes making them are left out:
    // those items still come from the inputs, or as by-products of other recipes)
    const relevant = relevantRecipes(game, options).filter(id => options.capInputs === false || options.inputs[game.recipes[id].products[0].item] === undefined);
    for(const id of relevant)
    {
        const recipe    = game.recipes[id];
        const x         = lp.addVariable('recipe:' + id);
            vars.recipe.set(id, x);

        for(const { item, rate } of recipe.products){ addTerm(item, x, rate); }
        for(const { item, rate } of recipe.ingredients){ addTerm(item, x, -rate); }
    }

    /*
     * Amplified variants (somersloops): same inputs, boosted outputs. Depending on the solving
     * stage they are free under the stock (relaxation), bounded by whole machines already kept
     * (greedy rounding), or tied to whole-machine counts w with branching bounds (branch and bound).
     */
    const amplification = options.amplification ?? {};
    const kept          = amplification.kept ?? new Map();
    const bounds        = amplification.bounds ?? null;
    const freeBudget    = amplification.freeBudget ?? options.somersloops;
    const somersloops   = [];

        for(const id of relevant)
        {
            const recipe    = game.recipes[id];
            const slots     = (options.amplifiable === null || options.amplifiable.has(id)) ? game.buildings[recipe.building].amplifierSlots : 0;

            for(let used = 1; used <= slots; used++)
            {
                const key       = id + '|' + used;
                const factor    = 1 + used / slots;

                    // A machine cannot hold more somersloops than what is left to place
                    if(bounds === null && kept.has(key) === false && used > freeBudget){ continue; }
                    if(bounds !== null && used > options.somersloops){ continue; }
                    if(fitsMaxRates(game, recipe, factor, options) === false){ continue; }

                const y = lp.addVariable('amplified:' + key);
                const entry = { recipe: id, used, slots, factor, variable: y, machinesVariable: y };
                    vars.amplified.set(key, entry);

                for(const { item, rate } of recipe.products){ addTerm(item, y, rate * factor); }
                for(const { item, rate } of recipe.ingredients){ addTerm(item, y, -rate); }

                if(bounds !== null)
                {
                    // Whole amplified machines w: y <= w, branching bounds on w
                    const w = lp.addVariable('amplifiedMachines:' + key);
                        entry.machinesVariable = w;
                        lp.addConstraint([[y, 1], [w, -1]], '<=', 0, 'amplifiedClock:' + key);
                        somersloops.push([w, used]);

                    const bound = bounds.get(key);
                        if(bound?.lower > 0){ lp.addConstraint([[w, 1]], '>=', bound.lower, 'amplifiedLower:' + key); }
                        if(Number.isFinite(bound?.upper)){ lp.addConstraint([[w, 1]], '<=', bound.upper, 'amplifiedUpper:' + key); }
                }
                else if(kept.has(key))
                {
                    // Whole machines already holding their somersloops: they may run underclocked
                    lp.addConstraint([[y, 1]], '<=', kept.get(key), 'amplified:' + key);
                }
                else
                {
                    somersloops.push([y, used]);
                }
            }
        }
        if(somersloops.length > 0)
        {
            lp.addConstraint(somersloops, '<=', (bounds !== null) ? options.somersloops : freeBudget, 'somersloops');
        }

    // Every item touched by the request must have a balance row too
    for(const item of [...Object.keys(options.targets), ...Object.keys(options.maximize), ...Object.keys(options.inputs)])
    {
        if(balance.has(item) === false){ balance.set(item, []); }
    }

    // Raw resources, inputs, surplus and deficit columns
    for(const item of balance.keys())
    {
        if(game.resources[item] !== undefined)
        {
            const s = lp.addVariable('resource:' + item);
                vars.resource.set(item, s);
                addTerm(item, s, 1);
                extractors.set(item, pickExtractor(game, options, item));

            // A provided raw resource is not extracted on top when inputs are the only source
            const limit = (options.capInputs === true && options.inputs[item] !== undefined) ? 0 : options.resourceLimits[item];
                if(Number.isFinite(limit))
                {
                    lp.addConstraint([[s, 1]], '<=', Math.max(0, limit), 'limit:' + item);
                }
        }
        else
        {
            const d = lp.addVariable('deficit:' + item);
                vars.deficit.set(item, d);
                addTerm(item, d, 1);
        }

        if(options.inputs[item] !== undefined)
        {
            const u = lp.addVariable('input:' + item);
                vars.input.set(item, u);
                addTerm(item, u, 1);
                lp.addConstraint([[u, 1]], '<=', options.inputs[item], 'inputCap:' + item);
        }

        const e = lp.addVariable('surplus:' + item);
            vars.surplus.set(item, e);
            addTerm(item, e, -1);
    }

    if(options.mode === 'maximize')
    {
        vars.lambda = lp.addVariable('lambda');
            for(const [item, ratio] of Object.entries(options.maximize)){ addTerm(item, vars.lambda, -ratio); }
    }

    for(const [item, terms] of balance)
    {
        lp.addConstraint(terms, '=', options.targets[item] ?? 0, 'balance:' + item);
    }

    // Objectives, in lexicographic order
    const objectives = [];
        objectives.push({ name: 'deficit', terms: [...vars.deficit.values()].map(d => [d, 1]) });

        if(options.mode === 'maximize')
        {
            objectives.push({ name: 'output', terms: [[vars.lambda, -1]] });
        }

        for(const name of options.objectives)
        {
            objectives.push({ name, terms: objectiveTerms(name, game, options, vars, extractors) });
        }

        // Always end with the buildings count so ties never leave pointless loops in the plan
        if(options.objectives.at(-1) !== 'buildings')
        {
            objectives.push({ name: 'buildings', terms: objectiveTerms('buildings', game, options, vars, extractors) });
        }

    return { lp, vars, objectives: objectives.filter(o => o.terms.length > 0), extractors };
}

/*
 * Backward closure from the requested items: a recipe that cannot contribute, directly or
 * through its ingredients, to a requested item can only push items into the surplus, so it is
 * never part of an optimal plan. Dropping those keeps the LP small and well-conditioned.
 * The sink objective values surplus itself, so it keeps every enabled recipe.
 */
function relevantRecipes(game, options)
{
    if(options.objectives.includes('sink')){ return [...options.enabled]; }

    const producers = new Map();
        for(const id of options.enabled)
        {
            for(const { item } of game.recipes[id].products)
            {
                if(producers.has(item) === false){ producers.set(item, []); }
                producers.get(item).push(id);
            }
        }

    const needed    = new Set([...Object.keys(options.targets), ...Object.keys(options.maximize)]);
    const queue     = [...needed];
    const recipes   = new Set();

    while(queue.length > 0)
    {
        const item = queue.pop();

        for(const id of producers.get(item) ?? [])
        {
            if(recipes.has(id)){ continue; }
            recipes.add(id);

            for(const ingredient of game.recipes[id].ingredients)
            {
                if(needed.has(ingredient.item) === false)
                {
                    needed.add(ingredient.item);
                    queue.push(ingredient.item);
                }
            }
        }
    }

    // Keep the enabled order so results are deterministic
    return [...options.enabled].filter(id => recipes.has(id));
}

function objectiveTerms(name, game, options, vars, extractors)
{
    const terms = [];

    switch(name)
    {
        case 'resources':
            for(const [item, s] of vars.resource)
            {
                const weight = resourceWeight(item, options);
                    if(weight > 0){ terms.push([s, weight]); }
            }
            break;

        case 'power':
            // Consumption only: running generators must never look like a way to "save" power
            for(const [id, x] of vars.recipe)
            {
                const power = game.recipes[id].power;
                    if(power > 0){ terms.push([x, power]); }
            }
            for(const { recipe, factor, variable } of vars.amplified.values())
            {
                const power = game.recipes[recipe].power;
                    if(power > 0){ terms.push([variable, power * factor * factor]); }
            }
            for(const [item, s] of vars.resource)
            {
                const extractor = extractors.get(item);
                    if(extractor?.rate > 0 && extractor.power > 0){ terms.push([s, extractor.power / extractor.rate]); }
            }
            break;

        case 'buildings':
            for(const x of vars.recipe.values()){ terms.push([x, 1]); }
            for(const { variable } of vars.amplified.values()){ terms.push([variable, 1]); }
            for(const [item, s] of vars.resource)
            {
                const extractor = extractors.get(item);
                    if(extractor?.rate > 0){ terms.push([s, 1 / extractor.rate]); }
            }
            break;

        case 'sink':
            // Maximise AWESOME Sink points of what is left over
            for(const [item, e] of vars.surplus)
            {
                const points = game.items[item].sinkPoints;
                    if(points > 0 && game.items[item].fluid === false){ terms.push([e, -points]); }
            }
            break;
    }

    return terms;
}

/*
 * A single machine must not need or make more than one belt / pipe: amplified variants whose
 * boosted outputs would exceed it are not offered.
 */
function fitsMaxRates(game, recipe, factor, options)
{
    const limit = (item) => game.items[item].fluid ? options.maxRates.fluid : options.maxRates.solid;

    return recipe.products.every(({ item, rate }) => rate * factor <= limit(item) + 1e-9)
        && recipe.ingredients.every(({ item, rate }) => rate <= limit(item) + 1e-9);
}

function resourceWeight(item, options)
{
    if(options.resourceWeights[item] !== undefined){ return options.resourceWeights[item]; }

    const availability = DEFAULT_RESOURCE_LIMITS[item];
        if(availability !== undefined){ return 1 / availability; }

    // Water and unknown (mod) resources: water is free, unknown ones get a cautious weight
    return (item === 'Desc_Water_C') ? 0 : 1 / 1000;
}

function extractionType(game, item)
{
    if(item === 'Desc_Water_C'){ return 'water'; }
    if(item === 'Desc_LiquidOil_C'){ return 'oil'; }
    if(game.items[item].category === 'gas'){ return 'gas'; }

    return 'ore';
}

function pickExtractor(game, options, item)
{
    const resource  = game.resources[item];
    const wanted    = options.extraction[extractionType(game, item)];
    const building  = resource.extractors.includes(wanted.building) ? wanted.building : resource.extractors[0];
    const fluid     = game.items[item].fluid;
    const rawRate   = extractionRateFor(game.buildings[building], wanted.purity);

    return {
        building,
        purity  : wanted.purity,
        rate    : rawRate === null ? null : (fluid ? rawRate / 1000 : rawRate),
        power   : game.buildings[building].powerUsed ?? 0
    };
}


function readSolution(game, options, model, solution)
{
    const value = (variable) => {
        const v = solution.values[variable];
        return (v > ZERO) ? v : 0;
    };

    // Amplified machines grouped by recipe
    const amplifiedByRecipe = new Map();
        for(const { recipe, used, slots, factor, variable } of model.vars.amplified.values())
        {
            const machines = value(variable);
                if(machines === 0){ continue; }

            if(amplifiedByRecipe.has(recipe) === false){ amplifiedByRecipe.set(recipe, []); }
            amplifiedByRecipe.get(recipe).push({ somersloops: used, slots, factor, machines });
        }

    const recipes = [];
        for(const id of new Set([...model.vars.recipe.keys(), ...amplifiedByRecipe.keys()]))
        {
            const base      = model.vars.recipe.has(id) ? value(model.vars.recipe.get(id)) : 0;
            const amplified = amplifiedByRecipe.get(id) ?? [];
                if(base === 0 && amplified.length === 0){ continue; }

            const recipe    = game.recipes[id];
            const building  = game.buildings[recipe.building];
            const baseCount = Math.ceil(base - 1e-6);
            const clock     = baseCount > 0 ? base / baseCount : 1;

            // Inputs follow every machine at its clock, outputs also get the amplification
            const machines  = base + amplified.reduce((total, a) => total + a.machines, 0);
            const boosted   = base + amplified.reduce((total, a) => total + a.machines * a.factor, 0);

            recipes.push({
                id,
                name        : recipe.name,
                kind        : recipe.kind,
                building    : recipe.building,
                machines,
                count       : baseCount + amplified.reduce((total, a) => total + Math.ceil(a.machines - 1e-6), 0),
                clock       : clock * 100,
                amplified,
                somersloops : amplified.reduce((total, a) => total + a.somersloops * Math.ceil(a.machines - 1e-6), 0),
                inputs      : recipe.ingredients.map(({ item, rate }) => ({ item, qty: rate * machines })),
                outputs     : recipe.products.map(({ item, rate }) => ({ item, qty: rate * boosted })),
                // Nominal: as if fractional machines ran at 100%. Actual: base machines underclocked evenly.
                // Amplification multiplies power by (1 + somersloops / slots)².
                power       : {
                    nominal : recipe.power * (base + amplified.reduce((total, a) => total + a.machines * a.factor * a.factor, 0)),
                    actual  : recipe.power * (baseCount * Math.pow(clock, building.overclockExponent)
                                            + amplified.reduce((total, a) => total + a.machines * a.factor * a.factor, 0))
                }
            });
        }

    const resources = [];
        for(const [item, s] of model.vars.resource)
        {
            const qty = value(s);
                if(qty === 0){ continue; }

            const extractor = model.extractors.get(item);
            const machines  = extractor.rate > 0 ? qty / extractor.rate : null;
            const count     = machines === null ? null : Math.ceil(machines - 1e-6);
            const exponent  = game.buildings[extractor.building].overclockExponent;

            resources.push({
                item,
                qty,
                building    : extractor.building,
                purity      : extractor.purity,
                machines,
                count,
                power       : {
                    nominal : machines === null ? 0 : extractor.power * machines,
                    actual  : machines === null ? 0 : extractor.power * count * Math.pow(machines / count, exponent)
                }
            });
        }

    const collect = (map) => {
        const list = [];
            for(const [item, variable] of map)
            {
                const qty = value(variable);
                    if(qty > 0){ list.push({ item, qty }); }
            }
        return list;
    };

    const lambda    = model.vars.lambda === null ? null : value(model.vars.lambda);
    const outputs   = options.mode === 'maximize'
                    ? Object.entries(options.maximize).map(([item, ratio]) => ({ item, qty: ratio * lambda }))
                    : Object.entries(options.targets).map(([item, qty]) => ({ item, qty }));

    const missing   = collect(model.vars.deficit);
    const warnings  = [...options.warnings];
        if(missing.length > 0)
        {
            warnings.push({ type: 'missing_items', items: missing.map(m => m.item) });
        }
        for(const resource of resources)
        {
            if(resource.machines === null){ warnings.push({ type: 'unknown_extraction_rate', item: resource.item, building: resource.building }); }
        }

    const sum = (list, key) => list.reduce((total, entry) => total + entry.power[key], 0);
    const power = {
        consumption : sum(recipes.filter(r => r.power.nominal > 0), 'actual') + sum(resources, 'actual'),
        generation  : -sum(recipes.filter(r => r.power.nominal < 0), 'actual'),
        nominal     : sum(recipes, 'nominal') + sum(resources, 'nominal')
    };

    const result = {
        status      : 'optimal',
        mode        : options.mode,
        recipes,
        resources,
        inputs      : collect(model.vars.input),
        outputs,
        surplus     : collect(model.vars.surplus),
        missing,
        power,
        buildings   : {
            machines    : recipes.reduce((total, r) => total + r.count, 0),
            extractors  : resources.reduce((total, r) => total + (r.count ?? 0), 0)
        },
        somersloops : { available: options.somersloops, used: recipes.reduce((total, r) => total + r.somersloops, 0) },
        objectives  : Object.fromEntries(model.objectives.map((o, i) => [o.name, solution.objectiveValues[i]])),
        warnings,
        iterations  : solution.iterations
    };

    result.flows = buildFlows(result);

    return result;
}

function statusMessage(solution, model)
{
    if(solution.status === 'unbounded')
    {
        const stage = model.objectives[solution.unboundedStage]?.name;
            if(stage === 'output')
            {
                return 'Output can grow without limit: provide inputs or resource limits to maximise against.';
            }

        return 'Objective "' + stage + '" is unbounded.';
    }
    if(solution.status === 'infeasible')
    {
        return 'No plan satisfies the constraints (check resource limits).';
    }

    return 'Solver stopped: ' + solution.status;
}