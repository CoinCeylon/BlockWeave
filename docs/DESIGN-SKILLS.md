# AI design skills (Impeccable + Taste Skill)

We use two open-source skills so our AI coding agents don't produce generic "AI-made" UI.
They read **`PRODUCT.md`** in the repo root, so keep that file up to date: it's what makes the
output look like TeaTrail and not a template.

| Skill | Use it for | Licence |
|---|---|---|
| [Impeccable](https://github.com/pbakaus/impeccable) | App screens: estate, checkpoint, auction, lot passport. Audits, critiques, polish. | Apache 2.0 |
| [Taste Skill](https://github.com/Leonxlnx/taste-skill) | Marketing pages only: a landing page / pitch site for TeaTrail. | MIT |

Don't use Taste Skill on the app screens. It's built for company websites (big heroes, one section per screen),
not for forms and dashboards.

## Install (each teammate, once)

Needs Node.js. Run from the repo root (`D:\blockweave` or wherever you cloned it):

```bash
npx skills add pbakaus/impeccable
npx skills add https://github.com/Leonxlnx/taste-skill --skill design-taste-frontend
```

The installer asks which agent you use (Claude Code, Gemini CLI, Codex, Cursor, Copilot…). Pick yours.
Skill files land in your agent's skills folder and are **not committed**. Everyone installs their own.

## Commit vs keep local

Commit: `PRODUCT.md`, `DESIGN.md` (when created), `.impeccable/config.json`, `.impeccable/surfaces/`,
`.impeccable/design.json`.
Keep local (already git-ignored): `.impeccable/config.local.json`, `.gemini/`, installed skill folders.

## Useful Impeccable commands

```
/impeccable critique app/src/app/lot/[id]/page.tsx   # design review with scores
/impeccable audit app                                 # accessibility, responsive, performance
/impeccable polish app/src/app/checkpoint/page.tsx    # final pass on one screen
/impeccable document                                  # write DESIGN.md from our current code
/impeccable adapt app/src/app/lot/[id]/page.tsx       # make it work on small phones
```

Ground rules, whatever the skill suggests:
- No invented testimonials, partners, numbers or real company names (see PRODUCT.md, Evidence on Hand).
- Bid amounts are never shown before the auction closes.
