/* global self */

/*
 * Worker only instanciate appropriate solver class
 */
export default function ProductionWorker(workerClass)
{
    self.workerClass    = new workerClass(self);
}