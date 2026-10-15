---
title: A dry brush that catches the highest points under it
date: 2026-10-15
phase: 2
issues: [133]
prs: []
topics: [look, textures, testing, performance]
---

## What we did

The dry brush of the painting engine now catches the highest points of whatever it starts on. Each stroke measures the highest point under its first dab, and the brush paints by how close a spot comes to that height; pressure decides how far below it the paint reaches. A small brush on low detail now picks out that detail's crests, where it used to lay nothing. Creases and flat surface still take no paint.

## Why

PM feedback on the hobby brushes (#128, PR #132): zoomed in on a large mini's low detail with a small brush, the dry brush laid nothing even at full pressure. Its threshold was absolute: a spot took paint when the bake measured it raised by more than a fixed amount (its cavity, −1 crease … +1 edge), and low detail measures low. A real dry brush catches the highest points of what it is dragged over. The issue asked for a design pass first; the PM had Opus do it instead of Fable. Design note: `docs/design/dry-brush-crests.md`.

## How

- **Measured before deciding.** A script painted single dabs of the flat brush on four minis (three corpus minis and the generated figure) at a grid of spots from three sides and 1–8 mm, and read the cavity under each. Three facts came out: the cavity is smooth at a brush's scale (under a 1 mm brush the highest texel, a pixel of the paint texture, stands one or two of the texture's steps above the 95th percentile, so no spikes need guarding against); it comes in steps of 0.0157; and flat is not zero (below).
- **The reference is the highest cavity under the first dab.** Not the whole stroke so far: the engine redraws the whole stroke through the mask every frame, so a rising reference would take back paint already laid, and a replay would group the dabs differently. Not a percentile: no spikes to guard against, and the maximum is exact on the GPU with one-byte textures.
- **The rule is relative.** A texel's height above flat as a share of the reference's height above flat; `DRY_THRESHOLD` and `DRY_SOFTNESS` keep their values as shares. The reference's own height takes a full coat at any pressure when it stands at least the floor above flat. A footprint lower than `DRY_REFERENCE_MIN` (0.2, the PM's choice from pictures: about thirteen of the texture's steps) counts as that high, so neither the noise of a flat surface nor the gentle curve of a smooth one is magnified more than five times.
- **Measured on the GPU, never read back.** After the first dab is drawn into the stroke layer, three small passes reduce it with the detail texture to one texel (each texel of a pass takes the maximum of 16 × 16 of the level below, the last of 4 × 4), and the composite reads that texel. Nothing waits for the CPU.
- **Not recorded.** A replay (undo, redo) draws the same first dab from the same camera on the same surface and measures the same byte, so a stroke's data keeps its shape and consumers' kept histories still replay.
- **A test shape with low detail.** `generateRidgedBlock`: a 12.8 mm block whose top has ridges 0.06 mm high every 1.6 mm. Its crests measure 0.067, four of the texture's steps above flat; the old rule gave them nothing below about 0.87 of the pressure and a faint quarter coat at full. The e2e test strokes a 1 mm brush across them at three quarters, nine tenths and full pressure and checks every texel against the CPU twin of the mask with the reference the test computes from the first dab's footprint.

## Problems and how we solved them

- **Smooth surfaces took blotchy full coats.** The first build had a floor of 0.1. Its pictures on a corpus figure (short 1.5 mm strokes at half pressure) showed the crests of fine detail caught, and also rectangles of full coat on a smooth shield face and cape. **Cause:** a smooth, gently convex surface reads one to nine steps above flat (a median 0.067 on that cape), the same as low detail; a stroke starting there got a low reference, the floor magnified it up to ten times, and its neighbours, started elsewhere, did not. **Fix:** nothing in the cavity's value tells the two apart, so the floor is a trade-off: the PM compared 0.1, 0.2 and 0.3 painted side by side and chose 0.2. The block's crests now take paint from about 0.4 of the pressure (0.6 in software rendering) and a full coat at full (main's rule: nothing below about 0.87); most smooth surfaces stay bare at half pressure.
- **Flat is half a step above zero.** The generated figure's flat disc top read +0.0078, not 0. **Cause:** the cavity is stored as a byte, and zero rounds to 128, the byte above the middle. Relative to a small reference, that half step would have painted every flat surface. **Fix:** heights are measured from `FLAT_CAVITY`, the encoding's flat.
- **Flat texels came back with the brush's colour at alpha 0.** **Cause:** the GPU's decode of the flat byte and the constant differ by float rounding (about 1e-7), so the mask was about 1e-12 rather than 0; the alpha rounds to 0 and the colour is written, as at any stroke's faintest fringe. Below flat the mask is exactly 0. The formula stays as it is; the test checks every byte below flat and the alpha at flat.
- **The test block stood on its head.** With low ridges its top was flat enough to count as a base, and the up detection stood it on the top. A gentle dome (0.3 mm) fixed it. Its first underside, two big triangles, measured as an edge everywhere: cavity comes from the vertices, and it had only the four corners.
- **Exact assertions met coarse data.** Under the floor a step of the read-back (2/255 of cavity) moves a texel's share by 0.04 against a band 0.2 wide (0.08 at the first floor), and the block's 512 px detail texture is sampled between its texels for the 1,024 px paint. In software rendering the block's reference also read lower than in Chrome on the GPU (about 0.05 against 0.067; the cause was not chased, and the per-texel check against `toolMask` holds in both), which puts the crests' share right at the half-pressure threshold. The test strokes at three quarters, nine tenths and full pressure, and asserts "painted", and nearly a full coat at full.
- **The shader-against-twin test timed out** under the full suite's load once every tool's grid was multiplied by seven references. Only the dry brush reads one, so only its grid has them.

## Dead ends

- References weighed and dropped in the design note: the whole stroke so far, one per dab, a high percentile, a read-back to the CPU recorded in the stroke. Each loses on replay, cost or need; the note says which.
- Ridges every 1.5 mm on a 0.2 mm grid: the crests fell between grid lines and measured unevenly (0.035 to 0.067). Every 1.6 mm puts each crest and trough on a line.

## Numbers

| How often the highest point under the brush takes under a tenth of a coat (four minis, 130–139 footprints each) |      1 mm |     2 mm |     4 mm |     8 mm |
| --------------------------------------------------------------------------------------------------------------- | --------: | -------: | -------: | -------: |
| Half pressure, old rule / new rule                                                                              |  64% / 9% | 36% / 2% | 21% / 0% | 10% / 0% |
| No pressure, old rule / new rule                                                                                | 93% / 21% | 81% / 7% | 60% / 2% | 37% / 0% |

On the three corpus minis alone, the 1 mm figure at half pressure is 74% with main's rule, 1% with a floor of 0.1, 12% with 0.2 and 20% with 0.3 (design note §4.1).

Frame rate, development PC (i7-11700F, RTX 3060, Chrome, a 165 Hz display, 1,920 × 1,080), `scripts/measure-painting.mjs`, three strokes of 120 pointer samples per brush: the dry brush at 2 and 16 mm on the generated figure and on the largest corpus mini (59,954 triangles, 2,048 px detail) came at the display's 6.1 ms between frames (worst 6.3 ms), the engine's counter at a median of 0.1 ms and a worst of 0.6 ms, no slow frame, as every other brush. The reduction runs once per stroke.

Tests, software rendering in Chromium (as CI): the two dry-brush tests in 5.0 minutes on one worker, the block's conversion included. Unit tests: 687.

## Still open

- The floor of 0.2 was chosen on one corpus figure and the ridged block; other minis in the `?dev` Paint tool may move it. Telling low detail from a smooth curve would need more than the cavity's value (its contrast within the footprint, for one): a design question of its own.
- A large brush now reaches further down than before at the same pressure (an 8 mm footprint's highest point is a median 0.55–0.65, not 1); at full pressure the difference is small. The design note says what to do if the PM wants big brushes as they were.
- The reference laptop's numbers.

## Story angle

"Where does a dry brush stop?" Teaching a shader to find the highest point under the brush, and why the zero of a byte is half a step above zero.
