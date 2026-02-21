const CACHE_NAME = "derobeats-ipfs-v2";

const GATEWAYS = [
    "https://gateway.pinata.cloud/ipfs/",
    "https://ipfs.io/ipfs/",
    "https://cloudflare-ipfs.com/ipfs/",
    "https://dweb.link/ipfs/",
    "https://w3s.link/ipfs/",
    "https://4everland.io/ipfs/",
    "https://nftstorage.link/ipfs/"
];

const KNOWN_HOSTS = GATEWAYS.map(g => new URL(g).hostname);

function extractCid(url) {
    const m = url.pathname.match(/\/ipfs\/([A-Za-z0-9]+)/);
    return m ? m[1] : null;
}

function isIpfsRequest(url) {
    return KNOWN_HOSTS.includes(url.hostname) && extractCid(url);
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

const _recentFails = new Map();
const FAIL_COOLDOWN = 45000;

async function fetchWithGatewayFallback(cid, originalRequest) {
    const cache = await caches.open(CACHE_NAME);
    const cacheKey = new Request("ipfs://" + cid);

    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const lastFail = _recentFails.get(cid);
    if (lastFail && Date.now() - lastFail < FAIL_COOLDOWN) {
        return new Response("IPFS temporarily unavailable", { status: 502 });
    }

    const originalGw = GATEWAYS.find(g => originalRequest.url.startsWith(g));
    const ordered = originalGw
        ? [originalGw, ...GATEWAYS.filter(g => g !== originalGw)]
        : GATEWAYS;

    for (const gw of ordered) {
        try {
            const resp = await fetch(gw + cid, { mode: "cors", credentials: "omit" });
            if (resp.ok) {
                _recentFails.delete(cid);
                cache.put(cacheKey, resp.clone());
                return resp;
            }
        } catch (_) {}
    }

    _recentFails.set(cid, Date.now());
    return new Response("All IPFS gateways failed", { status: 502 });
}

self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);
    const cid = extractCid(url);
    if (!cid || !isIpfsRequest(url)) return;

    e.respondWith(fetchWithGatewayFallback(cid, e.request));
});
