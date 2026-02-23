# DeroBeats

**Decentralized music platform on DERO. On-chain, underground, permissionless.**

![DeroBeats](https://raw.githubusercontent.com/KalinaLux/derobeats/main/img/default-art.png)

DeroBeats is a fully decentralized music registry and streaming platform built on the [DERO](https://dero.io) blockchain. Artists publish tracks to IPFS, register them on-chain via smart contract, and listeners mine EPOCH hashes directly to artists while they play. No middlemen. No platform cuts. No algorithms.

## Features

- **On-chain song registry** -- publish, discover, and stream tracks stored on IPFS or any direct URL
- **EPOCH mining to artists** -- listeners mine hashes directly to artist wallets during playback
- **Donations** -- tip artists in DERO, forwarded instantly by the smart contract
- **Upvoting** -- on-chain upvotes, one per wallet per song
- **Play tracking** -- cumulative hash counts recorded on-chain per song
- **Playlists** -- local playlist creation, reordering, sharing via encoded codes
- **Multi-gateway IPFS + Service Worker** -- smart caching across 7 IPFS gateways with automatic failover
- **Direct URL hosting** -- artists can host media anywhere (IPFS, GitHub, Catbox, private server)
- **Background playback** -- MediaSession API keeps audio playing across browser tabs with Now Playing controls
- **Tela-native** -- designed to run inside DERO's Tela web framework

## How It Works

```
Artist uploads MP3 to IPFS
        |
        v
Artist registers song on-chain (smart contract)
        |
        v
Gnomon indexes the contract variables
        |
        v
DeroBeats loads songs from registry, renders player
        |
        v
Listener plays track --> EPOCH hashes mine to artist wallet
Listener donates    --> DERO sent directly to artist address
Listener upvotes    --> On-chain vote recorded (1 per wallet)
```

## Storage Philosophy

DeroBeats is designed to minimize on-chain footprint. No music or artwork is stored on the blockchain. All media lives on IPFS or artist-hosted URLs. The only on-chain data is:

- **Registry smart contract** -- song metadata (title, artist address, CID pointers, genre). No media content.
- **Tela site DOCs** -- the compressed site interface (~50KB across 7 DOCs). No shards.

The chain knows *where* to find the music, not the music itself. If you're building on Dero, please consider the same approach -- store pointers, not payloads.

## Smart Contract (MV5)

Registry SCID: `88aa9c31ca557eb87fe0ff4c1f077fd5a41c0613f63090c58f82d0452929929c`

| Function | Description |
|---|---|
| `RegisterSong` | Publish a new track (title, artist, genre, IPFS hash, artwork CID) |
| `UpvoteSong` | Upvote a song (one per wallet) |
| `Donate` | Send DERO to the artist who registered the track |
| `RecordHashes` | Record cumulative play hashes for a song |
| `RemoveSong` | Remove a song (artist or contract owner only) |
| `TransferOwnership` | Transfer contract ownership |

The contract source is in [`derobeats-registry-mv5.bas`](derobeats-registry-mv5.bas).

## Deployment

### Tela

DeroBeats is deployed as a Tela site on DERO. All site files are stored as individual compressed DOCs (no sharding required) and served natively through any Tela-compatible client.

INDEX SCID: `b1e1cba50cbfd8edbb12b01220ffebbece300d4936516a87fc2255fa8e23d8a2`

### Standalone (Engram + XSWD)

You can also run DeroBeats as a regular website:

1. Open `index.html` in a browser
2. Make sure [Engram wallet](https://github.com/DEROFOUNDATION/engram) is running with XSWD enabled on port 44326
3. Connect your wallet through the EPOCH gate
4. EPOCH must be set to "dApp Chooses" in Engram settings

### Publishing a Track

1. Click "Upload your track" to open the upload form
2. Upload an MP3 (and optional artwork) to IPFS via Pinata, paste CIDs, or paste any direct URL
3. Click "Register on chain" to write the song to the registry
4. Approve the transaction in Engram
5. Wait ~18 seconds for Gnomon to index, then refresh

## Project Structure

```
index.html              Main app (player, registry, playlists)
upload.html             Track upload + registration flow
css/style.css           All styles
js/app-core.js          App logic pt1 (wallet, registry, mining, rendering)
js/app-ui.js            App logic pt2 (playlists, media session, UI events)
js/xswd.js              XSWD WebSocket helper
sw.js                   Service worker (IPFS multi-gateway cache + failover)
derobeats-registry-mv5.bas   Smart contract source (DVM-BASIC)
docs/CURLS.md           Curl commands for testing the contract
docs/REGISTRY_SETUP.md  Contract deployment instructions
```

## Curl Testing

See [`docs/CURLS.md`](docs/CURLS.md) for ready-to-use curl commands to query the registry, estimate gas, and test all contract functions.

## License

MIT
