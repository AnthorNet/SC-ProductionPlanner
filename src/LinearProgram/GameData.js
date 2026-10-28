/*
 * Normalises Satisfactory-Calculator game data into a solver-friendly shape.
 *
 * Accepts either the /api/game payload ({buildingsData, itemsData, toolsData, recipesData})
 * or the worker message shape ({buildings, items, recipes}). Mod data is expected to be
 * merged beforehand, exactly like SCPP.start() does today.
 *
 * Units after normalisation:
 *  - every rate is per minute, for one machine at 100% clock
 *  - fluids (liquid / gas) are in m³, not in the game's internal litres (x1000)
 */

export const FLUID_CATEGORIES   = ['liquid', 'gas'];

// Somersloop slots per building (production amplification): not part of the game data payload
export const AMPLIFIER_SLOTS    = {
    Build_SmelterMk1_C          : 1,
    Build_ConstructorMk1_C      : 1,
    Build_FoundryMk1_C          : 2,
    Build_AssemblerMk1_C        : 2,
    Build_OilRefinery_C         : 2,
    Build_Converter_C           : 2,
    Build_ManufacturerMk1_C     : 4,
    Build_Blender_C             : 4,
    Build_HadronCollider_C      : 4,
    Build_QuantumEncoder_C      : 4
};
export const DEFAULT_OVERCLOCK_EXPONENT = 1.321928;

// Buildings that cannot be automated: their recipes never enter the model
const NON_AUTOMATED_PRODUCERS   = [
    '',
    '/Script/FactoryGame.FGBuildGun',
    '/Game/FactoryGame/Buildable/-Shared/WorkBench/BP_WorkshopComponent.BP_WorkshopComponent_C',
    '/Game/FactoryGame/Buildable/-Shared/WorkBench/BP_WorkBenchComponent.BP_WorkBenchComponent_C'
];

const AUTOMATED_CATEGORIES      = ['production', 'generator', 'extraction'];

/*
 * Extraction rate for a purity key as found in the game data (RP_Inpure, RP_Normal, RP_Pure).
 * Water pumps only define RP_Normal, which is used whatever the purity asked.
 */
export function extractionRateFor(building, purity)
{
    return building?.extractionRate?.[purity] ?? building?.extractionRate?.RP_Normal ?? null;
}

/*
 * Same classification as Worker_Wrapper.isAlternateRecipe(), except for Residual recipes:
 * they are standard in-game and only were flagged to avoid loops, which the LP handles.
 */
export function classifyRecipe(recipe)
{
    const className = recipe.className ?? '';

    if(className.startsWith('/Game/FactoryGame/Recipes/Converter/ResourceConversion/Recipe_')){ return 'conversion'; }

    if(className.endsWith('Recipe_Alternate_Turbofuel.Recipe_Alternate_Turbofuel_C')){ return 'standard'; }
    if(className.endsWith('Recipe_Alternate_EnrichedCoal.Recipe_Alternate_EnrichedCoal_C')){ return 'standard'; }

    if(className.startsWith('/Game/FactoryGame/Recipes/AlternateRecipes')){ return 'alternate'; }
    if(className.includes('_Alt.Recipe_') || className.includes('.Recipe_Alt_RP_')){ return 'alternate'; }

    return 'standard';
}

/*
 * options.partsCostMultiplier: "Recipe Parts Cost Multiplier" game mode (1.2): every recipe ingredient
 * amount is multiplied; products and durations stay the same.
 */
export function prepareGameData(raw, { partsCostMultiplier = 1 } = {})
{
    const buildingsData = raw.buildingsData ?? raw.buildings ?? {};
    const itemsData     = Object.assign({}, raw.toolsData ?? {}, raw.itemsData ?? raw.items ?? {});
    const recipesData   = raw.recipesData ?? raw.recipes ?? {};

    const items             = {};
    const itemByClassName   = new Map();
        for(const [id, item] of Object.entries(itemsData))
        {
            items[id] = {
                id,
                name        : item.name ?? id,
                category    : item.category ?? null,
                fluid       : FLUID_CATEGORIES.includes(item.category),
                image       : item.image ?? null,
                color       : item.color ?? null,
                sinkPoints  : item.resourceSinkPoints ?? null
            };

            itemByClassName.set(item.className, id);
            itemByClassName.set(id, id);
        }

    const buildings             = {};
    const buildingByClassName   = new Map();
        for(const [id, building] of Object.entries(buildingsData))
        {
            buildings[id] = {
                id,
                name                : building.name ?? id,
                category            : building.category ?? null,
                image               : building.image ?? null,
                powerUsed           : building.powerUsed ?? null,
                powerUsedRecipes    : building.powerUsedRecipes ?? null,
                powerGenerated      : building.powerGenerated ?? null,
                overclockExponent   : building.powerProductionExponent ?? DEFAULT_OVERCLOCK_EXPONENT,
                amplifierSlots      : AMPLIFIER_SLOTS[id] ?? 0,
                extractionRate      : building.extractionRate
            };

            if(building.className !== undefined)
            {
                buildingByClassName.set(building.className, id);
            }
        }

    const recipes       = {};
    const resources     = {};   // raw itemId → { recipeId, extractors: [buildingId] }
    const skipped       = [];   // recipes that cannot be automated or reference unknown items

    for(const [id, recipe] of Object.entries(recipesData))
    {
        const producers = (recipe.mProducedIn ?? [])
                            .filter(className => NON_AUTOMATED_PRODUCERS.includes(className) === false)
                            .map(className => buildingByClassName.get(className))
                            .filter(buildingId => buildingId !== undefined && AUTOMATED_CATEGORIES.includes(buildings[buildingId].category));

            if(producers.length === 0)
            {
                skipped.push({ id, reason: 'not_automated' });
                continue;
            }

        const ingredients   = resolveStacks(recipe.ingredients, itemByClassName, items, partsCostMultiplier);
        const products      = resolveStacks(recipe.produce, itemByClassName, items);
            if(ingredients === null || products === null)
            {
                skipped.push({ id, reason: 'unknown_item' });
                continue;
            }

        // Extraction recipes (Recipe_OreIron_C...) turn an item into itself: they define raw resources
        if(producers.every(buildingId => buildings[buildingId].category === 'extraction'))
        {
            for(const { item } of products)
            {
                resources[item] = resources[item] ?? { item, recipes: [], extractors: [] };
                resources[item].recipes.push(id);

                for(const buildingId of producers)
                {
                    if(resources[item].extractors.includes(buildingId) === false)
                    {
                        resources[item].extractors.push(buildingId);
                    }
                }
            }

            continue;
        }

        const buildingId    = producers.find(b => buildings[b].category !== 'extraction');
        const building      = buildings[buildingId];
        const perMinute     = 60 / recipe.mManufactoringDuration;

        recipes[id] = {
            id,
            name        : recipe.name ?? id,
            kind        : classifyRecipe(recipe),
            building    : buildingId,
            ingredients : ingredients.map(({ item, amount }) => ({ item, rate: amount * perMinute })),
            products    : products.map(({ item, amount }) => ({ item, rate: amount * perMinute })),
            power       : recipePower(building, id)
        };
    }

    return { items, buildings, recipes, resources, skipped, itemByClassName };
}

function resolveStacks(stacks, itemByClassName, items, multiplier = 1)
{
    const resolved = [];

    for(const [className, stackAmount] of Object.entries(stacks ?? {}))
    {
        const item = itemByClassName.get(className);
            if(item === undefined){ return null; }

        const rawAmount = stackAmount * multiplier;

        resolved.push({ item, amount: items[item].fluid ? rawAmount / 1000 : rawAmount });
    }

    return resolved;
}

/*
 * MW for one machine at 100%: generators are negative.
 * Variable-power buildings (Particle Accelerator, Converter, Quantum Encoder) use their average draw.
 */
function recipePower(building, recipeId)
{
    if(building.powerGenerated !== null){ return -building.powerGenerated; }

    const range = building.powerUsedRecipes?.[recipeId];
        if(Array.isArray(range)){ return (range[0] + range[1]) / 2; }

    return building.powerUsed ?? 0;
}