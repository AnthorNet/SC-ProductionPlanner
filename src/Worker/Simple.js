/*
 * Bundled worker entry for the SIMPLE view.
 */
import ProductionWorker     from '../ProductionWorker.js';
import Solver_Simple        from '../Solver/Simple.js';

ProductionWorker(Solver_Simple);