// DeroBeats - Phase 1: Personal Music Site
// Complete XSWD + EPOCH Integration
// Tela telaHost support (uses DERO.GetSC instead of Gnomon - bypasses indexing)

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then(
        () => console.log("📦 IPFS cache worker ready"),
        (err) => console.warn("SW registration failed:", err)
    );
}

let socket;
let isConnected = false;
let isTela = false; // true when running in Tela (window.telaHost)
let userAddress = "";
let epochVerified = false;
let pendingEpochVerification = false;
const _pendingGasCallbacks = {};
let _loadedSongs = [];
let _currentSort = "top";
let _currentFilter = "";
let _songsPerPage = 20;
let _visibleCount = 20;
const _songHashMap = {};
const _hashAccumulator = {};
const _genreDisplayMap = {
    "emo trap": "Cyber Noir"
};
let sessionStats = {
    totalHashes: 0,
    songsSupported: new Set()
};

// Playlist state
let _playlists = [];
let _activePlaylistId = null; // null = "All Tracks" view

// Address for EPOCH verification (10 hashes go to this artist; use demo address)
const EPOCH_VERIFY_HASHES = 10;
const EPOCH_VERIFY_ADDRESS = "dero1qygfgg5hq4fracps4q8cxwzvyjvmh85kewfwc75nxnfpg6grsr4nyqqket86l";

// Dynamic app ID — avoids Engram "App ID is already used" on reconnect
function _freshAppId() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, "0")).join("");
}

function _buildAppData() {
    return {
        id: _freshAppId(),
        name: "DeroBeats - Underground Music Platform",
        description: "Support underground artists through EPOCH mining. No ads, no tracking, 100% to artists.",
        url: location.origin || ("http://localhost:" + location.port)
    };
}

// Registry contract SCID - DeroBeats registry (installed)
const registryScid = "88aa9c31ca557eb87fe0ff4c1f077fd5a41c0613f63090c58f82d0452929929c";

// Contract requires exactly 64 hex chars; if not, RETURN 1 and state is NOT committed (tx still mines!)
function normalizeSongId(raw) {
    if (!raw || typeof raw !== "string") return { ok: false, error: "Song ID is empty or invalid" };
    const s = String(raw).trim().toLowerCase();
    if (s.length !== 64) return { ok: false, error: "Song ID must be exactly 64 hex chars (got " + s.length + ")" };
    if (!/^[0-9a-f]{64}$/.test(s)) return { ok: false, error: "Song ID must be hex only [0-9a-f]" };
    return { ok: true, value: s };
}

// Decode hex-encoded string values from DERO.GetSC (daemon returns strings as hex)
function decodeHexString(val) {
    if (typeof val !== 'string') return val;
    if (val.length === 0 || val.length % 2 !== 0) return val;
    if (!/^[0-9a-fA-F]+$/.test(val)) return val;
    try {
        const bytes = new Uint8Array(val.match(/.{2}/g).map(b => parseInt(b, 16)));
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (_) {
        return val;
    }
}

// IPFS gateways — ordered by preference, auto-fallback on failure
const IPFS_GATEWAYS = [
    "https://gateway.pinata.cloud/ipfs",
    "https://ipfs.io/ipfs",
    "https://cloudflare-ipfs.com/ipfs",
    "https://dweb.link/ipfs",
    "https://w3s.link/ipfs"
];
let _gatewayIndex = parseInt(localStorage.getItem("derobeats_gw_idx"), 10) || 0;
if (_gatewayIndex >= IPFS_GATEWAYS.length) _gatewayIndex = 0;
const IPFS_GATEWAY = IPFS_GATEWAYS[_gatewayIndex];

function isDirectUrl(val) {
    return val && (val.startsWith("http://") || val.startsWith("https://"));
}

function resolveMediaUrl(val) {
    if (!val) return "";
    if (isDirectUrl(val)) return val;
    return `${IPFS_GATEWAYS[_gatewayIndex]}/${val}`;
}

const DEFAULT_ART_LOCAL = "https://raw.githubusercontent.com/KalinaLux/derobeats/main/img/default-art.png";

function tryNextGateway(el, cid, isAudio) {
    const attempts = (el._gwAttempts || 0) + 1;
    el._gwAttempts = attempts;
    if (attempts >= IPFS_GATEWAYS.length) {
        el.onerror = null;
        if (!isAudio) {
            console.log(`[IPFS] Using local fallback artwork for ${cid.substring(0, 12)}...`);
            el.src = DEFAULT_ART_LOCAL;
        } else {
            console.warn(`[IPFS] All gateways exhausted for audio ${cid.substring(0, 12)}...`);
        }
        return;
    }
    const nextIdx = (_gatewayIndex + attempts) % IPFS_GATEWAYS.length;
    const newUrl = `${IPFS_GATEWAYS[nextIdx]}/${cid}`;
    console.log(`[IPFS] Trying gateway ${nextIdx + 1}/${IPFS_GATEWAYS.length} for ${cid.substring(0, 12)}...`);
    if (isAudio) {
        const source = el.querySelector("source");
        if (source) { source.src = newUrl; el.load(); }
    } else {
        el.src = newUrl;
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    isTela = typeof telaHost !== 'undefined' && telaHost;
    if (isTela) console.log('🎵 DeroBeats running in Tela (telaHost)');
    else console.log('🎵 DeroBeats initializing (XSWD/Engram)...');

    // Gate shows unless: they just clicked "Back to DeroBeats" from upload (?from=upload).
    // We use URL param so refresh (no param) always shows the gate; referrer/sessionStorage are unreliable.
    const params = new URLSearchParams(window.location.search);
    if (params.get('from') === 'upload') {
        const gate = document.getElementById('epochGate');
        if (gate) gate.classList.add('hidden');
        if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname || '/');
        }
    }

    // Tela: if already connected, auto-populate and hide gate
    if (isTela && typeof telaHost !== 'undefined' && telaHost?.isConnected && telaHost.isConnected()) {
        (async () => {
            try {
                userAddress = await telaHost.getAddress();
                isConnected = true;
                epochVerified = true;
                updateIndicators("green");
                document.getElementById('connectButton').textContent = "Disconnect";
                document.getElementById('walletAddress').textContent = `${userAddress.substring(0, 12)}...${userAddress.substring(userAddress.length - 8)}`;
                const bal = await telaHost.getBalance();
                document.getElementById('balance').textContent = ((bal.unlocked || 0) / 100000).toFixed(5) + " DERO";
                hideEpochGate();
                loadSongsFromRegistry();
            } catch (_) {}
        })();
    }

    // EPOCH gate: Connect / Retry button
    const gateConnectBtn = document.getElementById('epochGateConnectBtn');
    if (gateConnectBtn) {
        gateConnectBtn.addEventListener('click', function() {
            if (epochVerified) return;
            if (isConnected && pendingEpochVerification) return;
            if (isConnected && !epochVerified) {
                runEpochVerification(); // Retry verification after EPOCH error
                return;
            }
            connectWallet();
        });
    }

    // Connect wallet button (main header)
    document.getElementById('connectButton').addEventListener('click', connectWallet);

    // Refresh songs button (reload from registry - like FEED)
    document.getElementById('refreshSongsBtn')?.addEventListener('click', function() {
        if (!isTela && (!epochVerified || !isConnected)) {
            showNotification("Complete EPOCH verification first", "error");
            return;
        }
        if (isTela && !isConnected) {
            showNotification("Connect wallet first", "error");
            return;
        }
        const btn = this;
        btn.disabled = true;
        btn.textContent = "↻ Loading...";
        loadSongsFromRegistry();
        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = "↻ Refresh";
        }, 2000); // Gnomon can take a moment
    });

    initSortFilterControls();
    initPlaylistControls();
    
    // Add click handlers to upvote buttons
    document.querySelectorAll('.upvote-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const songSCID = this.dataset.songScid;
            upvoteSong(songSCID);
        });
    });

    
    // Load saved stats from localStorage
    loadStats();

    // Pending registration from upload page (index.html has registerBanner)
    const registerBanner = document.getElementById('registerBanner');
    if (registerBanner) {
        const params = new URLSearchParams(location.search);
        if (params.get('register') === '1' && params.get('songSCID')) {
            const songSCID = params.get('songSCID');
            const title = params.get('title') || '';
            const artist = params.get('artist') || '';
            const genre = params.get('genre') || '';
            const ipfsHash = params.get('ipfsHash') || '';
            const summary = document.getElementById('registerSummary');
            if (summary) summary.textContent = `"${title}" by ${artist} — Ready to register on chain. Connect wallet and click below.`;
            registerBanner.style.display = 'block';
            document.getElementById('registerNowBtn')?.addEventListener('click', () => {
                registerSong(songSCID, title, artist, genre, ipfsHash);
            });
            document.getElementById('dismissRegisterBtn')?.addEventListener('click', () => {
                registerBanner.style.display = 'none';
                history.replaceState({}, '', location.pathname);
            });
        }
    }
    
    // Upload modal (iframe — wallet stays connected)
    const uploadModalOverlay = document.getElementById('uploadModalOverlay');
    const uploadFrame = document.getElementById('uploadFrame');
    const openUploadModalBtn = document.getElementById('openUploadModalBtn');
    const uploadModalCloseBtn = document.getElementById('uploadModalCloseBtn');
    if (openUploadModalBtn && uploadModalOverlay) {
        openUploadModalBtn.addEventListener('click', () => {
            uploadFrame.src = 'upload.html';
            uploadModalOverlay.classList.add('show');
        });
    }
    if (uploadModalCloseBtn && uploadModalOverlay) {
        uploadModalCloseBtn.addEventListener('click', () => {
            uploadModalOverlay.classList.remove('show');
            uploadFrame.src = 'about:blank';
        });
    }
    if (uploadModalOverlay) {
        uploadModalOverlay.addEventListener('click', (e) => {
            if (e.target === uploadModalOverlay) {
                uploadModalOverlay.classList.remove('show');
                uploadFrame.src = 'about:blank';
            }
        });
    }

    window.addEventListener('message', (e) => {
        if (e.data?.type === 'derobeats_close_upload') {
            const overlay = document.getElementById('uploadModalOverlay');
            const frame = document.getElementById('uploadFrame');
            if (overlay) overlay.classList.remove('show');
            if (frame) frame.src = 'about:blank';
            return;
        }
        if (e.data?.type === 'derobeats_register') {
            const { songSCID, title, artist, genre, ipfsHash, contentHash, fileSize, mimeType, duration, previewArtCid } = e.data;
            if (!songSCID || !ipfsHash) {
                try { e.source.postMessage({ type: 'derobeats_register_error', error: 'Missing songSCID or ipfsHash' }, '*'); } catch (_) {}
                return;
            }
            const t = (title || '').trim();
            const a = (artist || '').trim();
            if (!t || !a) {
                try { e.source.postMessage({ type: 'derobeats_register_error', error: 'Title and artist are required.' }, '*'); } catch (_) {}
                return;
            }
            if (!isConnected || !epochVerified) {
                try { e.source.postMessage({ type: 'derobeats_register_error', error: 'Connect wallet and verify EPOCH on the main page first.' }, '*'); } catch (_) {}
                return;
            }
            window._derobeatsIframeRegisterSource = e.source;
            const extras = (contentHash || fileSize || mimeType || duration || previewArtCid) ? {
                contentHash: String(contentHash || ''),
                fileSize: String(fileSize || '0'),
                mimeType: String(mimeType || ''),
                duration: String(duration || '0'),
                previewArtCid: String(previewArtCid || '')
            } : null;
            registerSong(songSCID, t, a, genre || '', ipfsHash, extras);
        }
    });

    // Footer "Support DeroBeats" donate button
    document.getElementById("footerDonateBtn")?.addEventListener("click", async () => {
        if (!isConnected || !epochVerified) {
            showNotification("Connect wallet first", "error");
            return;
        }
        const amt = await plPrompt("Donate DERO to DeroBeats", "1");
        if (!amt || !amt.trim()) return;
        const val = parseFloat(amt.trim());
        if (isNaN(val) || val <= 0) { showNotification("Enter a valid amount", "error"); return; }
        const atomic = Math.round(val * 100000);
        sendRequest("transfer", {
            transfers: [{ destination: EPOCH_VERIFY_ADDRESS, amount: atomic }],
            ringsize: 16
        });
        showNotification(`Sending ${val} DERO to DeroBeats — thank you!`, "success");
    });

    console.log('✅ DeroBeats ready!');
});


// Connect to wallet via XSWD (Engram) or telaHost (Tela)
let _connectingInProgress = false;

async function connectWallet() {
    if (isConnected) {
        disconnectWallet();
        return;
    }
    if (_connectingInProgress) return;

    if (isTela) {
        try {
            console.log('🔌 Connecting via Tela telaHost...');
            await telaHost.connect();
            if (!telaHost.isConnected()) {
                showNotification("Connection was not established", "error");
                return;
            }
            userAddress = await telaHost.getAddress();
            isConnected = true;
            epochVerified = true; // Tela: skip EPOCH gate
            updateIndicators("green");
            document.getElementById('connectButton').textContent = "Disconnect";
            document.getElementById('walletAddress').textContent = `${userAddress.substring(0, 12)}...${userAddress.substring(userAddress.length - 8)}`;
            const bal = await telaHost.getBalance();
            document.getElementById('balance').textContent = ((bal.unlocked || 0) / 100000).toFixed(5) + " DERO";
            hideEpochGate();
            loadSongsFromRegistry();
            showNotification("✓ Connected", "success");
        } catch (err) {
            if (err?.message?.includes('reject') || err?.message?.includes('cancelled')) {
                showNotification("Connection rejected", "error");
            } else {
                showNotification("Connection failed: " + (err?.message || err), "error");
            }
        }
        return;
    }

    // Tear down any stale socket from a previous attempt
    if (socket) {
        try { socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null; socket.close(); } catch (_) {}
        socket = null;
    }

    _connectingInProgress = true;
    console.log('🔌 Connecting to wallet...');
    const appData = _buildAppData();
    socket = new WebSocket("ws://localhost:44326/xswd");
    
    socket.addEventListener("open", function() {
        console.log("✅ WebSocket connected");
        updateIndicators("yellow");
        socket.send(JSON.stringify(appData));
    });
    
    socket.addEventListener("message", function(event) {
        const response = JSON.parse(event.data);
        console.log("📨 Response:", response);

        if (response.accepted === false) {
            console.warn("❌ Connection rejected:", response.message);
            showNotification(response.message || "Connection rejected by Engram", "error");
            _connectingInProgress = false;
            return;
        }
        
        if (response.accepted) {
            console.log("✅ Connection accepted! Requesting address...");
            _connectingInProgress = false;
            sendRequest("GetAddress");
            return;
        }
        
        const _respId = typeof response.id === 'string' ? response.id.replace(/^"|"$/g, '') : String(response.id || '');
        if (_respId && _pendingGasCallbacks[_respId]) {
            _pendingGasCallbacks[_respId](response.result || null, response.error || null);
        } else if (response.result) {
            handleResult(response.result);
        }
        
        if (response.error && !_pendingGasCallbacks[_respId]) {
            console.error("❌ Error:", response.error.message, "| full:", JSON.stringify(response.error));
            if (window._derobeatsIframeRegisterSource) {
                try {
                    window._derobeatsIframeRegisterSource.postMessage({ type: 'derobeats_register_error', error: response.error.message }, '*');
                } catch (_) {}
                window._derobeatsIframeRegisterSource = null;
            }
            const wasVerifying = pendingEpochVerification;
            if (pendingEpochVerification) {
                pendingEpochVerification = false;
                showEpochGateError("EPOCH not configured or was denied. Set Engram Settings → Allow → EPOCH = 'dApp Chooses', then click Retry.");
                showNotification("Enable EPOCH with dApp Chooses to use DeroBeats", "error");
            } else {
                showNotification("Error: " + response.error.message, "error");
            }
            if ((response.error.message.includes("reject") || response.error.message.includes("denied")) && !wasVerifying) {
                disconnectWallet();
            }
        }
    });
    
    socket.addEventListener("error", function(event) {
        console.error("❌ WebSocket error:", event);
        _connectingInProgress = false;
        showNotification("Failed to connect. Is Engram running?", "error");
        updateIndicators("red");
    });
    
    socket.addEventListener("close", function(event) {
        console.log("🔌 Connection closed");
        _connectingInProgress = false;
        if (isConnected) disconnectWallet();
    });
}

// Disconnect wallet — gate shows again; they must connect and reverify EPOCH every time
function disconnectWallet() {
    // Stop all playback and move pending hashes into the accumulator
    document.querySelectorAll("audio").forEach(a => {
        a.pause();
        stopContinuousMining(a);
    });

    // Flush accumulated hashes while socket is still open
    flushHashAccumulator();

    if (!isTela && socket) {
        const s = socket;
        socket = null;
        // Detach handlers to prevent recursive disconnectWallet from close event
        try { s.onopen = null; s.onmessage = null; s.onerror = null; s.onclose = null; } catch (_) {}
        setTimeout(() => { try { s.close(); } catch (_) {} }, 600);
    }
    if (isTela && telaHost?.isConnected && telaHost.isConnected()) {
        flushHashAccumulator();
    }

    isConnected = false;
    userAddress = "";
    epochVerified = false;
    pendingEpochVerification = false;
    sessionStorage.removeItem('derobeats_gate_passed');
    updateIndicators("red");
    document.getElementById('connectButton').textContent = "Connect Wallet";
    document.getElementById('walletAddress').textContent = "";
    document.getElementById('balance').textContent = "";
    showEpochGate();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

// EPOCH gate UI helpers
function showEpochGate() {
    const gate = document.getElementById('epochGate');
    const status = document.getElementById('epochGateStatus');
    const err = document.getElementById('epochGateError');
    if (gate) gate.classList.remove('hidden');
    if (status) {
        status.innerHTML = '<button id="epochGateConnectBtn" class="epoch-gate-connect-btn">Enter DeroBeats</button>';
        document.getElementById('epochGateConnectBtn')?.addEventListener('click', () => {
            if (isConnected) runEpochVerification();
            else connectWallet();
        });
    }
    if (err) { err.style.display = 'none'; err.textContent = ''; }
}
function showEpochGateError(msg) {
    const status = document.getElementById('epochGateStatus');
    const err = document.getElementById('epochGateError');
    if (status) status.innerHTML = '<button id="epochGateConnectBtn" class="epoch-gate-connect-btn">Retry</button>';
    document.getElementById('epochGateConnectBtn')?.addEventListener('click', () => runEpochVerification());
    if (err) { err.textContent = msg; err.style.display = 'block'; err.className = 'epoch-gate-error'; }
}
function setEpochGateVerifying() {
    const status = document.getElementById('epochGateStatus');
    const err = document.getElementById('epochGateError');
    if (status) status.innerHTML = '<span class="epoch-gate-verifying">⛏️ Verifying EPOCH...</span>';
    if (err) { err.style.display = 'none'; err.textContent = ''; }
}
function setEpochGateReadyToVerify() {
    const status = document.getElementById('epochGateStatus');
    const err = document.getElementById('epochGateError');
    if (status && !epochVerified) {
        status.innerHTML = '<button id="epochGateConnectBtn" class="epoch-gate-connect-btn">Verify &amp; Enter</button>';
        document.getElementById('epochGateConnectBtn')?.addEventListener('click', () => runEpochVerification());
    }
    if (err) { err.style.display = 'none'; err.textContent = ''; }
}
function hideEpochGate() {
    const gate = document.getElementById('epochGate');
    if (gate) gate.classList.add('hidden');
    sessionStorage.setItem('derobeats_gate_passed', '1');
    window.scrollTo({ top: 0, behavior: "smooth" });
}
function runEpochVerification() {
    if (!socket || socket.readyState !== WebSocket.OPEN || !isConnected) return;
    pendingEpochVerification = true;
    setEpochGateVerifying();
    sendRequest("AttemptEPOCHWithAddr", {
        address: EPOCH_VERIFY_ADDRESS,
        hashes: EPOCH_VERIFY_HASHES
    });
}

// Send XSWD request
function sendRequest(method, params = null) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.error("❌ Socket not connected");
        return;
    }
    
    const request = {
        jsonrpc: "2.0",
        id: Date.now().toString(),
        method: method
    };
    
    if (params) {
        request.params = params;
    }
    
    const json = JSON.stringify(request);
    console.log("📤 Sending:", method, "| payload size:", json.length, "bytes");
    console.log("📤 Full JSON:", json);
    socket.send(json);
}

// Handle response results
function handleResult(result) {
    // Handle address response — connection is now stable
    if (result.address) {
        userAddress = result.address;
        isConnected = true;
        updateIndicators("green");
        document.getElementById('connectButton').textContent = "Disconnect";
        document.getElementById('walletAddress').textContent = `${userAddress.substring(0, 12)}...${userAddress.substring(userAddress.length - 8)}`;
        console.log("✅ Address:", userAddress);

        // Stagger remaining requests now that the connection is confirmed stable
        sendRequest("GetBalance");
        if (!epochVerified) {
            setEpochGateVerifying();
            setTimeout(() => runEpochVerification(), 300);
        }
    }
    
    // Handle balance response
    if (result.unlocked_balance !== undefined) {
        const balance = (result.unlocked_balance / 100000).toFixed(5);
        document.getElementById('balance').textContent = `${balance} DERO`;
        console.log("💰 Balance:", balance, "DERO");
    }
    
    // Handle scinvoke response (upvote, register, etc.)
    if (result.txid) {
        console.log("📥 [scinvoke response] txid:", result.txid, "full result:", JSON.stringify(result));
        showNotification("✅ Transaction sent! Wait ~18 seconds, then Refresh to see your track.", "success");
        if (window._derobeatsIframeRegisterSource) {
            try {
                window._derobeatsIframeRegisterSource.postMessage({ type: 'derobeats_register_done', txid: result.txid }, '*');
            } catch (_) {}
            window._derobeatsIframeRegisterSource = null;
        }
        if (isConnected) {
            setTimeout(() => loadSongsFromRegistry(), 36000);
        }
    }

    // Handle Gnomon registry data (dynamic song list)
    if (result.allVariables !== undefined) {
        if (result.allVariables && Array.isArray(result.allVariables)) {
            renderSongsFromRegistry(result.allVariables);
        } else {
            console.warn("📀 Gnomon returned no variables (registry not indexed or still syncing)");
            window._gnomonRetryCount = (window._gnomonRetryCount || 0) + 1;
            if (window._gnomonRetryCount <= 3) {
                showNotification("Gnomon syncing... retrying in 10s (" + window._gnomonRetryCount + "/3)", "info");
                setTimeout(() => loadSongsFromRegistry(), 10000);
            } else {
                window._gnomonRetryCount = 0;
                showNotification("Registry not indexed yet. In Engram: Assets → Add SCID → paste registry SCID → Add. Then Refresh.", "warning");
                const grid = document.getElementById("tracksGrid");
                if (grid) {
                    grid.innerHTML = getDemoSongHtml();
                    attachSongEventHandlers(grid);
                }
            }
        }
    }

    // Handle EPOCH mining response
    if (result.epochHashes !== undefined) {
        const hashes = result.epochHashes;
        const duration = result.epochDuration;
        const minis = result.epochSubmitted;

        if (pendingEpochVerification) {
            pendingEpochVerification = false;
            epochVerified = true;
            hideEpochGate();
            showNotification("✓ Epoch Verified.", "success");
            console.log("✅ EPOCH verification passed");
            loadSongsFromRegistry();
        } else {
            console.log(`⛏️ Mined ${hashes} hashes in ${duration}ms (${minis} miniblocks)`);
        }

        sessionStats.totalHashes += hashes;
        updateGlobalStats();
        saveStats();
    }
}

// Update status indicators
function updateIndicators(status) {
    const indicators = ['redIndicator', 'yellowIndicator', 'greenIndicator'];
    indicators.forEach(id => {
        document.getElementById(id).classList.remove('active');
    });
    
    if (status === "red") document.getElementById('redIndicator').classList.add('active');
    else if (status === "yellow") document.getElementById('yellowIndicator').classList.add('active');
    else if (status === "green") document.getElementById('greenIndicator').classList.add('active');
}

// Register a new song on the DeroBeats registry (RegisterSong or RegisterSongExt when extras provided)
function registerSong(songSCID, title, artist, genre, ipfsHash, extras) {
    if (!epochVerified || !isConnected) {
        showNotification("⚠️ Complete EPOCH verification first.", "error");
        if (window._derobeatsIframeRegisterSource) {
            try { window._derobeatsIframeRegisterSource.postMessage({ type: 'derobeats_register_error', error: 'Complete EPOCH verification first.' }, '*'); } catch (_) {}
            window._derobeatsIframeRegisterSource = null;
        }
        return;
    }
    const norm = normalizeSongId(songSCID);
    if (!norm.ok) {
        showNotification("⚠️ " + norm.error, "error");
        if (window._derobeatsIframeRegisterSource) {
            try { window._derobeatsIframeRegisterSource.postMessage({ type: 'derobeats_register_error', error: norm.error }, '*'); } catch (_) {}
            window._derobeatsIframeRegisterSource = null;
        }
        return;
    }
    const safeSongId = norm.value;
    const safeTitle = String(title || "").trim();
    const safeArtist = String(artist || "").trim();
    const safeIpfsHash = String(ipfsHash || "").trim();
    if (!safeTitle || !safeArtist || !safeIpfsHash) {
        showNotification("⚠️ Title, artist, and IPFS hash required (non-empty)", "error");
        if (window._derobeatsIframeRegisterSource) {
            try { window._derobeatsIframeRegisterSource.postMessage({ type: 'derobeats_register_error', error: 'Title, artist, and IPFS hash required' }, '*'); } catch (_) {}
            window._derobeatsIframeRegisterSource = null;
        }
        return;
    }
    if (registryScid.includes("REPLACE")) {
        showNotification("⚠️ Deploy registry first. See docs/REGISTRY_SETUP.md", "error");
        if (window._derobeatsIframeRegisterSource) {
            try { window._derobeatsIframeRegisterSource.postMessage({ type: 'derobeats_register_error', error: 'Registry not deployed' }, '*'); } catch (_) {}
            window._derobeatsIframeRegisterSource = null;
        }
        return;
    }

    const safeGenre = String(genre || "").trim();
    const safePreviewArtCid = String((extras?.previewArtCid) || "").trim();
    const titleHex = Array.from(new TextEncoder().encode(safeTitle)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`🔍 [RegisterSong] title="${safeTitle}" hex=[${titleHex}] len=${safeTitle.length} artist="${safeArtist}" genre="${safeGenre}" songSCID=${safeSongId}`);
    const scRpc = [
        { name: "entrypoint", datatype: "S", value: "RegisterSong" },
        { name: "songSCID", datatype: "S", value: safeSongId },
        { name: "title", datatype: "S", value: safeTitle },
        { name: "artist", datatype: "S", value: safeArtist },
        { name: "genre", datatype: "S", value: safeGenre },
        { name: "ipfsHash", datatype: "S", value: safeIpfsHash },
        { name: "previewArtCid", datatype: "S", value: safePreviewArtCid }
    ];

    const telaScRpc = scRpc.filter(x => x.name !== "entrypoint"); // telaHost uses separate entrypoint param

    if (isTela) {
        (async () => {
            try {
                const result = await telaHost.scInvoke({
                    scid: registryScid,
                    entrypoint: "RegisterSong",
                    sc_rpc: telaScRpc
                });
                showNotification("✅ Registered! TX: " + (result?.txid || '').slice(0, 16) + "... Wait ~18s for Gnomon to index.", "success");
                if (window._derobeatsIframeRegisterSource) {
                    try { window._derobeatsIframeRegisterSource.postMessage({ type: 'derobeats_register_done', txid: result?.txid }, '*'); } catch (_) {}
                    window._derobeatsIframeRegisterSource = null;
                }
                setTimeout(() => loadSongsFromRegistry(), 36000);
            } catch (err) {
                showNotification("Register failed: " + (err?.message || err), "error");
                if (window._derobeatsIframeRegisterSource) {
                    try { window._derobeatsIframeRegisterSource.postMessage({ type: 'derobeats_register_error', error: err?.message || String(err) }, '*'); } catch (_) {}
                    window._derobeatsIframeRegisterSource = null;
                }
            }
        })();
        return;
    }

    const gasRpc = [
        ...scRpc,
        { name: "SC_ACTION", datatype: "U", value: 0 },
        { name: "SC_ID", datatype: "H", value: registryScid }
    ];
    const gasParams = { sc_rpc: gasRpc, ringsize: 2, signer: userAddress };
    console.log("⛽ Requesting gas estimate for RegisterSong...");
    showNotification("📝 Estimating gas...", "info");

    const gasId = "gas_reg_" + Date.now();
    _pendingGasCallbacks[gasId] = (result, error) => {
        delete _pendingGasCallbacks[gasId];
        let fees = 5000;
        if (result && result.gasstorage > 0) {
            fees = Math.max(Math.ceil(result.gasstorage * 2), 2000);
            console.log("⛽ GasEstimate OK — storage:", result.gasstorage, "compute:", result.gascompute, "→ fees:", fees);
        } else {
            console.warn("⛽ GasEstimate failed, using fallback fees:", fees, error ? JSON.stringify(error) : "");
        }
        sendRequest("transfer", { scid: registryScid, sc_id: registryScid, ringsize: 2, fees: fees, sc_rpc: scRpc });
        showNotification("⚡ Switch to Engram — it needs your approval", "info");
    };

    const gasReq = { jsonrpc: "2.0", id: gasId, method: "DERO.GetGasEstimate", params: gasParams };
    socket.send(JSON.stringify(gasReq));
}

// Upvote a song (FEED-style: scinvoke on registry contract)
function upvoteSong(songSCID) {
    if (!epochVerified || !isConnected) {
        showNotification("⚠️ Complete EPOCH verification first.", "error");
        return;
    }
    const norm = normalizeSongId(songSCID);
    if (!norm.ok) {
        showNotification("⚠️ " + norm.error, "error");
        return;
    }
    const safeSongId = norm.value;

    if (registryScid.includes("REPLACE")) {
        showNotification("⚠️ Configure registry SCID in app.js first", "error");
        return;
    }

    if (isTela) {
        (async () => {
            try {
                await telaHost.scInvoke({
                    scid: registryScid,
                    entrypoint: "UpvoteSong",
                    sc_rpc: [{ name: "songSCID", datatype: "S", value: safeSongId }],
                    sc_dero_deposit: 0,
                    sc_token_deposit: 0
                });
                showNotification("👍 Upvote sent!", "success");
                setTimeout(() => loadSongsFromRegistry(), 2000);
            } catch (err) {
                showNotification("Upvote failed: " + (err?.message || err), "error");
            }
        })();
        return;
    }

    const scRpc = [
        { name: "entrypoint", datatype: "S", value: "UpvoteSong" },
        { name: "songSCID", datatype: "S", value: safeSongId }
    ];
    const gasRpc = [
        ...scRpc,
        { name: "SC_ACTION", datatype: "U", value: 0 },
        { name: "SC_ID", datatype: "H", value: registryScid }
    ];
    const gasId = "gas_upvote_" + Date.now();
    _pendingGasCallbacks[gasId] = (result, error) => {
        delete _pendingGasCallbacks[gasId];
        let fees = 2000;
        if (result && result.gasstorage > 0) {
            fees = Math.max(Math.ceil(result.gasstorage * 2), 1000);
            console.log("⛽ UpvoteSong gas — storage:", result.gasstorage, "compute:", result.gascompute, "→ fees:", fees);
        }
        sendRequest("transfer", { scid: registryScid, sc_id: registryScid, ringsize: 2, fees: fees, sc_rpc: scRpc });
        showNotification("⚡ Switch to Engram — approve the upvote", "info");
    };
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: gasId, method: "DERO.GetGasEstimate", params: { sc_rpc: gasRpc, ringsize: 2, signer: userAddress } }));
    showNotification("⛽ Estimating gas...", "info");
}

async function removeSong(songSCID) {
    if (!epochVerified || !isConnected) {
        showNotification("Complete EPOCH verification first.", "error");
        return;
    }
    const norm = normalizeSongId(songSCID);
    if (!norm.ok) {
        showNotification(norm.error, "error");
        return;
    }
    const ok = await plConfirm("Remove this song from the registry? Only the artist who published it or the contract owner can do this.");
    if (!ok) return;

    const scRpc = [
        { name: "entrypoint", datatype: "S", value: "RemoveSong" },
        { name: "songSCID", datatype: "S", value: norm.value }
    ];
    const gasRpc = [
        ...scRpc,
        { name: "SC_ACTION", datatype: "U", value: 0 },
        { name: "SC_ID", datatype: "H", value: registryScid }
    ];
    const gasId = "gas_rm_" + Date.now();
    _pendingGasCallbacks[gasId] = (result, error) => {
        delete _pendingGasCallbacks[gasId];
        let fees = 2000;
        if (result && result.gasstorage > 0) {
            fees = Math.max(Math.ceil(result.gasstorage * 2), 1000);
            console.log("⛽ RemoveSong gas — storage:", result.gasstorage, "→ fees:", fees);
        }
        sendRequest("transfer", { scid: registryScid, sc_id: registryScid, ringsize: 2, fees: fees, sc_rpc: scRpc });
        showNotification("⚡ Switch to Engram — approve the removal", "info");
    };
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: gasId, method: "DERO.GetGasEstimate", params: { sc_rpc: gasRpc, ringsize: 2, signer: userAddress } }));
    showNotification("⛽ Estimating gas...", "info");
}

// Donate DERO to artist
async function donateSong(songSCID, artistName) {
    if (!epochVerified || !isConnected) {
        showNotification("Complete EPOCH verification first", "error");
        return;
    }
    const norm = normalizeSongId(songSCID);
    if (!norm.ok) { showNotification(norm.error, "error"); return; }
    const amountStr = await plPrompt(`Donate DERO to ${artistName || "this artist"}`, "1");
    if (!amountStr || !amountStr.trim()) return;
    const amountFloat = parseFloat(amountStr.trim());
    if (isNaN(amountFloat) || amountFloat <= 0) { showNotification("Enter a valid amount", "error"); return; }
    const amountAtomic = Math.round(amountFloat * 100000);

    const scRpc = [
        { name: "entrypoint", datatype: "S", value: "Donate" },
        { name: "songSCID", datatype: "S", value: norm.value }
    ];
    const gasRpc = [
        ...scRpc,
        { name: "SC_ACTION", datatype: "U", value: 0 },
        { name: "SC_ID", datatype: "H", value: registryScid }
    ];
    const gasId = "gas_donate_" + Date.now();
    _pendingGasCallbacks[gasId] = (result, error) => {
        delete _pendingGasCallbacks[gasId];
        let fees = 2000;
        if (result && result.gasstorage > 0) {
            fees = Math.max(Math.ceil(result.gasstorage * 2), 1000);
        }
        sendRequest("transfer", {
            scid: registryScid, sc_id: registryScid, ringsize: 2, fees: fees,
            transfers: [{ scid: "0000000000000000000000000000000000000000000000000000000000000000", burn: amountAtomic }],
            sc_rpc: scRpc
        });
        showNotification(`Approve ${amountFloat} DERO donation in Engram`, "info");
    };
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: gasId, method: "DERO.GetGasEstimate", params: { transfers: [{ scid: registryScid, amount: amountAtomic }], sc_rpc: gasRpc, ringsize: 2, signer: userAddress } }));
    showNotification("Estimating gas...", "info");
}

// Record hashes on-chain for a single song
function recordHashesOnChain(songSCID, amount) {
    if (!epochVerified || !isConnected || !socket || socket.readyState !== WebSocket.OPEN) return;
    if (!amount || amount <= 0) return;
    const norm = normalizeSongId(songSCID);
    if (!norm.ok) return;
    const scRpc = [
        { name: "entrypoint", datatype: "S", value: "RecordHashes" },
        { name: "songSCID", datatype: "S", value: norm.value },
        { name: "amount", datatype: "U", value: amount }
    ];
    const gasRpc = [
        ...scRpc,
        { name: "SC_ACTION", datatype: "U", value: 0 },
        { name: "SC_ID", datatype: "H", value: registryScid }
    ];
    const gasId = "gas_hash_" + Date.now();
    _pendingGasCallbacks[gasId] = (result, error) => {
        delete _pendingGasCallbacks[gasId];
        let fees = 1000;
        if (result && result.gasstorage > 0) {
            fees = Math.max(Math.ceil(result.gasstorage * 2), 500);
        }
        sendRequest("transfer", { scid: registryScid, sc_id: registryScid, ringsize: 2, fees: fees, sc_rpc: scRpc });
        console.log(`[RecordHashes] ${amount} hashes for ${norm.value.substring(0, 12)}...`);
    };
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: gasId, method: "DERO.GetGasEstimate", params: { sc_rpc: gasRpc, ringsize: 2, signer: userAddress } }));
}

// Flush all accumulated hashes to chain (called once before disconnect)
function flushHashAccumulator() {
    const entries = Object.entries(_hashAccumulator);
    if (entries.length === 0) return;
    let total = 0;
    entries.forEach(([scid, amount]) => {
        if (amount > 0) {
            recordHashesOnChain(scid, amount);
            total += amount;
        }
    });
    Object.keys(_hashAccumulator).forEach(k => delete _hashAccumulator[k]);
    if (total > 0) console.log(`[FlushHashes] Submitted ${total} total hashes across ${entries.length} song(s)`);
}

// Demo song placeholder (Pixi.exe) - used when registry is empty
function getDemoSongHtml() {
    const artwork = resolveMediaUrl("bafybeieqp3vmodc6uevywxgrruedji4bjq7fo2dgdxaid777hzwvox7fqa");
    const audio = resolveMediaUrl("bafybeia3lsbqkt5vhpjpooxjiaaox3ce26mbkakvf5wwjehsls5gfp6auu");
    const artistAddr = "dero1qygfgg5hq4fracps4q8cxwzvyjvmh85kewfwc75nxnfpg6grsr4nyqqket86l";
    return `
<div class="song-card song-card-demo">
    <div class="song-artwork">
        <img src="${artwork}" alt="Pixi.exe artwork">
    </div>
    <div class="song-info">
        <h3 class="song-title">Demo Track</h3>
        <p class="artist-name">Pixi.exe</p>
        <div class="song-tags">
            <span class="tag">Demo</span>
        </div>
    </div>
    <div class="player-section">
        <audio class="audio-player" id="player-demo" controls>
            <source src="${audio}" type="audio/mpeg">
            Your browser does not support audio playback.
        </audio>
    </div>
    <div class="mining-section">
        <button class="mine-btn" style="display:none"
                data-artist="${artistAddr}"
                data-song-id="demo"
                data-hashes="${MINE_HASHES_PER_TICK}"
                data-song-name="Demo Track"></button>
        <div class="song-actions">
            <button class="upvote-btn button-ghost" data-song-scid="">👍 Upvote</button>
        </div>
        <div class="mining-stats">
            <div class="stat">
                <span class="stat-label">Session:</span>
                <span class="stat-value" id="demo-session">0 hashes</span>
            </div>
        </div>
    </div>
</div>`;
}

function _updateMediaSession(card, audioEl) {
    if (!("mediaSession" in navigator)) return;
    const title = card?.querySelector(".song-title")?.textContent || "DeroBeats";
    const artist = card?.querySelector(".artist-name")?.textContent || "";
    const artImg = card?.querySelector(".song-artwork img");
    const artSrc = artImg?.src || "";
    navigator.mediaSession.metadata = new MediaMetadata({
        title, artist, album: "DeroBeats",
        artwork: artSrc ? [{ src: artSrc, sizes: "512x512", type: "image/png" }] : []
    });
    navigator.mediaSession.setActionHandler("play", () => audioEl.play());
    navigator.mediaSession.setActionHandler("pause", () => audioEl.pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => {
        const players = Array.from(document.querySelectorAll("audio"));
        const idx = players.indexOf(audioEl);
        const next = players[idx + 1];
        if (next) next.play().catch(() => {});
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
        const players = Array.from(document.querySelectorAll("audio"));
        const idx = players.indexOf(audioEl);
        const prev = players[idx - 1];
        if (prev) prev.play().catch(() => {});
    });
}

// Attach click handlers for upvote, remove, continuous mine-while-playing, and auto-advance
function attachSongEventHandlers(container) {
    if (!container) return;

    const allPlayers = Array.from(container.querySelectorAll("audio"));

    allPlayers.forEach((player, idx) => {
        const card = player.closest(".song-card");
        const mineBtn = card?.querySelector(".mine-btn");
        const artistAddr = mineBtn?.dataset.artist || "";
        const songId = mineBtn?.dataset.songId || "";
        const songName = mineBtn?.dataset.songName || "";
        const songScid = mineBtn?.dataset.songScid || "";

        player.addEventListener("play", function () {
            document.querySelectorAll("audio").forEach(other => {
                if (other !== this && !other.paused) other.pause();
            });
            if (isConnected && epochVerified && artistAddr && artistAddr !== "YOUR_DERO_ADDRESS_HERE") {
                startContinuousMining(this, artistAddr, songId, songName, songScid);
            }
            _updateMediaSession(card, this);
        });

        player.addEventListener("pause", function () {
            stopContinuousMining(this);
        });

        player.addEventListener("ended", function () {
            stopContinuousMining(this);
            if (_activePlaylistId) {
                const plPlayers = Array.from(document.querySelectorAll(".playlist-song-item audio"));
                const plIdx = plPlayers.indexOf(this);
                const next = plPlayers[plIdx + 1];
                if (next) next.play().catch(() => {});
            } else {
                const next = allPlayers[idx + 1];
                if (next) next.play().catch(() => {});
            }
        });
    });

    container.querySelectorAll(".upvote-btn").forEach(btn => {
        btn.addEventListener("click", function() {
            upvoteSong(this.dataset.songScid);
        });
    });
    container.querySelectorAll(".remove-btn").forEach(btn => {
        btn.addEventListener("click", function() {
            removeSong(this.dataset.songScid);
        });
    });
    container.querySelectorAll(".donate-btn").forEach(btn => {
        btn.addEventListener("click", function() {
            donateSong(this.dataset.songScid, this.dataset.artistName);
        });
    });
    container.querySelectorAll(".playlist-add-btn").forEach(btn => {
        btn.addEventListener("click", function(e) {
            e.stopPropagation();
            showPlaylistContextMenu(this, this.dataset.songId);
        });
    });
}

// Load songs from registry — Gnomon (Engram) or telaHost.getSmartContract (Tela)
async function loadSongsFromRegistry() {
    if (isTela) {
        try {
            const sc = await telaHost.getSmartContract(registryScid);
            const allVariables = [];
            if (sc.stringkeys) {
                for (const [k, v] of Object.entries(sc.stringkeys)) {
                    // Daemon returns string values hex-encoded; decode them
                    allVariables.push({ Key: k, Value: typeof v === 'string' ? decodeHexString(v) : v });
                }
            }
            if (sc.uint64keys) {
                for (const [k, v] of Object.entries(sc.uint64keys)) {
                    allVariables.push({ Key: k, Value: v });
                }
            }
            console.log("📀 Tela getSmartContract: " + allVariables.length + " keys");
            renderSongsFromRegistry(allVariables);
        } catch (err) {
            console.error("📀 Tela getSmartContract error:", err);
            showNotification("Failed to load registry: " + (err?.message || err), "error");
        }
        return;
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    sendRequest("Gnomon.GetAllSCIDVariableDetails", { scid: registryScid });
}

// Parse Gnomon variables and render song cards dynamically
function renderSongsFromRegistry(allVariables) {
    if (!allVariables || !Array.isArray(allVariables)) {
        console.warn("📀 renderSongsFromRegistry: invalid allVariables", allVariables);
        return;
    }

    const vars = {};
    for (const v of allVariables) {
        const k = (v.Key !== undefined ? v.Key : v.key);
        let val = (v.Value !== undefined ? v.Value : v.value);
        if (k != null) vars[String(k)] = val;
    }

    const total = parseInt(vars["total_songs"], 10) || 0;

    // Auto-detect hex-encoded values: if song_0 exists and is 128 hex chars, decode all string values
    const song0 = vars["song_0"];
    if (song0 && typeof song0 === 'string' && song0.length === 128 && /^[0-9a-fA-F]+$/.test(song0)) {
        console.log("📀 Detected hex-encoded values, decoding...");
        for (const k of Object.keys(vars)) {
            if (typeof vars[k] === 'string') vars[k] = decodeHexString(vars[k]);
        }
    }

    const keySample = Object.keys(vars).slice(0, 20).join(", ");
    console.log("📀 Registry data: total_songs=" + total + ", key count=" + Object.keys(vars).length + ", sample: " + keySample);

    const grid = document.getElementById("tracksGrid");
    if (!grid) return;

    if (total === 0) {
        console.log("📀 Registry has no songs yet (total_songs=0), showing demo");
        grid.innerHTML = getDemoSongHtml();
        attachSongEventHandlers(grid);
        const el = document.getElementById("songsAvailable");
        if (el) el.textContent = "0";
        showNotification("Refreshed. Registry shows 0 songs — indexing may be in progress.", "info");
        return;
    }

    const songs = [];
    for (let i = 0; i < total; i++) {
        const songId = vars["song_" + i];
        if (!songId || String(songId).length !== 64) {
            if (total > 0 && i === 0) console.warn("📀 Skipped song_" + i + ": missing or invalid (len=" + (songId ? String(songId).length : "null") + ")");
            continue;
        }
        const sid = String(songId);
        if (vars[sid + "_removed"]) continue;

        const title = vars[sid + "_title"] || "Unknown";
        const artist = vars[sid + "_artist"] || "Unknown";
        const genreRaw = vars[sid + "_genre"] || "Unknown";
        const genre = _genreDisplayMap[genreRaw.toLowerCase()] || genreRaw;
        const ipfsHash = vars[sid + "_ipfs"] || "";
        const upvotes = parseInt(vars[sid + "_upvotes"], 10) || 0;
        const artistAddr = vars[sid + "_artist_addr"] || "";
        const previewArtCid = vars[sid + "_preview_art_cid"] || "";
        const duration = vars[sid + "_duration"] || "";
        const totalHashes = parseInt(vars[sid + "_hashes"], 10) || 0;
        const donations = parseInt(vars[sid + "_donations"], 10) || 0;
        const donatedDero = parseInt(vars[sid + "_donated_dero"], 10) || 0;

        if (!ipfsHash) {
            if (total > 0 && songs.length === 0) console.warn("📀 Skipped song (no ipfs): sid=" + sid.slice(0, 8) + "..., title=" + title);
            continue;
        }

        songs.push({
            songId: sid,
            title: String(title),
            artist: String(artist),
            genre: String(genre),
            ipfsHash: String(ipfsHash),
            upvotes,
            artistAddr: String(artistAddr),
            previewArtCid: String(previewArtCid),
            duration: String(duration),
            totalHashes,
            donations,
            donatedDero
        });
    }

    showNotification("Refreshed! " + songs.length + " song" + (songs.length === 1 ? "" : "s") + " loaded.", "success");

    _loadedSongs = songs;
    renderSortedSongs();
    console.log(`📀 Loaded ${songs.length} songs from registry`);
}

function renderSortedSongs(filterValue) {
    const grid = document.getElementById("tracksGrid");
    if (!grid || !_loadedSongs.length) return;

    if (filterValue !== undefined) _currentFilter = filterValue;

    let sorted = [..._loadedSongs];

    if (_currentFilter && _currentFilter.startsWith("genre:")) {
        const g = _currentFilter.slice(6);
        sorted = sorted.filter(s => s.genre.toLowerCase() === g.toLowerCase());
    } else if (_currentFilter && _currentFilter.startsWith("artist:")) {
        const a = _currentFilter.slice(7);
        sorted = sorted.filter(s => s.artist.toLowerCase() === a.toLowerCase());
    }

    if (_currentSort === "top") {
        sorted.sort((a, b) => b.upvotes - a.upvotes);
    } else if (_currentSort === "mostplayed") {
        sorted.sort((a, b) => (b.totalHashes || 0) - (a.totalHashes || 0));
    } else if (_currentSort === "newest") {
        sorted.sort((a, b) => {
            const idxA = _loadedSongs.indexOf(a);
            const idxB = _loadedSongs.indexOf(b);
            return idxB - idxA;
        });
    } else if (_currentSort === "az") {
        sorted.sort((a, b) => a.title.localeCompare(b.title));
    }

    const paginated = sorted.slice(0, _visibleCount);

    grid.innerHTML = paginated.map((s, idx) => {
        const audioUrl = resolveMediaUrl(s.ipfsHash);
        const artCid = s.previewArtCid || "";
        const artworkSrc = artCid ? resolveMediaUrl(artCid) : DEFAULT_ART_LOCAL;
        const playerId = "player-reg-" + idx;
        const durationTag = s.duration && parseInt(s.duration, 10) > 0 ? `<span class="tag">${formatDuration(s.duration)}</span>` : "";
        return `
<div class="song-card" data-dynamic="true">
    <div class="song-artwork">
        <img src="${escapeHtml(artworkSrc)}" alt="${escapeHtml(s.title)} artwork" ${artCid && !isDirectUrl(artCid) ? `data-cid="${escapeHtml(artCid)}" onerror="tryNextGateway(this,'${escapeHtml(artCid)}',false)"` : ""}>
    </div>
    <div class="song-info">
        <h3 class="song-title">${escapeHtml(s.title)}</h3>
        <p class="artist-name">${escapeHtml(s.artist)}</p>
        <div class="song-tags">
            <span class="tag">${escapeHtml(s.genre)}</span>
            ${durationTag}
            ${s.upvotes > 0 ? `<span class="tag">👍 ${s.upvotes}</span>` : ""}
        </div>
    </div>
    <div class="player-section">
        <audio class="audio-player" id="${playerId}" controls data-cid="${escapeHtml(s.ipfsHash)}">
            <source src="${escapeHtml(audioUrl)}" type="audio/mpeg" ${isDirectUrl(s.ipfsHash) ? "" : `onerror="tryNextGateway(this.parentElement,'${escapeHtml(s.ipfsHash)}',true)"`}>
        </audio>
    </div>
    <div class="mining-section">
        <button class="mine-btn" style="display:none"
                data-artist="${escapeHtml(s.artistAddr)}"
                data-song-id="reg-${idx}"
                data-song-scid="${s.songId}"
                data-hashes="${MINE_HASHES_PER_TICK}"
                data-song-name="${escapeHtml(s.title)}"></button>
        <div class="song-actions">
            <button class="playlist-add-btn" data-song-id="${s.songId}" title="Add to playlist">+</button>
            <button class="upvote-btn button-ghost" data-song-scid="${s.songId}">👍 Upvote</button>
            <button class="donate-btn button-ghost" data-song-scid="${s.songId}" data-artist-name="${escapeHtml(s.artist)}" title="Donate DERO to artist">Donate</button>
            <button class="remove-btn button-ghost" data-song-scid="${s.songId}" title="Remove song (artist or owner)">🗑️ Remove</button>
        </div>
        <div class="mining-stats">
            <div class="stat">
                <span class="stat-label">Session:</span>
                <span class="stat-value" id="reg-${idx}-session">0 hashes</span>
            </div>
            ${s.totalHashes > 0 ? `<div class="stat"><span class="stat-label">Plays:</span><span class="stat-value">${Number(s.totalHashes).toLocaleString()} hashes</span></div>` : ""}
            ${s.donations > 0 ? `<div class="stat"><span class="stat-label">Tips:</span><span class="stat-value">${s.donations}${s.donatedDero > 0 ? ` (${(s.donatedDero / 100000).toFixed(1)} DERO)` : ""}</span></div>` : ""}
        </div>
    </div>
</div>`;
    }).join("");

    if (sorted.length > _visibleCount) {
        grid.insertAdjacentHTML("beforeend", `<div class="show-more-wrap"><button class="show-more-btn" id="showMoreBtn">Show More (${sorted.length - _visibleCount} remaining)</button></div>`);
        document.getElementById("showMoreBtn")?.addEventListener("click", function () {
            _visibleCount += _songsPerPage;
            renderSortedSongs();
        });
    }

    attachSongEventHandlers(grid);
    updateOnChainStats();
    updateFilterDropdowns();
}

function updateFilterDropdowns() {
    const genreSelect = document.getElementById("filterGenre");
    const artistSelect = document.getElementById("filterArtist");
    if (!genreSelect || !artistSelect) return;

    const genres = [...new Set(_loadedSongs.map(s => s.genre).filter(g => g && g !== "Unknown"))].sort();
    const artists = [...new Set(_loadedSongs.map(s => s.artist).filter(a => a && a !== "Unknown"))].sort();

    const currentGenre = genreSelect.value;
    const currentArtist = artistSelect.value;

    genreSelect.innerHTML = '<option value="">All Genres</option>' + genres.map(g => `<option value="genre:${escapeHtml(g)}"${currentGenre === "genre:" + g ? " selected" : ""}>${escapeHtml(g)}</option>`).join("");
    artistSelect.innerHTML = '<option value="">All Artists</option>' + artists.map(a => `<option value="artist:${escapeHtml(a)}"${currentArtist === "artist:" + a ? " selected" : ""}>${escapeHtml(a)}</option>`).join("");
}

// ═══ SHARED MODAL — single delegated handler, zero per-button wiring ═══
let _modalResolve = null;
let _modalMode = null; // "confirm" or "prompt"

function _initModalDelegation() {
    const overlay = document.getElementById("plModalOverlay");
    if (!overlay || overlay._delegated) return;
    overlay._delegated = true;

    overlay.addEventListener("click", (e) => {
        if (!_modalResolve) return;
        const t = e.target;
        if (t.id === "plModalOk" || t.closest("#plModalOk")) {
            _resolveModal(_modalMode === "prompt"
                ? document.getElementById("plModalInput").value
                : true);
        } else if (t.id === "plModalCancel" || t.closest("#plModalCancel") ||
                   t.id === "plModalClose" || t.closest("#plModalClose")) {
            _resolveModal(_modalMode === "prompt" ? null : false);
        } else if (t === overlay) {
            _resolveModal(_modalMode === "prompt" ? null : false);
        }
    });

    document.addEventListener("keydown", (e) => {
        if (!_modalResolve) return;
        if (e.key === "Enter") {
            e.preventDefault();
            _resolveModal(_modalMode === "prompt"
                ? document.getElementById("plModalInput").value
                : true);
        } else if (e.key === "Escape") {
            _resolveModal(_modalMode === "prompt" ? null : false);
        }
    });
}

function _resolveModal(value) {
    const fn = _modalResolve;
    if (!fn) return;
    _modalResolve = null;
    _modalMode = null;
    const overlay = document.getElementById("plModalOverlay");
    const inp = document.getElementById("plModalInput");
    const okBtn = document.getElementById("plModalOk");
    if (overlay) overlay.classList.remove("show");
    if (inp) inp.style.display = "";
    if (okBtn) okBtn.textContent = "OK";
    fn(value);
}

// ═══ STYLED CONFIRM ═══
function plConfirm(message) {
    _initModalDelegation();
    if (_modalResolve) _resolveModal(false);
    return new Promise(resolve => {
        _modalResolve = resolve;
        _modalMode = "confirm";
        const overlay = document.getElementById("plModalOverlay");
        const inp = document.getElementById("plModalInput");
        const titleEl = document.getElementById("plModalTitle");
        const okBtn = document.getElementById("plModalOk");
        if (!overlay) { resolve(confirm(message)); return; }
        if (titleEl) titleEl.textContent = message;
        if (inp) inp.style.display = "none";
        if (okBtn) okBtn.textContent = "Confirm";
        overlay.classList.add("show");
    });
}

// ═══ PLAYLIST PROMPT ═══
function plPrompt(title, defaultVal) {
    _initModalDelegation();
    if (_modalResolve) _resolveModal(null);
    return new Promise(resolve => {
        _modalResolve = resolve;
        _modalMode = "prompt";
        const overlay = document.getElementById("plModalOverlay");
        const inp = document.getElementById("plModalInput");
        const titleEl = document.getElementById("plModalTitle");
        if (!overlay) { resolve(prompt(title, defaultVal || "")); return; }
        if (titleEl) titleEl.textContent = title;
        if (inp) { inp.value = defaultVal || ""; inp.focus(); }
        overlay.classList.add("show");
    });
}

// ═══ PLAYLIST CRUD (LocalStorage) ═══
function loadPlaylists() {
    try { _playlists = JSON.parse(localStorage.getItem("derobeats_playlists") || "[]"); }
    catch (_) { _playlists = []; }
    return _playlists;
}
function savePlaylists() {
    localStorage.setItem("derobeats_playlists", JSON.stringify(_playlists));
}
function createPlaylist(name) {
    const pl = { id: "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name || "New Playlist", artworkCid: "", songIds: [], created: Date.now(), updated: Date.now() };
    _playlists.push(pl);
    savePlaylists();
    return pl;
}
function renamePlaylist(id, name) {
    const pl = _playlists.find(p => p.id === id);
    if (pl) { pl.name = name; pl.updated = Date.now(); savePlaylists(); }
}
function deletePlaylist(id) {
    _playlists = _playlists.filter(p => p.id !== id);
    savePlaylists();
    if (_activePlaylistId === id) exitPlaylistView();
}
function addSongToPlaylist(playlistId, songId) {
    const pl = _playlists.find(p => p.id === playlistId);
    if (pl && !pl.songIds.includes(songId)) { pl.songIds.push(songId); pl.updated = Date.now(); savePlaylists(); }
}
function removeSongFromPlaylist(playlistId, songId) {
    const pl = _playlists.find(p => p.id === playlistId);
    if (pl) { pl.songIds = pl.songIds.filter(s => s !== songId); pl.updated = Date.now(); savePlaylists(); }
}
function reorderPlaylist(id, newSongIds) {
    const pl = _playlists.find(p => p.id === id);
    if (pl) { pl.songIds = newSongIds; pl.updated = Date.now(); savePlaylists(); }
}
function getPlaylistArtwork(pl) {
    if (pl.artworkCid) return resolveMediaUrl(pl.artworkCid);
    if (pl.songIds.length) {
        const first = _loadedSongs.find(s => s.songId === pl.songIds[0]);
        if (first?.previewArtCid) return resolveMediaUrl(first.previewArtCid);
    }
    return DEFAULT_ART_LOCAL;
}
function exportPlaylist(id) {
    const pl = _playlists.find(p => p.id === id);
    if (!pl) return "";
    return btoa(JSON.stringify({ n: pl.name, s: pl.songIds, a: pl.artworkCid || "" }));
}
function importPlaylist(code) {
    try {
        const d = JSON.parse(atob(code));
        if (!d.n || !Array.isArray(d.s)) return null;
        const pl = createPlaylist(d.n);
        pl.songIds = d.s.filter(sid => _loadedSongs.some(s => s.songId === sid));
        pl.artworkCid = d.a || "";
        savePlaylists();
        return pl;
    } catch (_) { return null; }
}

// ═══ PLAYLIST UI ═══
function renderPlaylistBar() {
    const bar = document.getElementById("playlistBar");
    if (!bar) return;
    const sel = bar.querySelector("#playlistSelect");
    if (sel) {
        const cur = sel.value;
        sel.innerHTML = '<option value="">All Tracks</option>' + _playlists.map(p => `<option value="${p.id}"${p.id === _activePlaylistId ? " selected" : ""}>${escapeHtml(p.name)} (${p.songIds.length})</option>`).join("");
        if (cur && !_activePlaylistId) sel.value = "";
    }
    const actions = bar.querySelector(".playlist-active-actions");
    if (actions) actions.style.display = _activePlaylistId ? "flex" : "none";
}

function enterPlaylistView(playlistId) {
    const pl = _playlists.find(p => p.id === playlistId);
    if (!pl) return;
    _activePlaylistId = playlistId;
    if (_activeTab !== "playlists") switchTab("playlists");
    _showGrid("playlists");
    renderPlaylistBar();
    renderPlaylistSongs(pl);
}

function exitPlaylistView() {
    _activePlaylistId = null;
    const sel = document.getElementById("playlistSelect");
    if (sel) sel.value = "";
    renderPlaylistBar();
    if (_activeTab === "tracks") {
        _showGrid("tracks");
    } else {
        const grid = document.getElementById("playlistsGrid");
        if (grid) grid.innerHTML = `<div class="songs-grid-empty"><p>Select or create a playlist above.</p></div>`;
    }
}

function renderPlaylistSongs(pl) {
    const grid = document.getElementById("playlistsGrid");
    if (!grid) return;

    const songs = pl.songIds.map(sid => _loadedSongs.find(s => s.songId === sid)).filter(Boolean);
    const artSrc = getPlaylistArtwork(pl);

    let html = `<div class="playlist-header-card">
        <div class="playlist-header-art" title="Click to change artwork"><img src="${escapeHtml(artSrc)}" alt="Playlist artwork" id="playlistHeaderArtImg"></div>
        <div class="playlist-header-info">
            <h3 class="playlist-header-name" id="playlistHeaderName">${escapeHtml(pl.name)}</h3>
            <p class="playlist-header-meta">${songs.length} track${songs.length !== 1 ? "s" : ""}</p>
            <div class="playlist-header-btns">
                <button class="playlist-action-btn" id="plPlayAllBtn" title="Play all">&#9654; Play All</button>
                <button class="playlist-action-btn" id="plShareBtn" title="Share playlist">Share</button>
                <button class="playlist-action-btn" id="plRenameBtn" title="Rename">Rename</button>
                <button class="playlist-action-btn playlist-action-btn--danger" id="plDeleteBtn" title="Delete playlist">Delete</button>
                <button class="playlist-action-btn" id="plBackBtn" title="Back to all tracks">&larr; All Tracks</button>
            </div>
        </div>
    </div>`;

    if (!songs.length) {
        html += `<p class="playlist-empty-msg">No tracks yet. Use the + button on any song to add it here.</p>`;
    }

    html += songs.map((s, idx) => {
        const audioUrl = resolveMediaUrl(s.ipfsHash);
        const artCid = s.previewArtCid || "";
        const artworkSrc = artCid ? resolveMediaUrl(artCid) : DEFAULT_ART_LOCAL;
        const playerId = "player-pl-" + idx;
        return `<div class="playlist-song-item" draggable="true" data-song-id="${s.songId}" data-pl-idx="${idx}">
    <span class="playlist-drag-handle" title="Drag to reorder">&#9776;</span>
    <img class="playlist-song-thumb" src="${escapeHtml(artworkSrc)}" alt="" ${artCid && !isDirectUrl(artCid) ? `data-cid="${escapeHtml(artCid)}" onerror="tryNextGateway(this,'${escapeHtml(artCid)}',false)"` : ""}>
    <div class="playlist-song-info">
        <span class="playlist-song-title">${escapeHtml(s.title)}</span>
        <span class="playlist-song-artist">${escapeHtml(s.artist)}</span>
    </div>
    <audio class="audio-player playlist-audio" id="${playerId}" controls data-cid="${escapeHtml(s.ipfsHash)}">
        <source src="${escapeHtml(audioUrl)}" type="audio/mpeg" ${isDirectUrl(s.ipfsHash) ? "" : `onerror="tryNextGateway(this.parentElement,'${escapeHtml(s.ipfsHash)}',true)"`}>
    </audio>
    <button class="mine-btn" style="display:none" data-artist="${escapeHtml(s.artistAddr)}" data-song-id="pl-${idx}" data-song-scid="${s.songId}" data-hashes="${MINE_HASHES_PER_TICK}" data-song-name="${escapeHtml(s.title)}"></button>
    <button class="playlist-remove-song-btn" data-song-id="${s.songId}" title="Remove from playlist">&times;</button>
</div>`;
    }).join("");

    grid.innerHTML = html;

    // Wire playlist header buttons
    document.getElementById("plPlayAllBtn")?.addEventListener("click", () => {
        const first = grid.querySelector("audio");
        if (first) first.play().catch(() => {});
    });
    document.getElementById("plShareBtn")?.addEventListener("click", () => {
        const code = exportPlaylist(pl.id);
        if (code) { navigator.clipboard.writeText(code).then(() => showNotification("Playlist code copied to clipboard", "success")).catch(() => {}); }
    });
    document.getElementById("plRenameBtn")?.addEventListener("click", async () => {
        const newName = await plPrompt("Rename playlist", pl.name);
        if (newName && newName.trim()) { renamePlaylist(pl.id, newName.trim()); renderPlaylistBar(); renderPlaylistSongs(_playlists.find(p => p.id === pl.id)); }
    });
    document.getElementById("plDeleteBtn")?.addEventListener("click", () => {
        plConfirm(`Delete "${pl.name}"?`).then(ok => { if (ok) deletePlaylist(pl.id); });
    });
    document.getElementById("plBackBtn")?.addEventListener("click", exitPlaylistView);

    // Wire artwork click
    document.querySelector(".playlist-header-art")?.addEventListener("click", async () => {
        const cid = await plPrompt("Paste an IPFS CID for artwork (empty = auto)", pl.artworkCid || "");
        if (cid !== null) { pl.artworkCid = cid.trim(); pl.updated = Date.now(); savePlaylists(); renderPlaylistSongs(pl); }
    });

    // Wire remove-from-playlist buttons
    grid.querySelectorAll(".playlist-remove-song-btn").forEach(btn => {
        btn.addEventListener("click", function () {
            removeSongFromPlaylist(pl.id, this.dataset.songId);
            renderPlaylistSongs(_playlists.find(p => p.id === pl.id));
            renderPlaylistBar();
        });
    });

    // Drag-to-reorder
    let _dragIdx = null;
    grid.querySelectorAll(".playlist-song-item").forEach(item => {
        item.addEventListener("dragstart", function (e) {
            _dragIdx = parseInt(this.dataset.plIdx);
            this.classList.add("dragging");
            e.dataTransfer.effectAllowed = "move";
        });
        item.addEventListener("dragend", function () { this.classList.remove("dragging"); });
        item.addEventListener("dragover", function (e) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; this.classList.add("drag-over"); });
        item.addEventListener("dragleave", function () { this.classList.remove("drag-over"); });
        item.addEventListener("drop", function (e) {
            e.preventDefault();
            this.classList.remove("drag-over");
            const dropIdx = parseInt(this.dataset.plIdx);
            if (_dragIdx === null || _dragIdx === dropIdx) return;
            const ids = [...pl.songIds];
            const [moved] = ids.splice(_dragIdx, 1);
            ids.splice(dropIdx, 0, moved);
            reorderPlaylist(pl.id, ids);
            renderPlaylistSongs(_playlists.find(p => p.id === pl.id));
        });
    });

    attachSongEventHandlers(grid);
}

// "+" add-to-playlist context menu
function showPlaylistContextMenu(btn, songId) {
    document.querySelectorAll(".playlist-context-menu").forEach(m => m.remove());
    if (!_playlists.length) {
        const pl = createPlaylist("My Playlist");
        addSongToPlaylist(pl.id, songId);
        renderPlaylistBar();
        showNotification(`Added to "${pl.name}"`, "success");
        return;
    }
    const menu = document.createElement("div");
    menu.className = "playlist-context-menu";
    menu.innerHTML = _playlists.map(p => {
        const has = p.songIds.includes(songId);
        return `<label class="playlist-ctx-item"><input type="checkbox" data-pl-id="${p.id}" ${has ? "checked" : ""}> ${escapeHtml(p.name)}</label>`;
    }).join("") + `<button class="playlist-ctx-new">+ New Playlist</button>`;
    btn.closest(".song-actions")?.appendChild(menu);

    menu.querySelectorAll("input[type=checkbox]").forEach(cb => {
        cb.addEventListener("change", function () {
            if (this.checked) addSongToPlaylist(this.dataset.plId, songId);
            else removeSongFromPlaylist(this.dataset.plId, songId);
            renderPlaylistBar();
        });
    });
    menu.querySelector(".playlist-ctx-new")?.addEventListener("click", async () => {
        menu.remove();
        const name = await plPrompt("New playlist name");
        if (name && name.trim()) {
            const pl = createPlaylist(name.trim());
            addSongToPlaylist(pl.id, songId);
            renderPlaylistBar();
            showNotification(`Added to "${pl.name}"`, "success");
        }
    });

    const dismiss = (e) => { if (!menu.contains(e.target) && e.target !== btn) { menu.remove(); document.removeEventListener("click", dismiss); } };
    setTimeout(() => document.addEventListener("click", dismiss), 0);
}

function initPlaylistControls() {
    loadPlaylists();
    renderPlaylistBar();

    document.getElementById("playlistSelect")?.addEventListener("change", function () {
        if (this.value) enterPlaylistView(this.value);
        else exitPlaylistView();
    });
    document.getElementById("newPlaylistBtn")?.addEventListener("click", async () => {
        const name = await plPrompt("New playlist name");
        if (name && name.trim()) {
            const pl = createPlaylist(name.trim());
            renderPlaylistBar();
            enterPlaylistView(pl.id);
        }
    });
    document.getElementById("importPlaylistBtn")?.addEventListener("click", async () => {
        const code = await plPrompt("Paste a playlist share code");
        if (code && code.trim()) {
            const pl = importPlaylist(code.trim());
            if (pl) { renderPlaylistBar(); enterPlaylistView(pl.id); showNotification(`Imported "${pl.name}"`, "success"); }
            else showNotification("Invalid playlist code", "error");
        }
    });

    // Auto-import from URL hash
    if (location.hash.startsWith("#playlist=")) {
        const code = location.hash.slice(10);
        if (code) {
            setTimeout(() => {
                const pl = importPlaylist(code);
                if (pl) { renderPlaylistBar(); enterPlaylistView(pl.id); showNotification(`Imported "${pl.name}"`, "success"); history.replaceState({}, "", location.pathname + location.search); }
            }, 2000);
        }
    }
}

let _activeTab = "tracks";

function _showGrid(which) {
    const tg = document.getElementById("tracksGrid");
    const pg = document.getElementById("playlistsGrid");
    if (tg) tg.style.display = which === "tracks" ? "" : "none";
    if (pg) pg.style.display = which === "playlists" ? "" : "none";
}

function _hasPlayingAudio(container) {
    if (!container) return false;
    return Array.from(container.querySelectorAll("audio")).some(a => !a.paused && !a.ended);
}

function switchTab(tab) {
    _activeTab = tab;
    document.querySelectorAll(".section-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
    const sortBar = document.getElementById("sortFilterBar");
    const plBar = document.getElementById("playlistBar");
    if (tab === "tracks") {
        if (sortBar) sortBar.style.display = "";
        if (plBar) plBar.style.display = "none";
        _activePlaylistId = null;
        const sel = document.getElementById("playlistSelect");
        if (sel) sel.value = "";
        renderPlaylistBar();
        _showGrid("tracks");
    } else {
        if (sortBar) sortBar.style.display = "none";
        if (plBar) plBar.style.display = "";
        const sel = document.getElementById("playlistSelect");
        if (sel && sel.value) {
            _showGrid("playlists");
            enterPlaylistView(sel.value);
        } else {
            const grid = document.getElementById("playlistsGrid");
            if (grid && !_hasPlayingAudio(grid)) {
                grid.innerHTML = `<div class="songs-grid-empty"><p>Select or create a playlist above.</p></div>`;
            }
            _showGrid("playlists");
        }
    }
}

function initSectionTabs() {
    document.querySelectorAll(".section-tab").forEach(tab => {
        tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    });
}

function initSortFilterControls() {
    initSectionTabs();

    document.querySelectorAll(".sort-btn").forEach(btn => {
        btn.addEventListener("click", function () {
            document.querySelectorAll(".sort-btn").forEach(b => b.classList.remove("active"));
            this.classList.add("active");
            _currentSort = this.dataset.sort;
            _visibleCount = _songsPerPage;
            renderSortedSongs();
        });
    });

    const genreSelect = document.getElementById("filterGenre");
    const artistSelect = document.getElementById("filterArtist");

    if (genreSelect) genreSelect.addEventListener("change", function () {
        if (artistSelect) artistSelect.value = "";
        _visibleCount = _songsPerPage;
        renderSortedSongs(this.value);
    });

    if (artistSelect) artistSelect.addEventListener("change", function () {
        if (genreSelect) genreSelect.value = "";
        _visibleCount = _songsPerPage;
        renderSortedSongs(this.value);
    });
}

function formatDuration(secStr) {
    const sec = parseInt(secStr, 10) || 0;
    if (sec < 1) return "";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ":" + String(s).padStart(2, "0");
}

function escapeHtml(s) {
    if (!s) return "";
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
}

const MINE_INTERVAL_MS = 10000;
const MINE_HASHES_PER_TICK = 1000;

let _continuousMiningActive = false;

function startContinuousMining(audioEl, artistAddr, songId, songName, songScid) {
    stopContinuousMining(audioEl);
    if (!isConnected || !epochVerified) return;

    _continuousMiningActive = true;
    audioEl._pendingHashes = 0;
    audioEl._songScid = songScid || "";
    console.log(`⛏️ Continuous mining started for "${songName}" → ${artistAddr.slice(0, 12)}...`);
    showNotification("⛏️ Mining to the artist", "success");
    startMining(artistAddr, songId, MINE_HASHES_PER_TICK, songName);
    audioEl._pendingHashes += MINE_HASHES_PER_TICK;

    audioEl._mineInterval = setInterval(() => {
        if (audioEl.paused || audioEl.ended) {
            stopContinuousMining(audioEl);
            return;
        }
        startMining(artistAddr, songId, MINE_HASHES_PER_TICK, songName);
        audioEl._pendingHashes += MINE_HASHES_PER_TICK;
    }, MINE_INTERVAL_MS);
}

function stopContinuousMining(audioEl) {
    if (audioEl._mineInterval) {
        clearInterval(audioEl._mineInterval);
        audioEl._mineInterval = null;
    }
    if (audioEl._pendingHashes > 0 && audioEl._songScid) {
        const scid = audioEl._songScid;
        _hashAccumulator[scid] = (_hashAccumulator[scid] || 0) + audioEl._pendingHashes;
        audioEl._pendingHashes = 0;
    }
    _continuousMiningActive = false;
}

// Start mining for an artist
function startMining(artistAddress, songId, hashes, songName) {
    if (!epochVerified) {
        showNotification("⚠️ EPOCH must be verified first. Connect and complete verification.", "error");
        return;
    }
    if (!isConnected) {
        showNotification("⚠️ Please connect your wallet first!", "error");
        return;
    }
    
    console.log(`⛏️ Mining ${hashes} hashes to ${artistAddress} for "${songName}"`);
    
    // Update UI immediately
    const statusElement = document.getElementById(`${songId}-status`);
    const button = document.querySelector(`[data-song-id="${songId}"]`);
    
    if (statusElement) {
        statusElement.textContent = "Mining...";
        statusElement.style.color = "#f5a623";
    }
    
    if (button) {
        button.disabled = true;
        button.textContent = "⛏️ Mining...";
        button.classList.add('mining');
    }
    
    // Send EPOCH request
    sendRequest("AttemptEPOCHWithAddr", {
        address: artistAddress,
        hashes: hashes
    });
    
    // Update UI after expected mining time (rough estimate: 1000 hashes ~= 2 seconds)
    const estimatedTime = (hashes / 500) * 1000; // Adjust based on your hardware
    
    setTimeout(() => {
        if (statusElement) {
            statusElement.textContent = "Complete! ✓";
            statusElement.style.color = "var(--dero-green)";
        }
        
        if (button) {
            button.disabled = false;
            button.textContent = `⛏️ Mine & Support (${hashes} hashes)`;
            button.classList.remove('mining');
        }
        
        // Update session stats
        updateSessionStats(songId, hashes);
        sessionStats.songsSupported.add(songName);
        
        // Reset status after 3 seconds
        setTimeout(() => {
            if (statusElement) statusElement.textContent = "Ready";
        }, 3000);
        
    }, Math.max(estimatedTime, 2000));
}

function updateSessionStats(songId, hashes) {
    const sessionElement = document.getElementById(`${songId}-session`);
    if (sessionElement) {
        const current = parseInt(sessionElement.textContent) || 0;
        sessionElement.textContent = `${current + hashes} hashes`;
        sessionElement.style.color = "var(--dero-green)";
        sessionElement.style.transform = "scale(1.2)";
        setTimeout(() => {
            sessionElement.style.transform = "scale(1)";
        }, 300);
    }

    const card = document.querySelector(`[data-song-id="${songId}"]`)?.closest(".song-card");
    const scid = card?.querySelector(".upvote-btn")?.dataset.songScid;
    if (scid) {
        _songHashMap[scid] = (_songHashMap[scid] || 0) + hashes;
    }
}

function updateOnChainStats() {
    const songs = _loadedSongs;
    const el = document.getElementById("songsAvailable");
    if (el) el.textContent = String(songs.length);

    const upEl = document.getElementById("totalUpvotes");
    if (upEl) upEl.textContent = String(songs.reduce((sum, s) => sum + (s.upvotes || 0), 0));

    const artEl = document.getElementById("totalArtists");
    if (artEl) artEl.textContent = String(new Set(songs.map(s => s.artist.toLowerCase()).filter(a => a && a !== "unknown")).size);
}

function updateGlobalStats() {
    updateOnChainStats();
    const el = document.getElementById('sessionSupport');
    if (el) el.textContent = sessionStats.totalHashes.toLocaleString();
}

// Save stats to localStorage
function saveStats() {
    localStorage.setItem('derobeats_stats', JSON.stringify({
        totalHashes: sessionStats.totalHashes,
        songsSupported: Array.from(sessionStats.songsSupported)
    }));
}

// Load stats from localStorage
function loadStats() {
    const saved = localStorage.getItem('derobeats_stats');
    if (saved) {
        const data = JSON.parse(saved);
        sessionStats.totalHashes = data.totalHashes || 0;
        sessionStats.songsSupported = new Set(data.songsSupported || []);
        updateGlobalStats();
    }
}

function showNotification(message, type = "info") {
    const slot = document.getElementById('notificationSlot');
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.animation = 'notificationSlideIn 0.3s ease-out';

    (slot || document.body).appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'notificationSlideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}


// Export for debugging
window.derobeats = {
    connect: connectWallet,
    disconnect: disconnectWallet,
    sendRequest: sendRequest,
    isConnected: () => isConnected,
    getAddress: () => userAddress,
    getStats: () => sessionStats,
    clearStats: () => {
        sessionStats = { totalHashes: 0, songsSupported: new Set() };
        localStorage.removeItem('derobeats_stats');
        updateGlobalStats();
        console.log('Stats cleared!');
    }
};

// Best-effort flush on tab close / navigation
window.addEventListener("beforeunload", () => {
    document.querySelectorAll("audio").forEach(a => stopContinuousMining(a));
    flushHashAccumulator();
});

console.log('🎵 DeroBeats loaded! Debug: window.derobeats');
console.log('⚠️ Remember to:');
console.log('  1. Add your DERO address in index.html');
console.log('  2. Generate unique app ID (line 12)');
console.log('  3. Add your song files!');
