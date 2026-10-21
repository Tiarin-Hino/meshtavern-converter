/**
 * The painter's panel as a view other code mounts (issue #166, design note
 * `docs/design/painting-panel.md`): the tools, the tool's sliders, the colour with the pipette and
 * the swatches, the regions, the mask, the groups and the look, on MeshTavern's components,
 * driving the painting view of ./painting.ts. The sixth entry. Its stylesheet is
 * ./painting-panel.css (package export `meshtavern-converter/painting-panel.css`), imported once by
 * the consumer after the theme's tokens.css and components.css and ./painting.css, for the reason
 * questions.ts gives.
 */
export {
  mountPaintingPanel,
  type PaintingPanelOptions,
  type PaintingPanel,
  type PaintingPanelState,
} from './painting-panel/mount';
export {
  SLIDERS,
  DIRECTIONS,
  panelSwatches,
  sliderValue,
  SIZE_STEP_MM,
  UNIT_STEP,
} from './painting-panel/controls';
