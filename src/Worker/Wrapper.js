/* global Intl */

export default class Worker_Wrapper
{
    constructor(worker)
    {
        // General options
        this.baseUrls       = {};
        this.url            = {};

        this.debug          = false;
        this.locale         = 'en';
        this.translate      = {};

        this.buildings      = {};
        this.items          = {};
        this.tools          = {};
        this.recipes        = {};

        this.options        = {
            maxBeltSpeed                : 780,
            maxPipeSpeed                : 600000,

            oreType                     : 'Build_MinerMk2_C',
            oreSpeed                    : 'normal',
            oilType                     : 'Build_OilPump_C',
            oilSpeed                    : 'normal',
            waterType                   : 'Build_WaterPump_C',
            waterSpeed                  : 'normal',
            gasType                     : 'Build_FrackingExtractor_C',
            gasSpeed                    : 'normal'
        };
        this.inputItems     = {};
        this.requestedItems = {};
        this.altRecipes     = [];
        this.convRecipes    = [];
        this.requiredPower  = 0;
        this.listItems      = {};
        this.listBuildings  = {};

        this.nodeIdKey      = 0;
        this.graphNodes     = [];
        this.graphEdges     = [];

        // Initiate the passed worker
        this.worker             = worker;
        this.worker.onmessage   = function(e){
            // General variables
            this.baseUrls       = e.data.baseUrls;
            this.debug          = e.data.debug;
            this.locale         = e.data.locale;
            this.translate      = e.data.translate;

            this.buildings      = e.data.buildings;
            this.items          = e.data.items;
            this.tools          = e.data.tools;
            this.recipes        = e.data.recipes;

            return this.initiate(e.data.formData);
        }.bind(this);

        this.postMessage({type: 'showLoader'});
    }

    initiate(formData)
    {
        this.postMessage({type: 'updateLoaderText', text: 'Checking requested items...'});

        // Requested intems
        for(let itemKey in this.items)
        {
            if(formData[itemKey] !== undefined && this.items[itemKey] !== undefined)
            {
                this.url[itemKey]               = formData[itemKey];
                this.requestedItems[itemKey]    = formData[itemKey];
            }
        }

        // Available inputs
        if(formData.input !== undefined)
        {
            this.url.input                      = formData.input
            this.inputItems                     = formData.input;
        }

        // Mods
        if(formData.mods === undefined && formData.activatedMods !== undefined && formData.activatedMods.length > 0)
        {
            this.url.mods = [];
            for(let i = 0; i < formData.activatedMods.length; i++)
            {
                this.url.mods.push(formData.activatedMods[i].data.idSML);
            }
        }
        else
        {
            if(formData.mods !== undefined)
            {
                this.url.mods = formData.mods;
            }
        }

        // Which alternative recipes are accepted?
        if(formData.altRecipes !== undefined)
        {
            this.postMessage({type: 'updateLoaderText', text: 'Applying alternative recipes...'});

            this.altRecipes = [];
            for(let i = 0; i < formData.altRecipes.length; i++)
            {
                let recipeKey = formData.altRecipes[i];
                    if(this.recipes[recipeKey] !== undefined)
                    {
                        this.altRecipes.push(recipeKey);
                    }
            }

            if(this.altRecipes.length > 0)
            {
                this.url.altRecipes = this.altRecipes;
            }
        }

        if(formData.convRecipes !== undefined)
        {
            this.postMessage({type: 'updateLoaderText', text: 'Applying Converter recipes...'});

            this.convRecipes = [];
            for(let i = 0; i < formData.convRecipes.length; i++)
            {
                let recipeKey = formData.convRecipes[i];
                    if(this.recipes[recipeKey] !== undefined)
                    {
                        this.convRecipes.push(recipeKey);
                    }
            }

            if(this.convRecipes.length > 0)
            {
                this.url.convRecipes = this.convRecipes;
            }
        }

        this.postMessage({type: 'updateUrl', url: this.url});
        this.startCalculation();
    }

    postMessage(e)
    {
        return this.worker.postMessage(e);
    }

    startCalculation()
    {
        this.addInputs();
    }

    endCalculation()
    {
        this.addLabels();

        this.postMessage({type: 'updateLoaderText', text: 'Generating buildings layout...'});
        this.postMessage({type: 'updateGraphNetwork', nodes: this.graphNodes, edges: this.graphEdges});
        this.postMessage({type: 'updateRequiredPower', power: this.requiredPower});
        this.postMessage({type: 'updateItemsList', data: this.listItems});
        this.postMessage({type: 'updateBuildingsList', data: this.listBuildings});
        this.generateTreeList();
        this.postMessage({type: 'done'});
    }


    addInputs()
    {
        this.postMessage({type: 'updateLoaderText', text: 'Add inputs resources...'});

        for(let itemKey in this.inputItems)
        {
            let requestedQty = parseFloat(this.inputItems[itemKey]);
            let maxMergedQty = this.options.maxBeltSpeed;
                if(['liquid', 'gas'].includes(this.items[itemKey].category))
                {
                    requestedQty *= 1000;
                    maxMergedQty = this.options.maxPipeSpeed;
                }

                while(requestedQty >= maxMergedQty)
                {
                    this.graphNodes.push({data: {
                        id                  : itemKey + '_' + (this.nodeIdKey++) + '_byProduct',
                        nodeType            : 'byProductItem',
                        itemId              : itemKey,
                        qtyUsed             : 0,
                        qtyProduced         : maxMergedQty,
                        neededQty           : maxMergedQty,
                        image               : this.items[itemKey].image
                    }});

                    requestedQty -= maxMergedQty;
                }

                if(requestedQty > 0)
                {
                    this.graphNodes.push({data: {
                        id                  : itemKey + '_' + (this.nodeIdKey++) + '_byProduct',
                        nodeType            : 'byProductItem',
                        itemId              : itemKey,
                        qtyUsed             : 0,
                        qtyProduced         : requestedQty,
                        neededQty           : requestedQty,
                        image               : this.items[itemKey].image
                    }});
                }
        }
    }


    addLabels()
    {
        this.postMessage({type: 'updateLoaderText', text: 'Add labels...'});

        for(let i = 0; i < this.graphEdges.length; i++)
        {
            let edgeData    = this.graphEdges[i].data;
            let itemName    = this.items[edgeData.itemId].name;

            if(edgeData.useAlternateRecipe !== undefined && edgeData.useAlternateRecipe !== null)
            {
                itemName = this.alternative[edgeData.useAlternateRecipe].name;
            }

            let roundedQty = +(Math.round(edgeData.qty * 100) / 100);
                if(roundedQty < 0.1)
                {
                    this.graphEdges[i].data.label = itemName + ' (< 0.1/min)';
                }
                else
                {
                    if(this.items[edgeData.itemId].category === 'liquid' || this.items[edgeData.itemId].category === 'gas')
                    {
                        this.graphEdges[i].data.label = itemName + ' (' + Math.round(Math.round(roundedQty) / 1000) + ' m³/min)';
                    }
                    else
                    {
                        this.graphEdges[i].data.label = itemName + ' (' + roundedQty + ' units/min)';
                    }
                }

            //TODO: Change width for MK++ belts...

            // Apply edge color
            if(this.items[edgeData.itemId].color !== undefined)
            {
                this.graphEdges[i].data.color = this.items[edgeData.itemId].color;
            }
        }


        for(let i = 0; i < this.graphNodes.length; i++)
        {
            let nodeData = this.graphNodes[i].data;

            if(nodeData.nodeType === 'mainNode')
            {
                if(this.items[nodeData.itemId].category === 'liquid' || this.items[nodeData.itemId].category === 'gas')
                {
                    this.graphNodes[i].data.label   = new Intl.NumberFormat(this.locale).format(Math.round(Math.round(nodeData.qty) / 1000))
                                                    + ' m³ ' + this.items[nodeData.itemId].name;
                }
                else
                {
                    this.graphNodes[i].data.label   = new Intl.NumberFormat(this.locale).format(Math.round(nodeData.qty * 1000) / 1000)
                                                    + ' ' + this.items[nodeData.itemId].name;
                }
            }

            if(nodeData.nodeType === 'merger')
            {
                if(this.items[nodeData.itemId].category === 'liquid' || this.items[nodeData.itemId].category === 'gas')
                {
                    this.graphNodes[i].data.label   = this.buildings.Build_PipelineJunction_Cross_C.name + '\n(' + this.items[nodeData.itemId].name + ')';
                    this.graphNodes[i].data.image   = this.buildings.Build_PipelineJunction_Cross_C.image;

                    if(this.listBuildings.Build_PipelineJunction_Cross_C === undefined)
                    {
                        this.listBuildings.Build_PipelineJunction_Cross_C = 0;
                    }
                    this.listBuildings.Build_PipelineJunction_Cross_C++;
                }
                else
                {
                    this.graphNodes[i].data.label   = this.buildings.Build_ConveyorAttachmentMerger_C.name + '\n(' + this.items[nodeData.itemId].name + ')';
                    this.graphNodes[i].data.image   = this.buildings.Build_ConveyorAttachmentMerger_C.image;

                    if(this.listBuildings.Build_ConveyorAttachmentMerger_C === undefined)
                    {
                        this.listBuildings.Build_ConveyorAttachmentMerger_C = 0;
                    }
                    this.listBuildings.Build_ConveyorAttachmentMerger_C++;
                }
            }

            if(nodeData.nodeType === 'splitter')
            {
                if(this.items[nodeData.itemId].category === 'liquid' || this.items[nodeData.itemId].category === 'gas')
                {
                    this.graphNodes[i].data.label   = this.buildings.Build_PipelineJunction_Cross_C.name + '\n(' + this.items[nodeData.itemId].name + ')';
                    this.graphNodes[i].data.image   = this.buildings.Build_PipelineJunction_Cross_C.image;

                    if(this.listBuildings.Build_PipelineJunction_Cross_C === undefined)
                    {
                        this.listBuildings.Build_PipelineJunction_Cross_C = 0;
                    }
                    this.listBuildings.Build_PipelineJunction_Cross_C++;
                }
                else
                {
                    this.graphNodes[i].data.label   = this.buildings.Build_ConveyorAttachmentSplitter_C.name + '\n(' + this.items[nodeData.itemId].name + ')';
                    this.graphNodes[i].data.image   = this.buildings.Build_ConveyorAttachmentSplitter_C.image;

                    if(this.listBuildings.Build_ConveyorAttachmentSplitter_C === undefined)
                    {
                        this.listBuildings.Build_ConveyorAttachmentSplitter_C = 0;
                    }
                    this.listBuildings.Build_ConveyorAttachmentSplitter_C++;
                }
            }

            if(nodeData.nodeType === 'productionBuilding')
            {
                let performance                                 = (nodeData.qtyUsed / nodeData.qtyProducedDefault * 100);
                    this.graphNodes[i].data.performance         = Math.round(performance);
                    this.graphNodes[i].data.performanceColor    = this.getColorForPercentage(Math.min(100, Math.round(performance)));
                    this.graphNodes[i].data.borderWidth         = '15px';

                    this.graphNodes[i].data.label   = 'x' + new Intl.NumberFormat(this.locale).format(Math.ceil(performance / 10) / 10)
                                                    + ' ' + this.buildings[nodeData.buildingType].name
                                                    + '\n' + '(' + this.recipes[this.graphNodes[i].data.recipe].name + ')';
                                                    //+ '(' + nodeData.qtyUsed + '/' + nodeData.qtyProduced + ')'; // DEBUG

                // Add to items list
                if(this.listItems[nodeData.itemOut] === undefined)
                {
                    this.listItems[nodeData.itemOut] = 0;
                }
                if(this.items[nodeData.itemOut].category === 'liquid' || this.items[nodeData.itemOut].category === 'gas')
                {
                    this.listItems[nodeData.itemOut] += nodeData.qtyUsed / 1000;
                }
                else
                {
                    this.listItems[nodeData.itemOut] += nodeData.qtyUsed;
                }
            }

            if(nodeData.nodeType === 'lastNodeItem' || nodeData.nodeType === 'byProductItem')
            {
                if(this.items[nodeData.itemId].category === 'liquid' || this.items[nodeData.itemId].category === 'gas')
                {
                    this.graphNodes[i].data.label   = new Intl.NumberFormat(this.locale).format(Math.round(Math.round(nodeData.neededQty) / 1000))
                                                    + ' m³ ' + this.items[nodeData.itemId].name;
                }
                else
                {
                    this.graphNodes[i].data.label   = new Intl.NumberFormat(this.locale).format(Math.round(nodeData.neededQty * 1000) / 1000)
                                                    + ' ' + this.items[nodeData.itemId].name;
                }

                if(nodeData.nodeType === 'byProductItem')
                {
                    this.graphNodes[i].data.label += '*';
                }

                // Add to items list
                if(this.listItems[nodeData.itemId] === undefined)
                {
                    this.listItems[nodeData.itemId] = 0;
                }
                if(this.items[nodeData.itemId].category === 'liquid' || this.items[nodeData.itemId].category === 'gas')
                {
                    this.listItems[nodeData.itemId] += nodeData.neededQty / 1000;
                }
                else
                {
                    this.listItems[nodeData.itemId] += nodeData.neededQty;
                }
            }
        }
    }



    /**
     * COMMON FUNCTIONS
     */
    getColorForPercentage(pct)
    {
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
    }


    /*
     * COMMON GAME FUNCTIONS
     */
    getItemIdFromClassName(itemClassName)
    {
        for(let itemId in this.items)
        {
            if(this.items[itemId].className === itemClassName)
            {
                return itemId;
            }
        }

        return null;
    };

    isAlternateRecipe(recipe)
    {
        if(recipe.className === '/Game/FactoryGame/Recipes/AlternateRecipes/Parts/Recipe_Alternate_Turbofuel.Recipe_Alternate_Turbofuel_C')
        {
            return false;
        }
        if(recipe.className === '/Game/FactoryGame/Recipes/AlternateRecipes/Parts/Recipe_Alternate_EnrichedCoal.Recipe_Alternate_EnrichedCoal_C')
        {
            return false;
        }
        if(recipe.className.startsWith('/Game/FactoryGame/Recipes/AlternateRecipes'))
        {
            return true;
        }
        if(recipe.className.startsWith('/Game/FactoryGame/Recipes/Converter/ResourceConversion/Recipe_'))
        {
            return true;
        }
        if(recipe.className.search('Recipe_Residual') !== -1)
        {
            return true;
        }
        if(recipe.className.search('_Alt.Recipe_') !== -1)
        {
            return true;
        }
        if(recipe.className.search('.Recipe_Alt_RP_') !== -1)
        {
            return true;
        }

        return false;
    }

    getRecipeToProduceItemId(itemId)
    {
        if(this.items[itemId] === undefined)
        {
            console.log('Missing item...', itemId);
            return null;
        }
        let currentItemClassName    = this.items[itemId].className;

        let ignoredRecipes          = ['Recipe_Biomass_AlienOrgans_C', 'Recipe_Biomass_AlienCarapace_C', 'Recipe_Protein_Hog_C', 'Recipe_Protein_Spitter_C', 'Recipe_Protein_Crab_C', 'Recipe_Protein_Stinger_C'];
        let availableRecipes        = [];

            // Grab recipe that can produce the requested item...
            for(let i = 0; i < this.altRecipes.length; i++)
            {
                let recipeKey = this.altRecipes[i];

                    if(ignoredRecipes.includes(recipeKey)){ continue; }
                    if(itemId === 'Desc_Water_C') // Force water to be extracted...
                    {
                        continue;
                    }

                    if(this.recipes[recipeKey] !== undefined)
                    {
                        if(this.recipes[recipeKey].produce[currentItemClassName] !== undefined)
                        {
                            // Skip loops?
                            if(recipeKey === 'Recipe_Alternate_RecycledRubber_C' && this.altRecipes.includes('Recipe_Alternate_Plastic_1_C'))
                            {
                                continue;
                            }
                            if(itemId === 'Desc_CompactedCoal_C' && this.altRecipes.includes('Recipe_Alternate_IonizedFuel_Dark_C'))
                            {
                                continue;
                            }
                            if(itemId === 'Desc_DarkEnergy_C' && this.altRecipes.includes('Recipe_SyntheticPowerShard_C'))
                            {
                                continue;
                            }

                            return recipeKey;
                        }
                    }
            }

            for(let i = 0; i < this.convRecipes.length; i++)
            {
                let recipeKey = this.convRecipes[i];

                    if(ignoredRecipes.includes(recipeKey)){ continue; }
                    if(itemId === 'Desc_Water_C') // Force water to be extracted...
                    {
                        continue;
                    }

                    if(this.recipes[recipeKey] !== undefined)
                    {
                        if(this.recipes[recipeKey].produce[currentItemClassName] !== undefined)
                        {
                            // Skip loops?
                            if(recipeKey === 'Recipe_Bauxite_Caterium_C' && this.convRecipes.includes('Recipe_Nitrogen_Bauxite_C')){ continue; }
                            if(recipeKey === 'Recipe_Bauxite_Caterium_C' && this.convRecipes.includes('Recipe_Quartz_Bauxite_C')){ continue; }
                            if(recipeKey === 'Recipe_Bauxite_Caterium_C' && this.convRecipes.includes('Recipe_Uranium_Bauxite_C')){ continue; }

                            if(recipeKey === 'Recipe_Bauxite_Copper_C' && this.convRecipes.includes('Recipe_Nitrogen_Bauxite_C')){ continue; }
                            if(recipeKey === 'Recipe_Bauxite_Copper_C' && this.convRecipes.includes('Recipe_Quartz_Bauxite_C')){ continue; }
                            if(recipeKey === 'Recipe_Bauxite_Copper_C' && this.convRecipes.includes('Recipe_Uranium_Bauxite_C')){ continue; }

                            if(recipeKey === 'Recipe_Caterium_Copper_C' && this.convRecipes.includes('Recipe_Bauxite_Caterium_C')){ continue; }
                            if(recipeKey === 'Recipe_Caterium_Copper_C' && this.convRecipes.includes('Recipe_Nitrogen_Caterium_C')){ continue; }

                            if(recipeKey === 'Recipe_Caterium_Quartz_C' && this.convRecipes.includes('Recipe_Bauxite_Caterium_C')){ continue; }
                            if(recipeKey === 'Recipe_Caterium_Quartz_C' && this.convRecipes.includes('Recipe_Nitrogen_Caterium_C')){ continue; }

                            if(recipeKey === 'Recipe_Coal_Iron_C' && this.convRecipes.includes('Recipe_Quartz_Coal_C')){ continue; }
                            if(recipeKey === 'Recipe_Coal_Iron_C' && this.convRecipes.includes('Recipe_Sulfur_Coal_C')){ continue; }

                            if(recipeKey === 'Recipe_Coal_Limestone_C' && this.convRecipes.includes('Recipe_Quartz_Coal_C')){ continue; }
                            if(recipeKey === 'Recipe_Coal_Limestone_C' && this.convRecipes.includes('Recipe_Sulfur_Coal_C')){ continue; }

                            if(recipeKey === 'Recipe_Copper_Quartz_C' && this.convRecipes.includes('Recipe_Bauxite_Copper_C')){ continue; }
                            if(recipeKey === 'Recipe_Copper_Quartz_C' && this.convRecipes.includes('Recipe_Caterium_Copper_C')){ continue; }

                            if(recipeKey === 'Recipe_Copper_Sulfur_C' && this.convRecipes.includes('Recipe_Bauxite_Copper_C')){ continue; }
                            if(recipeKey === 'Recipe_Copper_Sulfur_C' && this.convRecipes.includes('Recipe_Caterium_Copper_C')){ continue; }

                            if(recipeKey === 'Recipe_Iron_Limestone_C' && this.convRecipes.includes('Recipe_Limestone_Sulfur_C')){ continue; }

                            if(recipeKey === 'Recipe_Limestone_Sulfur_C' && this.convRecipes.includes('Recipe_Coal_Limestone_C')){ continue; }
                            if(recipeKey === 'Recipe_Limestone_Sulfur_C' && this.convRecipes.includes('Recipe_Iron_Limestone_C')){ continue; }

                            if(recipeKey === 'Recipe_Quartz_Bauxite_C' && this.convRecipes.includes('Recipe_Caterium_Quartz_C')){ continue; }
                            if(recipeKey === 'Recipe_Quartz_Bauxite_C' && this.convRecipes.includes('Recipe_Copper_Quartz_C')){ continue; }

                            if(recipeKey === 'Recipe_Quartz_Coal_C' && this.convRecipes.includes('Recipe_Caterium_Quartz_C')){ continue; }
                            if(recipeKey === 'Recipe_Quartz_Coal_C' && this.convRecipes.includes('Recipe_Copper_Quartz_C')){ continue; }

                            if(recipeKey === 'Recipe_Sulfur_Coal_C' && this.convRecipes.includes('Recipe_Copper_Sulfur_C')){ continue; }
                            if(recipeKey === 'Recipe_Sulfur_Coal_C' && this.convRecipes.includes('Recipe_Limestone_Sulfur_C')){ continue; }

                            if(recipeKey === 'Recipe_Sulfur_Iron_C' && this.convRecipes.includes('Recipe_Copper_Sulfur_C')){ continue; }
                            if(recipeKey === 'Recipe_Sulfur_Iron_C' && this.convRecipes.includes('Recipe_Limestone_Sulfur_C')){ continue; }

                            return recipeKey;
                        }
                    }
            }

            for(let recipeKey in this.recipes)
            {
                if(ignoredRecipes.includes(recipeKey)){ continue; }

                if(this.isAlternateRecipe(this.recipes[recipeKey]) === false)
                {
                    if(this.recipes[recipeKey].produce !== undefined)
                    {
                        if(this.recipes[recipeKey].produce[currentItemClassName] !== undefined)
                        {
                            availableRecipes.push(recipeKey);
                        }
                    }
                }
            }

            if(availableRecipes.length === 0)
            {
                // Forcing enabling alternate recipe...
                if(itemId === 'Desc_DissolvedSilica_C')
                {
                    this.postMessage({type: 'addAlternateRecipe', recipeId: 'Recipe_Alternate_Quartz_Purified_C'});
                    availableRecipes.push('Recipe_Alternate_Quartz_Purified_C');
                }
            }

            if(availableRecipes.length > 0)
            {
                // Order by produce length
                availableRecipes.sort(function(a, b){
                    let aLength = Object.keys(this.recipes[a].produce).length;
                    let bLength = Object.keys(this.recipes[b].produce).length;

                        if(aLength === bLength)
                        {
                            if(this.isAlternateRecipe(this.recipes[a]) === true && this.isAlternateRecipe(this.recipes[b]) === false)
                            {
                                return 1;
                            }
                            if(this.isAlternateRecipe(this.recipes[a]) === false && this.isAlternateRecipe(this.recipes[b]) === true)
                            {
                                return -1;
                            }

                            let produceA = null;
                            let produceB = null;

                                for(let item in this.recipes[a].produce)
                                {
                                    if(item === itemId)
                                    {
                                        produceA = (60 / this.recipes[a].mManufactoringDuration * this.recipes[a].produce[item]);
                                        break;
                                    }
                                }
                                for(let item in this.recipes[b].produce)
                                {
                                    if(item === itemId)
                                    {
                                        produceB = (60 / this.recipes[b].mManufactoringDuration * this.recipes[b].produce[item]);
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

                            // Use Rubber instead of Plastic
                            if(itemId === 'Desc_HeavyOilResidue_C' && a === 'Recipe_Rubber_C' && b === 'Recipe_Plastic_C')
                            {
                                return -1;
                            }
                            if(itemId === 'Desc_HeavyOilResidue_C' && a === 'Recipe_Plastic_C' && b === 'Recipe_Rubber_C')
                            {
                                return 1;
                            }

                            //TODO: Add power/items sorting?
                            //TODO: Fix Firefox sorting in reverse order?
                            return this.recipes[a].className.localeCompare(this.recipes[b].className);
                        }

                    return aLength - bLength;
                }.bind(this));

                return availableRecipes[0];
            }

        return null;
    }

    getProductionBuildingFromRecipeId(recipeId)
    {
        // Find suitable building
        if(this.recipes[recipeId].mProducedIn !== undefined)
        {
            for(let i = this.recipes[recipeId].mProducedIn.length - 1; i >= 0; i--)
            {
                let currentBuilding = this.recipes[recipeId].mProducedIn[i];

                    for(let buildingKey in this.buildings)
                    {
                        if(this.buildings[buildingKey].className === currentBuilding)
                        {
                            if(recipeId === 'Recipe_CrudeOil_C' && this.options.oilType === 'Build_OilPump_C' && buildingKey !== 'Build_OilPump_C')
                            {
                                continue;
                            }
                            if(recipeId === 'Recipe_CrudeWater_C' && this.options.waterType === 'Build_WaterPump_C' && buildingKey !== 'Build_WaterPump_C')
                            {
                                continue;
                            }

                            return buildingKey;
                        }
                    }
            }
        }

        return null;
    }


    /**
     * TREE LIST
     */
    generateTreeList()
    {
        this.postMessage({type: 'updateLoaderText', text: 'Generating production list...'});
        var html = [];
        var requestedItemsLength = Object.keys(this.requestedItems).length;

        if(requestedItemsLength === 0)
        {
            html.push('<p class="p-3 text-center">Please select at least one item in the production list.</p>');
        }
        else
        {
            html.push('<div class="row">');

            for(let itemId in this.requestedItems)
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
                                    html.push('<img src="' + this.items[itemId].image + '" style="width: 40px;" class="mr-3" />');

                                    if(this.items[itemId].category === 'liquid' || this.items[itemId].category === 'gas')
                                    {
                                        html.push(new Intl.NumberFormat(this.language).format(this.requestedItems[itemId]) + 'm³ ');
                                    }
                                    else
                                    {
                                        html.push(new Intl.NumberFormat(this.locale).format(this.requestedItems[itemId]) + 'x ');
                                    }

                                    if(this.items[itemId].url !== undefined)
                                    {
                                        html.push('<a href="' + this.items[itemId].url + '"style="line-height: 40px;">' + this.items[itemId].name + '</a>');
                                    }
                                    else
                                    {
                                        html.push('<a href="' + this.baseUrls.items + '/id/' + itemId + '/name/' + this.items[itemId].name + '"style="line-height: 40px;">' + this.items[itemId].name + '</a>');
                                    }

                                    for(let k = 0; k < this.graphNodes.length; k++)
                                    {
                                        if(this.graphNodes[k].data.nodeType === 'mainNode' && this.graphNodes[k].data.itemId === itemId)
                                        {
                                            html.push(this.buildHierarchyTree(this.graphNodes[k].data.id));
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

        this.postMessage({type: 'updateTreeList', data: html.join('')});
    }

    buildHierarchyTree(parentId)
    {
        let html = [];

        // Build current parentId childrens
        let children = [];
            for(let k = 0; k < this.graphEdges.length; k++)
            {
                if(this.graphEdges[k].data.target === parentId)
                {
                    children.push(this.graphEdges[k]);
                }
            }

        if(children.length > 0)
        {
            html.push('<div class="parent">');

            for(let i = 0; i < children.length; i++)
            {
                for(let k = 0; k < this.graphNodes.length; k++)
                {
                    if(this.graphNodes[k].data.id === children[i].data.source)
                    {
                        html.push('<div class="child">');

                            html.push('<div class="media">');

                            if(this.graphNodes[k].data.nodeType === 'lastNodeItem' || this.graphNodes[k].data.nodeType === 'byProductItem')
                            {
                                html.push('<img src="' + this.items[this.graphNodes[k].data.itemId].image + '" alt="' + this.items[this.graphNodes[k].data.itemId].name + '" style="width: 40px;" class="mr-3" />');

                                html.push('<div class="media-body">');
                                    if(this.items[this.graphNodes[k].data.itemId].category === 'liquid' || this.items[this.graphNodes[k].data.itemId].category === 'gas')
                                    {
                                        html.push(new Intl.NumberFormat(this.language).format(this.graphNodes[k].data.neededQty / 1000) + 'm³ ');
                                    }
                                    else
                                    {
                                        html.push(new Intl.NumberFormat(this.locale).format(this.graphNodes[k].data.neededQty) + 'x ');
                                    }

                                    if(this.items[this.graphNodes[k].data.itemId].url !== undefined)
                                    {
                                        html.push('<a href="' + this.items[this.graphNodes[k].data.itemId].url + '" style="line-height: 40px;">' + this.items[this.graphNodes[k].data.itemId].name + '</a>');
                                    }
                                    else
                                    {
                                        html.push('<a href="' + this.baseUrls.items + '/id/' + this.graphNodes[k].data.itemId + '/name/' + this.items[this.graphNodes[k].data.itemId].name + '" style="line-height: 40px;">' + this.items[this.graphNodes[k].data.itemId].name + '</a>');
                                    }
                                html.push('</div>');
                            }
                            else
                            {
                                if(this.graphNodes[k].data.nodeType === 'merger')
                                {
                                    if(this.items[this.graphNodes[k].data.itemId].category === 'liquid' || this.items[this.graphNodes[k].data.itemId].category === 'gas')
                                    {
                                        this.graphNodes[k].data.buildingType = 'Build_PipelineJunction_Cross_C';
                                    }
                                    else
                                    {
                                        this.graphNodes[k].data.buildingType = 'Build_ConveyorAttachmentMerger_C';
                                    }
                                }
                                if(this.graphNodes[k].data.nodeType === 'splitter')
                                {
                                    if(this.items[this.graphNodes[k].data.itemId].category === 'liquid' || this.items[this.graphNodes[k].data.itemId].category === 'gas')
                                    {
                                        this.graphNodes[k].data.buildingType = 'Build_PipelineJunction_Cross_C';
                                    }
                                    else
                                    {
                                        this.graphNodes[k].data.buildingType = 'Build_ConveyorAttachmentSplitter_C';
                                    }
                                }

                                html.push('<img src="' + this.buildings[this.graphNodes[k].data.buildingType].image + '" alt="' + this.buildings[this.graphNodes[k].data.buildingType].name + '" style="width: 40px;" class="mr-3 collapseChildren" />');

                                html.push('<div class="media-body">');

                                    if(this.buildings[this.graphNodes[k].data.buildingType].url !== undefined)
                                    {
                                        html.push('<a href="' + this.buildings[this.graphNodes[k].data.buildingType].url + '">' + this.buildings[this.graphNodes[k].data.buildingType].name + '</a>');
                                    }
                                    else
                                    {
                                        html.push('<a href="' + this.baseUrls.buildings + '/id/' + this.graphNodes[k].data.buildingType + '/name/' + this.buildings[this.graphNodes[k].data.buildingType].name + '">' + this.buildings[this.graphNodes[k].data.buildingType].name + '</a>');
                                    }

                                    if(this.graphNodes[k].data.nodeType === 'productionBuilding')
                                    {
                                        html.push(this.treeListProductionBuilding(this.graphNodes[k].data.performanceColor, this.graphNodes[k].data.performance));
                                    }

                                    html.push('<br />');
                                    html.push('<small>' + children[i].data.label + '</small>');
                                html.push('</div>');
                            }

                            html.push('</div>');

                            if(this.graphNodes[k].data.nodeType !== 'byProductItem')
                            {
                                html.push(this.buildHierarchyTree(this.graphNodes[k].data.id));
                            }

                        html.push('</div>');

                        //break; // Don't break as not merged belt can have more than one input...
                    }
                }
            }

            html.push('</div>');
        }

        return html.join('');
    }

    treeListProductionBuilding(performanceColor, performance)
    {
        //html.push(' <em style="color: ' + this.graphNodes[k].data.performanceColor + '">(' + k + ')</em>'); // DEBUG
        return ' <em style="color: ' + performanceColor + '">(' + performance + '%)</em>';
        //html.push(' <em style="color: ' + this.graphNodes[k].data.performanceColor + '">(' + this.graphNodes[k].data.qtyUsed + ' / ' + this.graphNodes[k].data.qtyProduced + ')</em>'); // DEBUG
    }
}