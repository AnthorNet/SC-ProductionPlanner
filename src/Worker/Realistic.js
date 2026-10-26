/*
 * Bundled worker entry for the REALISTIC view.
 */
import ProductionWorker     from '../ProductionWorker.js';
import Solver_Realistic     from '../Solver/Realistic.js';

ProductionWorker(Solver_Realistic);