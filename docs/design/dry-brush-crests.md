# Design: a dry brush that catches the highest points under it (#133)

Status: design pass and build by Opus 5.5, 2026-10-15 (the PM asked for Opus instead of the recommended Fable pass); the floor `DRY_REFERENCE_MIN` chosen by the PM in the build session the same day, from pictures (§4.1) · Issue: #133, PM feedback on PR #132 (#128) · Builds on: `docs/design/painting-engine.md` §5 and §6 (the dab pass, the composite, the masks), §8 (undo by replay), the #128 and #134 journal entries

This note fixes the rule, its constants, how its reference is measured, how undo and redo give the same bytes, and the tests. Every number marked _(proposal)_ is the PM's to change. Measurements are from the development PC (i7-11700F, RTX 3060, Chrome) with the experiment described in §2, on three corpus minis and the generated figure.

## 1. The problem

The dry brush (#128) paints a texel by how raised the bake measured it, its cavity `c` (−1 crease … +1 edge, the detail texture's alpha decoded as the material does): `mask = smoothstep(t, t + DRY_SOFTNESS, c)` with `t = DRY_THRESHOLD × (1 − pressure)`, `DRY_THRESHOLD = 0.5`, `DRY_SOFTNESS = 0.2`. The threshold is absolute. The cavity is an angle measure on the sculpt's own mesh, so low, small detail measures low whatever the brush: a crest that is the highest point under a 1 mm brush on a large mini may measure 0.05. Below `t` it takes nothing. The PM found that a small brush, zoomed in on low detail, lays nothing even at full pressure.

A real dry brush catches the highest points of whatever it is dragged over. So the brush should measure where it starts and paint relative to that.

## 2. What the data looks like

An experiment (a script in the git-ignored `out/`, not committed): for each mini, single-dab footprints of the flat brush (where a dab reaches: in sight, facing, within the sphere and its depth cut, #134) at a grid of 8 × 8 canvas points from three sides, at 1, 2, 4 and 8 mm, and the cavity the composite reads at each texel of each footprint (`view.surface()`). Minis: large-02, humanoid-02, quadruped-01 (corpus), the generated figure.

| Footprint                                                                     |        1 mm |        2 mm |        4 mm |        8 mm |
| ----------------------------------------------------------------------------- | ----------: | ----------: | ----------: | ----------: |
| Texels (median)                                                               |      61–190 |     276–661 |     ~1–2.5k |       ~3–8k |
| Highest cavity, 10th–50th percentile of footprints (corpus)                   | 0.04 – 0.22 | 0.13 – 0.30 | 0.24 – 0.49 | 0.30 – 0.65 |
| Highest minus 95th percentile within a footprint (median)                     | 0.016–0.031 |   0.06–0.09 |   0.13–0.19 |   0.24–0.27 |
| Crest under a tenth of a coat at half pressure, today's rule (all four minis) |         64% |         36% |         21% |         10% |
| The same with the rule of §4                                                  |          9% |          2% |          0% |          0% |
| The same at no pressure: today / §4                                           |   93% / 21% |    81% / 7% |    60% / 2% |    37% / 0% |

Four facts shape the design, the last found after the first build, in pictures:

- **The cavity is smooth at a brush's scale.** The sculpt's cavity is smoothed three passes on the sculpt's vertices before the bake (`SCULPT_CAVITY_SMOOTHING`), and the bake interpolates it across the sculpt's triangles. Under a 1 mm brush the highest texel stands a median of one or two of the texture's own steps above the 95th percentile. A single texel does not stand out of a footprint as a spike.
- **The cavity comes in steps of 4/255 = 0.0157.** It is stored in a byte (`cavityToByte`, raw −0.5 … 0.5) and decoded × `CAVITY_GAIN` (4). The low detail of the issue is two to six steps above flat.
- **Flat is not zero.** `cavityToByte(0)` is 128, which decodes to +0.0078, half a step above zero. The generated figure's flat disc top reads exactly that. A rule relative to a small reference must measure from there, or it paints every flat surface.
- **A smooth curved surface measures like low detail.** Found after the first build, in pictures (§4.1): on a corpus figure's smooth cape the cavity reads a median 0.067, one to nine steps above flat, from its gentle convex curve and the texture's 4 × 4 compression blocks; the low detail of the issue reads the same. By value alone the two cannot be told apart, so whatever lets a small brush catch the one at a pressure catches the other.

## 3. The decision in one paragraph

When a dry-brush stroke begins, the engine measures its **reference**: the highest cavity under the stroke's **first dab**, over the texels that dab covers (in sight, facing, within its sphere and depth cut: the dab pass's own coverage). The brush then paints by **relief relative to the reference**: a texel's height above flat as a share of the reference's height above flat, never less than a floor `DRY_REFERENCE_MIN` (a footprint lower than that counts as that high, so neither the noise of a flat surface nor the gentle curve of a smooth one is magnified more than five times), and pressure decides how far below the reference the paint reaches, with today's `DRY_THRESHOLD` and `DRY_SOFTNESS` as shares of that height. The reference is measured on the GPU, after the first dab is drawn into the stroke layer, by three small reduction passes into a 1 × 1 target the composite reads: no read-back, no wait. It is not recorded: a replay draws the same first dab from the same camera on the same surface and measures the same byte, so `PaintStroke` keeps its shape.

## 4. The rule

```
relief(c)  = c − FLAT_CAVITY
scale      = max(relief(reference), DRY_REFERENCE_MIN)
t          = DRY_THRESHOLD × (1 − pressure)
mask(c)    = smoothstep(t, t + DRY_SOFTNESS, relief(c) / scale)
```

| Constant            | Value                                                  | Meaning                                                                                                                                      |
| ------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `FLAT_CAVITY`       | `(cavityToByte(0) / 255 − 0.5) × CAVITY_GAIN` = 0.0078 | The cavity a flat surface decodes to: the encoding's zero, not a choice. In `look.ts` beside `cavityToByte`.                                 |
| `DRY_REFERENCE_MIN` | 0.2 (the PM's choice, §4.1)                            | The smallest height above flat a reference counts as, about thirteen of the texture's steps. Under it the footprint is treated as this high. |
| `DRY_THRESHOLD`     | 0.5 _(as #128)_                                        | Now a share of `scale`: at no pressure the paint begins halfway up from flat to the reference.                                               |
| `DRY_SOFTNESS`      | 0.2 _(as #128)_                                        | Now a share of `scale`: the ramp from nothing to all.                                                                                        |

What follows from it:

- **Creases and flat are never painted.** At or below flat the relief is ≤ 0 and `t ≥ 0`, so the mask is 0 at every pressure and every reference: a crease or a hollow keeps every byte (the #128 test's line, kept). At flat itself the GPU's decode of the flat byte and `FLAT_CAVITY` differ by float rounding (about 1e-7), so at full pressure a flat texel's mask may be about 1e-12: its alpha stays 0, but its colour may take the brush's, as at any stroke's faintest fringe.
- **The highest points under the first dab take a full coat at every pressure, when they stand above the floor.** At the reference itself the relief share is then 1, and `DRY_THRESHOLD + DRY_SOFTNESS = 0.7 < 1`: a full coat at every pressure. Lower down, pressure decides: at none the top 30% of the reference's height takes a full coat, at half pressure the top 55%, at full pressure everything above a fifth.
- **Further along the stroke**, anything as high as the reference or higher takes a full coat (when the reference stands above the floor), and the rest by the same shares. A stroke that starts on a big edge and runs onto low detail leaves the low detail bare, as a real brush loaded for that edge would; the person starts a new stroke there.
- **A low footprint**, under the floor: the floor is the scale. The low detail of the ridged block of §7 (crests four steps up, relief 0.059, a share of 0.30) takes paint at its crests from about 0.4 of the pressure (about 0.6 in software rendering, where the crest reads 0.05), a seventh of a coat at half, most of a coat at three quarters and a full coat at full pressure, where the old rule gave a faint quarter coat at full and nothing below about 0.87; one-step relief takes nothing below five sixths of the pressure.
- **Smooth surfaces** (a shield's face, a cape) read a few steps up and are treated like low detail: at half pressure the floor of 0.2 leaves most of them bare; at full pressure they take patches, as they did faintly before. Strokes that start on different spots have different references, so neighbouring strokes can paint the same surface differently.
- **Big forms** behave as before when the footprint holds a fully raised texel (reference 1, scale 0.992). An 8 mm footprint's highest point is a median 0.55–0.65 (§2), so a large brush now reaches about 1.6 times as far down in cavity as before at the same pressure; at full pressure the difference is small (a full coat from 0.13 instead of 0.2).

`toolMask(tool, cavity, occlusion, normal, brush, reference = 1)` is the CPU twin with the reference as a new last parameter (only the dry brush reads it; 1 when left out: a fully raised edge under the brush, the old rule up to the flat offset). The GLSL mask gets it as a fourth parameter, `mtMask(cavity, occlusion, normal, reference)`, and `tools.test.ts` runs the two against each other over a grid of references.

### 4.1 The floor, chosen from pictures

The first build had `DRY_REFERENCE_MIN = 0.1`. Painted on a corpus figure with a grid of short 1.5 mm strokes (main's rule, then floors of 0.1, 0.2 and 0.3, at half and full pressure; the pictures stay out of this public repo), 0.1 laid blotchy full coats on the smooth shield face and cape at half pressure, in rectangles that followed the strokes; 0.3 left them clean but gave the ridged block's crests nothing at half pressure, as main did. On the corpus footprints of §2 at 1 mm and half pressure, the crest under the brush stays nearly bare in 74% of footprints with main's rule, 1% with 0.1, 12% with 0.2 and 20% with 0.3 (three corpus minis). The PM chose 0.2 (2026-10-15): the ridged block shows thin crest lines at half pressure and whole ridges at full (`docs/design/dry-brush-crests-ridges.png`), and most smooth surfaces stay bare at half pressure.

### Rejected

- **The highest cavity under the whole stroke so far.** The composite applies the mask to the whole stroke layer every frame, so a reference that rises during the stroke would take paint away from what the stroke already laid; and the reference after each frame depends on how many dabs a frame held, which a replay does not repeat. Baking each dab's mask into the stroke layer instead would need a reduction per frame and the frame grouping recorded.
- **A reference per dab.** It needs the highest cavity within each dab's sphere at every texel the dab covers, a gather per fragment per dab: too much for a frame, and it would make the brush pick out the highest point of every flat stretch.
- **A high percentile instead of the maximum.** §2 shows no spikes to guard against (the top texel within one or two steps of the 95th percentile at 1 mm), and a percentile on the GPU needs a histogram (a scatter of every texel) or float targets; the maximum is exact in R8 with no extension. If corpus minis show a spike deciding the reference (§8), a 3 × 3 minimum before the maximum is the cheap fix: it removes anything narrower than three texels.
- **A read-back of the footprint to the CPU** (to compute the reference there and record it in the stroke): the composite would wait a frame or two for it at every stroke's start, the detail texture is compressed and would have to be rendered out first, and the record would grow a field consumers keep. The GPU has every input already.
- **A blend of absolute and relative** (`scale = mix(1, relief(reference), w)`): one more constant and no better answer to the flat case than the floor.

## 5. Measuring the reference

In `PaintPasses.drawDabs`, for a tool whose pass has `reference: true` (the dry brush) and a draw that starts at the stroke's first dab (`from === 0`, the live stroke's first frame and every replay): dab 0 is drawn into `stroke` alone, then `measureReference()` runs, then the remaining dabs. Max-blended coverage is the same bytes in any grouping, so splitting the first draw changes nothing else.

`measureReference()` reduces the stroke layer and the detail texture into `reference`, a 1 × 1 R8 target, through targets of 64² and 4² (`REFERENCE_BLOCK = 16`: each fragment takes the maximum over a 16 × 16 block of the level below, the last over 4 × 4):

1. **1,024² → 64²:** for each texel of the block with coverage above 0, the detail texture at that texel (`textureLod(…, 0)` at the texel's centre, as the composite reads it: covered texels are island or border texels, which own themselves), its cavity decoded and clamped, written as `cavity × 0.5 + 0.5`; the maximum, 0 when nothing in the block is covered.
2. **64² → 4², 4² → 1:** the maximum of the block.

The composite reads `reference = texelFetch(uReference, (0, 0)).r × 2 − 1`. A stroke whose first dab covered nothing (all of it out of sight) reads −1: the floor. The encoding is the one `surface()` reads back for tests, so a test computes the GPU's reference exactly from the first dab's footprint. Cost: 4,096 fragments of 256 fetches, 16 of 256, one of 16, once per stroke; the frame-rate criterion of #127 is measured with `scripts/measure-painting.mjs`, which strokes the dry brush at 2 mm as well as 16 mm since this change. `warm` runs the passes once at `open` so their programs are compiled before the first stroke.

## 6. Undo and redo

A replay renders the stroke's depth map from its `camera`, clears the stroke layer, draws dab 0 alone, measures, draws the rest (§8 of the engine's note). Every input of the measurement (the first dab, the camera, the mesh, the detail texture) is the step's or the open mini's, and the passes are deterministic on one GPU, so the reference is the same byte live and replayed. Nothing is added to `PaintStroke`; a consumer's kept history replays to the same paint (a dry stroke kept from before #133 replays with this rule). The e2e test `measures a dry stroke's reference again when it is replayed after another` pins it: a dry stroke whose reference differs from the one before it is undone and redone to the same bytes (the hobby-brush replay test alone would not see a replay that skipped the measurement, since the target still held the live stroke's byte); the dry-brush pixel tests compute the reference independently from the first dab's footprint and check every texel against `toolMask` with it.

## 7. Tests and build order

1. **The rule** (`look.ts`, `brush.ts`, `tools.ts`): `FLAT_CAVITY`, `DRY_REFERENCE_MIN`, `toolMask`'s `reference`, the GLSL mask's. Node: creases and flat stay at 0 for every reference and pressure; the reference's own cavity takes all at every pressure when above the floor; more pressure never takes less and reaches lower; a low reference (0.067) paints its crest from half pressure up and fully at full pressure, where the old rule (reference 1) gives 0 below about 0.87; a reference below the floor behaves as the floor; reference 1 is the old rule up to the flat offset. `tools.test.ts`: the GLSL and `toolMask` over references −1 … 1.
2. **The measurement** (`passes.ts`): the reduction, the 1 × 1 target, `drawDabs`'s split, `warm`. E2e on the generated figure: the #128 dry-brush test, now with the reference computed from the first dab's footprint (`expectMasked` checks every texel the stroke reached against `toolMask` with it); creases keep every byte, flat its alpha; a dry stroke replayed after another measures its own reference again.
3. **Low detail** (e2e): `generateRidgedBlock` (`src/regression/shapes.ts`, not in the baseline): a 12.8 mm block 8 mm tall whose top has ridges 0.06 mm high every 1.6 mm on a grid of 0.2 mm, domed 0.3 mm so the underside is its base; its crests measure 0.067, its troughs −0.059, about 15,000 triangles. A stroke of a 1 mm brush across the ridges from a crest, at three quarters, nine tenths and full pressure: every texel as `toolMask` with the measured reference says; the crests' highest texels painted at each, nearly a full coat at full pressure, where the old rule gives nothing at three quarters; in software rendering the block's reference reads about 0.05 (0.067 in Chrome on the GPU), which puts half pressure at the threshold; the troughs bare; the painted texels of a lower pressure a subset of a higher one's and fewer.
4. **The page** (`?dev` Paint tool): nothing changes but the dry brush's hint, `PAINT_COPY.toolHints.dry`.
5. **Numbers:** `scripts/measure-painting.mjs` on the generated figure and large-01, the dry brush at 2 and 16 mm; the PR states them with the device.

## 8. When to stop and ask

- **A spike decides the reference on a corpus mini** (a stroke on visible detail paints nothing because one texel under the first dab measured far higher than the rest): report the mini and the footprint's numbers; the 3 × 3 minimum of §4 is the proposal.
- **The floor is wrong by eye** on other minis in the `?dev` Paint tool: smooth surfaces blotch at mid pressure (raise `DRY_REFERENCE_MIN`), or low detail takes too little at mid pressure (lower it). The number is the PM's (§4.1); telling low detail from a smooth curve would need more than the cavity's value (its contrast within the footprint, for one), which is a design question of its own.
- **Large brushes paint too far down** compared with before (§4's last point): ask whether big forms should keep the absolute rule (a blend, rejected above, would be the way).
- **A replayed dry stroke differs from the live one**: the reduction is not deterministic on that GPU; find which pass.

## 9. Out of this note

- The wash and the ink stay absolute: the issue is the dry brush's. If the PM wants a wash relative to the deepest point under it, the same reference with a minimum is the shape.
- Pen pressure per dab still drives nothing (§16 of the engine's note); the slider is the pressure.
- A reference that follows the stroke (per frame or per dab) is rejected above; a later tool could record its frame grouping if it wanted one.
