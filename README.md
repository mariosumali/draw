# Draw Battle

Draw Battle is a real-time multiplayer drawing race. Two players join the same invite room, ready up, and race for 90 seconds to draw prompts that an in-browser Quick Draw CNN recognizes.

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

The app loads a TensorFlow.js model from:

```text
public/models/quickdraw/model.json
public/models/quickdraw/classes.json
```

Add the model weight shards beside `model.json`. `classes.json` must list labels in the same order as the model output.

The drawing pipeline crops the ink, centers it, rescales it to 28x28 grayscale, and feeds a `1 x 28 x 28 x 1` tensor into the model. Recognition scores when the current prompt is in the top three predictions with at least 72% confidence.

Known candidate: DoodleNet is a 345-class Quick Draw CNN converted to TensorFlow.js. Confirm the model license before committing its weights.

## Scripts

- `npm run dev`: start Next.js
- `npm run party:dev`: start PartyKit on port 1999
- `npm run build`: build the Next.js app
- `npm run lint`: run ESLint
- `npm run typecheck`: run TypeScript checks
- `npm test`: run unit tests
