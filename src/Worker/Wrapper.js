/* global Intl */

/*
 * LP objectives, in lexicographic order, for each "optimizeFor" choice: the first one decides,
 * the next ones break ties.
 */
const OBJECTIVE_ORDERS = {
    resources   : ['resources', 'buildings'],
    power       : ['power', 'resources', 'buildings'],
    buildings   : ['buildings', 'resources'],
    alternates  : ['resources', 'buildings']     // Same costs, but the selected alternates are forced (see solverRequest)
};

// Values offered by the game for the "Recipe Parts Cost Multiplier" game mode
export const PARTS_COST_MULTIPLIERS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
// ... and for the "Power Consumption Multiplier" one
export const POWER_CONSUMPTION_MULTIPLIERS = [0.25, 0.5, 0.75, 1, 2, 5];

export default class Worker_Wrapper
{
    constructor(worker)
    {
        // General options
        this.baseUrls       = {};
        this.url            = {};

        this.debug          = false;
        this.language       = 'en';
        this.translate      = {};

        this.buildings      = {};
        this.items          = {};
        this.recipes        = {};

        this.options        = {
            maxBeltSpeed                : 780,
            maxPipeSpeed                : 600000,

            oreType                     : 'Build_MinerMk2_C',
            oreSpeed                    : 'RP_Normal',
            oilType                     : 'Build_OilPump_C',
            oilSpeed                    : 'RP_Normal',
            waterType                   : 'Build_WaterPump_C',
            waterSpeed                  : 'RP_Normal',
            gasType                     : 'Build_FrackingExtractor_C',
            gasSpeed                    : 'RP_Normal'
        };
        this.inputItems     = {};
        this.requestedItems = [];
        this.altRecipes     = [];
        this.convRecipes    = [];
        this.optimizeFor    = 'resources';
        this.partsCostMultiplier = 1;
        this.powerConsumptionMultiplier = 1;
        this.maximizeOutput = false;
        this.notice         = null;     // Message from the solver, shown on top of the tree list
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
            this.language       = e.data.language;
            this.translate      = e.data.translate;

            this.buildings      = e.data.buildings;
            this.items          = e.data.items;
            this.recipes        = e.data.recipes;

            return this.initiate(e.data.formData);
        }.bind(this);

        this.postMessage({type: 'showLoader'});
    }

    initiate(formData)
    {
        this.postMessage({type: 'updateLoaderText', text: 'Checking requested items...'});

        // Requested items
        for(let itemKey in this.items)
        {
            if(formData[itemKey] !== undefined && this.items[itemKey] !== undefined)
            {
                this.url[itemKey]               = formData[itemKey];
                this.requestedItems.push({id: itemKey, qty: formData[itemKey]});
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

        // Search options of the LP solver
        // "Recipe Parts Cost Multiplier" game mode (1.2)
        if(PARTS_COST_MULTIPLIERS.includes(Number(formData.partsCostMultiplier)) && Number(formData.partsCostMultiplier) !== 1)
        {
            this.partsCostMultiplier        = Number(formData.partsCostMultiplier);
            this.url.partsCostMultiplier    = this.partsCostMultiplier;
        }

        // "Power Consumption Multiplier" game mode (1.2)
        if(POWER_CONSUMPTION_MULTIPLIERS.includes(Number(formData.powerConsumptionMultiplier)) && Number(formData.powerConsumptionMultiplier) !== 1)
        {
            this.powerConsumptionMultiplier         = Number(formData.powerConsumptionMultiplier);
            this.url.powerConsumptionMultiplier     = this.powerConsumptionMultiplier;
        }

        if(OBJECTIVE_ORDERS[formData.optimizeFor] !== undefined && formData.optimizeFor !== 'resources')
        {
            this.optimizeFor        = formData.optimizeFor;
            this.url.optimizeFor    = formData.optimizeFor;
        }
        // Drawing options, only kept in the URL (the graph is drawn by the main thread), when not the defaults
        if(['RIGHT', 'LEFT', 'DOWN', 'UP'].includes(formData.direction) && formData.direction !== 'RIGHT')
        {
            this.url.direction      = formData.direction;
        }
        if(formData.edgeStyle === 'orthogonal')
        {
            this.url.edgeStyle      = formData.edgeStyle;
        }
        // One-shot run from the "Maximize" button (internal flag, not a form field nor part of the URL)
        if(formData.maximizeOutputs === true)
        {
            this.maximizeOutput     = true;
        }

        this.postMessage({type: 'updateUrl', url: this.url});
        this.startCalculation();
    }

    /*
     * LP request shared by both views: requested items, inputs, recipes and search options.
     * For the "Maximize" button the requested quantities are ratios and the provided inputs are the
     * limits: those items only come from the inputs, everything else is made as usual.
     */
    solverRequest(extraction)
    {
        const quantities    = Object.fromEntries(this.requestedItems.map(item => [item.id, Number(item.qty)]));
        const request       = {
            inputs      : this.inputItems,
            recipes     : { alternates: this.altRecipes, conversions: this.convRecipes, forceAll: this.optimizeFor === 'alternates' },
            extraction  : extraction,
            objectives  : OBJECTIVE_ORDERS[this.optimizeFor]
        };

            if(this.maximizeOutput === true)
            {
                request.maximize        = quantities;
                request.capInputs       = true;
            }
            else
            {
                request.targets         = quantities;
            }

        return request;
    }

    /*
     * "Maximize" button: the quantities reached from the provided inputs go back to the form,
     * which fills the outputs and runs a normal calculation with them.
     * Returns 'stop' when the view stops here, 'retry' when there is nothing to maximize (no inputs,
     * outputs not depending on them, nothing they can make): the view then quietly renders the
     * requested quantities as usual, and 'continue' outside a maximize run.
     */
    sendMaximizedQuantities(plan)
    {
        if(this.maximizeOutput === false){ return 'continue'; }

        const quantities = {};
            if(plan.status === 'optimal')
            {
                for(const requested of this.requestedItems)
                {
                    // Rounded down so the inputs are always enough
                    const reached = plan.outputs.find(output => output.item === requested.id)?.qty ?? 0;
                        quantities[requested.id] = Math.floor(reached * 100 + 1e-6) / 100;
                }
            }

        if(Object.keys(this.inputItems).length === 0 || Object.values(quantities).every(qty => qty <= 0))
        {
            this.maximizeOutput = false;
            return 'retry';
        }

        this.postMessage({type: 'updateRequestedQuantities', quantities});
        return 'stop';
    }

    // The loader hides once the graph is laid out: the tree list keeps the message visible
    showNotice(text)
    {
        this.notice = text;
        this.postMessage({type: 'updateLoaderText', text: text});
    }

    postMessage(e)
    {
        return this.worker.postMessage(e);
    }

    startCalculation()
    {
        // Ensure some ordering on requested items...
        this.requestedItems.sort((a, b) => {

            // Fuel at the end...
            if(this.items[a.id].energy !== undefined && this.items[b.id].energy === undefined){ return 1; }
            if(this.items[a.id].energy === undefined && this.items[b.id].energy !== 'fuel'){ return -1; }
        });
    }

    endCalculation()
    {
        this.addLabels();

        this.postMessage({type: 'updateLoaderText', text: 'Generating buildings layout...'});
        this.postMessage({type: 'updateGraphNetwork', nodes: this.graphNodes, edges: this.graphEdges});
        // "Power Consumption Multiplier" game mode: every building's consumption is scaled
        this.postMessage({type: 'updateRequiredPower', power: this.requiredPower * this.powerConsumptionMultiplier});
        this.postMessage({type: 'updateItemsList', data: this.listItems});
        this.postMessage({type: 'updateBuildingsList', data: this.listBuildings});
        this.generateTreeList();
        this.postMessage({type: 'done'});
    }


    addLabels()
    {
        this.postMessage({type: 'updateLoaderText', text: 'Add labels...'});

        for(let i = 0; i < this.graphEdges.length; i++)
        {
            let edgeData    = this.graphEdges[i].data;
            let itemName    = this.items[edgeData.itemId].name;

            let roundedQty = +(Math.round(edgeData.qty * 10) / 10);
                if(roundedQty < 0.1)
                {
                    this.graphEdges[i].data.label = itemName + ' (< ' + new Intl.NumberFormat(this.language).format(0.10) + '/min)';
                }
                else
                {
                    if(this.items[edgeData.itemId].category === 'liquid' || this.items[edgeData.itemId].category === 'gas')
                    {
                        this.graphEdges[i].data.label = itemName + ' (' + new Intl.NumberFormat(this.language).format(Math.round(Math.round(edgeData.qty) / 1000)) + ' m³/min)';
                    }
                    else
                    {
                        this.graphEdges[i].data.label = itemName + ' (' + new Intl.NumberFormat(this.language).format(Math.round(edgeData.qty * 100) / 100) + ' units/min)';
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
                    this.graphNodes[i].data.label   = new Intl.NumberFormat(this.language).format(Math.round(Math.round(nodeData.qty) / 1000))
                                                    + ' m³ ' + this.items[nodeData.itemId].name;
                }
                else
                {
                    this.graphNodes[i].data.label   = new Intl.NumberFormat(this.language).format(Math.round(nodeData.qty * 100) / 100)
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
                    this.graphNodes[i].data.performanceColor    = ((nodeData.buildingType === 'Build_Workshop_C') ? 'rgb(255, 255, 255)' : this.getColorForPercentage(Math.min(100, Math.round(performance))));
                    this.graphNodes[i].data.borderWidth         = '15px';

                    this.graphNodes[i].data.label   = ((nodeData.buildingType === 'Build_Workshop_C') ? '' : 'x' + new Intl.NumberFormat(this.language).format(Math.ceil(performance) / 100) + ' ')
                                                    + this.buildings[nodeData.buildingType].name
                                                    + '\n' + '(' + this.recipes[this.graphNodes[i].data.recipe].name + ')';

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
                    this.graphNodes[i].data.label   = new Intl.NumberFormat(this.language).format(Math.round(Math.round(nodeData.neededQty) / 1000))
                                                    + ' m³ ' + this.items[nodeData.itemId].name;
                }
                else
                {
                    this.graphNodes[i].data.label   = new Intl.NumberFormat(this.language).format(Math.round(nodeData.neededQty * 100) / 100)
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
    // Power of one building at 100%: its own, or the middle of the recipe's range (variable power recipes)
    buildingPower(buildingType, recipeId)
    {
        const building  = this.buildings[buildingType];
        const range     = building?.powerUsedRecipes?.[recipeId];

        return (range !== undefined) ? (range[0] + range[1]) / 2 : (building?.powerUsed ?? 0);
    }

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


    /**
     * TREE LIST
     */
    generateTreeList()
    {
        this.postMessage({type: 'updateLoaderText', text: 'Generating production list...'});
        let  html = [];
            if(this.notice !== null)
            {
                html.push('<p class="p-3 text-center text-warning">' + this.notice + '</p>');
            }

            if(this.requestedItems.length === 0)
            {
                html.push('<p class="p-3 text-center">Please select at least one item in the production list.</p>');
            }
            else
            {
                html.push('<div class="row">');

                for(let i = 0; i < this.requestedItems.length; i++)
                {
                    if(this.requestedItems.length >= 1)
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
                                        html.push('<img src="' + this.items[this.requestedItems[i].id].image + '" style="width: 40px;" class="mr-3" />');

                                        if(this.items[this.requestedItems[i].id].category === 'liquid' || this.items[this.requestedItems[i].id].category === 'gas')
                                        {
                                            html.push(new Intl.NumberFormat(this.language).format(this.requestedItems[i].qty) + 'm³ ');
                                        }
                                        else
                                        {
                                            html.push(new Intl.NumberFormat(this.language).format(this.requestedItems[i].qty) + 'x ');
                                        }

                                        if(this.items[this.requestedItems[i].id].url !== undefined)
                                        {
                                            html.push('<a href="' + this.items[this.requestedItems[i].id].url + '"style="line-height: 40px;">' + this.items[this.requestedItems[i].id].name + '</a>');
                                        }
                                        else
                                        {
                                            html.push('<a href="' + this.baseUrls.items + '/id/' + this.requestedItems[i].id + '/name/' + this.items[this.requestedItems[i].id].name + '"style="line-height: 40px;">' + this.items[this.requestedItems[i].id].name + '</a>');
                                        }

                                        for(let k = 0; k < this.graphNodes.length; k++)
                                        {
                                            if(this.graphNodes[k].data.nodeType === 'mainNode' && this.graphNodes[k].data.itemId === this.requestedItems[i].id)
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
                                        html.push(new Intl.NumberFormat(this.language).format(this.graphNodes[k].data.neededQty) + 'x ');
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
        return ' <em style="color: ' + performanceColor + '">(' + performance + '%)</em>';
    }
}