const CACHE_NAME = "derobeats-ipfs-v1";

const IPFS_HOSTS = [
    "gateway.pinata.cloud",
    "ipfs.io",
    "cloudflare-ipfs.com",
    "dweb.link",
    "w3s.link"
];

function isIpfsRequest(url) {
    return IPFS_HOSTS.some(h => url.hostname === h) && url.pathname.includes("/ipfs/");
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);
    if (!isIpfsRequest(url)) return;

    e.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cid = url.pathname.split("/ipfs/")[1];
            const cacheKey = cid ? new Request("ipfs://" + cid) : e.request;

            const cached = await cache.match(cacheKey);
            if (cached) return cached;

            try {
                const resp = await fetch(e.request);
                if (resp.ok && resp.status === 200) {
                    cache.put(cacheKey, resp.clone());
                }
                return resp;
            } catch (err) {
                return new Response("IPFS fetch failed", { status: 502 });
            }
        })
    );
});
