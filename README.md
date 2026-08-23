# Draw Battle

Draw Battle is a collection of drawing games built around an in-browser Quick Draw CNN. It includes a two-to-six-player Party Show plus four standalone experiments for solo play.

## Ways to Play

- **Party Show** is a five-round multiplayer match. Everyone draws the same prompt, successful recognition locks the player's result without cutting off a stroke, and the round waits for everyone before showing the sketches side by side.
- **Daily Gauntlet** gives every player the same six seeded prompts each day, thirty seconds per prompt, and three lives. Daily bests persist on the device.
- **AI Telephone** turns the recognizer's top interpretation into the next drawing prompt across a four-link chain, then reveals how the meaning drifted.
- **Model Hacker** asks for a specific decoy guess before the true target can score, turning model steering into a five-puzzle run.
- **Creative Gallery** removes the clock and adds titles, downloads, remixes, and a device-local sketchbook.

Party Show rotates through three round rules, beginning with the room creator's pick:

- **Speed Run** is the direct race: every recognized prompt is worth 100 points, so throughput wins.
- **Ink Golf** rewards economical drawings. Every pen-down counts, and extra strokes reduce the award for a recognized prompt.
- **Double Take** rewards transformation. First make the recognizer confidently guess the wrong object, then turn the same sketch into the real prompt for a 400-point bonus.

Recognition records the completed sketch only after the active stroke ends, so the AI never pulls the canvas away mid-line. Party matches end with scores and a gallery containing every player's round submissions.

## Run Locally

Install dependencies:

```bash
npm install
```

Start PartyKit in one terminal:

```bash
npm run party:dev
```

Start Next.js in another terminal:

```bash
npm run dev
```

Open `http://localhost:3000`, create a room, then open the copied invite URL in a second browser window.

## Quick Draw Model

The game runs a **SE-ResNet over all 345 Quick Draw categories** entirely in the
browser through ONNX Runtime Web. The shipped build is 4.3 MB, scores in about 5 ms,
and needs no CDN and no server inference.

**80.3% top-1, 93.7% top-3, MAP@3 0.864** measured over 10,350 held-out drawings from
Google's own dataset. Reproduce with `npm run bench:recognizer -- --per-class 30`.

Recognition works from the captured strokes, not from canvas pixels: strokes are
re-rendered at the scale and stroke weight Google's training bitmaps were drawn at, so
a drawing reads the same however large it was drawn or wherever on the canvas it was
placed. On a paired test the render scores within noise of Google's own bitmaps for the
same drawing (76.1% vs 76.5% top-1 over 2,760 pairs). Downscaling the drawing canvas
instead costs roughly 70 points of top-1 accuracy. See [docs/recognizer.md](docs/recognizer.md) for the full pipeline, the
recovered render parameters, and the testing strategy.

A round scores when the current prompt is in the top five predictions above 45%
confidence.

The dev model lab at `/dev/models` (dev only — it 404s in production) compares the
shipped recognizer against:

- `public/models/doodlenet/` and ml5's hosted DoodleNet
- `public/models/quickdraw/` - a locally trained TF.js model
- `Xenova/quickdraw-mobilevit-small` via Transformers.js
- SketchXAI Base, served by a dev-only Python route

The dataset is published by Google under CC BY 4.0; keep attribution with any exported
model assets.

## Guessing Voice

While you draw, the recognizer narrates its guesses out loud in the style of Google's
Quick, Draw!: filler while it thinks ("Hmm..."), a guess per reveal ("I see a cat.",
"Or maybe a dog?"), and the payoff line the moment it lands on your prompt
("Oh, I know! It's a hot air balloon!"). It speaks through the Web Speech API, so
there are no audio assets and no network calls.

The speech-bubble button next to the room code opens the voice settings: on/off, which
installed system voice to use, speed, pitch, volume, and chattiness (quiet narrates only
the top guess and the win; chatty reads the whole top five). Settings persist in
`localStorage`.

The speaker toggle mutes **every** sound, the narrator included. When that (or anything
else) is keeping the voice silent, the panel says so and offers the fix: it reports
whether the game is muted, whether the browser has no Web Speech API, whether the system
has no installed voices, whether the browser is still waiting for a user gesture, or
whether the speech engine returned an error.

The model lab at `/dev/models` carries the same controls: draw once and every model
guesses the same sketch, then **Hear this model** reads any one of them out loud
without changing the active recognizer, so you can compare how each model *sounds* on
the same drawing. A Narration panel logs the last lines spoken and which model said
them.

## Scripts

- `npm run dev`: start Next.js
- `npm run party:dev`: start PartyKit on port 1999
- `npm run build`: build the Next.js app
- `npm run lint`: run ESLint
- `npm run typecheck`: run TypeScript checks
- `npm test`: run unit, accuracy and robustness tests
- `npm run bench:recognizer`: full-dataset recognizer benchmark (needs the local dataset)
- `npm run sync:ort`: refresh the ONNX Runtime WASM binaries in `public/ort`
- `npm run fixtures:build`: rebuild the committed evaluation fixtures
