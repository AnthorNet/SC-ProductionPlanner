/* global self, Intl */

export default function ProductionPlannerWorker()
{
    self.baseUrls       = {};
    self.url            = {};

    self.debug          = false;
    self.locale         = 'en';
    self.translate      = {};

    self.options        = {
        viewMode                    : 'REALISTIC',

        useManifolds                : 1,
        mergeBuildings              : 1,
        maxLevel                    : null,
        maxBeltSpeed                : 780,
        maxPipeSpeed                : 600000,

        oreType                     : 'Build_MinerMk2_C',
        oreSpeed                    : 'normal',
        oilType                     : 'Build_OilPump_C',
        oilSpeed                    : 'normal',
        waterType                   : 'Build_WaterPump_C',
        waterSpeed                  : 'normal',
        gasType                     : 'Build_FrackingExtractor_C',
        gasSpeed                    : 'normal',

        availablePowerShards        : 0,
        allowMinerOverclocking      : true,
        allowPumpOverclocking       : true,
        allowBuildingOverclocking   : true,
    };

    self.buildings      = {};
    self.items          = {};
    self.tools          = {};
    self.recipes        = {};

    self.inputItems     = {};
    self.requestedItems = {};
    self.requiredPower  = 0;
    self.listItems      = {};
    self.listBuildings  = {};

    self.nodeIdKey      = 0;
    self.graphNodes     = [];
    self.graphEdges     = [];
    self.graphDirection = 'RIGHT';

    self.onmessage = function(e) {
        self.postMessage({type: 'showLoader'});

        // Add default
        self.baseUrls       = e.data.baseUrls;
        self.debug          = e.data.debug;
        self.locale         = e.data.locale;
        self.translate      = e.data.translate;

        self.buildings      = e.data.buildings;
        self.items          = e.data.items;
        self.tools          = e.data.tools;
        self.recipes        = e.data.recipes;

        self.prepareOptions(e.data.formData);
    };

    self.prepareOptions = function(formData) {
        self.postMessage({type: 'updateLoaderText', text: 'Checking requested items...'});
        for(let itemKey in self.items)
        {
            if(formData[itemKey] !== undefined && self.items[itemKey] !== undefined)
            {
                self.url[itemKey] = formData[itemKey];
                self.requestedItems[itemKey] = formData[itemKey];
            }
        }

        if(formData.input !== undefined)
        {
            self.url.input  = formData.input
            self.inputItems = formData.input;
        }

        if(formData.direction !== undefined && self.graphDirection !== formData.direction)
        {
            self.url.direction  = formData.direction;
            self.graphDirection = formData.direction;
        }

        if(formData.view !== undefined && formData.view !== 'REALISTIC')
        {
            self.url.view           = formData.view;
            self.options.viewMode   = formData.view;

            // If using SIMPLE view, reset some other options
            if(formData.view === 'SIMPLE')
            {
                delete formData.mergeBuildings; // Merge buildings
                delete formData.useManifolds;
                self.options.useManifolds = 0;  // Don't use manifolds

                // Reset max speeds
                delete formData.maxBeltSpeed;
                delete formData.maxPipeSpeed;

                delete formData.oreExtraction;
                delete formData.oilExtraction;
                delete formData.waterExtraction;
                delete formData.gasExtraction;

                // Reset overclocking
                delete formData.powerShards;
                delete formData.minerOverclocking;
                delete formData.pumpOverclocking;
                delete formData.buildingOverclocking;

                delete formData.maxLevel;
            }
        }

        if(formData.activatedMods !== undefined && formData.activatedMods.length > 0)
        {
            self.url.mods = [];
            for(let i = 0; i < formData.activatedMods.length; i++)
            {
                self.url.mods.push(formData.activatedMods[i].data.id);
            }
        }

        if(formData.mergeBuildings !== undefined)
        {
            self.url.mergeBuildings     = formData.mergeBuildings;
            self.options.mergeBuildings = parseInt(formData.mergeBuildings);

            if(self.options.mergeBuildings !== 1)
            {
                delete formData.powerShards;
            }
        }

        if(formData.useManifolds !== undefined)
        {
            self.url.useManifolds       = formData.useManifolds;
            self.options.useManifolds   = parseInt(formData.useManifolds);
        }

        if(formData.maxLevel !== undefined)
        {
            self.url.maxLevel       = formData.maxLevel;
            self.options.maxLevel   = parseInt(formData.maxLevel);
        }

        if(formData.maxBeltSpeed !== undefined)
        {
            if(self.options.maxBeltSpeed !== parseInt(formData.maxBeltSpeed))
            {
                self.url.maxBeltSpeed = formData.maxBeltSpeed;
            }

            self.options.maxBeltSpeed = parseInt(formData.maxBeltSpeed);
        }

        if(formData.maxPipeSpeed !== undefined)
        {
            if(self.options.maxPipeSpeed !== parseInt(formData.maxPipeSpeed))
            {
                self.url.maxPipeSpeed = formData.maxPipeSpeed;
            }

            self.options.maxPipeSpeed = parseInt(formData.maxPipeSpeed);
        }

        self.postMessage({type: 'updateLoaderText', text: 'Applying extration rates...'});
        if(formData.oreExtraction !== undefined)
        {
            let oreOptions = formData.oreExtraction.split(';');
                if(oreOptions.length === 2)
                {
                    self.options.oreType    = oreOptions[0];
                    self.options.oreSpeed   = oreOptions[1];
                }

            if(self.options.oreType === 'Build_MinerMk1_C')
            {
                delete self.buildings.Build_MinerMk3_C;
                delete self.buildings.Build_MinerMk2_C;
            }

            if(self.options.oreType === 'Build_MinerMk2_C')
            {
                delete self.buildings.Build_MinerMk3_C;
            }

            if(self.options.oreType !== 'Build_MinerMk2_C' || self.options.oreSpeed !== 'normal')
            {
                self.url.oreExtraction = self.options.oreType + ';' + self.options.oreSpeed;
            }
        }
        if(formData.oilExtraction !== undefined)
        {
            let oilOptions = formData.oilExtraction.split(';');
                if(oilOptions.length === 2)
                {
                    self.options.oilType    = oilOptions[0];
                    self.options.oilSpeed   = oilOptions[1];
                }

            if(self.options.oilType !== 'Build_OilPump_C' || self.options.oilSpeed !== 'normal')
            {
                self.url.oilExtraction = self.options.oilType + ';' + self.options.oilSpeed;
            }
        }
        if(formData.waterExtraction !== undefined)
        {
            let waterOptions = formData.waterExtraction.split(';');
                if(waterOptions.length === 2)
                {
                    self.options.waterType  = waterOptions[0];
                    self.options.waterSpeed = waterOptions[1];
                }

            if(self.options.waterType !== 'Build_WaterPump_C' || self.options.waterSpeed !== 'normal')
            {
                self.url.waterExtraction = self.options.waterType + ';' + self.options.waterSpeed;
            }
        }
        if(formData.gasExtraction !== undefined)
        {
            let gasOptions = formData.gasExtraction.split(';');
                if(gasOptions.length === 2)
                {
                    self.options.gasType    = gasOptions[0];
                    self.options.gasSpeed   = gasOptions[1];
                }

            if(self.options.gasType !== 'Build_FrackingExtractor_C' || self.options.gasSpeed !== 'normal')
            {
                self.url.gasExtraction = self.options.gasType + ';' + self.options.gasSpeed;
            }
        }

        if(formData.altRecipes !== undefined)
        {
            self.postMessage({type: 'updateLoaderText', text: 'Applying alternative recipes...'});

            self.options.altRecipes = [];
            for(let i = 0; i < formData.altRecipes.length; i++)
            {
                let recipeKey = formData.altRecipes[i];
                    if(self.recipes[recipeKey] !== undefined)
                    {
                        self.options.altRecipes.push(recipeKey);
                    }
            }

            if(self.options.altRecipes.length > 0)
            {
                self.url.altRecipes = self.options.altRecipes;
            }
        }

        if(self.options.mergeBuildings === 1 && formData.powerShards !== undefined && formData.powerShards > 0)
        {
            self.options.availablePowerShards           = parseInt(formData.powerShards);
            self.url.powerShards                        = formData.powerShards;

            if(formData.minerOverclocking !== undefined && formData.minerOverclocking !== 1)
            {
                self.options.allowMinerOverclocking     = false;
                self.url.minerOverclocking              = formData.minerOverclocking;
            }
            if(formData.pumpOverclocking !== undefined && formData.pumpOverclocking !== 1)
            {
                self.options.allowPumpOverclocking      = false;
                self.url.pumpOverclocking               = formData.pumpOverclocking;
            }
            if(formData.buildingOverclocking !== undefined && formData.buildingOverclocking !== 1)
            {
                self.options.allowBuildingOverclocking  = false;
                self.url.buildingOverclocking           = formData.buildingOverclocking;
            }
        }

        self.postMessage({type: 'updateUrl', url: self.url});
        self.startCalculation();
    };

    self.startCalculation = function() {
        // Add pseudo-by products for inputs...
        for(let itemKey in self.inputItems)
        {
            let requestedQty = parseFloat(self.inputItems[itemKey]);
            let maxMergedQty = self.options.maxBeltSpeed;

                if(self.items[itemKey].category === 'liquid' || self.items[itemKey].category === 'gas')
                {
                    requestedQty *= 1000;
                    maxMergedQty = self.options.maxPipeSpeed;
                }

                while(requestedQty >= maxMergedQty)
                {
                    let mainNodeVisId  = itemKey + '_' + self.nodeIdKey;
                        self.nodeIdKey++;

                        self.graphNodes.push({data: {
                            id                  : mainNodeVisId + '_byProduct',
                            nodeType            : 'byProductItem',
                            itemId              : itemKey,
                            qtyUsed             : 0,
                            qtyProduced         : maxMergedQty,
                            neededQty           : maxMergedQty,
                            image               : self.items[itemKey].image
                        }});

                        requestedQty -= maxMergedQty;
                }

                if(requestedQty > 0)
                {
                    let mainNodeVisId  = itemKey + '_' + self.nodeIdKey;
                        self.nodeIdKey++;

                        self.graphNodes.push({data: {
                            id                  : mainNodeVisId + '_byProduct',
                            nodeType            : 'byProductItem',
                            itemId              : itemKey,
                            qtyUsed             : 0,
                            qtyProduced         : requestedQty,
                            neededQty           : requestedQty,
                            image               : self.items[itemKey].image
                        }});
                }
        }

        // Parse required items!
        for(let itemKey in self.requestedItems)
        {
            let requestedQty = self.requestedItems[itemKey];
            let maxMergedQty = self.options.maxBeltSpeed;

                if(self.items[itemKey].category === 'liquid' || self.items[itemKey].category === 'gas')
                {
                    requestedQty *= 1000;
                    maxMergedQty = self.options.maxPipeSpeed;
                }

            while(requestedQty >= maxMergedQty)
            {
                self.startMainNode(itemKey, ((self.items[itemKey].category === 'liquid' || self.items[itemKey].category === 'gas') ? (maxMergedQty / 1000) : maxMergedQty));
                requestedQty -= maxMergedQty;
            }

            if(requestedQty > 0)
            {
                self.startMainNode(itemKey, ((self.items[itemKey].category === 'liquid' || self.items[itemKey].category === 'gas') ? (requestedQty / 1000) : requestedQty));
            }
        }

        // Merge nodes when possible!
        if(self.options.mergeBuildings === 1 || self.options.viewMode === 'SIMPLE')
        {
            if(self.options.viewMode === 'SIMPLE')
            {
                self.postMessage({type: 'updateLoaderText', text: 'Merging all buildings...'});
            }
            if(self.options.mergeBuildings === 1)
            {
                self.postMessage({type: 'updateLoaderText', text: 'Improving buildings efficiency...'});
            }

            // Loop backwards so the miners/pumps are overclocked before the production buildings ;)
            for(let pass = 1; pass <= 2; pass++)
            {
                for(let i = self.graphNodes.length - 1; i >= 0 ; i--)
                {
                    for(let j = self.graphNodes.length - 1; j >= 0 ; j--)
                    {
                        if(i !== j && self.graphNodes[i] !== undefined && self.graphNodes[j] !== undefined) // Not yet tested...
                        {
                            let mergingNodeData = self.graphNodes[i].data;
                            let sourceNodeData  = self.graphNodes[j].data;

                            if(
                                   mergingNodeData.nodeType === 'productionBuilding' && mergingNodeData.nodeType === sourceNodeData.nodeType && mergingNodeData.id !== sourceNodeData.id
                                // Both nodes needs to have the same recipe ^^
                                && mergingNodeData.recipe === sourceNodeData.recipe
                                && sourceNodeData.clockSpeed === 100 // Not touched yet!
                            )
                            {
                                // Can we apply some overclocking?
                                if(self.options.mergeBuildings === 1 && self.options.availablePowerShards > 0 && (mergingNodeData.qtyUsed + sourceNodeData.qtyUsed) > mergingNodeData.qtyProduced && mergingNodeData.clockSpeed < 250)
                                {
                                    let allowSourceNodeOverclocking = false;
                                        if(mergingNodeData.buildingType.startsWith('Build_MinerMk') && self.options.allowMinerOverclocking === true)
                                        {
                                            allowSourceNodeOverclocking = true;
                                        }
                                        if(mergingNodeData.buildingType.startsWith('Build_OilPump') && self.options.allowPumpOverclocking === true)
                                        {
                                            allowSourceNodeOverclocking = true;
                                        }
                                        if(mergingNodeData.buildingType.startsWith('Build_MinerMk') === false && mergingNodeData.buildingType.startsWith('Build_OilPump') === false && self.options.allowBuildingOverclocking === true)
                                        {
                                            allowSourceNodeOverclocking = true;
                                        }

                                        if(allowSourceNodeOverclocking === true)
                                        {
                                            while(self.options.availablePowerShards > 0 && (mergingNodeData.qtyUsed + sourceNodeData.qtyUsed) > mergingNodeData.qtyProduced && mergingNodeData.clockSpeed < 250)
                                            {
                                                self.options.availablePowerShards--;
                                                mergingNodeData.clockSpeed += 50;

                                                mergingNodeData.qtyProduced = mergingNodeData.qtyProducedDefault * mergingNodeData.clockSpeed / 100;
                                            }
                                        }
                                }

                                if(mergingNodeData.qtyUsed < mergingNodeData.qtyProduced || self.options.viewMode === 'SIMPLE')
                                {
                                    let maxMergedQty        = mergingNodeData.qtyUsed + sourceNodeData.qtyUsed;
                                    let mergedPercentage    = 100;
                                    let maxBeltSpeed        = self.options.maxBeltSpeed;
                                        if(mergingNodeData.buildingType === 'Build_OilPump_C' || mergingNodeData.buildingType === 'Build_WaterPump_C' || mergingNodeData.buildingType === 'Build_FrackingExtractor_C')
                                        {
                                            maxBeltSpeed = self.options.maxPipeSpeed;
                                        }
                                    let mergedQty       = Math.min(maxMergedQty, mergingNodeData.qtyProduced, maxBeltSpeed);
                                        if(self.options.viewMode === 'SIMPLE')
                                        {
                                            mergedQty   = maxMergedQty;
                                        }
                                        if(mergedQty < maxMergedQty)
                                        {
                                            mergedPercentage = (mergedQty - mergingNodeData.qtyUsed) / (maxMergedQty - mergingNodeData.qtyUsed) * 100;
                                        }

                                    if((mergedQty <= mergingNodeData.qtyProduced && mergedQty <= maxBeltSpeed) || self.options.viewMode === 'SIMPLE')
                                    {
                                        // Tests if input/output are allowed to that new speed...
                                        let canMergeInputs  = self.testEdgesMaxSpeeds(mergingNodeData, sourceNodeData, mergedPercentage);
                                            if(canMergeInputs === true && mergedPercentage === 100)
                                            {
                                                // Update edges!
                                                for(let k = 0; k < self.graphEdges.length; k++)
                                                {
                                                    if(self.graphEdges[k] !== undefined)
                                                    {
                                                        if(self.graphEdges[k].data.source === sourceNodeData.id)
                                                        {
                                                            self.graphEdges[k].data.source = mergingNodeData.id;
                                                        }
                                                        if(self.graphEdges[k].data.target === sourceNodeData.id)
                                                        {
                                                            self.graphEdges[k].data.target = mergingNodeData.id;
                                                        }
                                                    }
                                                }

                                                delete self.graphNodes[j];

                                                mergingNodeData.qtyUsed     = mergedQty;
                                            }
                                        /**/
                                        if(1 === 2 && canMergeInputs === true && mergedPercentage < 100 && pass === 2)
                                        {
                                            mergingNodeData.qtyUsed  = mergedQty;
                                            sourceNodeData.qtyUsed  -= sourceNodeData.qtyUsed * (mergedPercentage / 100);

                                            if(sourceNodeData.qtyUsed === 0)
                                            {
                                                delete self.graphNodes[j];
                                            }
                                            else
                                            {
                                                for(let k = 0; k < self.graphEdges.length; k++)
                                                {
                                                    if(self.graphEdges[k] !== undefined)
                                                    {
                                                        if(self.graphEdges[k].data.source === sourceNodeData.id || self.graphEdges[k].data.target === sourceNodeData.id)
                                                        {
                                                            let removedQty = self.graphEdges[k].data.qty * (mergedPercentage / 100);
                                                                self.graphEdges[k].data.qty -= removedQty;

                                                            for(let m = 0; m < self.graphEdges.length; m++)
                                                            {
                                                                if(self.graphEdges[m] !== undefined)
                                                                {
                                                                    if(m !== k && (self.graphEdges[m].data.source === mergingNodeData.id || self.graphEdges[m].data.target === mergingNodeData.id) && self.graphEdges[k].data.itemId === self.graphEdges[m].data.itemId)
                                                                    {
                                                                        self.graphEdges[m].data.qty += removedQty;
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
                for(let i = 0; i < self.graphEdges.length; i++)
                {
                    for(let j = 0; j < self.graphEdges.length; j++)
                    {
                        if(i !== j && self.graphEdges[i] !== undefined && self.graphEdges[j] !== undefined) // Not yet tested...
                        {
                            if(self.graphEdges[i].data.source === self.graphEdges[j].data.source && self.graphEdges[i].data.target === self.graphEdges[j].data.target)
                            {
                                self.graphEdges[i].data.qty += self.graphEdges[j].data.qty;
                                delete self.graphEdges[j];
                            }
                        }
                    }
                }
            }
        }

        if(self.options.useManifolds === 1)
        {
            self.postMessage({type: 'updateLoaderText', text: 'Building manifolds...'});

            // Add merger
            let mergers     = [];
            let mergerKey   = 0;

            for(let i = self.graphEdges.length - 1; i >= 0 ; i--)
            {
                if(self.graphEdges[i] === undefined)
                {
                    continue;
                }

                let parentEdge      = self.graphEdges[i];
                let currentMerger   = [];
                let mergerQty       = 0;
                let maxMergedQty    = self.options.maxBeltSpeed;

                    if(self.items[parentEdge.data.itemId].category === 'liquid' || self.items[parentEdge.data.itemId].category === 'gas')
                    {
                        maxMergedQty = self.options.maxPipeSpeed;
                    }

                for(let j = self.graphEdges.length - 1; j >= 0 ; j--)
                {
                    if(self.graphEdges[j] === undefined)
                    {
                        continue;
                    }

                    if(parentEdge.data.id !== self.graphEdges[j].data.id) // Not yet tested...
                    {
                        if(parentEdge.data.itemId === self.graphEdges[j].data.itemId && parentEdge.data.target === self.graphEdges[j].data.target)
                        {
                            if((mergerQty + self.graphEdges[j].data.qty) <= maxMergedQty)
                            {
                                if(self.graphEdges[j].data.qty >= 0.1)
                                {
                                    mergerQty += self.graphEdges[j].data.qty;
                                    currentMerger.push(self.graphEdges[j]);
                                }

                                delete self.graphEdges[j];
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

                    delete self.graphEdges[i];
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

                                self.graphNodes.push({data: {
                                    id          : currentMergerId,
                                    nodeType    : 'merger',
                                    itemId      : mergers[i].origin.data.itemId
                                }});

                                self.graphEdges.push({data: {
                                    id                  : 'merger_' + mergerKey + '_' + currentMergerTarget,
                                    source              : currentMergerId,
                                    target              : currentMergerTarget,
                                    itemId              : mergers[i].origin.data.itemId,
                                    useAlternateRecipe  : mergers[i].origin.data.useAlternateRecipe,
                                    qty                 : currentMergerTargetQty
                                }});
                            }
                        }

                        self.graphEdges.push({data: {
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
            for(let i = 0; i < self.graphEdges.length; i++)
            {
                let currentSplitter   = [];
                let splitterQty       = 0;

                for(let j = 0; j < self.graphEdges.length; j++)
                {
                    if(i !== j && self.graphEdges[i] !== undefined && self.graphEdges[j] !== undefined) // Not yet tested...
                    {
                        if(self.graphEdges[i].data.itemId === self.graphEdges[j].data.itemId && self.graphEdges[i].data.source === self.graphEdges[j].data.source)
                        {
                            if(self.graphEdges[j].data.qty >= 0.1)
                            {
                                splitterQty += self.graphEdges[j].data.qty;
                                currentSplitter.push(self.graphEdges[j]);
                            }
                            delete self.graphEdges[j];
                        }
                    }
                }

                if(currentSplitter.length > 0)
                {
                    if(self.graphEdges[i].data.qty >= 0.1)
                    {
                        splitterQty += self.graphEdges[i].data.qty;
                        currentSplitter.push(self.graphEdges[i]);

                        splitters.push({
                            origin: self.graphEdges[i],
                            splitterTargets: currentSplitter,
                            splitterQty: splitterQty
                        });
                    }

                    delete self.graphEdges[i];
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

                            self.graphNodes.push({data: {
                                id          : currentSplitterId,
                                nodeType    : 'splitter',
                                itemId      : splitters[i].origin.data.itemId
                            }});

                            self.graphEdges.push({data: {
                                id                  : currentSplitterSource + '_splitter_' + splitterKey,
                                source              : currentSplitterSource,
                                target              : currentSplitterId,
                                itemId              : splitters[i].origin.data.itemId,
                                useAlternateRecipe  : splitters[i].origin.data.useAlternateRecipe,
                                qty                 : currentSplitterSourceQty
                            }});
                        }

                        self.graphEdges.push({data: {
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
        self.graphNodes = self.graphNodes.filter(function(element){ return element !== undefined; });
        self.graphEdges = self.graphEdges.filter(function(element){ return element !== undefined; });

        // Clean up NODES
        self.postMessage({type: 'updateLoaderText', text: 'Cleaning buildings...'});
        for(let i = 0; i < self.graphNodes.length; i++)
        {
            let node        = self.graphNodes[i];

            if(node.data.nodeType === 'mainNode')
            {
                if(self.items[node.data.itemId].category === 'liquid' || self.items[node.data.itemId].category === 'gas')
                {
                    self.graphNodes[i].data.label   = new Intl.NumberFormat(self.locale).format(Math.round(Math.round(node.data.qty) / 1000))
                                                    + ' m³ ' + self.items[node.data.itemId].name;
                }
                else
                {
                    self.graphNodes[i].data.label   = new Intl.NumberFormat(self.locale).format(Math.ceil(node.data.qty))
                                                    + ' ' + self.items[node.data.itemId].name;
                }
            }

            if(node.data.nodeType === 'merger')
            {
                if(self.items[node.data.itemId].category === 'liquid' || self.items[node.data.itemId].category === 'gas')
                {
                    self.graphNodes[i].data.label   = self.buildings.Build_PipelineJunction_Cross_C.name + '\n(' + self.items[node.data.itemId].name + ')';
                    self.graphNodes[i].data.image   = self.buildings.Build_PipelineJunction_Cross_C.image;

                    if(self.listBuildings.Build_PipelineJunction_Cross_C === undefined)
                    {
                        self.listBuildings.Build_PipelineJunction_Cross_C = 1;
                    }
                    else
                    {
                        self.listBuildings.Build_PipelineJunction_Cross_C += 1;
                    }
                }
                else
                {
                    self.graphNodes[i].data.label   = self.buildings.Build_ConveyorAttachmentMerger_C.name + '\n(' + self.items[node.data.itemId].name + ')';
                    self.graphNodes[i].data.image   = self.buildings.Build_ConveyorAttachmentMerger_C.image;

                    if(self.listBuildings.Build_ConveyorAttachmentMerger_C === undefined)
                    {
                        self.listBuildings.Build_ConveyorAttachmentMerger_C = 1;
                    }
                    else
                    {
                        self.listBuildings.Build_ConveyorAttachmentMerger_C += 1;
                    }
                }
            }

            if(node.data.nodeType === 'splitter')
            {
                if(self.items[node.data.itemId].category === 'liquid' || self.items[node.data.itemId].category === 'gas')
                {
                    self.graphNodes[i].data.label   = self.buildings.Build_PipelineJunction_Cross_C.name + '\n(' + self.items[node.data.itemId].name + ')';
                    self.graphNodes[i].data.image   = self.buildings.Build_PipelineJunction_Cross_C.image;

                    if(self.listBuildings.Build_PipelineJunction_Cross_C === undefined)
                    {
                        self.listBuildings.Build_PipelineJunction_Cross_C = 1;
                    }
                    else
                    {
                        self.listBuildings.Build_PipelineJunction_Cross_C += 1;
                    }
                }
                else
                {
                    self.graphNodes[i].data.label   = self.buildings.Build_ConveyorAttachmentSplitter_C.name + '\n(' + self.items[node.data.itemId].name + ')';
                    self.graphNodes[i].data.image   = self.buildings.Build_ConveyorAttachmentSplitter_C.image;

                    if(self.listBuildings.Build_ConveyorAttachmentSplitter_C === undefined)
                    {
                        self.listBuildings.Build_ConveyorAttachmentSplitter_C = 1;
                    }
                    else
                    {
                        self.listBuildings.Build_ConveyorAttachmentSplitter_C += 1;
                    }
                }
            }

            if(node.data.nodeType === 'productionBuilding')
            {
                let performance                         = (node.data.qtyUsed / node.data.qtyProducedDefault * 100);
                    self.graphNodes[i].data.performance = Math.round(performance);
                let getColorForPercentage               = function(pct) {
                    pct /= 100;

                    let percentColors = [
                        { pct: 0.0, color: { r: 0xff, g: 0x00, b: 0 } },
                        { pct: 0.5, color: { r: 0xff, g: 0xff, b: 0 } },
                        { pct: 1.0, color: { r: 0x00, g: 0xff, b: 0 } }
                    ];
                    let i = 1;
                        for(i; i < percentColors.length - 1; i++)
                        {
                            if(pct < percentColors[i].pct)
                            {
                                break;
                            }
                        }

                    let lower       = percentColors[i - 1];
                    let upper       = percentColors[i];
                    let range       = upper.pct - lower.pct;
                    let rangePct    = (pct - lower.pct) / range;
                    let pctLower    = 1 - rangePct;
                    let pctUpper    = rangePct;
                    let color       = {
                        r: Math.floor(lower.color.r * pctLower + upper.color.r * pctUpper),
                        g: Math.floor(lower.color.g * pctLower + upper.color.g * pctUpper),
                        b: Math.floor(lower.color.b * pctLower + upper.color.b * pctUpper)
                    };
                    return 'rgb(' + [color.r, color.g, color.b].join(',') + ')';
                };
                    self.graphNodes[i].data.performanceColor    = getColorForPercentage(Math.min(100, Math.round(performance)));
                    self.graphNodes[i].data.borderWidth         = '15px';

                    if(self.options.viewMode === 'REALISTIC')
                    {
                        self.graphNodes[i].data.label   = self.buildings[node.data.buildingType].name
                                                        + ' (' + new Intl.NumberFormat(self.locale).format(Math.round(performance)) + '%)'
                                                        + '\n' + '(' + self.recipes[self.graphNodes[i].data.recipe].name + ')'
                                                        //+ '\n' + '(' + node.data.id + ')' // DEBUG
                                                        //+ '\n' + '(' + node.data.qtyUsed + '/' + node.data.qtyProduced + ')' // DEBUG
                                                        ;

                        if(self.graphNodes[i].data.clockSpeed > 100)
                        {
                            self.graphNodes[i].data.label  += '\n(' + Math.round((self.graphNodes[i].data.clockSpeed - 100) / 50) + ' power shards)';
                            self.graphNodes[i].data.borderWidth = Math.round((self.graphNodes[i].data.clockSpeed - 100) / 50) * 15 + 15 + 'px';
                        }
                    }

                    if(self.options.viewMode === 'SIMPLE')
                    {
                        self.graphNodes[i].data.label   = 'x' + new Intl.NumberFormat(self.locale).format(Math.ceil(performance / 10) / 10)
                                                        + ' ' + self.buildings[node.data.buildingType].name
                                                        + '\n' + '(' + self.recipes[self.graphNodes[i].data.recipe].name + ')';
                                                        //+ '(' + node.data.qtyUsed + '/' + node.data.qtyProduced + ')'; // DEBUG
                    }

                // Calculate required power!
                let powerUsage = 0
                    if(self.buildings[node.data.buildingType].powerUsed !== undefined)
                    {
                        powerUsage = self.buildings[node.data.buildingType].powerUsed;
                    }
                    if(node.data.buildingType === 'Build_FrackingExtractor_C')
                    {
                        //TODO: Average power based on max Extractor?
                        powerUsage = self.buildings.Build_FrackingSmasher_C.powerUsed;
                    }
                    if(self.buildings[node.data.buildingType].powerUsedRecipes !== undefined && self.buildings[node.data.buildingType].powerUsedRecipes[node.data.recipe] !== undefined)
                    {
                        powerUsage = (self.buildings[node.data.buildingType].powerUsedRecipes[node.data.recipe][0] + self.buildings[node.data.buildingType].powerUsedRecipes[node.data.recipe][1]) / 2;
                    }

                    if(self.options.viewMode === 'SIMPLE')
                    {
                        powerUsage  *= performance / 100;
                    }
                    else
                    {
                        powerUsage  *= Math.pow(performance / 100, 1.6);
                    }
                    self.requiredPower     += powerUsage;

                // Add to items list
                if(self.listItems[node.data.itemOut] === undefined)
                {
                    if(self.items[node.data.itemOut].category === 'liquid' || self.items[node.data.itemOut].category === 'gas')
                    {
                        self.listItems[node.data.itemOut] = node.data.qtyUsed / 1000;
                    }
                    else
                    {
                        self.listItems[node.data.itemOut] = node.data.qtyUsed;
                    }
                }
                else
                {
                    if(self.items[node.data.itemOut].category === 'liquid' || self.items[node.data.itemOut].category === 'gas')
                    {
                        self.listItems[node.data.itemOut] += node.data.qtyUsed / 1000;
                    }
                    else
                    {
                        self.listItems[node.data.itemOut] += node.data.qtyUsed;
                    }
                }

                // Add to buildgins list
                if(self.listBuildings[node.data.buildingType] === undefined)
                {
                    self.listBuildings[node.data.buildingType] = 1;
                }
                else
                {
                    self.listBuildings[node.data.buildingType] += 1;
                }
            }

            if(node.data.nodeType === 'lastNodeItem' || node.data.nodeType === 'byProductItem')
            {
                if(self.items[node.data.itemId].category === 'liquid' || self.items[node.data.itemId].category === 'gas')
                {
                    self.graphNodes[i].data.label   = new Intl.NumberFormat(self.locale).format(Math.round(Math.round(node.data.neededQty) / 1000))
                                                    + ' m³ ' + self.items[node.data.itemId].name;
                }
                else
                {
                    self.graphNodes[i].data.label   = new Intl.NumberFormat(self.locale).format(Math.ceil(node.data.neededQty))
                                                    + ' ' + self.items[node.data.itemId].name;
                }

                if(node.data.nodeType === 'byProductItem')
                {
                    self.graphNodes[i].data.label += '*';
                }

                // Add to items list
                if(self.listItems[node.data.itemId] === undefined)
                {
                    if(self.items[node.data.itemId].category === 'liquid' || self.items[node.data.itemId].category === 'gas')
                    {
                        self.listItems[node.data.itemId] = node.data.neededQty / 1000;
                    }
                    else
                    {
                        self.listItems[node.data.itemId] = node.data.neededQty;
                    }
                }
                else
                {
                    if(self.items[node.data.itemId].category === 'liquid' || self.items[node.data.itemId].category === 'gas')
                    {
                        self.listItems[node.data.itemId] += node.data.neededQty / 1000;
                    }
                    else
                    {
                        self.listItems[node.data.itemId] += node.data.neededQty;
                    }
                }
            }
        }

        // Clean up EDGES
        self.postMessage({type: 'updateLoaderText', text: 'Cleaning conveyor belts...'});
        for(let i = 0; i < self.graphEdges.length; i++)
        {
            let edge        = self.graphEdges[i];
            let itemName    = self.items[edge.data.itemId].name;

            if(edge.data.useAlternateRecipe !== undefined && edge.data.useAlternateRecipe !== null)
            {
                itemName = self.alternative[edge.data.useAlternateRecipe].name;
            }

            let roundedQty = +(Math.round(edge.data.qty * 100) / 100);
                if(roundedQty < 0.1)
                {
                    self.graphEdges[i].data.label = itemName + ' (< 0.1/min)';
                }
                else
                {
                    if(self.items[edge.data.itemId].category === 'liquid' || self.items[edge.data.itemId].category === 'gas')
                    {
                        self.graphEdges[i].data.label = itemName + ' (' + Math.round(Math.round(roundedQty) / 1000) + ' m³/min)';
                    }
                    else
                    {
                        self.graphEdges[i].data.label = itemName + ' (' + roundedQty + ' units/min)';
                    }
                }

            //TODO: Change width for MK++ belts...

            // Apply edge color
            if(self.items[edge.data.itemId].color !== undefined)
            {
                self.graphEdges[i].data.color = self.items[edge.data.itemId].color;
            }
        }
        /**/

        self.postMessage({type: 'updateRequiredPower', power: self.requiredPower});

        self.generateTreeList();
    };

    self.startMainNode = function(itemKey, mainRequiredQty) {
        console.log('startMainNode', itemKey, mainRequiredQty);

        let currentRecipe           = self.getRecipeToProduceItemId(itemKey);

            if(self.items[itemKey].category === 'liquid' || self.items[itemKey].category === 'gas')
            {
                mainRequiredQty *= 1000;
            }

        if(currentRecipe !== null)
        {
            if(self.items[itemKey].category === 'liquid' || self.items[itemKey].category === 'gas')
            {
                self.postMessage({type: 'updateLoaderText', text: 'Calculating production of ' + new Intl.NumberFormat(self.locale).format(mainRequiredQty / 1000) + 'm³ ' + self.items[itemKey].name + '...'});
            }
            else
            {
                self.postMessage({type: 'updateLoaderText', text: 'Calculating production of ' + new Intl.NumberFormat(self.locale).format(mainRequiredQty) + ' ' + self.items[itemKey].name + '...'});
            }

            let mainNodeVisId  = itemKey + '_' + self.nodeIdKey;
                self.nodeIdKey++;

            self.graphNodes.push({data: {
                id          : mainNodeVisId,
                nodeType    : 'mainNode',
                itemId      : itemKey,
                qty         : mainRequiredQty,
                image       : self.items[itemKey].image
            }});

            // Build tree...
            while(mainRequiredQty > 0)
            {
                let usesByProduct = false;

                // Can we use by product?
                for(let i = 0; i < self.graphNodes.length; i ++)
                {
                    if(self.graphNodes[i].data.nodeType === 'byProductItem')
                    {
                        if(self.graphNodes[i].data.itemId === itemKey)
                        {
                            let remainingQty    = self.graphNodes[i].data.qtyProduced - self.graphNodes[i].data.qtyUsed;
                            let useQty          = Math.min(remainingQty, mainRequiredQty);
                                if(useQty < 0)
                                {
                                    useQty = remainingQty;
                                }

                            if(remainingQty > 0 && useQty > 0)
                            {
                                // Add edge between byProduct and item..
                                self.graphEdges.push({data: {
                                    id                  : self.graphNodes[i].data.id + '_' + mainNodeVisId,
                                    source              : self.graphNodes[i].data.id,
                                    target              : mainNodeVisId,
                                    itemId              : itemKey,
                                    qty                 : useQty
                                }});

                                self.graphNodes[i].data.qtyUsed    += useQty;
                                mainRequiredQty                    -= useQty;
                                usesByProduct                       = true;
                            }
                        }
                    }
                }

                if(usesByProduct === false)
                {
                    // Regular node...
                    let qtyProducedByNode = self.buildCurrentNodeTree({
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

    self.buildCurrentNodeTree = function(options)
    {
        if(self.debug === true)
        {
            console.log('buildCurrentNodeTree', options.qty, options.recipe, options.level);
        }

        let buildingId = self.getProductionBuildingFromRecipeId(options.recipe);

            if(buildingId !== null)
            {
                let productionCraftingTime  = 4,
                    productionPieces        = 1,
                    productionRecipe        = false;

                    self.nodeIdKey++;

                    if(self.buildings[buildingId].extractionRate !== undefined)
                    {
                        productionCraftingTime  = 0.5;

                        switch(buildingId)
                        {
                            case 'Build_FrackingExtractor_C':
                                if(options.recipe === 'Recipe_CrudeOil_C')
                                {
                                    if(self.buildings[buildingId].extractionRate[self.options.oilSpeed] !== undefined)
                                    {
                                        productionCraftingTime = 60 / (self.buildings[buildingId].extractionRate[self.options.oilSpeed]);
                                    }
                                }
                                else
                                {
                                    if(options.recipe === 'Recipe_CrudeWater_C')
                                    {
                                        if(self.buildings[buildingId].extractionRate[self.options.waterSpeed] !== undefined)
                                        {
                                            productionCraftingTime = 60 / (self.buildings[buildingId].extractionRate[self.options.waterSpeed]);
                                        }
                                    }
                                    else
                                    {
                                        if(self.buildings[buildingId].extractionRate[self.options.gasSpeed] !== undefined)
                                        {
                                            productionCraftingTime = 60 / (self.buildings[buildingId].extractionRate[self.options.gasSpeed]);
                                        }
                                    }
                                }
                                break;
                            case 'Build_OilPump_C':
                                if(self.buildings[buildingId].extractionRate[self.options.oilSpeed] !== undefined)
                                {
                                    productionCraftingTime = 60 / (self.buildings[buildingId].extractionRate[self.options.oilSpeed]);
                                }
                                break;
                            case 'Build_WaterPump_C':
                                productionCraftingTime = 60 / (self.buildings[buildingId].extractionRate['normal']);
                                break;
                            default:
                                if(self.buildings[buildingId].extractionRate[self.options.oreSpeed] !== undefined)
                                {
                                    productionCraftingTime = 60 / self.buildings[buildingId].extractionRate[self.options.oreSpeed];
                                }
                        }
                    }
                    else
                    {
                        if(self.recipes[options.recipe].ingredients !== undefined)
                        {
                            productionRecipe    = self.recipes[options.recipe].ingredients;
                        }

                        if(self.recipes[options.recipe].mManufactoringDuration !== undefined)
                        {
                            productionCraftingTime  = self.recipes[options.recipe].mManufactoringDuration;
                        }

                        if(self.recipes[options.recipe].produce !== undefined)
                        {
                            for(let producedClassName in self.recipes[options.recipe].produce)
                            {
                                if(producedClassName === self.items[options.id].className)
                                {
                                    productionPieces        = self.recipes[options.recipe].produce[producedClassName];
                                }
                            }
                        }
                    }

                    let currentParentVisId  = buildingId + '_'  + self.nodeIdKey;
                    let qtyProduced         = (60 / productionCraftingTime * productionPieces);
                    let qtyUsed             = Math.min(qtyProduced, options.qty);

                        // Should we reduce building speed for belts?
                        if(productionRecipe !== false && self.options.viewMode !== 'SIMPLE')
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
                                            let recipeItemId            = self.getItemIdFromClassName(recipeItemClassName);
                                            let maxProductionSpeed      = self.options.maxBeltSpeed;

                                                if(self.items[recipeItemId] !== undefined && (self.items[recipeItemId].category === 'liquid' || self.items[recipeItemId].category === 'gas'))
                                                {
                                                    maxProductionSpeed = self.options.maxPipeSpeed;
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
                    self.graphNodes.push({data: {
                        id                  : currentParentVisId,
                        nodeType            : 'productionBuilding',
                        buildingType        : buildingId,
                        recipe              : options.recipe,
                        itemOut             : options.id,
                        qtyProducedDefault  : qtyProduced,
                        qtyProduced         : qtyProduced,
                        qtyUsed             : qtyUsed,
                        clockSpeed          : 100,
                        image               : self.buildings[buildingId].image
                    }});

                    // Push new edges between node and parent
                    self.graphEdges.push({data: {
                        id                  : currentParentVisId + '_' + options.visId,
                        source              : currentParentVisId,
                        target              : options.visId,
                        itemId              : options.id,
                        recipe              : options.recipe,
                        qty                 : qtyUsed
                    }});

                    // Add by-product
                    if(self.recipes[options.recipe].produce !== undefined)
                    {
                        for(let producedClassName in self.recipes[options.recipe].produce)
                        {
                            if(producedClassName !== self.items[options.id].className)
                            {
                                let byProductId     = self.getItemIdFromClassName(producedClassName);
                                let byProductQty    = qtyUsed / productionPieces * self.recipes[options.recipe].produce[producedClassName];

                                let alreadyExistsByProductNode = false;

                                // Find already last level item!
                                for(let k = 0; k < self.graphNodes.length; k++)
                                {
                                    if(self.graphNodes[k].data.nodeType === 'byProductItem' && self.graphNodes[k].data.itemId === byProductId)
                                    {
                                        alreadyExistsByProductNode = true;

                                        self.graphNodes[k].data.qtyProduced  += byProductQty;
                                        self.graphNodes[k].data.neededQty    += byProductQty;

                                        // Push new edges between node and parent
                                        self.graphEdges.push({data: {
                                            id                  : currentParentVisId + '_' + self.graphNodes[k].data.id,
                                            source              : currentParentVisId,
                                            target              : self.graphNodes[k].data.id,
                                            itemId              : byProductId,
                                            recipe              : options.recipe,
                                            qty                 : byProductQty
                                        }});

                                        break;
                                    }
                                }

                                if(alreadyExistsByProductNode === false)
                                {
                                    self.graphNodes.push({data: {
                                        id                  : options.visId + '_byProduct',
                                        nodeType            : 'byProductItem',
                                        itemId              : byProductId,
                                        qtyUsed             : 0,
                                        qtyProduced         : byProductQty,
                                        neededQty           : byProductQty,
                                        image               : self.items[byProductId].image
                                    }});

                                    // Push new edges between node and parent
                                    self.graphEdges.push({data: {
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
                            let recipeItemId    = self.getItemIdFromClassName(recipeItemClassName);
                            let requiredQty     = (60 / productionCraftingTime * productionRecipe[recipeItemClassName]) * qtyUsed / qtyProduced;

                            if(self.options.maxLevel !== null && self.options.maxLevel === (options.level + 1) && self.items[recipeItemId].category !== 'ore' && recipeItemId !== '/Game/FactoryGame/Resource/RawResources/CrudeOil/Desc_LiquidOil.Desc_LiquidOil_C' && recipeItemId !== '/Game/FactoryGame/Resource/RawResources/Water/Desc_Water.Desc_Water_C')
                            {
                                // Find already last level item!
                                let alreadyExistsLastNode = false;
                                    for(let k = 0; k < self.graphNodes.length; k++)
                                    {
                                        if(self.graphNodes[k].data.nodeType === 'lastNodeItem' && self.graphNodes[k].data.itemId === recipeItemId)
                                        {
                                            alreadyExistsLastNode = true;

                                            self.graphNodes[k].data.neededQty  += requiredQty;
                                            self.graphEdges.push({data: {
                                                id                  : self.graphNodes[k].data.id + '_' + currentParentVisId,
                                                source              : self.graphNodes[k].data.id,
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
                                        self.graphNodes.push({data: {
                                            id                  : lastNodeVisId,
                                            nodeType            : 'lastNodeItem',
                                            itemId              : recipeItemId,
                                            neededQty           : requiredQty,
                                            image               : self.items[recipeItemId].image
                                        }});

                                        // Push new edges between node and parent
                                        self.graphEdges.push({data: {
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
                                let currentRecipe           = self.getRecipeToProduceItemId(recipeItemId);

                                if(currentRecipe !== null)
                                {
                                    while(requiredQty > 0)
                                    {
                                        // Can we use by product?
                                        let usesByProduct = false;
                                            for(let i = 0; i < self.graphNodes.length; i ++)
                                            {
                                                if(self.graphNodes[i].data.nodeType === 'byProductItem')
                                                {
                                                    if(self.graphNodes[i].data.itemId === recipeItemId)
                                                    {
                                                        let remainingQty    = self.graphNodes[i].data.qtyProduced - self.graphNodes[i].data.qtyUsed;
                                                        let useQty          = Math.min(remainingQty, requiredQty);

                                                            if(useQty < 0)
                                                            {
                                                                useQty = remainingQty;
                                                            }

                                                        if(remainingQty > 0 && useQty > 0)
                                                        {

                                                                // Add edge between byProduct and item..
                                                                self.graphEdges.push({data: {
                                                                    id                  : self.graphNodes[i].data.id + '_' + currentParentVisId,
                                                                    source              : self.graphNodes[i].data.id,
                                                                    target              : currentParentVisId,
                                                                    itemId              : recipeItemId,
                                                                    qty                 : useQty
                                                                }});

                                                                self.graphNodes[i].data.qtyUsed    += useQty;
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
                                            let qtyProducedByNode = self.buildCurrentNodeTree({
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
                                        for(let i = 0; i < self.graphNodes.length; i ++)
                                        {
                                            if(self.graphNodes[i].data.nodeType === 'lastNodeItem')
                                            {
                                                if(self.graphNodes[i].data.itemId === recipeItemId)
                                                {
                                                    // Add edge between byProduct and item..
                                                    self.graphEdges.push({data: {
                                                        id                  : self.graphNodes[i].data.id + '_' + currentParentVisId,
                                                        source              : self.graphNodes[i].data.id,
                                                        target              : currentParentVisId,
                                                        itemId              : recipeItemId,
                                                        qty                 : requiredQty
                                                    }});

                                                    self.graphNodes[i].data.neededQty += requiredQty;
                                                    usesLastNode                       = true;

                                                    break;
                                                }
                                            }
                                        }

                                        if(usesLastNode === false)
                                        {
                                            let lastNodeVisId = currentParentVisId + '_' + recipeItemId;

                                                // Push last node!
                                                self.graphNodes.push({data: {
                                                    id                  : lastNodeVisId,
                                                    nodeType            : 'lastNodeItem',
                                                    itemId              : recipeItemId,
                                                    neededQty           : requiredQty,
                                                    image               : self.items[recipeItemId].image
                                                }});

                                                // Push new edges between node and parent
                                                self.graphEdges.push({data: {
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
    };

    self.generateTreeList = function()
    {
        self.postMessage({type: 'updateLoaderText', text: 'Generating production list...'});
        var html = [];
        var requestedItemsLength = Object.keys(requestedItems).length;

        if(requestedItemsLength === 0)
        {
            html.push('<p class="p-3 text-center">Please select at least one item in the production list.</p>');
        }
        else
        {
            html.push('<div class="row">');

            for(let itemId in self.requestedItems)
            {
                if(requestedItemsLength >= 1)
                {
                    html.push('<div class="col-sm-6">');
                }
                else
                {
                    html.push('<div>');
                }

                    html.push('<div class="p-3">');
                        html.push('<div class="hierarchyTree">');
                            html.push('<div class="root">');
                                html.push('<div class="child">');
                                    html.push('<img src="' + self.items[itemId].image + '" style="width: 40px;" class="mr-3" />');

                                    html.push(new Intl.NumberFormat(self.locale).format(self.requestedItems[itemId]) + 'x ');

                                    if(self.items[itemId].url !== undefined)
                                    {
                                        html.push('<a href="' + self.items[itemId].url + '"style="line-height: 40px;">' + self.items[itemId].name + '</a>');
                                    }
                                    else
                                    {
                                        html.push('<a href="' + self.baseUrls.items + '/id/' + itemId + '/name/' + self.items[itemId].name + '"style="line-height: 40px;">' + self.items[itemId].name + '</a>');
                                    }

                                    for(let k = 0; k < self.graphNodes.length; k++)
                                    {
                                        if(self.graphNodes[k].data.nodeType === 'mainNode' && self.graphNodes[k].data.itemId === itemId)
                                        {
                                            html.push(self.buildHierarchyTree(self.graphNodes[k].data.id));
                                        }
                                    }

                                html.push('</div>');
                            html.push('</div>');
                        html.push('</div>');
                    html.push('</div>');
                html.push('</div>');
            }

            html.push('</div>');
        }

        self.postMessage({type: 'updateTreeList', html: html.join('')});
        self.generateItemsList();
    };

    self.buildHierarchyTree = function(parentId)
    {
        var html = [];

        // Build current parentId childrens
        var children = [];
        for(let k = 0; k < self.graphEdges.length; k++)
        {
            if(self.graphEdges[k].data.target === parentId)
            {
                children.push(self.graphEdges[k]);
            }
        }

        if(children.length > 0)
        {
            html.push('<div class="parent">');

            for(let i = 0; i < children.length; i++)
            {
                for(let k = 0; k < self.graphNodes.length; k++)
                {
                    if(self.graphNodes[k].data.id === children[i].data.source)
                    {
                        html.push('<div class="child">');

                            html.push('<div class="media">');

                            if(self.graphNodes[k].data.nodeType === 'lastNodeItem' || self.graphNodes[k].data.nodeType === 'byProductItem')
                            {
                                html.push('<img src="' + self.items[self.graphNodes[k].data.itemId].image + '" alt="' + self.items[self.graphNodes[k].data.itemId].name + '" style="width: 40px;" class="mr-3" />');

                                html.push('<div class="media-body">');
                                    html.push(new Intl.NumberFormat(self.locale).format(self.graphNodes[k].data.neededQty) + 'x ');

                                    if(self.items[self.graphNodes[k].data.itemId].url !== undefined)
                                    {
                                        html.push('<a href="' + self.items[self.graphNodes[k].data.itemId].url + '" style="line-height: 40px;">' + self.items[self.graphNodes[k].data.itemId].name + '</a>');
                                    }
                                    else
                                    {
                                        html.push('<a href="' + self.baseUrls.items + '/id/' + self.graphNodes[k].data.itemId + '/name/' + self.items[self.graphNodes[k].data.itemId].name + '" style="line-height: 40px;">' + self.items[self.graphNodes[k].data.itemId].name + '</a>');
                                    }
                                html.push('</div>');
                            }
                            else
                            {
                                if(self.graphNodes[k].data.nodeType === 'merger')
                                {
                                    if(self.items[self.graphNodes[k].data.itemId].category === 'liquid' || self.items[self.graphNodes[k].data.itemId].category === 'gas')
                                    {
                                        self.graphNodes[k].data.buildingType = 'Build_PipelineJunction_Cross_C';
                                    }
                                    else
                                    {
                                        self.graphNodes[k].data.buildingType = 'Build_ConveyorAttachmentMerger_C';
                                    }
                                }
                                if(self.graphNodes[k].data.nodeType === 'splitter')
                                {
                                    if(self.items[self.graphNodes[k].data.itemId].category === 'liquid' || self.items[self.graphNodes[k].data.itemId].category === 'gas')
                                    {
                                        self.graphNodes[k].data.buildingType = 'Build_PipelineJunction_Cross_C';
                                    }
                                    else
                                    {
                                        self.graphNodes[k].data.buildingType = 'Build_ConveyorAttachmentSplitter_C';
                                    }
                                }

                                html.push('<img src="' + self.buildings[self.graphNodes[k].data.buildingType].image + '" alt="' + self.buildings[self.graphNodes[k].data.buildingType].name + '" style="width: 40px;" class="mr-3 collapseChildren" />');

                                html.push('<div class="media-body">');

                                    if(self.buildings[self.graphNodes[k].data.buildingType].url !== undefined)
                                    {
                                        html.push('<a href="' + self.buildings[self.graphNodes[k].data.buildingType].url + '">' + self.buildings[self.graphNodes[k].data.buildingType].name + '</a>');
                                    }
                                    else
                                    {
                                        html.push('<a href="' + self.baseUrls.buildings + '/id/' + self.graphNodes[k].data.buildingType + '/name/' + self.buildings[self.graphNodes[k].data.buildingType].name + '">' + self.buildings[self.graphNodes[k].data.buildingType].name + '</a>');
                                    }

                                    if(self.graphNodes[k].data.nodeType === 'productionBuilding')
                                    {
                                        //html.push(' <em style="color: ' + self.graphNodes[k].data.performanceColor + '">(' + k + ')</em>'); // DEBUG
                                        html.push(' <em style="color: ' + self.graphNodes[k].data.performanceColor + '">(' + self.graphNodes[k].data.performance + '%)</em>');
                                        //html.push(' <em style="color: ' + self.graphNodes[k].data.performanceColor + '">(' + self.graphNodes[k].data.qtyUsed + ' / ' + self.graphNodes[k].data.qtyProduced + ')</em>'); // DEBUG
                                    }

                                    html.push('<br />');
                                    html.push('<small>' + children[i].data.label + '</small>');
                                html.push('</div>');
                            }

                            html.push('</div>');

                            if(self.graphNodes[k].data.nodeType !== 'byProductItem')
                            {
                                html.push(self.buildHierarchyTree(self.graphNodes[k].data.id));
                            }

                        html.push('</div>');

                        //break; // Don't break as not merged belt can have more than one input...
                    }
                }
            }

            html.push('</div>');
        }

        return html.join('');
    };

    self.generateItemsList = function()
    {
        self.postMessage({type: 'updateLoaderText', text: 'Generating items list...'});
        var html = [];
        var listItemsLength = Object.keys(self.listItems).length;

        if(listItemsLength === 0)
        {
            html.push('<p class="p-3 text-center">Please select at least one item in the production list.</p>');
        }
        else
        {
            var reversedKeys = Object.keys(self.listItems).reverse();

            html.push('<table class="table table-striped mb-0">');

            html.push('<thead>');
                html.push('<tr>');
                    html.push('<th></th>');
                    html.push('<th>Needed per minute</th>');
                html.push('</tr>');
            html.push('</thead>');

            html.push('<tbody>');

            for(let i = 0; i < reversedKeys.length; i++)
            {
                var itemId  = reversedKeys[i];

                html.push('<tr>');
                    html.push('<td width="40"><img src="' + self.items[itemId].image + '" style="width: 40px;" /></td>');
                    html.push('<td class="align-middle">');

                        if(self.items[itemId].category === 'liquid' || self.items[itemId].category === 'gas')
                        {
                            html.push(new Intl.NumberFormat(self.locale).format(self.listItems[itemId]) + ' m³/min of ');
                        }
                        else
                        {
                            html.push(new Intl.NumberFormat(self.locale).format(self.listItems[itemId]) + ' units/min of ');
                        }

                        if(self.items[itemId].url !== undefined)
                        {
                            html.push('<a href="' + self.items[itemId].url + '">' + self.items[itemId].name + '</a>');
                        }
                        else
                        {
                            html.push('<a href="' + self.baseUrls.items + '/id/' + itemId + '/name/' + self.items[itemId].name + '">' + self.items[itemId].name + '</a>');
                        }

                   html.push('</td>');
                html.push('</tr>');
            }

            html.push('</tbody>');
            html.push('</table>');
        }

        self.postMessage({type: 'updateItemsList', html: html.join('')});
        self.generateBuildingList();
    };

    self.generateBuildingList = function()
    {
        self.postMessage({type: 'updateLoaderText', text: 'Generating buildings list...'});
        var html = [];
        var buildingsListRecipe = {};
        var listBuildingsLength = Object.keys(self.listBuildings).length;

        if(listBuildingsLength === 0)
        {
            html.push('<p class="p-3 text-center">Please select at least one item in the production list.</p>');
        }
        else
        {
            var reversedKeys = Object.keys(self.listBuildings).reverse();

            html.push('<table class="table table-striped mb-0">');

            for(let i = 0; i < reversedKeys.length; i++)
            {
                let buildingId          = reversedKeys[i];
                let currentRecipe       = null;
                let buildingClassName   = self.buildings[buildingId].className.replace(/Build_/g, 'Desc_');

                // Build recipe...
                for(let recipeId in self.recipes)
                {
                    if(self.recipes[recipeId].produce[buildingClassName] !== undefined)
                    {
                        currentRecipe = [];

                        for(let ingredient in self.recipes[recipeId].ingredients)
                        {
                            for(let itemId in self.items)
                            {
                                if(self.items[itemId].className === ingredient)
                                {
                                    currentRecipe.push({
                                        id      : itemId,
                                        name    : self.items[itemId].name,
                                        image   : self.items[itemId].image,
                                        qty     : self.recipes[recipeId].ingredients[ingredient]
                                    });

                                    break;
                                }
                            }
                            for(let itemId in self.tools)
                            {
                                if(self.tools[itemId].className === ingredient)
                                {
                                    currentRecipe.push({
                                        id      : itemId,
                                        name    : self.tools[itemId].name,
                                        image   : self.tools[itemId].image,
                                        qty     : self.recipes[recipeId].ingredients[ingredient]
                                    });

                                    break;
                                }
                            }
                        }

                        break;
                    }
                }

                html.push('<tr>');
                html.push('<td width="40" class="align-middle"><img src="' + self.buildings[buildingId].image + '" style="width: 40px;" /></td>');

                html.push('<td class="align-middle">');
                    html.push(new Intl.NumberFormat(self.locale).format(self.listBuildings[buildingId]) + 'x ');

                    if(self.buildings[buildingId].url !== undefined)
                    {
                        html.push('<a href="' + self.buildings[buildingId].url + '">' + self.buildings[buildingId].name + '</a>');
                    }
                    else
                    {
                        html.push('<a href="' + self.baseUrls.buildings + '/id/' + buildingId + '/name/' + self.buildings[buildingId].name + '">' + self.buildings[buildingId].name + '</a>');
                    }

                html.push('</td>');

                html.push('<td class="align-middle">');

                    var toJoin = [];

                    if(currentRecipe !== null)
                    {
                        for(let j = 0; j < currentRecipe.length; j++)
                        {
                            var recipeQty = self.listBuildings[buildingId] * currentRecipe[j].qty;
                            var temp = [];
                                temp.push(new Intl.NumberFormat(self.locale).format(recipeQty) + 'x ');
                                temp.push('<img src="' + currentRecipe[j].image + '" title="' + currentRecipe[j].name + '" style="width: 24px;" />');

                            if(buildingsListRecipe[currentRecipe[j].id] === undefined)
                            {
                                buildingsListRecipe[currentRecipe[j].id] = recipeQty;
                            }
                            else
                            {
                                buildingsListRecipe[currentRecipe[j].id] += recipeQty;
                            }

                            toJoin.push(temp.join(''));
                        }
                    }

                    html.push(toJoin.join(', '));

                html.push('</td>');

                html.push('</tr>');
            }

            html.push('<tr>');
            html.push('<td></td>');
            html.push('<td><strong>Total:</strong></td>');
            html.push('<td class="p-0"><ul class="list-group list-group-flush">');

                for(let idRecipe in buildingsListRecipe)
                {
                    html.push('<li class="list-group-item">');

                    html.push(new Intl.NumberFormat(self.locale).format(buildingsListRecipe[idRecipe]) + 'x ');

                    if(self.items[idRecipe] !== undefined)
                    {
                        html.push('<img src="' + self.items[idRecipe].image + '" title="' + self.items[idRecipe].name + '" style="width: 24px;" /> ');

                        if(self.items[idRecipe].url !== undefined)
                        {
                            html.push('<a href="' + self.items[idRecipe].url + '">' + self.items[idRecipe].name + '</a>');
                        }
                        else
                        {
                            html.push('<a href="' + self.baseUrls.items + '/id/' + idRecipe + '/name/' + self.items[idRecipe].name + '">' + self.items[idRecipe].name + '</a>');
                        }
                    }
                    else
                    {
                        if(self.tools[idRecipe] !== undefined)
                        {
                            html.push('<img src="' + self.tools[idRecipe].image + '" title="' + self.tools[idRecipe].name + '" style="width: 24px;" /> ');

                            if(self.tools[idRecipe].url !== undefined)
                            {
                                html.push('<a href="' + self.tools[idRecipe].url + '">' + self.tools[idRecipe].name + '</a>');
                            }
                            else
                            {
                                html.push('<a href="' + self.baseUrls.tools + '/id/' + idRecipe + '/name/' + self.tools[idRecipe].name + '">' + self.tools[idRecipe].name + '</a>');
                            }
                        }
                        else
                        {
                            html.push(idRecipe);
                        }
                    }

                    html.push('</li>');
                }

            html.push('</ul></td>');
            html.push('</tr>');

            html.push('</table>');
        }

        self.postMessage({type: 'updateBuildingsList', html: html.join('')});
        self.postMessage({type: 'updateLoaderText', text: 'Generating buildings layout...'});
        self.postMessage({type: 'updateGraphNetwork', nodes: self.graphNodes, edges: self.graphEdges, direction: self.graphDirection});
        self.postMessage({type: 'done'});
    };


    self.getItemIdFromClassName = function(itemClassName)
    {
        for(let itemId in self.items)
        {
            if(self.items[itemId].className === itemClassName)
            {
                return itemId;
            }
        }

        return null;
    };

    self.isAlternateRecipe = function(recipe)
    {
        if(recipe.className === '/Game/FactoryGame/Recipes/AlternateRecipes/Parts/Recipe_Alternate_Turbofuel.Recipe_Alternate_Turbofuel_C')
        {
            return false;
        }
        if(recipe.className.startsWith('/Game/FactoryGame/Recipes/AlternateRecipes'))
        {
            return true;
        }
        if(recipe.className.search('Recipe_Residual') !== -1)
        {
            return true;
        }

        return false;
    }

    self.getRecipeToProduceItemId = function(itemId)
    {
        let currentItemClassName    = self.items[itemId].className;
        let availableRecipes        = [];

            // Grab recipe that can produce the requested item...
            for(let i = 0; i < self.options.altRecipes.length; i++)
            {
                let recipeKey = self.options.altRecipes[i];

                    if(['Recipe_Biomass_AlienOrgans_C', 'Recipe_Biomass_AlienCarapace_C'].includes(recipeKey)){ continue; }
                    if(itemId === 'Desc_Water_C') // Force water to be extracted...
                    {
                        continue;
                    }

                    if(self.recipes[recipeKey] !== undefined)
                    {
                        if(self.recipes[recipeKey].produce[currentItemClassName] !== undefined)
                        {
                            if(recipeKey === 'Recipe_Alternate_RecycledRubber_C' && self.options.altRecipes.includes('Recipe_Alternate_Plastic_1_C'))
                            {
                                continue;
                            }

                            return recipeKey;
                        }
                    }
            }

            for(let recipeKey in self.recipes)
            {
                if(['Recipe_Biomass_AlienOrgans_C', 'Recipe_Biomass_AlienCarapace_C'].includes(recipeKey)){ continue; }

                if(self.isAlternateRecipe(self.recipes[recipeKey]) === false)
                {
                    if(self.recipes[recipeKey].produce !== undefined)
                    {
                        if(self.recipes[recipeKey].produce[currentItemClassName] !== undefined)
                        {
                            availableRecipes.push(recipeKey);
                        }
                    }
                }
            }

            if(availableRecipes.length > 0)
            {
                // Order by produce length
                availableRecipes.sort(function(a, b){
                    let aLength = 0;
                    let bLength = 0;

                        for(let item in self.recipes[a].produce)
                        {
                            aLength++;
                        }
                        for(let item in self.recipes[b].produce)
                        {
                            bLength++;
                        }

                        if(aLength === bLength)
                        {
                            if(self.isAlternateRecipe(self.recipes[a]) === true && self.isAlternateRecipe(self.recipes[b]) === false)
                            {
                                return 1;
                            }
                            if(self.isAlternateRecipe(self.recipes[a]) === false && self.isAlternateRecipe(self.recipes[b]) === true)
                            {
                                return -1;
                            }

                            let produceA = null;
                            let produceB = null;

                                for(let item in self.recipes[a].produce)
                                {
                                    if(item === itemId)
                                    {
                                        produceA = (60 / self.recipes[a].mManufactoringDuration * self.recipes[a].produce[item]);
                                        break;
                                    }
                                }
                                for(let item in self.recipes[b].produce)
                                {
                                    if(item === itemId)
                                    {
                                        produceB = (60 / self.recipes[b].mManufactoringDuration * self.recipes[b].produce[item]);
                                        break;
                                    }
                                }

                            if(produceA !== null && produceB !== null)
                            {
                                if(produceA !== produceB)
                                {
                                    return produceB - produceA;
                                }
                            }

                            return self.recipes[a].name.localeCompare(self.recipes[b].name);
                        }

                    return aLength - bLength;
                });

                return availableRecipes[0];
            }

        return null;
    };

    self.getProductionBuildingFromRecipeId = function(recipeId)
    {
        // Find suitable building
        if(self.recipes[recipeId].mProducedIn !== undefined)
        {
            for(let i = self.recipes[recipeId].mProducedIn.length - 1; i >= 0; i--)
            {
                let currentBuilding = self.recipes[recipeId].mProducedIn[i];

                    for(let buildingKey in self.buildings)
                    {
                        if(self.buildings[buildingKey].className === currentBuilding)
                        {
                            if(recipeId === 'Recipe_CrudeOil_C' && self.options.oilType === 'Build_OilPump_C' && buildingKey !== 'Build_OilPump_C')
                            {
                                continue;
                            }
                            if(recipeId === 'Recipe_CrudeWater_C' && self.options.waterType === 'Build_WaterPump_C' && buildingKey !== 'Build_WaterPump_C')
                            {
                                continue;
                            }

                            return buildingKey;
                        }
                    }
            }
        }

        return null;
    };

    self.testEdgesMaxSpeeds = function(mergingNodeData, sourceNodeData, mergedPercentage)
    {
        let inputQty        = {};
            for(let k = 0; k < self.graphEdges.length; k++)
            {
                if(self.graphEdges[k] !== undefined)
                {
                    if(self.graphEdges[k].data.target === mergingNodeData.id || self.graphEdges[k].data.target === sourceNodeData.id)
                    {
                        if(inputQty[self.graphEdges[k].data.itemId] === undefined)
                        {
                            inputQty[self.graphEdges[k].data.itemId] = 0;
                        }

                        inputQty[self.graphEdges[k].data.itemId] += self.graphEdges[k].data.qty * (mergedPercentage / 100);

                        let currentMaxMergedQty = self.options.maxBeltSpeed;
                            if(self.items[self.graphEdges[k].data.itemId].category === 'liquid' || self.items[self.graphEdges[k].data.itemId].category === 'gas')
                            {
                                currentMaxMergedQty = self.options.maxPipeSpeed;
                            }

                            if(inputQty[self.graphEdges[k].data.itemId] > currentMaxMergedQty)
                            {
                                return false;
                            }
                    }
                }
            }

        return true;
    };
};