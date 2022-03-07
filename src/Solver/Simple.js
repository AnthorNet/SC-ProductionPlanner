/* global Intl */

import Worker_Wrapper   from '../Worker/Wrapper.js';

export default class Solver_Simple extends Worker_Wrapper
{
    constructor(worker)
    {
        super(worker);
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
        this.doCalculation();
        this.endCalculation();
    }

    doCalculation()
    {
        for(let itemKey in this.requestedItems)
        {
            let requestedQty = this.requestedItems[itemKey];
            let maxMergedQty = this.options.maxBeltSpeed;

                if(this.items[itemKey].category === 'liquid' || this.items[itemKey].category === 'gas')
                {
                    requestedQty *= 1000;
                    maxMergedQty = this.options.maxPipeSpeed;
                }

            while(requestedQty >= maxMergedQty)
            {
                this.startMainNode(itemKey, ((this.items[itemKey].category === 'liquid' || this.items[itemKey].category === 'gas') ? (maxMergedQty / 1000) : maxMergedQty));
                requestedQty -= maxMergedQty;
            }

            if(requestedQty > 0)
            {
                this.startMainNode(itemKey, ((this.items[itemKey].category === 'liquid' || this.items[itemKey].category === 'gas') ? (requestedQty / 1000) : requestedQty));
            }
        }
    }

    startMainNode(itemKey, mainRequiredQty)
    {
        console.log('startMainNode', itemKey, mainRequiredQty);

        let currentRecipe           = this.getRecipeToProduceItemId(itemKey);

            if(this.items[itemKey].category === 'liquid' || this.items[itemKey].category === 'gas')
            {
                mainRequiredQty *= 1000;
            }

        if(currentRecipe !== null)
        {
            if(this.items[itemKey].category === 'liquid' || this.items[itemKey].category === 'gas')
            {
                this.postMessage({type: 'updateLoaderText', text: 'Calculating production of ' + new Intl.NumberFormat(this.locale).format(mainRequiredQty / 1000) + 'm³ ' + this.items[itemKey].name + '...'});
            }
            else
            {
                this.postMessage({type: 'updateLoaderText', text: 'Calculating production of ' + new Intl.NumberFormat(this.locale).format(mainRequiredQty) + ' ' + this.items[itemKey].name + '...'});
            }

            let mainNodeVisId  = itemKey + '_' + this.nodeIdKey;
                this.nodeIdKey++;

            this.graphNodes.push({data: {
                id          : mainNodeVisId,
                nodeType    : 'mainNode',
                itemId      : itemKey,
                qty         : mainRequiredQty,
                image       : this.items[itemKey].image
            }});

            // Build tree...
            while(mainRequiredQty > 0)
            {
                // Can we use by product?
                let usesByProduct = false;
                    for(let i = 0; i < this.graphNodes.length; i ++)
                    {
                        if(this.graphNodes[i].data.nodeType === 'byProductItem')
                        {
                            if(this.graphNodes[i].data.itemId === itemKey)
                            {
                                let remainingQty    = this.graphNodes[i].data.qtyProduced - this.graphNodes[i].data.qtyUsed;
                                let useQty          = Math.min(remainingQty, mainRequiredQty);
                                    if(useQty < 0)
                                    {
                                        useQty = remainingQty;
                                    }

                                if(remainingQty > 0 && useQty > 0)
                                {
                                    // Edge?
                                    let haveFoundByProductEdge = false;
                                        for(let j = 0; j < this.graphEdges.length; j++)
                                        {
                                            if(this.graphEdges[j].data.source === this.graphNodes[i].data.id && this.graphEdges[j].data.target === mainNodeVisId)
                                            {
                                                this.graphEdges[j].data.qty    += useQty;
                                                haveFoundByProductEdge         = true;
                                                break;
                                            }
                                        }

                                        if(haveFoundByProductEdge === false)
                                        {
                                            this.graphEdges.push({data: {
                                                id                  : this.graphNodes[i].data.id + '_' + mainNodeVisId,
                                                source              : this.graphNodes[i].data.id,
                                                target              : mainNodeVisId,
                                                itemId              : itemKey,
                                                qty                 : useQty
                                            }});
                                        }

                                    this.graphNodes[i].data.qtyUsed    += useQty;
                                    mainRequiredQty                    -= useQty;
                                    usesByProduct                       = true;
                                }
                            }
                        }
                    }

                if(usesByProduct === false)
                {
                    // Regular node...
                    let qtyProducedByNode = this.buildCurrentNodeTree({
                        id              : itemKey,
                        recipe          : currentRecipe,
                        qty             : mainRequiredQty,
                        visId           : mainNodeVisId,
                        level           : 1
                    });

                    if(qtyProducedByNode !== false)
                    {
                        // Reduce needed quantity
                        mainRequiredQty     -= qtyProducedByNode;
                    }
                    else
                    {
                        break; //Prevent infinite loop...
                    }
                }
            }
        }
    };

    buildCurrentNodeTree(options)
    {
        if(this.debug === true)
        {
            console.log('buildCurrentNodeTree', options.qty, options.recipe, options.level);
        }

        let buildingId = this.getProductionBuildingFromRecipeId(options.recipe);

            if(buildingId !== null)
            {
                let productionCraftingTime  = 4,
                    productionPieces        = 1,
                    productionRecipe        = false;

                    this.nodeIdKey++;

                    if(this.buildings[buildingId].extractionRate !== undefined)
                    {
                        productionCraftingTime  = 0.5;

                        switch(buildingId)
                        {
                            case 'Build_FrackingExtractor_C':
                                if(options.recipe === 'Recipe_CrudeOil_C')
                                {
                                    if(this.buildings[buildingId].extractionRate[this.options.oilSpeed] !== undefined)
                                    {
                                        productionCraftingTime = 60 / (this.buildings[buildingId].extractionRate[this.options.oilSpeed]);
                                    }
                                }
                                else
                                {
                                    if(options.recipe === 'Recipe_CrudeWater_C')
                                    {
                                        if(this.buildings[buildingId].extractionRate[this.options.waterSpeed] !== undefined)
                                        {
                                            productionCraftingTime = 60 / (this.buildings[buildingId].extractionRate[this.options.waterSpeed]);
                                        }
                                    }
                                    else
                                    {
                                        if(this.buildings[buildingId].extractionRate[this.options.gasSpeed] !== undefined)
                                        {
                                            productionCraftingTime = 60 / (this.buildings[buildingId].extractionRate[this.options.gasSpeed]);
                                        }
                                    }
                                }
                                break;
                            case 'Build_OilPump_C':
                                if(this.buildings[buildingId].extractionRate[this.options.oilSpeed] !== undefined)
                                {
                                    productionCraftingTime = 60 / (this.buildings[buildingId].extractionRate[this.options.oilSpeed]);
                                }
                                break;
                            case 'Build_WaterPump_C':
                                productionCraftingTime = 60 / (this.buildings[buildingId].extractionRate['normal']);
                                break;
                            default:
                                if(this.buildings[buildingId].extractionRate[this.options.oreSpeed] !== undefined)
                                {
                                    productionCraftingTime = 60 / this.buildings[buildingId].extractionRate[this.options.oreSpeed];
                                }
                        }
                    }
                    else
                    {
                        if(this.recipes[options.recipe].ingredients !== undefined)
                        {
                            productionRecipe    = this.recipes[options.recipe].ingredients;
                        }

                        if(this.recipes[options.recipe].mManufactoringDuration !== undefined)
                        {
                            productionCraftingTime  = this.recipes[options.recipe].mManufactoringDuration;
                        }

                        if(this.recipes[options.recipe].produce !== undefined)
                        {
                            for(let producedClassName in this.recipes[options.recipe].produce)
                            {
                                if(producedClassName === this.items[options.id].className)
                                {
                                    productionPieces        = this.recipes[options.recipe].produce[producedClassName];
                                }
                            }
                        }
                    }

                    let currentParentVisId      = buildingId + '_'  + this.nodeIdKey;
                    let qtyProduced             = (60 / productionCraftingTime * productionPieces);
                    let qtyUsed                 = Math.min(qtyProduced, options.qty);
                    let haveFoundProductionNode = false;

                    // Does the production node already exists?
                    for(let k = 0; k < this.graphNodes.length; k++)
                    {
                        if(this.graphNodes[k].data.nodeType === 'productionBuilding' && this.graphNodes[k].data.recipe === options.recipe)
                        {
                            currentParentVisId                      = this.graphNodes[k].data.id;
                            this.graphNodes[k].data.qtyProduced    += qtyProduced;
                            this.graphNodes[k].data.qtyUsed        += qtyUsed;

                            // Edge?
                            let haveFoundProductionEdge = false;
                                for(let j = 0; j < this.graphEdges.length; j++)
                                {
                                    if(this.graphEdges[j].data.source === currentParentVisId && this.graphEdges[j].data.target === options.visId)
                                    {
                                        this.graphEdges[j].data.qty    += qtyUsed;
                                        haveFoundProductionEdge         = true;
                                        break;
                                    }
                                }

                                if(haveFoundProductionEdge === false)
                                {
                                    this.graphEdges.push({data: {
                                        id                  : currentParentVisId + '_' + options.visId,
                                        source              : currentParentVisId,
                                        target              : options.visId,
                                        itemId              : options.id,
                                        recipe              : options.recipe,
                                        qty                 : qtyUsed
                                    }});
                                }

                            haveFoundProductionNode                 = true;
                            break;
                        }
                    }

                    // Push new node!
                    if(haveFoundProductionNode === false)
                    {
                        this.graphNodes.push({data: {
                            id                  : currentParentVisId,
                            nodeType            : 'productionBuilding',
                            buildingType        : buildingId,
                            recipe              : options.recipe,
                            itemOut             : options.id,
                            qtyProducedDefault  : qtyProduced,
                            qtyProduced         : qtyProduced,
                            qtyUsed             : qtyUsed,
                            clockSpeed          : 100,
                            image               : this.buildings[buildingId].image
                        }});

                        // Push new edges between node and parent
                        this.graphEdges.push({data: {
                            id                  : currentParentVisId + '_' + options.visId,
                            source              : currentParentVisId,
                            target              : options.visId,
                            itemId              : options.id,
                            recipe              : options.recipe,
                            qty                 : qtyUsed
                        }});
                    }

                    // Add supplementalLoadType
                    if(this.buildings[buildingId].supplementalLoadType !== undefined && this.buildings[buildingId].powerGenerated !== undefined)
                    {
                        let supplementalLoadRatio      = (this.buildings[buildingId].supplementalLoadRatio !== undefined) ? this.buildings[buildingId].supplementalLoadRatio : 1;
                        let mPowerProductionExponent   = (this.buildings[buildingId].powerProductionExponent !== undefined) ? this.buildings[buildingId].powerProductionExponent : 1.3;

                        let supplementalLoadId          = this.buildings[buildingId].supplementalLoadType;
                        let supplementalLoadQty         = (qtyUsed / qtyProduced) * (60 * (this.buildings[buildingId].powerGenerated * Math.pow(1, 1 / mPowerProductionExponent)) * supplementalLoadRatio);
                        let supplementalLoadRecipe      = this.getRecipeToProduceItemId(this.buildings[buildingId].supplementalLoadType);

                        while(supplementalLoadQty > 0)
                        {
                            // Can we use by product?
                            let usesByProduct = false;
                                for(let i = 0; i < this.graphNodes.length; i ++)
                                {
                                    if(this.graphNodes[i].data.nodeType === 'byProductItem')
                                    {
                                        if(this.graphNodes[i].data.itemId === supplementalLoadId)
                                        {
                                            let remainingQty    = this.graphNodes[i].data.qtyProduced - this.graphNodes[i].data.qtyUsed;
                                            let useQty          = Math.min(remainingQty, supplementalLoadQty);

                                                if(useQty < 0)
                                                {
                                                    useQty = remainingQty;
                                                }

                                            if(remainingQty > 0 && useQty > 0)
                                            {
                                                // Edge?
                                                let haveFoundByProductEdge = false;
                                                    for(let j = 0; j < this.graphEdges.length; j++)
                                                    {
                                                        if(this.graphEdges[j].data.source === this.graphNodes[i].data.id && this.graphEdges[j].data.target === currentParentVisId)
                                                        {
                                                            this.graphEdges[j].data.qty    += useQty;
                                                            haveFoundByProductEdge         = true;
                                                            break;
                                                        }
                                                    }

                                                    if(haveFoundByProductEdge === false)
                                                    {
                                                        this.graphEdges.push({data: {
                                                            id                  : this.graphNodes[i].data.id + '_' + currentParentVisId,
                                                            source              : this.graphNodes[i].data.id,
                                                            target              : currentParentVisId,
                                                            itemId              : supplementalLoadId,
                                                            qty                 : useQty
                                                        }});
                                                    }

                                                this.graphNodes[i].data.qtyUsed    += useQty;
                                                supplementalLoadQty                -= useQty;
                                                usesByProduct                       = true;

                                                break;
                                            }
                                        }
                                    }
                                }

                            if(usesByProduct === false)
                            {
                                // Regular node...
                                let qtyProducedByNode = this.buildCurrentNodeTree({
                                    id              : supplementalLoadId,
                                    recipe          : supplementalLoadRecipe,
                                    qty             : supplementalLoadQty,
                                    visId           : currentParentVisId,
                                    level           : (options.level + 1)
                                });

                                if(qtyProducedByNode !== false)
                                {
                                    // Reduce needed quantity
                                    supplementalLoadQty     -= qtyProducedByNode;
                                }
                                else
                                {
                                    break; //Prevent infinite loop...
                                }
                            }
                        }
                    }

                    // Add by-product
                    if(this.recipes[options.recipe].produce !== undefined)
                    {
                        for(let producedClassName in this.recipes[options.recipe].produce)
                        {
                            if(producedClassName !== this.items[options.id].className)
                            {
                                let byProductId     = this.getItemIdFromClassName(producedClassName);
                                let byProductQty    = qtyUsed / productionPieces * this.recipes[options.recipe].produce[producedClassName];

                                let alreadyExistsByProductNode = false;

                                // Find already last level item!
                                for(let k = 0; k < this.graphNodes.length; k++)
                                {
                                    if(this.graphNodes[k].data.nodeType === 'byProductItem' && this.graphNodes[k].data.itemId === byProductId)
                                    {
                                        this.graphNodes[k].data.qtyProduced  += byProductQty;
                                        this.graphNodes[k].data.neededQty    += byProductQty;

                                        // Edge?
                                        let haveFoundByProductEdge = false;
                                            for(let j = 0; j < this.graphEdges.length; j++)
                                            {
                                                if(this.graphEdges[j].data.source === currentParentVisId && this.graphEdges[j].data.target === this.graphNodes[k].data.id)
                                                {
                                                    this.graphEdges[j].data.qty    += byProductQty;
                                                    haveFoundByProductEdge         = true;
                                                    break;
                                                }
                                            }

                                            if(haveFoundByProductEdge === false)
                                            {
                                                this.graphEdges.push({data: {
                                                    id                  : currentParentVisId + '_' + this.graphNodes[k].data.id,
                                                    source              : currentParentVisId,
                                                    target              : this.graphNodes[k].data.id,
                                                    itemId              : byProductId,
                                                    recipe              : options.recipe,
                                                    qty                 : byProductQty
                                                }});
                                            }

                                        alreadyExistsByProductNode = true;
                                        break;
                                    }
                                }

                                if(alreadyExistsByProductNode === false)
                                {
                                    this.graphNodes.push({data: {
                                        id                  : options.visId + '_byProduct',
                                        nodeType            : 'byProductItem',
                                        itemId              : byProductId,
                                        qtyUsed             : 0,
                                        qtyProduced         : byProductQty,
                                        neededQty           : byProductQty,
                                        image               : this.items[byProductId].image
                                    }});

                                    // Push new edges between node and parent
                                    this.graphEdges.push({data: {
                                        id                  : currentParentVisId + '_' + options.visId + '_byProduct',
                                        source              : currentParentVisId,
                                        target              : options.visId + '_byProduct',
                                        itemId              : byProductId,
                                        recipe              : options.recipe,
                                        qty                 : byProductQty
                                    }});
                                }
                            }
                        }
                    }

                    if(productionRecipe !== false)
                    {
                        for(let recipeItemClassName in productionRecipe)
                        {
                            let recipeItemId    = this.getItemIdFromClassName(recipeItemClassName);
                            let requiredQty     = (60 / productionCraftingTime * productionRecipe[recipeItemClassName]) * qtyUsed / qtyProduced;
                            let currentRecipe   = this.getRecipeToProduceItemId(recipeItemId);

                            if(currentRecipe !== null)
                            {
                                while(requiredQty > 0)
                                {
                                    // Can we use by product?
                                    let usesByProduct = false;
                                        for(let i = 0; i < this.graphNodes.length; i ++)
                                        {
                                            if(this.graphNodes[i].data.nodeType === 'byProductItem')
                                            {
                                                if(this.graphNodes[i].data.itemId === recipeItemId)
                                                {
                                                    let remainingQty    = this.graphNodes[i].data.qtyProduced - this.graphNodes[i].data.qtyUsed;
                                                    let useQty          = Math.min(remainingQty, requiredQty);

                                                        if(useQty < 0)
                                                        {
                                                            useQty = remainingQty;
                                                        }

                                                    if(remainingQty > 0 && useQty > 0)
                                                    {
                                                        // Edge?
                                                        let haveFoundByProductEdge = false;
                                                            for(let j = 0; j < this.graphEdges.length; j++)
                                                            {
                                                                if(this.graphEdges[j].data.source === this.graphNodes[i].data.id && this.graphEdges[j].data.target === currentParentVisId)
                                                                {
                                                                    this.graphEdges[j].data.qty    += useQty;
                                                                    haveFoundByProductEdge         = true;
                                                                    break;
                                                                }
                                                            }

                                                            if(haveFoundByProductEdge === false)
                                                            {
                                                                this.graphEdges.push({data: {
                                                                    id                  : this.graphNodes[i].data.id + '_' + currentParentVisId,
                                                                    source              : this.graphNodes[i].data.id,
                                                                    target              : currentParentVisId,
                                                                    itemId              : recipeItemId,
                                                                    qty                 : useQty
                                                                }});
                                                            }

                                                        this.graphNodes[i].data.qtyUsed    += useQty;
                                                        requiredQty                        -= useQty;
                                                        usesByProduct                       = true;

                                                        break;
                                                    }
                                                }
                                            }
                                        }

                                    if(usesByProduct === false)
                                    {
                                        // Regular node...
                                        let qtyProducedByNode = this.buildCurrentNodeTree({
                                            id              : recipeItemId,
                                            recipe          : currentRecipe,
                                            qty             : requiredQty,
                                            visId           : currentParentVisId,
                                            level           : (options.level + 1)
                                        });

                                        if(qtyProducedByNode !== false)
                                        {
                                            // Reduce needed quantity
                                            requiredQty     -= qtyProducedByNode;
                                        }
                                        else
                                        {
                                            break; //Prevent infinite loop...
                                        }
                                    }
                                }
                            }
                            else
                            {
                                // Can we use by last node yet?
                                let usesLastNode = false;
                                    for(let i = 0; i < this.graphNodes.length; i ++)
                                    {
                                        if(this.graphNodes[i].data.nodeType === 'lastNodeItem')
                                        {
                                            if(this.graphNodes[i].data.itemId === recipeItemId)
                                            {
                                                // Add edge between byProduct and item..
                                                this.graphEdges.push({data: {
                                                    id                  : this.graphNodes[i].data.id + '_' + currentParentVisId,
                                                    source              : this.graphNodes[i].data.id,
                                                    target              : currentParentVisId,
                                                    itemId              : recipeItemId,
                                                    qty                 : requiredQty
                                                }});

                                                this.graphNodes[i].data.neededQty += requiredQty;
                                                usesLastNode                       = true;

                                                break;
                                            }
                                        }
                                    }

                                    if(usesLastNode === false)
                                    {
                                        let lastNodeVisId = currentParentVisId + '_' + recipeItemId;

                                            // Push last node!
                                            this.graphNodes.push({data: {
                                                id                  : lastNodeVisId,
                                                nodeType            : 'lastNodeItem',
                                                itemId              : recipeItemId,
                                                neededQty           : requiredQty,
                                                image               : this.items[recipeItemId].image
                                            }});

                                            // Push new edges between node and parent
                                            this.graphEdges.push({data: {
                                                id                  : lastNodeVisId + '_' + currentParentVisId,
                                                source              : lastNodeVisId,
                                                target              : currentParentVisId,
                                                itemId              : recipeItemId,
                                                useAlternateRecipe  : null,
                                                qty                 : requiredQty
                                            }});
                                    }
                            }
                        }
                    }

                    return qtyUsed;
            }

        return false;
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
                        // Basic building
                        if(this.buildings[nodeData.buildingType].powerUsed !== undefined)
                        {
                            powerUsage = this.buildings[nodeData.buildingType].powerUsed;
                        }
                        // Fracking exrtractor
                        if(nodeData.buildingType === 'Build_FrackingExtractor_C')
                        {
                            //TODO: Average power based on max Extractor?
                            powerUsage = this.buildings.Build_FrackingSmasher_C.powerUsed;
                        }
                        // Custom recipe power usage (AVERAGE)
                        if(this.buildings[nodeData.buildingType].powerUsedRecipes !== undefined && this.buildings[nodeData.buildingType].powerUsedRecipes[nodeData.recipe] !== undefined)
                        {
                            powerUsage = (this.buildings[nodeData.buildingType].powerUsedRecipes[nodeData.recipe][0] + this.buildings[nodeData.buildingType].powerUsedRecipes[nodeData.recipe][1]) / 2;
                        }

                        this.requiredPower     += (nodeData.qtyUsed / nodeData.qtyProducedDefault) * (powerUsage * Math.pow(1, 1.6));
                }
        }
    }




    treeListProductionBuilding(performanceColor, performance)
    {
        //html.push(' <em style="color: ' + this.graphNodes[k].data.performanceColor + '">(' + k + ')</em>'); // DEBUG
        return ' <em style="color: ' + performanceColor + '">(x' + performance / 100 + ')</em>';
        //html.push(' <em style="color: ' + this.graphNodes[k].data.performanceColor + '">(' + this.graphNodes[k].data.qtyUsed + ' / ' + this.graphNodes[k].data.qtyProduced + ')</em>'); // DEBUG
    }
}