# Build Swap

Paste a Deadlock hero build, pick a hero, and the retargeted build goes back on your clipboard.

**Live:** https://noahsmaximum.github.io/deadlock-build-swap/

To run it locally:

```
python -m http.server 8352
```

Then open http://localhost:8352. It needs to be served over HTTP, because ES modules and clipboard access don't work from `file://`.

## How it works

A build string is `base64(zstd(CMsgHeroBuild protobuf))`. Top-level fields: 1 build id, 2 **hero id**, 3 author account id, 4 last-updated time, 5 name, 6 description, 10 items/abilities/notes.
Retargeting sets field 2 to the chosen hero, field 1 to `1`, field 4 to now, and field 5 to `[Source hero] copy of <name>`. Any old "Copy of [...]" or "[Hero] copy of" wrappers are stripped first. Everything else is kept byte-for-byte. Under **Advanced**, a reference build from the target hero also lends its author (field 3).

- `build.js`: base64/zstd/protobuf codec
- `heroes.js`: generated from [leamare/deadlock-metadata `heroes/names.json`](https://github.com/leamare/deadlock-metadata/blob/main/heroes/names.json) plus portrait URLs from [deadlock.wiki/Heroes](https://deadlock.wiki/Heroes)
- `vendor/zstd.js`: [@hpcc-js/wasm-zstd](https://www.npmjs.com/package/@hpcc-js/wasm-zstd) 1.16.2 (Apache-2.0)
- `fonts/`: copies of the fonts deadlock.wiki uses (the wiki serves them without CORS). They are Valve's fonts.
