/*
 * Dense two-phase primal simplex with exact lexicographic multi-objective support.
 *
 * No dependency, no DOM: usable in a worker, in Node, anywhere.
 *
 * Problem form:
 *      minimise    c1·x, then c2·x among c1-optimal x, then c3·x...
 *      subject to  Σ a_ij x_j (<=|=|>=) b_i
 *                  x >= 0
 *
 * Lexicographic optimisation is exact (no epsilon-relaxed constraints): once an objective
 * is optimal, every non-basic column with a strictly positive reduced cost is frozen at 0.
 * The remaining columns all have a zero reduced cost for that objective, so any further
 * pivot keeps its optimal value unchanged.
 */

const PIVOT_TOL         = 1e-7;     // Minimum |a_ij| accepted as a pivot element
const COST_TOL          = 1e-7;     // Reduced costs closer to 0 than this are treated as 0
const FEASIBILITY_TOL   = 1e-7;     // Phase 1 residual accepted as feasible
const DEGENERATE_LIMIT  = 50;       // Consecutive degenerate pivots before switching to Bland's rule
const HARRIS_TOL        = 1e-9;     // Infeasibility tolerated by the ratio test in exchange for larger pivots
const PERTURBATION      = 1e-6;     // Relative right-hand side perturbation against degeneracy

export class LinearProgram
{
    constructor()
    {
        this.variables      = [];
        this.constraints    = [];
    }

    /**
     * @returns {number} column index of the new variable (x >= 0)
     */
    addVariable(name = null)
    {
        const index = this.variables.length;
            this.variables.push(name ?? ('x' + index));

        return index;
    }

    /**
     * @param {Array<[number, number]>} terms   [variableIndex, coefficient] pairs (duplicates are summed)
     * @param {'<='|'='|'>='} operator
     * @param {number} rhs
     */
    addConstraint(terms, operator, rhs, name = null)
    {
        if(['<=', '=', '>='].includes(operator) === false)
        {
            throw new Error('Unknown constraint operator: ' + operator);
        }
        if(Number.isFinite(rhs) === false)
        {
            throw new Error('Constraint right-hand side must be finite (' + (name ?? this.constraints.length) + ')');
        }

        const merged = new Map();
            for(const [variable, coefficient] of terms)
            {
                if(coefficient === 0){ continue; }
                merged.set(variable, (merged.get(variable) ?? 0) + coefficient);
            }

        this.constraints.push({ terms: [...merged].filter(([, c]) => c !== 0), operator, rhs, name });

        return this.constraints.length - 1;
    }
}

/**
 * @param {LinearProgram} lp
 * @param {Array<Array<[number, number]>>} objectives   minimised in order
 * @param {{maxIterations?: number}} options
 * @returns {{status: 'optimal'|'infeasible'|'unbounded'|'iteration_limit', values: Float64Array|null, objectiveValues: number[], iterations: number, unboundedStage?: number}}
 */
export function solveLexicographic(lp, objectives, { maxIterations = 100000 } = {})
{
    const tableau = new Tableau(lp);
    const result  = { status: 'optimal', values: null, objectiveValues: [], iterations: 0 };

    // Phase 1: minimise the sum of artificial variables
    tableau.setObjective(tableau.phaseOneCosts());
    let status = tableau.optimise(maxIterations);
        if(status !== 'optimal')
        {
            return { ...result, status, iterations: tableau.iterations };
        }
        if(tableau.artificialResidual() > FEASIBILITY_TOL * Math.max(1, tableau.rhsScale))
        {
            return { ...result, status: 'infeasible', iterations: tableau.iterations };
        }

    tableau.removeArtificials();

    // Phase 2: each objective in turn, freezing what the previous ones decided
    for(let stage = 0; stage < objectives.length; stage++)
    {
        const costs = tableau.costsFromTerms(objectives[stage]);
            tableau.setObjective(costs);

        status = tableau.optimise(maxIterations - tableau.iterations);
            if(status !== 'optimal')
            {
                return { ...result, status, iterations: tableau.iterations, unboundedStage: stage };
            }

        if(stage < objectives.length - 1)
        {
            tableau.freezePositiveReducedCosts();
        }
    }

    result.values           = tableau.solution();
    result.iterations       = tableau.iterations;
    result.objectiveValues  = objectives.map(terms => terms.reduce((sum, [variable, c]) => sum + c * result.values[variable], 0));

    return result;
}


class Tableau
{
    constructor(lp)
    {
        const nVariables    = lp.variables.length;
        const rows          = [];

        // Normalise every row so that b >= 0
        for(const constraint of lp.constraints)
        {
            let { terms, operator, rhs } = constraint;
                if(rhs < 0)
                {
                    terms       = terms.map(([v, c]) => [v, -c]);
                    rhs         = -rhs;
                    operator    = (operator === '<=') ? '>=' : ((operator === '>=') ? '<=' : '=');
                }

            rows.push({ terms, operator, rhs });
        }

        /*
         * Crash basis: a row that owns a variable (appearing in no other row, with a positive
         * coefficient) can start with that variable basic instead of an artificial. In the
         * production model these are the deficit / extraction columns, so the simplex starts
         * from "everything is missing or extracted" instead of an arbitrary feasible point.
         */
        const occurrences = new Int32Array(nVariables);
            for(const row of rows){ for(const [v] of row.terms){ occurrences[v]++; } }

        const owned = new Array(rows.length).fill(-1);
        const taken = new Uint8Array(nVariables);
            for(let i = 0; i < rows.length; i++)
            {
                if(rows[i].operator === '<='){ continue; }

                let best = -1, bestCoefficient = 0;
                    for(const [v, c] of rows[i].terms)
                    {
                        if(occurrences[v] === 1 && taken[v] === 0 && c > bestCoefficient)
                        {
                            best            = v;
                            bestCoefficient = c;
                        }
                    }

                if(best !== -1)
                {
                    owned[i]    = best;
                    taken[best] = 1;
                }
            }

        // Column layout: [ originals | slacks/surpluses | artificials ]
        const nSlacks       = rows.filter(r => r.operator !== '=').length;
        const nArtificials  = rows.filter((r, i) => r.operator !== '<=' && owned[i] === -1).length;

        this.nVariables     = nVariables;
        this.firstArtificial= nVariables + nSlacks;
        this.nColumns       = nVariables + nSlacks + nArtificials;
        this.m              = rows.length;

        this.rows           = new Array(this.m);
        this.rhs            = new Float64Array(this.m);
        this.basis          = new Int32Array(this.m);
        this.rowActive      = new Uint8Array(this.m).fill(1);
        this.columnActive   = new Uint8Array(this.nColumns).fill(1);
        this.iterations     = 0;
        this.rhsScale       = 1;

        let slack       = nVariables;
        let artificial  = this.firstArtificial;

        for(let i = 0; i < this.m; i++)
        {
            const row = new Float64Array(this.nColumns);
                for(const [v, c] of rows[i].terms){ row[v] = c; }

            this.rhs[i]     = rows[i].rhs;
            this.rhsScale   = Math.max(this.rhsScale, rows[i].rhs);

            if(rows[i].operator === '<=')
            {
                row[slack]      = 1;
                this.basis[i]   = slack++;
            }
            else
            {
                if(rows[i].operator === '>=')
                {
                    row[slack++] = -1;
                }

                if(owned[i] !== -1)
                {
                    // Scale the row so the owned column becomes a unit column
                    const inv = 1 / row[owned[i]];
                        for(let j = 0; j < this.nColumns; j++){ if(row[j] !== 0){ row[j] *= inv; } }
                        row[owned[i]]   = 1;
                        this.rhs[i]    *= inv;
                        this.basis[i]   = owned[i];
                }
                else
                {
                    row[artificial]  = 1;
                    this.basis[i]    = artificial++;
                }
            }

            this.rows[i] = row;
        }

        /*
         * Production models are massively degenerate (most balance rows have b = 0), which makes
         * the simplex stall and pick poorly conditioned pivots. The search runs on a slightly
         * perturbed right-hand side, while the exact one is transformed alongside and used to
         * read the final values. The perturbation is deterministic so results are reproducible.
         */
        this.rhsTrue = Float64Array.from(this.rhs);

        let seed = 0x9e3779b9;
            for(let i = 0; i < this.m; i++)
            {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                this.rhs[i] += PERTURBATION * (1 + Math.abs(this.rhs[i])) * (0.5 + seed / 0x100000000);
            }

        this.reducedCosts   = new Float64Array(this.nColumns);
        this.objectiveValue = 0;
        this.costTolerance  = COST_TOL;
    }

    /*
     * Sum of artificial variables measured on the exact right-hand side (phase 1 residual).
     */
    artificialResidual()
    {
        let residual = 0;
            for(let i = 0; i < this.m; i++)
            {
                if(this.rowActive[i] === 1 && this.basis[i] >= this.firstArtificial)
                {
                    residual += Math.abs(this.rhsTrue[i]);
                }
            }

        return residual;
    }

    phaseOneCosts()
    {
        const costs = new Float64Array(this.nColumns);
            for(let j = this.firstArtificial; j < this.nColumns; j++){ costs[j] = 1; }

        return costs;
    }

    /*
     * Objectives are rescaled so that their largest coefficient is 1: the argmin is unchanged
     * and tolerances stay meaningful whatever the units (weights of 1e-5 per item, MW, machines...).
     */
    costsFromTerms(terms)
    {
        const costs = new Float64Array(this.nColumns);
            for(const [v, c] of terms){ costs[v] += c; }

        let scale = 0;
            for(let j = 0; j < this.nVariables; j++){ scale = Math.max(scale, Math.abs(costs[j])); }
            if(scale > 0)
            {
                for(let j = 0; j < this.nVariables; j++){ costs[j] /= scale; }
            }

        return costs;
    }

    setObjective(costs)
    {
        const d = this.reducedCosts;
            d.set(costs);

        let z = 0;
            for(let i = 0; i < this.m; i++)
            {
                if(this.rowActive[i] === 0){ continue; }
                const cb = costs[this.basis[i]];
                    if(cb === 0){ continue; }

                const row = this.rows[i];
                    for(let j = 0; j < this.nColumns; j++)
                    {
                        if(row[j] !== 0){ d[j] -= cb * row[j]; }
                    }

               z += cb * this.rhs[i];
            }

        // Basic columns have an exact zero reduced cost
        for(let i = 0; i < this.m; i++)
        {
            if(this.rowActive[i] === 1){ d[this.basis[i]] = 0; }
        }

        this.objectiveValue = z;
    }

    optimise(maxIterations)
    {
        let degenerateStreak    = 0;
        let iterations          = 0;

        while(true)
        {
            if(iterations++ >= maxIterations)
            {
                return 'iteration_limit';
            }

            const useBland  = degenerateStreak >= DEGENERATE_LIMIT;
            const entering  = this.chooseEntering(useBland);
                if(entering === -1)
                {
                    return 'optimal';
                }

            const leaving   = this.chooseLeaving(entering, useBland);
                if(leaving === -1)
                {
                    return 'unbounded';
                }

            const step = this.rhs[leaving] / this.rows[leaving][entering];
                degenerateStreak = (step <= PIVOT_TOL) ? (degenerateStreak + 1) : 0;

            this.pivot(leaving, entering);
            this.iterations++;
        }
    }

    chooseEntering(useBland)
    {
        const d     = this.reducedCosts;
        let best    = -1;
        let bestD   = -this.costTolerance;

        for(let j = 0; j < this.nColumns; j++)
        {
            if(this.columnActive[j] === 0 || d[j] >= -this.costTolerance){ continue; }

            if(useBland === true){ return j; } // Smallest index with a negative reduced cost

            if(d[j] < bestD)
            {
                bestD   = d[j];
                best    = j;
            }
        }

        return best;
    }

    /*
     * Harris two-pass ratio test: first find the largest step that keeps every basic variable
     * above −HARRIS_TOL, then among the rows blocking within that step pick the largest pivot
     * element. Pivoting on tiny elements is what makes dense tableaus blow up.
     * In Bland mode (anti-cycling) ties go to the smallest basic index instead.
     */
    chooseLeaving(entering, useBland)
    {
        let maxStep = Infinity;

        for(let i = 0; i < this.m; i++)
        {
            if(this.rowActive[i] === 0){ continue; }

            const a = this.rows[i][entering];
                if(a <= PIVOT_TOL){ continue; }

            maxStep = Math.min(maxStep, (Math.max(0, this.rhs[i]) + HARRIS_TOL) / a);
        }

        if(maxStep === Infinity){ return -1; }

        let best        = -1;
        let bestPivot   = 0;

        for(let i = 0; i < this.m; i++)
        {
            if(this.rowActive[i] === 0){ continue; }

            const a = this.rows[i][entering];
                if(a <= PIVOT_TOL || Math.max(0, this.rhs[i]) / a > maxStep){ continue; }

            if(best === -1
                || (useBland === true && this.basis[i] < this.basis[best])
                || (useBland === false && a > bestPivot))
            {
                best        = i;
                bestPivot   = a;
            }
        }

        return best;
    }

    pivot(r, e)
    {
        const pivotRow  = this.rows[r];
        const inv       = 1 / pivotRow[e];

        // Normalise the pivot row and remember its non-zero columns
        const nonZeros = [];
            for(let j = 0; j < this.nColumns; j++)
            {
                if(pivotRow[j] !== 0)
                {
                    pivotRow[j] *= inv;
                    nonZeros.push(j);
                }
            }
            pivotRow[e]      = 1;
            this.rhs[r]      = Math.max(0, this.rhs[r] * inv);
            this.rhsTrue[r] *= inv;

        for(let i = 0; i < this.m; i++)
        {
            if(i === r || this.rowActive[i] === 0){ continue; }

            const row       = this.rows[i];
            const factor    = row[e];
                if(factor === 0){ continue; }

            for(const j of nonZeros)
            {
                const value = row[j] - factor * pivotRow[j];
                    row[j]  = (Math.abs(value) < 1e-12) ? 0 : value;
            }
            row[e] = 0;

            const b = this.rhs[i] - factor * this.rhs[r];
                // Harris steps may leave basic variables marginally negative: snap them back to 0
                this.rhs[i] = (b < 1e-11 && b > -FEASIBILITY_TOL) ? 0 : b;

            this.rhsTrue[i] -= factor * this.rhsTrue[r];
        }

        const d = this.reducedCosts;
        const de = d[e];
            if(de !== 0)
            {
                for(const j of nonZeros){ d[j] -= de * pivotRow[j]; }
                d[e] = 0;
                this.objectiveValue += de * this.rhs[r];
            }

        this.basis[r] = e;
    }

    /*
     * After phase 1, artificials still in the basis sit at 0 (degenerate).
     * Pivot them out on any real column; if the row has none, it is redundant.
     */
    removeArtificials()
    {
        for(let i = 0; i < this.m; i++)
        {
            if(this.rowActive[i] === 0 || this.basis[i] < this.firstArtificial){ continue; }

            const row       = this.rows[i];
            let candidate   = -1;
            let magnitude   = PIVOT_TOL;

            for(let j = 0; j < this.firstArtificial; j++)
            {
                if(this.columnActive[j] === 1 && Math.abs(row[j]) > magnitude)
                {
                    candidate   = j;
                    magnitude   = Math.abs(row[j]);
                }
            }

            if(candidate === -1)
            {
                this.rowActive[i] = 0;
            }
            else
            {
                this.rhs[i]     = 0;
                this.rhsTrue[i] = 0;
                this.pivot(i, candidate);
            }
        }

        for(let j = this.firstArtificial; j < this.nColumns; j++){ this.columnActive[j] = 0; }
    }

    freezePositiveReducedCosts()
    {
        const d = this.reducedCosts;
            for(let j = 0; j < this.nColumns; j++)
            {
                if(d[j] > this.costTolerance){ this.columnActive[j] = 0; }
            }
    }

    solution()
    {
        const values = new Float64Array(this.nVariables);
            for(let i = 0; i < this.m; i++)
            {
                if(this.rowActive[i] === 1 && this.basis[i] < this.nVariables)
                {
                    values[this.basis[i]] = Math.max(0, this.rhsTrue[i]);
                }
            }

        return values;
    }
}