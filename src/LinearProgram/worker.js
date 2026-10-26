import { prepareGameData }  from './GameData.js';
import { solveProduction }  from './Solver.js';

let game = null;

self.onmessage = ({ data }) => {
    try
    {
        switch(data.type)
        {
            case 'loadGameData':
                game = prepareGameData(data.gameData);
                self.postMessage({ type: 'ready', recipes: Object.keys(game.recipes).length });
                return;

            case 'solve':
                if(game === null)
                {
                    throw new Error('Game data not loaded: send a "loadGameData" message first.');
                }

                self.postMessage({ type: 'result', id: data.id, result: solveProduction(game, data.request) });
                return;

            default:
                throw new Error('Unknown message type: ' + data.type);
        }
    }
    catch(error)
    {
        self.postMessage({ type: 'error', id: data.id, message: error.message });
    }
};