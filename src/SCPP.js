/* global Intl, URL, gtag */

import ProductionPlannerWorker from './Worker.js';

export default class SCPP
{
    constructor()
    {
        // General stuffs
        this.baseUrls                   = {};
        this.doUpdateUrl                = true;
        this.language                   = 'en';
        this.translate                  = {};
        this.productionContainer        = $('#productionContainer');

        this.staticAssetsUrl            = "https://static.satisfactory-calculator.com";
        this.gameDataUrl                = "https://satisfactory-calculator.com/" + this.language + "/api/game";
        this.modsDataUrl                = "https://satisfactory-calculator.com/" + this.language + "/mods/index/json";

        // Updater notice
        this.scriptsVERSION             = Math.floor(Math.random() * Math.floor(999));
        this.urlScriptsVERSION          = null;
        this.intervalScriptsVERSION     = null;

        this.activatedMods              = [];
    }

    start()
    {
        if(this.urlScriptsVERSION !== null)
        {
            this.intervalScriptsVERSION = setInterval(this.checkVersion.bind(this), 300 * 1000);
        }

        $.getJSON(this.gameDataUrl + '?v=' + this.scriptsVERSION, function(data)
        {
            this.modsData       = data.modsData;
            this.buildingsData  = data.buildingsData;
            this.itemsData      = data.itemsData;
            this.toolsData      = data.toolsData;
            this.recipesData    = data.recipesData;
            this.schematicsData = data.schematicsData;

            for(let recipeId in this.recipesData)
            {
                if(this.recipesData[recipeId].className !== undefined && this.recipesData[recipeId].className.startsWith('/Game/FactoryGame/') === false)
                {
                    this.recipesData[recipeId].className = '/Game/FactoryGame/Recipes/' + this.recipesData[recipeId].className;
                }
            }

            for(let schematicId in this.schematicsData)
            {
                if(this.schematicsData[schematicId].className !== undefined && this.schematicsData[schematicId].className.startsWith('/Game/FactoryGame/Schematics/') === false)
                {
                    this.schematicsData[schematicId].className = '/Game/FactoryGame/Schematics/' + this.schematicsData[schematicId].className;
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
                        'border-width'          : '15px'
                    }
                },
                {
                    selector                : 'node[performanceColor]',
                    style                   : {
                        'border-color'          : 'data(performanceColor)'
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
        $('.addOneItem').on('click', function(e){
            let currentId       = $(e.currentTarget).attr('data-id'),
                currentInput    = $('input.requireInput[data-id=' + currentId + ']');
                e.preventDefault();

            $(e.currentTarget).addClass('d-none').removeClass('d-flex');
            currentInput.closest('.media').find('.stepBackward').removeClass('disabled');
            currentInput.val(1).closest('.media').addClass('d-flex').removeClass('d-none');
            $('#chooseItem').modal('hide');

            this.triggerUpdateDebounce();
        }.bind(this));

        $('.stepUpdate').on('click', function(e){
            e.preventDefault();

            let inputGroup      = $(e.currentTarget).parent().parent();
            let input           = inputGroup.find('input');
            let dataValue       = parseInt($(e.currentTarget).attr('data-value'));
            let currentValue    = parseInt(input.val());
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

        $('input.requireInput').on('keyup', function(e){
            /*
            if($(e.currentTarget).val() > parseInt($(e.currentTarget).attr('data-maxQty')))
            {
                $(e.currentTarget).val(parseInt($(e.currentTarget).attr('data-maxQty')));
            }
            */

            if(parseInt($(e.currentTarget).val()) === 0)
            {
                $(e.currentTarget).closest('.media').addClass('d-none').removeClass('d-flex');
                $('.addOneItem[data-id=' + $(e.currentTarget).attr('data-id') + ']').addClass('d-flex').removeClass('d-none');
            }

            this.triggerUpdateDebounce();
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
                    $('#mainAltRecipe option[value="' + previousValue + '"]').prop('selected', false);
                    $('#mainAltRecipe option[value="' + clickedValue + '"]').prop('selected', true);

                    $('#mainAltRecipe').selectpicker('refresh');
                }
        });

        return this.updateRequired(true);
    }

    // Prevent too much worker starts...
    triggerUpdateDebounce()
    {
        if(this.inputTimeout)
        {
            clearTimeout(this.inputTimeout);
        }
        this.inputTimeout = setTimeout(function(){
            this.updateRequired();
            this.inputTimeout = null;
        }.bind(this), 500);
    }

    updateRequired(initialCall = false)
    {
        let  formData = {};

        // Generate required list
        $('.requireInput').each(function(){
            if($(this).is('select'))
            {
                if($(this).attr('name') === 'mergeBuildings' || $(this).attr('name') === 'useManifolds')
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
                        if($(this).attr('name') === 'altRecipes[]')
                        {
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
                        }
                        else
                        {
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
                    formData[$(this).attr('data-id')] = $(this).val();
                }
            }
        }).promise().done(function(){
            if(this.activatedMods.length > 0)
            {
                formData.activatedMods = this.activatedMods;
            }

            this.calculate(formData, initialCall);
        }.bind(this));
    }

    reset()
    {
        // Reset Network Graph
        this.graph.elements().remove();

        // Terminate worker if needed
        if(this.worker !== undefined && this.worker !== null)
        {
            this.worker.terminate();
            this.worker = null;
        }

        $('#productionList').empty();
        $('#itemsList').empty();
        $('#buildingsList').empty();
        $('#requiredPower').empty();

        this.hideLoader();
    }

    calculate(formData, initialCall)
    {
        this.reset();

        let $this       = this;
        let blobScript  = new Blob([ '(', ProductionPlannerWorker.toString(), ')()' ], { type: 'application/javascript' });
        let blobURL     = URL.createObjectURL(blobScript);
            this.worker = new Worker(blobURL);

            setTimeout(function(){ URL.revokeObjectURL(blobURL); }, 1500);

        // Planner states
        this.worker.onmessage = function(e)
        {
            if(e.data.type === 'showLoader')
            {
                $this.showLoader();
                return;
            }
            if(e.data.type === 'updateLoaderText')
            {
                $this.updateLoaderText(e.data.text);
                return;
            }

            if(e.data.type === 'updateUrl')
            {
                if(initialCall === false && $this.doUpdateUrl !== false)
                {
                    $this.updateUrl(e.data.url);
                }

                return;
            }
            if(e.data.type === 'updateGraphNetwork')
            {
                $this.updateGraphNetwork(e.data.nodes, e.data.edges, e.data.direction);
                return;
            }
            if(e.data.type === 'updateRequiredPower')
            {
                $('#requiredPower').html(
                    new Intl.NumberFormat($this.language)
                            .format(Math.ceil(e.data.power)) + ' MW'
                );
                return;
            }

            if(e.data.type === 'updateTreeList')
            {
                $this.updateTreeList(e.data.html);
                return;
            }
            if(e.data.type === 'updateItemsList')
            {
                $this.updateItemsList(e.data.html);
                return;
            }
            if(e.data.type === 'updateBuildingsList')
            {
                $this.updateBuildingsList(e.data.html);
                return;
            }

            if(e.data.type === 'done')
            {
                this.terminate();
                return;
            }

            console.log('onmessage received:', e.data);
        };

        // Launch it!
        this.worker.postMessage({
            baseUrls    : this.baseUrls,
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

    updateItemsList(html)
    {
        $('#itemsList').html(html);
    }

    updateBuildingsList(html)
    {
        $('#buildingsList').html(html);
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
        let urlJoined = this.baseUrls.planner + '/' + url.join('/');
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