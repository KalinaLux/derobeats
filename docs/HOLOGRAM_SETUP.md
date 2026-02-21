# Running DeroBeats in Hologram (Internal/Dev)

DeroBeats supports **Hologram** via the telaHost Bridge API. When opened in Hologram's TELA Browser, it uses `telaHost.getSmartContract()` to read the registry directly from the daemon—bypassing Gnomon. **Internal use only** — do not share publicly.

## How to run

1. **Install Hologram** and connect to mainnet (node `node.derofoundation.org:11012` or your own).
2. **Open DeroBeats** in Hologram's TELA Browser:
   - Use **Studio** → Local Dev Server, or
   - Serve the site (e.g. `python -m http.server 8000`) and open the URL in Hologram.
3. **Connect** — click "Connect Wallet" in the gate. Hologram will prompt for permission.
4. Songs load via `telaHost.getSmartContract(registryScid)` (daemon `DERO.GetSC`), not Gnomon.
5. **Register** and **Upvote** use `telaHost.scInvoke()`.

## Differences vs Engram

| Feature        | Engram (XSWD)                     | Hologram (telaHost)              |
|----------------|-----------------------------------|-----------------------------------|
| Registry data  | Gnomon.GetAllSCIDVariableDetails  | telaHost.getSmartContract (daemon)|
| Connect        | WebSocket ws://localhost:44326    | telaHost.connect()                |
| EPOCH gate     | Required (10 hashes)               | Skipped                           |
| Register/Upvote| scinvoke via XSWD                 | telaHost.scInvoke()               |

## Internal testing only — not for public distribution
