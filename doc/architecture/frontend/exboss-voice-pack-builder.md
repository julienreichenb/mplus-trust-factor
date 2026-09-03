# ExBoss Voice Pack Builder

Browser tool at `/tools/exboss-voice-pack` that builds a custom ExBoss voice pack without uploading audio.

## Privacy model

- Recording, MP3 encoding, draft storage, and ZIP generation are entirely client-side.
- Drafts live in IndexedDB (`mplus-exboss-voice-pack`) on the user’s device.
- Custom recordings are never sent to M+ Trust Factor backends.

## Manifest provenance

- Alert labels/filenames are pinned to upstream commit `57c3a78ef17c1b4e2a746e04b7700c8ee77c504b` of [aizuon/EXBOSS](https://github.com/aizuon/EXBOSS).
- That snapshot’s own TOC Interface is `120005,120007` and is provenance only.
- Canonical count is **185** alerts (see `apps/web/src/lib/exboss-voice-pack-manifest.ts`).
- To refresh the manifest: compare `EXBOSS-ENG/Labels.lua` + `Sounds.lua` at a newer commit, update the snapshot and provenance SHA together, and re-run the ExBoss voice-pack tests.

## English fallback dependency

- Generated packs use `## RequiredDeps: EXBOSS-ENG`.
- Alerts marked English keep the official ENG `.ogg` path under `Interface\AddOns\EXBOSS-ENG\Sounds\`.
- The builder does **not** redistribute English audio; users must keep `EXBOSS-ENG` installed.

## Generated addon structure

Top-level ZIP entry is one addon directory (`EXBOSS-MT-<slug>/`):

- `<dir>.toc` — current Retail Interface `120100` (Midnight 12.1.0), not the pinned ENG snapshot Interface
- `Labels.lua`
- `Sounds.lua`
- `Sounds/*.mp3` — custom recordings only

Install by extracting into `World of Warcraft/_retail_/Interface/AddOns/`, reload UI, then select the pack by its human-visible name in ExBoss.
