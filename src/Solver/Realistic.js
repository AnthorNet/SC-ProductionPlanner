/* global Intl */

import Worker_Wrapper   from '../Worker/Wrapper.js';

export default class Solver_Realistic extends Worker_Wrapper
{
    constructor(worker)
    {
        super(worker);

        this.options        = {
            useManifolds                : 1,
            mergeBuildings              : 1,
            maxLevel                    : null,

            availablePowerShards        : 0,
            allowMinerOverclocking      : true,
            allowPumpOverclocking       : true,
            allowBuildingOverclocking   : true
        };
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

            if(this.options.oreType === 'Build_MinerMk1_C')
            {
                delete this.buildings.Build_MinerMk3_C;
                delete this.buildings.Build_MinerMk2_C;
            }

            if(this.options.oreType === 'Build_MinerMk2_C')
            {
                delete this.buildings.Build_MinerMk3_C;
            }

            if(this.options.oreType !== 'Build_MinerMk2_C' || this.options.oreSpeed !== 'normal')
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

            if(this.options.oilType !== 'Build_OilPump_C' || this.options.oilSpeed !== 'normal')
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

            if(this.options.waterType !== 'Build_WaterPump_C' || this.options.waterSpeed !== 'normal')
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

            if(this.options.gasType !== 'Build_FrackingExtractor_C' || this.options.gasSpeed !== 'normal')
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
        // Parse required items!
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

        // Merge nodes when possible!
        if(this.options.mergeBuildings === 1)
        {
            this.postMessage({type: 'updateLoaderText', text: 'Improving buildings efficiency...'});

            // Loop backwards so the miners/pumps are overclocked before the production buildings ;)
            for(let pass = 1; pass <= 2; pass++)
            {
                for(let i = this.graphNodes.length - 1; i >= 0 ; i--)
                {
                    for(let j = this.graphNodes.length - 1; j >= 0 ; j--)
                    {
                        if(i !== j && this.graphNodes[i] !== undefined && this.graphNodes[j] !== undefined) // Not yet tested...
                        {
                            let mergingNodeData = this.graphNodes[i].data;
                            let sourceNodeData  = this.graphNodes[j].data;

                            if(
                                   mergingNodeData.nodeType === 'productionBuilding' && mergingNodeData.nodeType === sourceNodeData.nodeType && mergingNodeData.id !== sourceNodeData.id
                                // Both nodes needs to have the same recipe ^^
                                && mergingNodeData.recipe === sourceNodeData.recipe
                                && sourceNodeData.clockSpeed === 100 // Not touched yet!
                            )
                            {
                                // Can we apply some overclocking?
                                if(this.options.mergeBuildings === 1 && this.options.availablePowerShards > 0 && (mergingNodeData.qtyUsed + sourceNodeData.qtyUsed) > mergingNodeData.qtyProduced && mergingNodeData.clockSpeed < 250)
                                {
                                    let allowSourceNodeOverclocking = false;
                                        if(mergingNodeData.buildingType.startsWith('Build_MinerMk') && this.options.allowMinerOverclocking === true)
                                        {
                                            allowSourceNodeOverclocking = true;
                                        }
                                        if(mergingNodeData.buildingType.startsWith('Build_OilPump') && this.options.allowPumpOverclocking === true)
                                        {
                                            allowSourceNodeOverclocking = true;
                                        }
                                        if(mergingNodeData.buildingType.startsWith('Build_MinerMk') === false && mergingNodeData.buildingType.startsWith('Build_OilPump') === false && this.options.allowBuildingOverclocking === true)
                                        {
                                            allowSourceNodeOverclocking = true;
                                        }

                                        if(allowSourceNodeOverclocking === true)
                                        {
                                            while(this.options.availablePowerShards > 0 && (mergingNodeData.qtyUsed + sourceNodeData.qtyUsed) > mergingNodeData.qtyProduced && mergingNodeData.clockSpeed < 250)
                                            {
                                                this.options.availablePowerShards--;
                                                mergingNodeData.clockSpeed += 50;

                                                mergingNodeData.qtyProduced = mergingNodeData.qtyProducedDefault * mergingNodeData.clockSpeed / 100;
                                            }
                                        }
                                }

                                if(mergingNodeData.qtyUsed < mergingNodeData.qtyProduced)
                                {
                                    let maxMergedQty        = mergingNodeData.qtyUsed + sourceNodeData.qtyUsed;
                                    let mergedPercentage    = 100;
                                    let maxBeltSpeed        = this.options.maxBeltSpeed;
                                        if(mergingNodeData.buildingType === 'Build_OilPump_C' || mergingNodeData.buildingType === 'Build_WaterPump_C' || mergingNodeData.buildingType === 'Build_FrackingExtractor_C')
                                        {
                                            maxBeltSpeed = this.options.maxPipeSpeed;
                                        }
                                        if(this.items[mergingNodeData.itemOut].category === 'liquid' || this.items[mergingNodeData.itemOut].category === 'gas')
                                        {
                                            maxBeltSpeed = this.options.maxPipeSpeed;
                                        }
                                    let mergedQty       = Math.min(maxMergedQty, mergingNodeData.qtyProduced, maxBeltSpeed);
                                        if(mergedQty < maxMergedQty)
                                        {
                                            mergedPercentage = (mergedQty - mergingNodeData.qtyUsed) / (maxMergedQty - mergingNodeData.qtyUsed) * 100;
                                        }

                                    if((mergedQty <= mergingNodeData.qtyProduced && mergedQty <= maxBeltSpeed))
                                    {
                                        // Tests if input/output are allowed to that new speed...
                                        let canMergeInputs  = this.testEdgesMaxSpeeds(mergingNodeData, sourceNodeData, mergedPercentage);
                                            if(canMergeInputs === true && mergedPercentage === 100)
                                            {
                                                // Update edges!
                                                for(let k = 0; k < this.graphEdges.length; k++)
                                                {
                                                    if(this.graphEdges[k] !== undefined)
                                                    {
                                                        if(this.graphEdges[k].data.source === sourceNodeData.id)
                                                        {
                                                            this.graphEdges[k].data.source = mergingNodeData.id;
                                                        }
                                                        if(this.graphEdges[k].data.target === sourceNodeData.id)
                                                        {
                                                            this.graphEdges[k].data.target = mergingNodeData.id;
                                                        }
                                                    }
                                                }

                                                delete this.graphNodes[j];

                                                mergingNodeData.qtyUsed     = mergedQty;
                                            }
                                        /**/
                                        if(1 === 2 && canMergeInputs === true && mergedPercentage < 100 && pass === 2)
                                        {
                                            mergingNodeData.qtyUsed  = mergedQty;
                                            sourceNodeData.qtyUsed  -= sourceNodeData.qtyUsed * (mergedPercentage / 100);

                                            if(sourceNodeData.qtyUsed === 0)
                                            {
                                                delete this.graphNodes[j];
                                            }
                                            else
                                            {
                                                for(let k = 0; k < this.graphEdges.length; k++)
                                                {
                                                    if(this.graphEdges[k] !== undefined)
                                                    {
                                                        if(this.graphEdges[k].data.source === sourceNodeData.id || this.graphEdges[k].data.target === sourceNodeData.id)
                                                        {
                                                            let removedQty = this.graphEdges[k].data.qty * (mergedPercentage / 100);
                                                                this.graphEdges[k].data.qty -= removedQty;

                                                            for(let m = 0; m < this.graphEdges.length; m++)
                                                            {
                                                                if(this.graphEdges[m] !== undefined)
                                                                {
                                                                    if(m !== k && (this.graphEdges[m].data.source === mergingNodeData.id || this.graphEdges[m].data.target === mergingNodeData.id) && this.graphEdges[k].data.itemId === this.graphEdges[m].data.itemId)
                                                                    {
                                                                        this.graphEdges[m].data.qty += removedQty;
                                                                        break;
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        /**/
                                    }
                                }
                            }
                        }
                    }
                }

                // Update previous merged edges...
                for(let i = 0; i < this.graphEdges.length; i++)
                {
                    for(let j = 0; j < this.graphEdges.length; j++)
                    {
                        if(i !== j && this.graphEdges[i] !== undefined && this.graphEdges[j] !== undefined) // Not yet tested...
                        {
                            if(this.graphEdges[i].data.source === this.graphEdges[j].data.source && this.graphEdges[i].data.target === this.graphEdges[j].data.target)
                            {
                                this.graphEdges[i].data.qty += this.graphEdges[j].data.qty;
                                delete this.graphEdges[j];
                            }
                        }
                    }
                }
            }
        }

        if(this.options.useManifolds === 1)
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
                                    useAlternateRecipe  : mergers[i].origin.data.useAlternateRecipe,
                                    qty                 : currentMergerTargetQty
                                }});
                            }
                        }

                        this.graphEdges.push({data: {
                            id                  : mergers[i].mergerSources[k].data.source + '_' + currentMergerId,
                            source              : mergers[i].mergerSources[k].data.source,
                            target              : currentMergerId,
                            itemId              : mergers[i].mergerSources[k].data.itemId,
                            useAlternateRecipe  : mergers[i].mergerSources[k].data.useAlternateRecipe,
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
                                useAlternateRecipe  : splitters[i].origin.data.useAlternateRecipe,
                                qty                 : currentSplitterSourceQty
                            }});
                        }

                        this.graphEdges.push({data: {
                            id                  : currentSplitterId + '_' + splitters[i].splitterTargets[k].data.target,
                            source              : currentSplitterId,
                            target              : splitters[i].splitterTargets[k].data.target,
                            itemId              : splitters[i].splitterTargets[k].data.itemId,
                            useAlternateRecipe  : splitters[i].splitterTargets[k].data.useAlternateRecipe,
                            qty                 : splitters[i].splitterTargets[k].data.qty
                        }});

                        currentSplitterSourceQty -= splitters[i].splitterTargets[k].data.qty;
                    }
                }
            }
        }

        // Remove empty arrays ;)
        this.graphNodes = this.graphNodes.filter(function(element){ return element !== undefined; });
        this.graphEdges = this.graphEdges.filter(function(element){ return element !== undefined; });
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
                this.postMessage({type: 'updateLoaderText', text: 'Calculating production of ' + new Intl.NumberFormat(this.language).format(mainRequiredQty / 1000) + 'm³ ' + this.items[itemKey].name + '...'});
            }
            else
            {
                this.postMessage({type: 'updateLoaderText', text: 'Calculating production of ' + new Intl.NumberFormat(this.language).format(mainRequiredQty) + ' ' + this.items[itemKey].name + '...'});
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
                let usesByProduct = false;

                // Can we use by product?
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
                                // Add edge between byProduct and item..
                                this.graphEdges.push({data: {
                                    id                  : this.graphNodes[i].data.id + '_' + mainNodeVisId,
                                    source              : this.graphNodes[i].data.id,
                                    target              : mainNodeVisId,
                                    itemId              : itemKey,
                                    qty                 : useQty
                                }});

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
                        break; //Prevent infinite loop (Kind of :D)...
                    }
                }
            }
        }
    }

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

                    let currentParentVisId  = buildingId + '_'  + this.nodeIdKey,
                        qtyProduced         = (60 / productionCraftingTime * productionPieces),
                        qtyUsed             = Math.min(qtyProduced, options.qty);

                        // Should we reduce building speed for belts?
                        if(productionRecipe !== false)
                        {
                            let isTooFast = true;
                                while(isTooFast === true)
                                {
                                    isTooFast = false;

                                    if(qtyProduced > 0)
                                    {
                                        for(let recipeItemClassName in productionRecipe)
                                        {
                                            let requiredQty             = (60 / productionCraftingTime * productionRecipe[recipeItemClassName]) * qtyUsed / qtyProduced;
                                            let recipeItemId            = this.getItemIdFromClassName(recipeItemClassName);
                                            let maxProductionSpeed      = this.options.maxBeltSpeed;

                                                if(this.items[recipeItemId] !== undefined && (this.items[recipeItemId].category === 'liquid' || this.items[recipeItemId].category === 'gas'))
                                                {
                                                    maxProductionSpeed  = this.options.maxPipeSpeed;
                                                }
                                                if(requiredQty > maxProductionSpeed)
                                                {
                                                    isTooFast = true;
                                                    qtyUsed--;
                                                    break;
                                                }
                                        }
                                    }
                                }
                        }

                    // Push new node!
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

                    // Add supplementalLoadType
                    if(this.buildings[buildingId].supplementalLoadType !== undefined)
                    {

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
                                        alreadyExistsByProductNode = true;

                                        this.graphNodes[k].data.qtyProduced  += byProductQty;
                                        this.graphNodes[k].data.neededQty    += byProductQty;

                                        // Push new edges between node and parent
                                        this.graphEdges.push({data: {
                                            id                  : currentParentVisId + '_' + this.graphNodes[k].data.id,
                                            source              : currentParentVisId,
                                            target              : this.graphNodes[k].data.id,
                                            itemId              : byProductId,
                                            recipe              : options.recipe,
                                            qty                 : byProductQty
                                        }});

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

                            if(this.options.maxLevel !== null && this.options.maxLevel === (options.level + 1) && this.items[recipeItemId].category !== 'ore' && recipeItemId !== '/Game/FactoryGame/Resource/RawResources/CrudeOil/Desc_LiquidOil.Desc_LiquidOil_C' && recipeItemId !== '/Game/FactoryGame/Resource/RawResources/Water/Desc_Water.Desc_Water_C')
                            {
                                // Find already last level item!
                                let alreadyExistsLastNode = false;
                                    for(let k = 0; k < this.graphNodes.length; k++)
                                    {
                                        if(this.graphNodes[k].data.nodeType === 'lastNodeItem' && this.graphNodes[k].data.itemId === recipeItemId)
                                        {
                                            alreadyExistsLastNode = true;

                                            this.graphNodes[k].data.neededQty  += requiredQty;
                                            this.graphEdges.push({data: {
                                                id                  : this.graphNodes[k].data.id + '_' + currentParentVisId,
                                                source              : this.graphNodes[k].data.id,
                                                target              : currentParentVisId,
                                                itemId              : recipeItemId,
                                                qty                 : requiredQty
                                            }});

                                            break;
                                        }
                                    }

                                if(alreadyExistsLastNode === false)
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
                                            qty                 : requiredQty
                                        }});
                                }
                            }
                            else
                            {
                                let currentRecipe           = this.getRecipeToProduceItemId(recipeItemId);

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

                                                                // Add edge between byProduct and item..
                                                                this.graphEdges.push({data: {
                                                                    id                  : this.graphNodes[i].data.id + '_' + currentParentVisId,
                                                                    source              : this.graphNodes[i].data.id,
                                                                    target              : currentParentVisId,
                                                                    itemId              : recipeItemId,
                                                                    qty                 : useQty
                                                                }});

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
                    }

                    return qtyUsed;
            }

        return false;
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
                    let performance                                 = (nodeData.qtyUsed / nodeData.qtyProducedDefault * 100);

                        this.graphNodes[i].data.label   = this.buildings[nodeData.buildingType].name
                                                        + ' (' + new Intl.NumberFormat(this.language).format(Math.round(performance)) + '%)'
                                                        + '\n' + '(' + this.recipes[this.graphNodes[i].data.recipe].name + ')'
                                                        //+ '\n' + '(' + nodeData.id + ')' // DEBUG
                                                        //+ '\n' + '(' + nodeData.qtyUsed + '/' + nodeData.qtyProduced + ')' // DEBUG
                                                        ;

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

                    // Calculate required power!
                    let powerUsage = 0;
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

                            this.requiredPower     += powerUsage * Math.pow(performance / 100, 1.321929); // Update 7
                            //this.requiredPower     += powerUsage * Math.pow(performance / 100, 1.6);
                        }
                }
        }

        for(let recipeId in frackingExtractors)
        {
            this.requiredPower += Math.ceil(frackingExtractors[recipeId] / 6) * this.buildings.Build_FrackingSmasher_C.powerUsed;
        }
    }



    testEdgesMaxSpeeds(mergingNodeData, sourceNodeData, mergedPercentage)
    {
        let inputQty        = {};
            for(let k = 0; k < this.graphEdges.length; k++)
            {
                if(this.graphEdges[k] !== undefined)
                {
                    if(this.graphEdges[k].data.target === mergingNodeData.id || this.graphEdges[k].data.target === sourceNodeData.id)
                    {
                        if(inputQty[this.graphEdges[k].data.itemId] === undefined)
                        {
                            inputQty[this.graphEdges[k].data.itemId] = 0;
                        }

                        inputQty[this.graphEdges[k].data.itemId] += this.graphEdges[k].data.qty * (mergedPercentage / 100);

                        let currentMaxMergedQty = this.options.maxBeltSpeed;
                            if(this.items[this.graphEdges[k].data.itemId].category === 'liquid' || this.items[this.graphEdges[k].data.itemId].category === 'gas')
                            {
                                currentMaxMergedQty = this.options.maxPipeSpeed;
                            }

                            if(inputQty[this.graphEdges[k].data.itemId] > currentMaxMergedQty)
                            {
                                return false;
                            }
                    }
                }
            }

        return true;
    }
}