/* global Intl, URL, gtag */

// WORKERS
import ProductionWorker                             from './ProductionWorker.js';
import Worker_Wrapper                               from './Worker/Wrapper.js';

import Solver_Simple                                from './Solver/Simple.js';
import Solver_Realistic                             from './Solver/Realistic.js';

export default class SCPP
{
    constructor()
    {
        // General stuffs
        this.baseUrls                   = {};
        this.doUpdateUrl                = true;

        this.debug                      = false;
        this.language                   = 'en';
        this.translate                  = {};
        this.productionContainer        = $('#productionContainer');

        this.staticAssetsUrl            = "https://static.satisfactory-calculator.com";
        this.gameDataUrl                = "https://satisfactory-calculator.com/" + this.language + "/api/game";

        // Updater notice
        this.scriptsVERSION             = Math.floor(Math.random() * Math.floor(999));
        this.urlScriptsVERSION          = null;
        this.intervalScriptsVERSION     = null;

        this.collectedSchematics        = new Schematics({language: this.language});
        this.activatedMods              = [];

        this.availableWorkers           = {
            SIMPLE                          : {
                name    : 'Solver_Simple',
                class   : Solver_Simple
            },
            REALISTIC                       : {
                name    : 'Solver_Realistic',
                class   : Solver_Realistic
            }
        };
    }

    start()
    {
        if(this.urlScriptsVERSION !== null)
        {
            this.intervalScriptsVERSION = setInterval(this.checkVersion.bind(this), 300 * 1000);
        }

        $.getJSON(this.gameDataUrl + '?v=' + this.scriptsVERSION, function(data)
        {
            this.buildingsData  = data.buildingsData;
            this.itemsData      = data.itemsData;
            this.toolsData      = data.toolsData;
            this.recipesData    = data.recipesData;

            if(this.activatedMods.length > 0)
            {
                for(let i = 0; i < this.activatedMods.length; i++)
                {
                    let currentMod = this.activatedMods[i];

                        for(let buildingId in currentMod.buildings)
                        {
                            this.buildingsData[buildingId] = currentMod.buildings[buildingId];
                        }
                        for(let itemId in currentMod.items)
                        {
                            this.itemsData[itemId] = currentMod.items[itemId];
                        }
                        for(let toolId in currentMod.tools)
                        {
                            this.toolsData[toolId] = currentMod.tools[toolId];
                        }
                        for(let recipeId in currentMod.recipes)
                        {
                            this.recipesData[recipeId] = currentMod.recipes[recipeId];
                        }
                }
            }

            this.initiateGraph();
        }.bind(this));
    }

    initiateGraph()
    {
        this.graphLayout        = null;
        this.graph              = cytoscape({
            container               : document.getElementById('productionNetwork'),
            wheelSensitivity        : 0.05,
            layout                  : undefined,
            elements                : {nodes: {}, edges: {}},
            style                   : [
                {
                    selector                : 'node',
                    style                   : {
                        padding                 : '64px',
                        width                   : '384px',
                        height                  : '384px'
                    }
                },
                {
                    selector                : 'node[nodeType="merger"], node[nodeType="splitter"]',
                    style                   : {
                        padding                 : '32px',
                        width                   : '128px',
                        height                  : '128px'
                    }
                },
                {
                    selector                : 'node[image]',
                    style                   : {
                        shape                   : 'square',
                        'background-fit'        : 'contain',
                        'background-image'      : 'data(image)',
                        'background-opacity'    : 0
                    }
                },
                {
                    selector                : 'node[performance]',
                    style                   : {
                        shape                   : 'ellipse',
                        'background-fit'        : 'none',
                        'background-width'      : '75%',
                        'background-height'     : '75%',
                        'border-width'          : 'data(borderWidth)'
                    }
                },
                {
                    selector                : 'node[performanceColor]',
                    style                   : {
                        'border-color'          : 'data(performanceColor)'
                    }
                },
                {
                    selector                : 'node[wasClicked]',
                    style                   : {
                        'background-color'      : '#00FF00',
                        'background-opacity'    : 1
                    }
                },
                {
                    selector                : 'node[label]',
                    style                   : {
                        'text-margin-y'         : '20px',
                        label                   : 'data(label)',
                        'text-valign'           : 'bottom',
                        'font-size'             : '64px;',
                        'text-wrap'             : 'wrap',
                        color                   : '#FFFFFF'
                    }
                },

                {
                    selector                : 'edge',
                    style                   : {
                        'curve-style'           : 'bezier',
                        'target-arrow-shape'    : 'triangle',
                        'line-color'            : '#2b7ce9',
                        'target-arrow-color'    : '#2b7ce9',
                        opacity                 : 1,
                        width                   : '15px'
                    }
                },
                {
                    selector                : 'edge[color]',
                    style                   : {
                        'line-color'            : 'data(color)',
                        'target-arrow-color'    : 'data(color)'
                    }
                },
                {
                    selector                : 'edge[label]',
                    style                   : {
                        'text-margin-y'         : '-30px',
                        'text-rotation'         : 'autorotate',
                        label                   : 'data(label)',
                        'font-size'             : '36px;',
                        color                   : '#FFFFFF'
                    }
                }
            ]
        });

        return this.setupEvents();
    }

    setupEvents()
    {
        $('#chooseItemOutput, #chooseItemInput').on('show.bs.modal', function(){
            $(this).find('img').each(function(){
                let src = $(this).attr('data-src');
                    if(src !== undefined)
                    {
                        const img   = new Image();
                        img.src     = src;
                        img.onload  = () => {
                          $(this).attr('src', src)
                                 .removeAttr('data-src');
                        };
                    }
            });
        });

        $('.addOneItem').on('click', function(e){
            let currentId       = $(e.currentTarget).attr('data-id'),
                currentType     = $(e.currentTarget).attr('data-type'),
                currentInput    = $('input.requireInput[data-id=' + currentId + '][data-type=' + currentType + ']');
                e.preventDefault();

            $(e.currentTarget).addClass('d-none').removeClass('d-flex');
            currentInput.closest('.media').find('.stepBackward').removeClass('disabled');
            currentInput.val(1).closest('.media')
                               .addClass('d-flex')
                               .removeClass('d-none')
                               .find('img').each(function(){
                                    let src = $(this).attr('data-src');
                                        if(src !== undefined)
                                        {
                                            const img   = new Image();
                                            img.src     = src;
                                            img.onload  = () => {
                                                $(this).attr('src', src)
                                                       .removeAttr('data-src');
                                            };
                                        }
                                });
            $('#chooseItemInput').modal('hide');
            $('#chooseItemOutput').modal('hide');

            this.triggerUpdateDebounce();
        }.bind(this));

        $('.stepUpdate').on('click', function(e){
            e.preventDefault();

            let inputGroup      = $(e.currentTarget).parent().parent();
            let input           = inputGroup.find('input');
            let dataValue       = parseInt($(e.currentTarget).attr('data-value'));
            let currentValue    = parseFloat(input.val());
            //let maxQty          = parseInt(input.attr('data-maxQty'));
            let newValue        = currentValue + dataValue;

            if(newValue >= 0/* && newValue <= maxQty*/)
            {
                if(newValue === 0)
                {
                    inputGroup.closest('.media').addClass('d-none').removeClass('d-flex');
                    $('.addOneItem[data-id=' + input.attr('data-id') + ']').addClass('d-flex').removeClass('d-none');
                }

                input.val(newValue);
                this.triggerUpdateDebounce();
            }

            inputGroup.find('.stepUpdate').removeClass('disabled');
            if((newValue - 10) < 0){ inputGroup.find('.fastBackward').addClass('disabled'); }
            if((newValue - 1) < 0){ inputGroup.find('.stepBackward').addClass('disabled'); }
            //if((newValue + 1) > maxQty){ inputGroup.find('.stepForward').addClass('disabled'); }
            //if((newValue + 10) > maxQty){ inputGroup.find('.fastForward').addClass('disabled'); }
        }.bind(this));

        $('input.requireInput').on('keyup mouseup', function(e){
            this.triggerUpdateDebounce(e.currentTarget);
        }.bind(this));

        $('select.requireInput').on('change', function(e){
            this.triggerUpdateDebounce();
        }.bind(this));

        // Sync alternative recipes on change
        $('select[name="altRecipes[]"]').on('changed.bs.select', function(e, clickedIndex, isSelected, previousValue){
            let clickedValue = $(this).find('option:eq(' + clickedIndex + ')').attr('value');

                if(Array.isArray(previousValue)) // #mainAltRecipe was clicked...
                {
                    let option = $('select[name="altRecipes[]"]:not(#mainAltRecipe) option[value="' + clickedValue + '"]');
                    let select = option.parent();

                        option.prop('selected', isSelected);
                        select.selectpicker('refresh');
                }
                else // Need to sync #mainAltRecipe
                {
                    let option              = $('select[name="altRecipes[]"]:not(#mainAltRecipe) option[value="' + clickedValue + '"]');
                    let isConverterRecipe   = option.attr('data-converter');
                        if(isConverterRecipe === 1)
                        {
                            $('#mainConvRecipe option[value="' + previousValue + '"]').prop('selected', false);
                            $('#mainConvRecipe option[value="' + clickedValue + '"]').prop('selected', true);

                            $('#mainConvRecipe').selectpicker('refresh');
                        }
                        else
                        {
                            $('#mainAltRecipe option[value="' + previousValue + '"]').prop('selected', false);
                            $('#mainAltRecipe option[value="' + clickedValue + '"]').prop('selected', true);

                            $('#mainAltRecipe').selectpicker('refresh');
                        }
                }
        });

        // Switch available options based on view mode
        $('select[name="view"]').on('change', function(){
            let currentValue = $(this).val();
                $('div[data-view][data-view!="' + currentValue + '"]').hide();
                $('div[data-view="' + currentValue + '"]').show();
        });
        $('select[name="mergeBuildings"]').on('change', function(){
            let currentValue = $(this).val();
                if(currentValue > 0)
                {
                    $('div[data-mergeBuildings]').show();
                }
                else
                {
                    $('div[data-mergeBuildings]').hide();
                }
        });

        // Switch available options based on powerShards
        $('input[name="powerShards"]').on('keyup change input', function(e){
            let currentValue = parseInt($(e.currentTarget).val());
                if(currentValue > 0)
                {
                    $('div[data-powerShards]').show();
                }
                else
                {
                    $('div[data-powerShards]').hide();
                }

                this.triggerUpdateDebounce();
        }.bind(this));

        // Sync alternate recipes?
        let collectedSchematics = this.collectedSchematics.getCollectedSchematics();
            if(collectedSchematics.length > 0)
            {
                $('#loadAltRecipeFromSCIM').show().find('button').on('click', function(e){
                    $('#mainAltRecipe').selectpicker('deselectAll');

                    for(let i = 0; i < collectedSchematics.length; i++)
                    {
                        let currentVal = $('#mainAltRecipe').find('option[data-schematic="' + collectedSchematics[i] + '"');
                            if(currentVal.length > 0)
                            {
                                currentVal.each(function(){
                                    $('#mainAltRecipe option[value="' + $(this).val() + '"]').prop('selected', true);
                                })
                            }
                    }

                    $('#mainAltRecipe').selectpicker('refresh');
                    this.triggerUpdateDebounce();
                }.bind(this));
            }

        return this.updateRequired(true);
    }

    // Prevent too much worker starts...
    triggerUpdateDebounce(currentTarget = null)
    {
        if(this.inputTimeout)
        {
            clearTimeout(this.inputTimeout);
        }
        this.inputTimeout = setTimeout(function(){
            if(currentTarget !== null && parseFloat($(currentTarget).val()) === 0)
            {
                this.timeoutID = undefined;
                $(currentTarget).closest('.media').addClass('d-none').removeClass('d-flex');
                $('.addOneItem[data-id=' + $(currentTarget).attr('data-id') + '][data-type=' + $(currentTarget).attr('data-type') + ']').addClass('d-flex').removeClass('d-none');
            }

            this.updateRequired();
            this.inputTimeout = null;
        }.bind(this), 500);
    }

    updateRequired(initialCall = false)
    {
        let fullRefreshRequired = false;
        let activatedMods       = [];
            if(this.activatedMods.length > 0)
            {
                for(let i = 0; i < this.activatedMods.length; i++)
                {
                    activatedMods.push(this.activatedMods[i].data.idSML);
                }
            }

        let formData            = {};

        // Generate required list
        $('.requireInput').each(function(){
            if($(this).is('select'))
            {
                if(['mergeBuildings', 'useManifolds', 'minerOverclocking', 'pumpOverclocking', 'buildingOverclocking'].includes($(this).attr('name')))
                {
                    if(parseInt($(this).children("option:selected").val()) !== 1)
                    {
                        formData[$(this).attr('name')] = $(this).val();
                    }
                }
                else
                {
                    if($(this).children("option:selected").val() !== '')
                    {
                        let inputName = $(this).attr('name');
                            switch(inputName)
                            {
                                case 'altRecipes[]':
                                    let canUpdate       = false;
                                    let isMainAltRecipe = ($(this).attr('id') === 'mainAltRecipe') ? true : false;
                                        if(isMainAltRecipe === false)
                                        {
                                            let mediaParent = $(this).closest('.media');
                                                if(mediaParent.hasClass('d-none') === false)
                                                {
                                                    canUpdate = true;
                                                }
                                        }

                                        if(isMainAltRecipe === true || canUpdate === true)
                                        {
                                            let fieldName = $(this).attr('name').replace('[]', '');
                                                if(formData[fieldName] === undefined)
                                                {
                                                    formData[fieldName] = [];
                                                }

                                                $.each($(this).children("option"), function(key, value)
                                                {
                                                    let currentValue = $(this).val();
                                                    let isSelected   = $(this).is(':selected');

                                                        if(isSelected === true)
                                                        {
                                                            if((isMainAltRecipe === true || key > 0) && formData[fieldName].includes(currentValue) === false)
                                                            {
                                                                formData[fieldName].push(currentValue);
                                                            }
                                                        }
                                                });
                                        }

                                        break;

                                case 'convRecipes[]':
                                    let fieldName = $(this).attr('name').replace('[]', '');
                                        if(formData[fieldName] === undefined)
                                        {
                                            formData[fieldName] = [];
                                        }

                                        $.each($(this).children("option"), function(key, value)
                                        {
                                            let currentValue = $(this).val();
                                            let isSelected   = $(this).is(':selected');
                                                if(isSelected === true && formData[fieldName].includes(currentValue) === false)
                                                {
                                                    formData[fieldName].push(currentValue);
                                                }
                                        });

                                        break;

                                case 'mods[]':
                                    $.each($(this).children("option"), function(key, value)
                                    {
                                        let currentValue = $(this).val();
                                        let isSelected   = $(this).is(':selected');

                                            if(isSelected === true)
                                            {
                                                if(formData.mods === undefined)
                                                {
                                                    formData.mods = [];
                                                }
                                                formData.mods.push(currentValue);

                                                if(activatedMods.length === 0 || (activatedMods.length > 0 && activatedMods.includes(currentValue) === false))
                                                {
                                                    fullRefreshRequired = true;
                                                }
                                            }
                                            else
                                            {
                                                if(activatedMods.length > 0 && activatedMods.includes(currentValue) === true)
                                                {
                                                    fullRefreshRequired = true;
                                                }
                                            }
                                    });

                                    break;

                                default:
                                    formData[$(this).attr('name').replace('[]', '')] = $(this).children("option:selected").val();
                            }
                    }
                }
            }
            else
            {
                // General items...
                if($(this).val() > 0)
                {
                    if($(this).attr('data-id') !== undefined && $(this).attr('data-type') !== undefined)
                    {
                        if($(this).attr('data-type') === 'output')
                        {
                            formData[$(this).attr('data-id')] = $(this).val();
                        }
                        if($(this).attr('data-type') === 'input')
                        {
                            if(formData.input === undefined)
                            {
                                formData.input = {};
                            }

                            formData.input[$(this).attr('data-id')] = $(this).val();
                        }
                    }
                    else
                    {
                        formData[$(this).attr('name')] = $(this).val();
                    }
                }
            }
        }).promise().done(function(){
            if(this.activatedMods.length > 0)
            {
                formData.activatedMods = this.activatedMods;
            }

            this.calculate(formData, initialCall, fullRefreshRequired);
        }.bind(this));
    }



    reset()
    {
        // Reset Network Graph
        this.graph.elements().remove();
        this.graph.off('tap', 'node');

        // Terminate worker if needed
        this.terminateWorker();

        $('#productionList').empty();
        $('#itemsList').empty();
        $('#buildingsList').empty();
        $('#requiredPower').empty();

        this.hideLoader();
    }

    terminateWorker()
    {
        if(this.worker !== undefined && this.worker !== null)
        {
            this.worker.terminate();
            this.worker = null;
        }
    }



    calculate(formData, initialCall, fullRefreshRequired = false)
    {
        this.reset();

        // Create a custom worker based on required view
        let blobScript  = new Blob([
                Worker_Wrapper.toString(), ';',
                this.availableWorkers[formData.view].class.toString(), ';',
                '(', ProductionWorker.toString(), ')(' + this.availableWorkers[formData.view].name + ');'
            ], { type: 'application/javascript' });
        let blobURL     = URL.createObjectURL(blobScript);
            this.worker = new Worker(blobURL);

            setTimeout(function(){ URL.revokeObjectURL(blobURL); }, 1500);

        // Planner states
        this.worker.onmessage = function(e)
        {
            switch(e.data.type)
            {
                case 'showLoader':
                    return this.showLoader();
                case 'updateLoaderText':
                    return this.updateLoaderText(e.data.text);
                case 'updateUrl':
                    if(fullRefreshRequired === true)
                    {
                        location.href = this.baseUrls.planner + '/json/' + encodeURI(JSON.stringify(e.data.url));
                    }
                    else
                    {
                        if(initialCall === false && this.doUpdateUrl !== false)
                        {
                            return this.updateUrl(e.data.url);
                        }
                    }
                    return;

                case 'updateGraphNetwork':
                    if(fullRefreshRequired === false)
                    {
                        return this.updateGraphNetwork(e.data.nodes, e.data.edges, formData.direction);
                    }
                    return;

                case 'updateRequiredPower':
                    $('#requiredPower').html(
                        new Intl.NumberFormat(this.language)
                                .format(Math.ceil(e.data.power)) + ' MW'
                    );
                    return ;

                case 'updateTreeList':
                case 'updateItemsList':
                case 'updateBuildingsList':
                    return this[e.data.type](e.data.data);

                case 'addAlternateRecipe':
                    $('#mainAltRecipe option[value="' + e.data.recipeId + '"]').prop('selected', true);
                    $('#mainAltRecipe').selectpicker('refresh');
                    this.triggerUpdateDebounce();

                    return;

                case 'removeAlternateRecipe':
                    $('#mainAltRecipe option[value="' + e.data.recipeId + '"]').prop('selected', false);
                    $('#mainAltRecipe').selectpicker('refresh');
                    this.triggerUpdateDebounce();

                    return;

                case 'done':
                    return this.terminateWorker();
            }

            // Another command?
            console.log('onmessage received:', e.data);
        }.bind(this);

        // Launch it!
        this.worker.postMessage({
            baseUrls    : this.baseUrls,
            debug       : this.debug,
            language    : this.language,
            translate   : this.translate,

            buildings   : this.buildingsData,
            items       : this.itemsData,
            tools       : this.toolsData,
            recipes     : this.recipesData,

            formData    : formData
        });
    }


    updateGraphNetwork(dataNodes, dataEdges, direction = 'RIGHT')
    {
        if(this.graphLayout !== null)
        {
            this.graphLayout.stop();
        }

        this.graph.json({
            elements: {
                nodes: dataNodes,
                edges: dataEdges
            }
        });

        let layoutOptions = {
                name                            : 'elk',
                nodeDimensionsIncludeLabels     : true,
                fit                             : true,
                ranker                          : 'longest-path',
                elk                             : {
                    'elk.layered.spacing.nodeNodeBetweenLayers'     : 768,
                    'elk.layered.spacing.nodeNode'                  : 512,
                    'elk.direction'                                 : direction,
                    'elk.algorithm'                                 : 'layered',
                    'elk.layered.crossingMinimization.strategy'     : 'LAYER_SWEEP',
                    'elk.edgeRouting'                               : "ORTHOGONAL",

                    spacing                                         : 512,
                    inLayerSpacingFactor                            : 50,
                    layoutHierarchy                                 : true,
                    intCoordinates                                  : true,
                    zoomToFit                                       : true,
                    separateConnectedComponents                     : false
                }
        };

        this.graphLayout = this.graph.layout(layoutOptions);
        this.graphLayout.on('layoutstop', function(){ this.hideLoader(); }.bind(this));

        this.graphLayout.run();

        this.graph.on('tap', 'node', function(evt){
            if(this.data('nodeType') !== 'mainNode')
            {
                if(this.data('wasClicked') === undefined)
                {
                    this.data('wasClicked', true);
                }
                else
                {
                    this.removeData('wasClicked');
                }
            }
        });
    }

    updateTreeList(html)
    {
        $('#productionList').empty().html(html);

        $('#productionList .collapseChildren')
            .css('cursor', 'pointer')
            .bind('click', function(){
                let nextChild = $(this).parent().next('.parent');
                    if(nextChild.is(":hidden"))
                    {
                        nextChild.show();
                    }
                    else
                    {
                        nextChild.hide();
                    }
            });
    }

    updateItemsList(items)
    {
            this.updateLoaderText('Generating items list...');
        let html        = [];
        let listItems   = Object.keys(items).sort((a, b) => items[b] - items[a]);

        if(listItems.length === 0)
        {
            html.push('<p class="p-3 text-center">Please select at least one item in the production list.</p>');
        }
        else
        {
            html.push('<table class="table table-striped mb-0">');

            html.push('<thead>');
                html.push('<tr>');
                    html.push('<th></th>');
                    html.push('<th>Needed per minute</th>');
                html.push('</tr>');
            html.push('</thead>');

            html.push('<tbody>');

            for(let i = 0; i < listItems.length; i++)
            {
                let itemId  = listItems[i];

                html.push('<tr>');
                    html.push('<td width="40"><img src="' + this.itemsData[itemId].image + '" style="width: 40px;" /></td>');
                    html.push('<td class="align-middle">');

                        if(this.itemsData[itemId].category === 'liquid' || this.itemsData[itemId].category === 'gas')
                        {
                            html.push(new Intl.NumberFormat(this.language).format(items[itemId]) + ' m³/min of ');
                        }
                        else
                        {
                            html.push(new Intl.NumberFormat(this.language).format(items[itemId]) + ' units/min of ');
                        }

                        if(this.itemsData[itemId].url !== undefined)
                        {
                            html.push('<a href="' + this.itemsData[itemId].url + '">' + this.itemsData[itemId].name + '</a>');
                        }
                        else
                        {
                            html.push('<a href="' + this.baseUrls.items + '/id/' + itemId + '/name/' + this.itemsData[itemId].name + '">' + this.itemsData[itemId].name + '</a>');
                        }

                   html.push('</td>');
                html.push('</tr>');
            }

            html.push('</tbody>');
            html.push('</table>');
        }

        $('#itemsList').html(html.join(''));
    }

    updateBuildingsList(buildings)
    {
            this.updateLoaderText('Generating buildings list...');
        let html                = [];
        let buildingsListRecipe = {};
        let listBuildings       = Object.keys(buildings).sort((a, b) => buildings[b] - buildings[a]);

        if(listBuildings.length === 0)
        {
            html.push('<p class="p-3 text-center">Please select at least one item in the production list.</p>');
        }
        else
        {
            html.push('<table class="table table-striped mb-0">');

            for(let i = 0; i < listBuildings.length; i++)
            {
                let buildingId          = listBuildings[i];
                let currentRecipe       = null;
                let buildingClassName   = this.buildingsData[buildingId].className.replace(/Build_/g, 'Desc_');

                // Build recipe...
                for(let recipeId in this.recipesData)
                {
                    if(this.recipesData[recipeId].produce[buildingClassName] !== undefined)
                    {
                        currentRecipe = [];

                        for(let ingredient in this.recipesData[recipeId].ingredients)
                        {
                            for(let itemId in this.itemsData)
                            {
                                if(this.itemsData[itemId].className === ingredient)
                                {
                                    currentRecipe.push({
                                        id      : itemId,
                                        name    : this.itemsData[itemId].name,
                                        image   : this.itemsData[itemId].image,
                                        qty     : this.recipesData[recipeId].ingredients[ingredient]
                                    });

                                    break;
                                }
                            }
                            for(let itemId in this.toolsData)
                            {
                                if(this.toolsData[itemId].className === ingredient)
                                {
                                    currentRecipe.push({
                                        id      : itemId,
                                        name    : this.toolsData[itemId].name,
                                        image   : this.toolsData[itemId].image,
                                        qty     : this.recipesData[recipeId].ingredients[ingredient]
                                    });

                                    break;
                                }
                            }
                        }

                        break;
                    }
                }

                html.push('<tr>');
                html.push('<td width="40" class="align-middle"><img src="' + this.buildingsData[buildingId].image + '" style="width: 40px;" /></td>');

                html.push('<td class="align-middle">');
                    html.push(new Intl.NumberFormat(this.language).format(buildings[buildingId]) + 'x ');

                    if(this.buildingsData[buildingId].url !== undefined)
                    {
                        html.push('<a href="' + this.buildingsData[buildingId].url + '">' + this.buildingsData[buildingId].name + '</a>');
                    }
                    else
                    {
                        html.push('<a href="' + this.baseUrls.buildings + '/id/' + buildingId + '/name/' + this.buildingsData[buildingId].name + '">' + this.buildingsData[buildingId].name + '</a>');
                    }

                html.push('</td>');

                html.push('<td class="align-middle">');

                    let toJoin = [];
                        if(currentRecipe !== null)
                        {
                            for(let j = 0; j < currentRecipe.length; j++)
                            {
                                let recipeQty   = buildings[buildingId] * currentRecipe[j].qty;
                                let temp        = [];
                                    temp.push(new Intl.NumberFormat(this.language).format(recipeQty) + 'x ');
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
            html.push('<td width="50"></td>');
            html.push('<td><strong>Total:</strong></td>');
            html.push('<td class="p-0"><ul class="list-group list-group-flush">');

            let totalKeys = Object.keys(buildingsListRecipe).sort((a, b) => buildingsListRecipe[b] - buildingsListRecipe[a])
                for(let i = 0; i < totalKeys.length; i++)
                {
                    let idRecipe = totalKeys[i];
                    html.push('<li class="list-group-item">');

                    html.push(new Intl.NumberFormat(this.language).format(buildingsListRecipe[idRecipe]) + 'x ');

                    if(this.itemsData[idRecipe] !== undefined)
                    {
                        html.push('<img src="' + this.itemsData[idRecipe].image + '" title="' + this.itemsData[idRecipe].name + '" style="width: 24px;" /> ');

                        if(this.itemsData[idRecipe].url !== undefined)
                        {
                            html.push('<a href="' + this.itemsData[idRecipe].url + '">' + this.itemsData[idRecipe].name + '</a>');
                        }
                        else
                        {
                            html.push('<a href="' + this.baseUrls.items + '/id/' + idRecipe + '/name/' + this.itemsData[idRecipe].name + '">' + this.itemsData[idRecipe].name + '</a>');
                        }
                    }
                    else
                    {
                        if(this.toolsData[idRecipe] !== undefined)
                        {
                            html.push('<img src="' + this.toolsData[idRecipe].image + '" title="' + this.toolsData[idRecipe].name + '" style="width: 24px;" /> ');

                            if(this.toolsData[idRecipe].url !== undefined)
                            {
                                html.push('<a href="' + this.toolsData[idRecipe].url + '">' + this.toolsData[idRecipe].name + '</a>');
                            }
                            else
                            {
                                html.push('<a href="' + this.baseUrls.tools + '/id/' + idRecipe + '/name/' + this.toolsData[idRecipe].name + '">' + this.toolsData[idRecipe].name + '</a>');
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

        $('#buildingsList').html(html.join(''));
    }

    hideLoader()
    {
        this.productionContainer.find('.loader').hide();
    }
    showLoader()
    {
        this.productionContainer.find('.loader').show();
    }
    updateLoaderText(text)
    {
        this.productionContainer.find('.loader h6').html(text);
    }

    updateUrl(url)
    {
        let urlJoined   = this.baseUrls.planner;
            urlJoined  += '/json/' + encodeURIComponent(JSON.stringify(url));
            window.history.pushState({href: urlJoined}, '', urlJoined);

            if(typeof gtag === 'function')
            {
                gtag('event', 'page_view', {page_path: urlJoined});
            }
    }

    checkVersion(currentVersion)
    {
        if(currentVersion !== undefined && currentVersion !== null)
        {
            if(currentVersion > this.scriptsVERSION)
            {
                if($.fn.modal)
                {
                    $('#newPlannerRelease').modal({backdrop: 'static', keyboard: false});
                }
                else
                {
                    alert("Good news, a new version of the production planner was released! Please refresh your page / browser cache to make sure you'll get the latest fixes and features.");
                }

                return false;
            }
        }
        else
        {
            if(this.urlScriptsVERSION !== null)
            {
                $.get(this.urlScriptsVERSION, function(data){
                    if(data > this.scriptsVERSION)
                    {
                        if($.fn.modal)
                        {
                            $('#newPlannerRelease').modal({backdrop: 'static', keyboard: false});
                        }
                        else
                        {
                            alert("Good news, a new version of the production planner was released! Please refresh your page / browser cache to make sure you'll get the latest fixes and features.");
                        }

                        clearInterval(this.intervalScriptsVERSION);
                        return false;
                    }
                });
            }
        }

        return true;
    };
}

window.SCPP = new SCPP();