# The mark (#147)

Status: the brief and round 1's prompts are written, round 1 waits for the PM · Date: 2026-10-16 · Spec: `docs/specs/look-and-feel.md`, L5 · Name: `name.md` beside this file

This file holds the mark's process and, at the end, its result. It follows the application's process for its own wordmark (its spec 07, decision 8). The PM generates candidates with ChatGPT's image generation. The agent writes the prompts and scores each round against the checklist of section 2. The rounds repeat until the PM picks one. The pick is committed here as an image with the prompt that made it and the date (section 6). The agent then traces it into `wordmark.svg` and derives the favicon from it (section 7). Until then the page's bar shows the name in the display face, and the favicon is its P (`public/favicon.svg`, #145).

MeshTavern's wordmark stays in the application's repo. It is not reused here, and its idea is not borrowed either (2.3).

## 1. The brief

**What it is.** The name "PolyWash" set as a logo: letters only, no separate symbol. It is a placeholder made with an image model; a designer may replace it before or after the launch.

**What the name says.** "Poly" is the polygon mesh: the converter reduces a miniature's sculpt to a light model of polygons that a game can draw. "Wash" is the miniature painter's wash, thin paint that settles into the recesses, and the look the converter gives a mini: primed and washed. The capital W is the hinge between the two halves. One idea can sit at the "o" (a polygon), at the "y" (a stroke running under "Wash"), or in the split between the halves.

**Who it is for.** Anyone with the STL of a miniature, most of them hobbyists who print and paint. The page is free and runs in the browser. It should look like a product that someone cared about, not a hobby project and not a fantasy skin.

**Personality.** MeshTavern's direction, a modern tool with a warm accent: calm, precise, confident, a little warm. It is a sibling of MeshTavern, not a part of it. The bar names the family in words ("MeshTavern", its one link), so the mark needs no family look.

**Genre-neutral, and not a cleaner.** The page converts fantasy, sci-fi and modern minis alike. So: no swords, dragons, dice, shields, runes, scrolls, parchment, wood or banners; no medieval or blackletter lettering; no circuitry or glitch. The name has a second reading that the mark must not feed. Every "Polywash" in a trade mark register is a cleaning product, and "wash" is also a car wash, a laundry and the bath after a resin print (`name.md`, 2.1 and 2.4). So: no water drops, splashes, waves, bubbles, foam or sparkles, and no brush, paint pot or nozzle either.

**Form.**

- One flat colour: no gradient, shadow, glow, bevel, 3D, texture or ornament. The page colours it from the tokens, on the dark theme (`--grey-950`, `#151412`) and on the light one (`--grey-50`, `#f7f6f3`). Whether "Wash" takes the brass of `--accent-text` is the trace's call once the mark exists.
- It reads with the whole word 16 px tall (the bar sets the name at `--text-lg`, 20 px), and at 32 and 128 px. A traced SVG has no optical sizes, so it can have no hairlines, no thin serifs and no counters that close up when small.
- Traceable: clean edges, even strokes, few distinct shapes.
- It sits beside the page's type, Inter for text and Fraunces for headings, without fighting either.
- The short form is **the "P"** (PM, 2026-10-14). It must survive as a 16 px favicon and as an app icon reversed out of a rounded square, as the placeholder P does today.

**Left out of the prompts on purpose.**

- Names of other products and brands, MeshTavern and Polymaker included. Naming a mark invites the model to echo it, and the look-alike check would then have to catch it.
- Names of commercial typefaces: the model may reproduce one, and the mark should not be a font nobody holds a licence for. Fraunces (SIL OFL 1.1), which the page already ships, is the one face named, in direction C.
- "Brass" and "gold": those words pull an image model toward a metallic gradient. Candidates are asked for in black on white, which is also the cleanest source for tracing; the analysis sheet shows each one in the product's colours (2.2).
- "Wash" as a picture. The prompts call the wash a painting technique once, for the meaning, and then ban the liquid motifs by name.

## 2. The checklist and the analysis

### 2.1 The checklist

Gates. A candidate that fails one is dropped, or fixed once when the fault is small and the rest is strong (a wrong letter, a stray element):

| Gate                    | Passes when                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 Spelling             | exactly "PolyWash": eight letters, capital P and W, every other letter lowercase, no space, no hyphen, nothing doubled or dropped                                                 |
| G2 One colour, flat     | one ink on one background; no gradient, shadow, glow, bevel, 3D or texture                                                                                                        |
| G3 Letters only         | no symbol, badge, frame, tagline or other text; an underline only when it is a letter's own stroke (the y of C2)                                                                  |
| G4 No genre, no cleaner | none of the motifs of the brief, and no letterform that reads as one (a blackletter, a rune-like cut, a drop for a counter, a wave for a stroke, a bubble for the "o" or the dot) |

Scores, 0 (fails), 1 (passes with a fault), 2 (passes clean):

| Score            | What is judged                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| S1 16 px         | the word reads with the whole mark 16 px tall, on light and on dark                                             |
| S2 32 and 128 px | it holds together at 32 px and shows no flaw at 128 px (wobbly curves, uneven weight, uneven spacing)           |
| S3 Traceable     | clean edges, even stroke widths, shapes a tracer turns into few nodes                                           |
| S4 Fits          | sits beside Inter and Fraunces, reads as a modern tool with warmth, and as a product rather than a hobby        |
| S5 Distinct      | carries one idea someone could remember (at the "o", the "y", the W or the split) without turning into ornament |
| S6 Short form    | a "P" cut from it survives at 16 px and reversed out of an app icon                                             |

A finalist passes every gate, scores at least 1 everywhere, and scores 2 on S1 and S3. The pick is a finalist that also passes the look-alike check (2.3).

### 2.2 The analysis sheet

Each candidate is cropped to its ink, reduced to one-colour coverage and drawn at 128, 32, 20 and 16 px tall. It is drawn on the light theme in the text colour, and on the dark theme in the text colour and in brass (`--grey-50` with `--grey-900`, `--grey-950` with `--grey-100` and `--brass-400`). The 16 px render is zoomed four times so its pixels show. Two numbers come with it: the share of the ink that is mid-tone, which flags a gradient, a texture or a soft edge, and the spread of the ink's hue, which flags a second colour. The application's sheet measured clean black on white at about 5 % mid-tone and no hue spread. The sheet is made in the session from the candidates the PM shares, with a short Python script on Pillow. It is a working file and is not committed; neither are the candidates.

**The baseline is the placeholder:** the name as the bar sets it today, Fraunces' display cut (`--display-settings`: opsz 144, SOFT 30) at the heading weight. At 16 px its thin strokes and serifs fade, because a traced mark cannot switch to the font's text optical size as the live font does. A candidate has to beat that.

### 2.3 The look-alike check

Run on every finalist, and recorded in the issue for the pick:

- **The virtual tabletops:** Roll20, Foundry Virtual Tabletop, Owlbear Rodeo, Fantasy Grounds, Alchemy RPG, TaleSpire.
- **The tabletop and miniature brands**, the paint ranges first because "wash" is their word: Citadel, The Army Painter, Vallejo, Games Workshop, Wizards of the Coast and Dungeons & Dragons, Paizo, Hero Forge.
- **The 3D-printing brands:** Polymaker first, because of its "Poly" family (`name.md`, 2.4), then Prusa, Bambu Lab, Creality, Elegoo, Anycubic, Printables, Thingiverse, MyMiniFactory, Cults3D.
- **The 3D tools whose names start with "Poly":** Polycam, Poly Haven, Unity's Polybrush, Google's former Poly. A stylised "Poly" is where an echo is most likely.
- **The cleaning products** that hold the name in the registers: Polymount's and Ducora's POLYWASH, Diversey's Suma.
- **MeshTavern's own wordmark**, so that the sibling does not read as a copy of it.
- **A reverse image search of the pick**, by the PM (Google Lens, TinEye, Bing Visual Search); the agent's session cannot run one.

## 3. How a round runs

1. **One new ChatGPT chat per direction**, so that one direction's style does not bleed into the next. Paste the direction's prompt; it asks for one landscape image.
2. **The second image in the same chat:** paste the direction's variation line. Two images per direction and four directions make eight candidates.
3. **Misspelled but otherwise strong:** try once with the fix line below. If the letters change as well, regenerate instead. Every edit can drift the letterforms, so compare before keeping one.
4. **Name each candidate** by direction and number (A1, A2, B1 …; a later round continues the numbers, A3, or opens a new letter). Share them in the session, where the agent reads attached images directly; the issue works too. The PNG that ChatGPT offers for download is better than a screenshot.
5. **From round 2 on, iterate a candidate from its own image:** a new chat with the parent's PNG attached, one prompt per new candidate. Each prompt starts again from that attached original rather than from the last image made, so that the drift of one edit does not carry into the next.
6. **The agent answers** with the sheet, the scores, which candidates to drop, which to iterate and how, and the next round's prompts. The round goes into the log (section 5).

The fix line:

```
Keep this logo exactly as it is (letterforms, weight, spacing and composition unchanged) and correct only the spelling, so that it reads P-o-l-y-W-a-s-h: eight letters, one word, capital P and capital W, every other letter lowercase.
```

## 4. Round 1: four directions

Each prompt is complete and ready to paste. The four share their opening and their rules on spelling, rendering and motifs, and differ only in the style paragraph. That way the candidates differ in style and not in how well they were asked. Each direction's second image tries one idea; an idea that works can move to another direction in round 2 (its line pastes into any chat). The short form (E) waits until a candidate leads: the "P" should be cut from the letters that lead, not invented on its own.

What the application's round 1 taught, applied here: the model spells a word right when it is spelled out letter by letter; it silently drops a structural instruction it finds vague; and it draws a fine detail (a facet) as a defect. So every idea below is asked for in measurable terms.

### A. Geometric sans: precise

Letters constructed from circles and straight strokes. The closest to "a modern tool"; the risk is a generic look. The second image makes the "o" a polygon, the one nod to "Poly" that stays flat and keeps the letter whole.

```
Design a wordmark logo for PolyWash, a free browser tool that turns the 3D-printing file of a miniature figure into a light, game-ready 3D model, shaded as if it had been primed and given a painter's wash. Calm, modern and well made, with a little warmth: a software tool, not a fantasy product and not a cleaning product.

The text, exactly: PolyWash
Spelled P-o-l-y-W-a-s-h: eight letters, one word, no space, no hyphen. Capital P and capital W; every other letter lowercase. Each letter appears once: none added, dropped or repeated.

Style: a modern geometric sans-serif constructed from near-perfect circles and straight strokes. Single-storey "a". Medium-bold weight with even stroke thickness, round counters kept open and slightly generous letter spacing, so that the word stays readable when shrunk to 16 pixels high. Precise and confident, with no quirks.

Rendering: a flat vector logo in solid black on a plain white background, one colour only. No gradient, shadow, glow, outline, bevel, 3D, texture or grain. Letters only: no icon, symbol, emblem, badge, frame, underline, tagline or any other text. No fantasy, sci-fi or gaming motifs: no dice, swords, dragons, shields, runes, scrolls, parchment, wood, banners, circuitry, and no medieval or blackletter lettering. No water or cleaning motifs: no drops, splashes, waves, bubbles, foam or sparkles, and no brushes or paint.

Composition: the word centred on a wide landscape canvas with generous empty space around it, shown flat as the logo artwork itself, not printed on paper, a sign, a wall, a screen or any other mockup. Landscape image.
```

A2, the polygon:

```
Make one new version in the same direction: draw the lowercase "o" as a regular octagon instead of a circle, eight equal straight sides, with the same stroke weight and the same height as the other lowercase letters, and an octagonal counter inside it. Only that one letter changes; every other letter stays as it is. Same rules as before: solid black on white, flat, one colour, exactly "PolyWash" with capital P and capital W. Landscape image.
```

### B. Humanist sans: warm

Open letters with a trace of the pen. The warmest of the sans directions; the risk is softness at 16 px. The second image splits the two halves by weight instead of by colour, so that "Wash" starts at the W without a space or a second colour.

```
Design a wordmark logo for PolyWash, a free browser tool that turns the 3D-printing file of a miniature figure into a light, game-ready 3D model, shaded as if it had been primed and given a painter's wash. Calm, modern and well made, with a little warmth: a software tool, not a fantasy product and not a cleaning product.

The text, exactly: PolyWash
Spelled P-o-l-y-W-a-s-h: eight letters, one word, no space, no hyphen. Capital P and capital W; every other letter lowercase. Each letter appears once: none added, dropped or repeated.

Style: a warm humanist sans-serif with open apertures, a gentle stroke contrast and terminals that hint at a broad pen, friendly and professional at once. Double-storey "a". Medium-bold weight, open counters and comfortable letter spacing, so that the word stays readable when shrunk to 16 pixels high. Approachable and well crafted, not playful or bubbly.

Rendering: a flat vector logo in solid black on a plain white background, one colour only. No gradient, shadow, glow, outline, bevel, 3D, texture or grain. Letters only: no icon, symbol, emblem, badge, frame, underline, tagline or any other text. No fantasy, sci-fi or gaming motifs: no dice, swords, dragons, shields, runes, scrolls, parchment, wood, banners, circuitry, and no medieval or blackletter lettering. No water or cleaning motifs: no drops, splashes, waves, bubbles, foam or sparkles, and no brushes or paint.

Composition: the word centred on a wide landscape canvas with generous empty space around it, shown flat as the logo artwork itself, not printed on paper, a sign, a wall, a screen or any other mockup. Landscape image.
```

B2, the weight split:

```
Make one new version in the same direction: set "Poly" in a regular weight and "Wash" two steps bolder, in the same typeface and the same black, so that the capital W starts the second half without a space or a second colour. The regular "Poly" must still be sturdy enough to read at 16 pixels high. Same rules as before: solid black on white, flat, one colour, exactly "PolyWash" with capital P and capital W. Landscape image.
```

### C. Soft serif: character

Kin to the headings' Fraunces, cut sturdier for small sizes: the closest to the placeholder and to the display face. The risks are fine detail that fails at 16 px and an old-fashioned feel. The second image lets the tail of the "y" run under "Wash" as one stroke. A swash under the wash: the one place the name's second half can be drawn without water.

```
Design a wordmark logo for PolyWash, a free browser tool that turns the 3D-printing file of a miniature figure into a light, game-ready 3D model, shaded as if it had been primed and given a painter's wash. Calm, modern and well made, with a little warmth: a software tool, not a fantasy product and not a cleaning product.

The text, exactly: PolyWash
Spelled P-o-l-y-W-a-s-h: eight letters, one word, no space, no hyphen. Capital P and capital W; every other letter lowercase. Each letter appears once: none added, dropped or repeated.

Style: a contemporary soft serif with character, in the spirit of the open-source typeface Fraunces: sturdy, slightly rounded wedge serifs, moderate stroke contrast, a large x-height and warm, generous curves. Medium-bold weight with no hairline strokes and no thin serifs, so that the word stays readable when shrunk to 16 pixels high. Confident and modern: not old-fashioned, not calligraphic, not medieval.

Rendering: a flat vector logo in solid black on a plain white background, one colour only. No gradient, shadow, glow, outline, bevel, 3D, texture or grain. Letters only: no icon, symbol, emblem, badge, frame, underline, tagline or any other text. No fantasy, sci-fi or gaming motifs: no dice, swords, dragons, shields, runes, scrolls, parchment, wood, banners, circuitry, and no medieval or blackletter lettering. No water or cleaning motifs: no drops, splashes, waves, bubbles, foam or sparkles, and no brushes or paint.

Composition: the word centred on a wide landscape canvas with generous empty space around it, shown flat as the logo artwork itself, not printed on paper, a sign, a wall, a screen or any other mockup. Landscape image.
```

C2, the swash:

```
Make one new version in the same direction: extend the descender of the lowercase "y" so that its tail curves to the right and runs as one flat, nearly straight stroke under the letters "Wash", below the baseline, ending cleanly under the right edge of the "h". The stroke is as thick as the letters' main stems, never thinner, so that it stays visible at 16 pixels high, and a clear gap separates it from the bottoms of "Wash" above it. It must read as the tail of the y, not as a separate underline. Everything else stays plain. Same rules as before: solid black on white, flat, one colour, exactly "PolyWash" with capital P and capital W. Landscape image.
```

### D. Polygonal sans: the mesh

A sans whose curves are drawn as a few straight segments, the way the converter reduces a curved sculpt to flat polygons. It is the most literal reading of "Poly", and the one whose idea is the whole word rather than one letter. The risks are a retro arcade or digital-display feel, which G4 and S4 judge, and an "s" or "a" that stops reading. The second image keeps "Poly" polygonal and lets "Wash" curve again: the two halves of the name as two treatments of one face.

```
Design a wordmark logo for PolyWash, a free browser tool that turns the 3D-printing file of a miniature figure into a light, game-ready 3D model, shaded as if it had been primed and given a painter's wash. Calm, modern and well made, with a little warmth: a software tool, not a fantasy product and not a cleaning product.

The text, exactly: PolyWash
Spelled P-o-l-y-W-a-s-h: eight letters, one word, no space, no hyphen. Capital P and capital W; every other letter lowercase. Each letter appears once: none added, dropped or repeated.

Style: a clean modern sans-serif in which every curve is drawn as a few straight, flat segments with crisp corners, like a curved shape simplified into polygons: the bowl of the P, the o, the a, the s and the shoulder of the h each made of four to eight straight sides. Medium-bold weight with even stroke thickness, open counters and comfortable letter spacing, so that every letter, the s included, stays readable when shrunk to 16 pixels high. Precise and contemporary: not pixelated, not a digital clock or arcade font, not stencilled, not futuristic.

Rendering: a flat vector logo in solid black on a plain white background, one colour only. No gradient, shadow, glow, outline, bevel, 3D, texture or grain. Letters only: no icon, symbol, emblem, badge, frame, underline, tagline or any other text. No fantasy, sci-fi or gaming motifs: no dice, swords, dragons, shields, runes, scrolls, parchment, wood, banners, circuitry, and no medieval or blackletter lettering. No water or cleaning motifs: no drops, splashes, waves, bubbles, foam or sparkles, and no brushes or paint.

Composition: the word centred on a wide landscape canvas with generous empty space around it, shown flat as the logo artwork itself, not printed on paper, a sign, a wall, a screen or any other mockup. Landscape image.
```

D2, polygons and curves:

```
Make one new version in the same direction: keep "Poly" exactly as it is, with its curves drawn as straight segments, and draw "Wash" in the same typeface with smooth round curves instead, same weight, same height and same spacing, so that the word turns from faceted to smooth at the capital W. Same rules as before: solid black on white, flat, one colour, exactly "PolyWash" with capital P and capital W. Landscape image.
```

### E. The short form

Pasted into the chat of a leading candidate, so that the model draws from its letters. Round 2 attaches the candidate's PNG instead (section 3, step 5).

E1, the P:

```
From the logo you just made, design its short form for a favicon and an app icon: the capital "P" alone, drawn with exactly the same letterform, weight and details, centred on a square canvas and filling about 80 percent of its height. It must stay recognisable at 16 by 16 pixels. Solid black on a plain white background, flat, one colour; no other letters, no frame, no background shape, no mockup. Square image.
```

E2, the app icon:

```
Make one more version of the short form: the same "P" cut out in white from a solid black rounded square that fills the canvas, with the same letterform, for an app icon. One colour only, flat, no gradient, no shadow. Square image.
```

### Lines for later rounds

Pasted into a direction's chat when a round calls for one. Each ends with "Change nothing else", and each still needs the before-and-after comparison of section 3, step 3.

```
Same logo, one step bolder, with the letter spacing opened slightly so that the counters stay clear at 16 pixels high. Change nothing else.
```

```
Same logo with the letter spacing opened by about ten percent, so that no two letters come close to touching when the logo is small. Change nothing else.
```

```
Same logo with a larger x-height: the lowercase letters taller relative to the capitals. Change nothing else.
```

```
Same logo with a single-storey "a" instead of the double-storey one (or the other way round). Change nothing else.
```

For a finalist, the clean redraw before tracing:

```
Redraw this exact logo at the largest size you can, as crisp, flat black shapes on pure white: straight lines perfectly straight, curves smooth and even, stroke widths consistent, sharp corners where corners are meant, and no noise, texture or soft edges. Do not change the letterforms, weight, spacing or any detail. Landscape image.
```

## 5. Round log

### Round 1

Waiting for the PM's candidates: eight images from the prompts of section 4, named A1 to D2.

## 6. The pick

Not yet. When the PM picks, this section records: the file (`wordmark.png`, the PNG as ChatGPT gave it), how it was made (each step's prompt and chat), the date, the scores, and the look-alike check with where it is recorded. AI-generated marks get weak or no copyright protection; that is acceptable for a placeholder and is one reason to commission a designer later.

## 7. The trace

After the pick:

- `wordmark.svg` beside this file: the PNG traced into outlines in one colour, cleaned (straight edges exactly straight, curves even, strokes evened), with nothing redrawn, and checked against the PNG by the overlap of their ink.
- `public/favicon.svg`: the traced P, simplified for 16 px where it has to be (stems on whole pixels, counters opened), on the placeholder's rounded square, replacing the P of Fraunces; `NOTICE.txt`'s favicon lines follow.
- The bar's wordmark slot (`#wordmark`, `COPY.title`) draws the SVG with the name as its accessible text, in the theme's colours, both themes.
