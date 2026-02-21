# DeroBeats Curl Commands (MV5)

Daemon: `http://node.derofoundation.org:11012/json_rpc`
Registry SCID: `88aa9c31ca557eb87fe0ff4c1f077fd5a41c0613f63090c58f82d0452929929c`

## Check registry state (total songs, song list)

```bash
curl -s -X POST http://node.derofoundation.org:11012/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"0","method":"DERO.GetSC","params":{"scid":"88aa9c31ca557eb87fe0ff4c1f077fd5a41c0613f63090c58f82d0452929929c","variables":true,"code":false}}'
```

## Check contract source code

```bash
curl -s -X POST http://node.derofoundation.org:11012/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"0","method":"DERO.GetSC","params":{"scid":"88aa9c31ca557eb87fe0ff4c1f077fd5a41c0613f63090c58f82d0452929929c","variables":false,"code":true}}'
```

## Quick total_songs check (pipe to jq)

```bash
curl -s -X POST http://node.derofoundation.org:11012/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"0","method":"DERO.GetSC","params":{"scid":"88aa9c31ca557eb87fe0ff4c1f077fd5a41c0613f63090c58f82d0452929929c","variables":true,"code":false}}' | jq '.result.stringkeys.total_songs'
```

## Gas estimate for RegisterSong

```bash
curl -s -X POST http://node.derofoundation.org:11012/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{
  "jsonrpc":"2.0","id":"1","method":"DERO.GetGasEstimate",
  "params":{
    "signer":"dero1qygfgg5hq4fracps4q8cxwzvyjvmh85kewfwc75nxnfpg6grsr4nyqqket86l",
    "ringsize":2,
    "sc_rpc":[
      {"name":"entrypoint","datatype":"S","value":"RegisterSong"},
      {"name":"SC_ACTION","datatype":"U","value":0},
      {"name":"SC_ID","datatype":"H","value":"88aa9c31ca557eb87fe0ff4c1f077fd5a41c0613f63090c58f82d0452929929c"},
      {"name":"songSCID","datatype":"S","value":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
      {"name":"title","datatype":"S","value":"Test Title For Gas Estimate"},
      {"name":"artist","datatype":"S","value":"TestArtist"},
      {"name":"genre","datatype":"S","value":"Electronic"},
      {"name":"ipfsHash","datatype":"S","value":"bafybeielswng4aq4kxb3tydqcgld4bltaf4jvtnbcrxlss3u7klpf74ube"},
      {"name":"previewArtCid","datatype":"S","value":"bafybeieqp3vmodc6uevywxgrruedji4bjq7fo2dgdxaid777hzwvox7fqa"}
    ]
  }}'
```

## Gas estimate for Donate

```bash
curl -s -X POST http://node.derofoundation.org:11012/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{
  "jsonrpc":"2.0","id":"1","method":"DERO.GetGasEstimate",
  "params":{
    "signer":"dero1qygfgg5hq4fracps4q8cxwzvyjvmh85kewfwc75nxnfpg6grsr4nyqqket86l",
    "ringsize":2,
    "transfers":[{"scid":"88aa9c31ca557eb87fe0ff4c1f077fd5a41c0613f63090c58f82d0452929929c","amount":100000}],
    "sc_rpc":[
      {"name":"entrypoint","datatype":"S","value":"Donate"},
      {"name":"SC_ACTION","datatype":"U","value":0},
      {"name":"SC_ID","datatype":"H","value":"88aa9c31ca557eb87fe0ff4c1f077fd5a41c0613f63090c58f82d0452929929c"},
      {"name":"songSCID","datatype":"S","value":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
    ]
  }}'
```

## Gas estimate for RecordHashes

```bash
curl -s -X POST http://node.derofoundation.org:11012/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{
  "jsonrpc":"2.0","id":"1","method":"DERO.GetGasEstimate",
  "params":{
    "signer":"dero1qygfgg5hq4fracps4q8cxwzvyjvmh85kewfwc75nxnfpg6grsr4nyqqket86l",
    "ringsize":2,
    "sc_rpc":[
      {"name":"entrypoint","datatype":"S","value":"RecordHashes"},
      {"name":"SC_ACTION","datatype":"U","value":0},
      {"name":"SC_ID","datatype":"H","value":"88aa9c31ca557eb87fe0ff4c1f077fd5a41c0613f63090c58f82d0452929929c"},
      {"name":"songSCID","datatype":"S","value":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
      {"name":"amount","datatype":"U","value":5000}
    ]
  }}'
```

## Direct wallet RPC test (bypasses XSWD)

Replace the songSCID with a fresh 64-char hex string each time.

```bash
curl -s -X POST http://localhost:40403/json_rpc \
  -H 'Content-Type: application/json' \
  -d '{
  "jsonrpc":"2.0","id":"1","method":"transfer",
  "params":{
    "sc_id":"88aa9c31ca557eb87fe0ff4c1f077fd5a41c0613f63090c58f82d0452929929c",
    "ringsize":2,
    "fees":20000,
    "sc_rpc":[
      {"name":"entrypoint","datatype":"S","value":"RegisterSong"},
      {"name":"songSCID","datatype":"S","value":"0000000000000000000000000000000000000000000000000000000000000001"},
      {"name":"title","datatype":"S","value":"Direct RPC Test"},
      {"name":"artist","datatype":"S","value":"Test Artist"},
      {"name":"genre","datatype":"S","value":"Test"},
      {"name":"ipfsHash","datatype":"S","value":"bafybeiagvxmbewmpsjv5flh3s7o3qwk7tb4idg7ifafuslifoofk4s2pii"},
      {"name":"previewArtCid","datatype":"S","value":""}
    ]
  }}'
```
