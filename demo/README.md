# Demo Scenarios

These scenarios demonstrate checkit's passage evidence feature.
Each demo contains an article with known copied sentences so you can see exactly
what the tool outputs for a real plagiarism case.

## Demos

| File | Language | Topic | Sources |
|------|----------|-------|---------|
| [english-demo.md](./english-demo.md) | English | Vitamin D | Wikipedia, Healthline |
| [hebrew-demo.md](./hebrew-demo.md) | Hebrew | ויטמין D | Hebrew Wikipedia |

## How to run a demo

### Step 1 — Create a Google Doc

1. Open [docs.google.com](https://docs.google.com) and create a new document
2. Copy the **Demo article text** section from the demo file
3. Paste it into the Google Doc
4. Click **Share** → **Anyone with the link** → **Viewer**
5. Copy the document URL

### Step 2 — Run checkit

```bash
checkit <your-google-doc-url>
```

If you have a Parallel AI key configured, you'll see the passage evidence phase:

```
⠋ Enriching 3 sources with passage evidence…
```

### Step 3 — Read the output

```
────────────────────────────────────────────────
Words checked:   412
Similarity:      31%  (128 / 412 words matched)

Top matches (2 sources):
  1. en.wikipedia.org/wiki/Vitamin_D   96 words
     ↳ "Vitamin D is a group of fat-soluble secosteroids responsible for
        increasing intestinal absorption of calcium, magnesium, and phosphate…"
     ↳ "The major natural source of the vitamin is synthesis of cholecalciferol
        in the lower layers of the epidermis…"

  2. www.healthline.com/nutrition/vitamin-d-deficiency-symptoms   32 words
     ↳ "Symptoms of vitamin D deficiency can include getting sick or infected
        often, fatigue and tiredness, bone and back pain…"

────────────────────────────────────────────────
❌  REWRITE — similarity too high
────────────────────────────────────────────────
```

## What this demonstrates

Without Parallel AI key — you see **aggregate word counts**:

```
1. en.wikipedia.org/wiki/Vitamin_D   96 words
```

With Parallel AI key — you see **which sentences were copied**:

```
1. en.wikipedia.org/wiki/Vitamin_D   96 words
   ↳ "Vitamin D is a group of fat-soluble secosteroids…"
   ↳ "The major natural source of the vitamin is synthesis…"
```

This is the key value: editors know **exactly which sentences to rewrite**,
not just that there is "some similarity" to a source.

## Setup

Run `checkit --setup` to configure your API keys. The Parallel AI key
is optional but enables the passage evidence feature shown above.

Get a Parallel AI key at [platform.parallel.ai](https://platform.parallel.ai/).
