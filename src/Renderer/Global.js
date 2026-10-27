/*
 * Build entry for pages outside the planner (balancers...): exposes the renderer as window.SCPPRenderer.
 */
import Renderer from './Renderer.js';

window.SCPPRenderer = Renderer;
window.dispatchEvent(new Event('SCPPRenderer'));