# Taking the non-SRD content out (the kill switch)

Push 48 (audit round 2, T4). Six Axes includes statistics from D&D books outside the System Reference
Documents, written in Kerf and Code wording: monsters (source keys `kc-*`), spells
(`spells-authored.json`), magic items, feats, backgrounds, classes and subclasses. In the data they are
marked `source: "kc"` or carry a non-SRD book name. Terry's decision is to keep them, with a way to take
them all out quickly if a publisher asks. This is that way.

## What the switch does

`NEXT_PUBLIC_NON_SRD_CONTENT=off` (lib/content-policy.ts):

- Every picker and lookup that reads `loadSrd` (the Forge, the statblock editor's monster list,
  imports, the encounter builder) offers the SRD and the open third-party bestiaries only.
  Subclasses come down to the one SRD subclass per class.
- The compendium hides every `kc` card, even from index files built before the switch.
- The compendium's footer line stops mentioning the other books.

What it does not do: change anything already saved in a campaign. A character who took a non-SRD spell
keeps it on their sheet, and a GM's stat block copied from a `kc` monster stays theirs. Removing those
would destroy people's work; ask before going further.

## Steps

1. In Vercel, Settings, Environment Variables, add `NEXT_PUBLIC_NON_SRD_CONTENT` = `off` for
   Production (and Preview if wanted).
2. Rebuild the compendium files without the content, so the static files stop being served too
   (otherwise anyone can still fetch `/compendium/cards/...` directly):

   ```
   set NON_SRD_CONTENT=off
   node scripts/build-compendium-index.mjs 2014
   node scripts/build-compendium-index.mjs 2024
   node scripts/build-compendium-index.mjs both
   ```

   Each run prints how many entries it left out.
3. Commit `public/compendium/` and push. Vercel builds with the new variable, which is inlined at
   build time, so the push is the redeploy.
4. Check: open the compendium and search for "beholder" (a Monster Manual monster outside the SRD); it
   should not appear. Open the Forge and look at a class's subclass list; only the SRD subclass shows.

The JSON files under `lib/srd/` still sit in the repository. With the switch off they are bundled but
filtered before anything shows them. To take them out of the bundle as well, delete the `kc` records
from those files in a later push; the switch then has nothing left to hide.

## Turning it back on

Remove the variable (or set it to anything but `off`), rebuild the compendium without
`NON_SRD_CONTENT`, commit, push.
