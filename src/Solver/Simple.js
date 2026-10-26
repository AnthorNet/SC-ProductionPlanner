/* global Intl */

import Worker_Wrapper       from '../Worker/Wrapper.js';
import { prepareGameData }  from '../LinearProgram/GameData.js';
import { solveProduction }  from '../LinearProgram/Solver.js';

/*
 * SIMPLE view, powered by the LP solver.
 *
 * The plan computed by the LP is translated into the graphNodes / graphEdges format shared
 * with the Realistic view, so labels, lists and the tree view from Worker_Wrapper work unchanged.
 * Graph quantities stay in the internal units (fluids x1000), the LP works in m³.
 *
 * Runs in a bundled worker (see Worker/Simple.js): it imports modules, so it cannot go
 * through the Blob/toString() worker the Realistic view uses.
 */

// SIMPLE always uses the fastest extraction, whatever the (hidden) Realistic selects send
const EXTRACTION = {
    ore     : { building: 'Build_MinerMk3_C',           purity: 'RP_Pure' },
    oil     : { building: 'Build_OilPump_C',            purity: 'RP_Pure' },
    water   : { building: 'Build_WaterPump_C',          purity: 'RP_Pure' },
    gas     : { building: 'Build_FrackingExtractor_C',  purity: 'RP_Pure' }
};

export default class Solver_Simple extends Worker_Wrapper
{
    constructor(worker)
    {
        super(worker);

        this.treePath = new Set();
    }

    // Worker only receive main thread initial options
    initiate(formData)
    {
        //this.url.view               = formData.view;

        // No speed limit on SIMPLE (Mostly ^^)
        this.options.maxBeltSpeed   = Number.MAX_SAFE_INTEGER;
        this.options.maxPipeSpeed   = Number.MAX_SAFE_INTEGER;

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

        const game  = prepareGameData({ buildings: this.buildings, items: this.items, recipes: this.recipes });
        const plan  = solveProduction(game, this.solverRequest(EXTRACTION));

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

        this.buildGraph(game, plan);
    }

    buildGraph(game, plan)
    {
        const internal  = (itemId, qty) => (game.items[itemId]?.fluid === true) ? qty * 1000 : qty;
        const visIds    = new Map();
        const visId     = (flowId) => {
            if(visIds.has(flowId) === false)
            {
                visIds.set(flowId, flowId.split(':')[0] + '_' + (this.nodeIdKey++));
            }
            return visIds.get(flowId);
        };

        const recipes   = new Map(plan.recipes.map(recipe => [recipe.id, recipe]));
        const resources = new Map(plan.resources.map(resource => [resource.item, resource]));

        for(const node of plan.flows.nodes)
        {
            const id = visId(node.id);

            switch(node.type)
            {
                case 'recipe':
                {
                    const recipe    = recipes.get(node.recipe);
                    const mainOut   = game.recipes[recipe.id].products[0];

                    this.graphNodes.push({data: {
                        id                  : id,
                        nodeType            : 'productionBuilding',
                        buildingType        : recipe.building,
                        recipe              : recipe.id,
                        itemOut             : mainOut.item,
                        qtyProducedDefault  : internal(mainOut.item, mainOut.rate),
                        qtyProduced         : internal(mainOut.item, mainOut.rate),
                        qtyUsed             : internal(mainOut.item, mainOut.rate * recipe.machines),
                        clockSpeed          : 100,
                        image               : this.buildings[recipe.building].image
                    }});
                    break;
                }

                case 'resource':
                {
                    const resource      = resources.get(node.item);
                    const extractor     = this.buildings[resource.building];
                    const rate          = resource.machines > 0 ? resource.qty / resource.machines : null;

                    // Extractors show as buildings; unknown rates fall back to a plain item
                    if(rate !== null && extractor !== undefined)
                    {
                        this.graphNodes.push({data: {
                            id                  : id,
                            nodeType            : 'productionBuilding',
                            buildingType        : resource.building,
                            recipe              : game.resources[node.item].recipes[0],
                            itemOut             : node.item,
                            qtyProducedDefault  : internal(node.item, rate),
                            qtyProduced         : internal(node.item, rate),
                            qtyUsed             : internal(node.item, resource.qty),
                            clockSpeed          : 100,
                            image               : extractor.image
                        }});
                    }
                    else
                    {
                        this.pushItemNode(id, 'lastNodeItem', node.item, internal(node.item, node.qty));
                    }
                    break;
                }

                case 'missing':
                    this.pushItemNode(id, 'lastNodeItem', node.item, internal(node.item, node.qty));
                    break;

                case 'input':
                case 'surplus':
                    this.pushItemNode(id, 'byProductItem', node.item, internal(node.item, node.qty));
                    break;

                case 'output':
                    if(node.qty <= 1e-9){ break; }     // Nothing could be made from the inputs

                    this.graphNodes.push({data: {
                        id          : id,
                        nodeType    : 'mainNode',
                        itemId      : node.item,
                        qty         : internal(node.item, node.qty),
                        image       : this.items[node.item].image
                    }});
                    break;
            }
        }

        for(const edge of plan.flows.edges)
        {
            const source = visId(edge.source);
            const target = visId(edge.target);

            this.graphEdges.push({data: {
                id          : source + '_' + target + '_' + edge.item,
                source      : source,
                target      : target,
                itemId      : edge.item,
                qty         : internal(edge.item, edge.qty)
            }});
        }
    }

    pushItemNode(id, nodeType, itemId, qty)
    {
        this.graphNodes.push({data: {
            id          : id,
            nodeType    : nodeType,
            itemId      : itemId,
            qtyUsed     : 0,
            qtyProduced : qty,
            neededQty   : qty,
            image       : this.items[itemId].image
        }});
    }



    addLabels()
    {
        super.addLabels();

        for(let i = 0; i < this.graphNodes.length; i++)
        {
            let nodeData = this.graphNodes[i].data;
                if(nodeData.nodeType === 'productionBuilding')
                {
                    if(this.listBuildings[nodeData.buildingType] === undefined)
                    {
                        this.listBuildings[nodeData.buildingType] = 0;
                    }
                    this.listBuildings[nodeData.buildingType] += nodeData.qtyUsed / nodeData.qtyProducedDefault;

                    // Calculate required power!
                    let powerUsage = 0;
                        // Fracking exrtractor
                        if(nodeData.buildingType === 'Build_FrackingExtractor_C')
                        {
                            this.requiredPower += Math.ceil((nodeData.qtyUsed / nodeData.qtyProducedDefault) / 6) * this.buildings.Build_FrackingSmasher_C.powerUsed;
                        }
                        else
                        {
                            // Basic building
                            if(this.buildings[nodeData.buildingType].powerUsed !== undefined)
                            {
                                powerUsage = this.buildings[nodeData.buildingType].powerUsed;
                            }
                            // Custom recipe power usage (AVERAGE)
                            if(this.buildings[nodeData.buildingType].powerUsedRecipes !== undefined && this.buildings[nodeData.buildingType].powerUsedRecipes[nodeData.recipe] !== undefined)
                            {
                                powerUsage = (this.buildings[nodeData.buildingType].powerUsedRecipes[nodeData.recipe][0] + this.buildings[nodeData.buildingType].powerUsedRecipes[nodeData.recipe][1]) / 2;
                            }

                            this.requiredPower     += (nodeData.qtyUsed / nodeData.qtyProducedDefault) * powerUsage;
                        }
                }
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

    treeListProductionBuilding(performanceColor, performance)
    {
        return ' <em style="color: ' + performanceColor + '">(x' + performance / 100 + ')</em>';
    }
}