# DeroBeats Registry Setup (Like Feed)

The registry lets you **upvote** songs and (future) query the catalog. Same pattern as Feed's posts registry.

## Quick Overview

| Step | What |
|------|------|
| 1 | Deploy `derobeats-registry.bas` to chain |
| 2 | Copy the SCID → put in `js/app.js` as `registryScid` |
| 3 | Register each song via scinvoke `RegisterSong` |
| 4 | Add `data-song-scid="<64-char-hex>"` to each song card upvote button |

## 1. Deploy the Registry

### Option A: Simulator (for testing)

```bash
# Terminal 1: Start simulator
cd "/Users/kalinalux/Dero Tela Sites/builds"
./simulator --rpc-bind=127.0.0.1:20000

# Terminal 2: Deploy via tela-cli or dero-wallet-cli
# Compile derobeats-registry.bas and install the SC
# You'll get a 64-char SCID
```

### Option C: Mainnet

Same flow but against mainnet daemon. Uses real DERO for gas.

## 2. Update app.js

```javascript
// Replace this:
const registryScid = "REPLACE_WITH_REGISTRY_SCID_WHEN_DEPLOYED";

// With your deployed SCID:
const registryScid = "a1b2c3d4e5f6...";  // 64 hex chars
```

## 3. Register Songs

Each song must be registered on-chain before upvotes work. Call `RegisterSong` via scinvoke:

```javascript
// Entrypoint: RegisterSong
// Params: songSCID, title, artist, genre, ipfsHash
```

For Phase 1 (no TELA-DOC per song), you can use a single "catalog" SCID per song or extend the registry with an `AddSong` entrypoint that stores title, artist, ipfsHash in the registry (no separate DOC per song).

## 4. Add data-song-scid to HTML

Once a song is registered, it has an SCID. Add it to the upvote button:

```html
<button class="upvote-btn" data-song-scid="a1b2c3d4e5f6...">👍 Upvote</button>
```

If `data-song-scid` is empty or missing, upvote shows: "Song not registered in DeroBeats registry yet".

## Current State

- `registryScid` = placeholder (not deployed)
- Song cards have `data-song-scid=""` (no SCIDs yet)
- Upvote → blocked until registry + registration done

Once steps 1–4 are done, upvotes work like Feed's Preserve.
