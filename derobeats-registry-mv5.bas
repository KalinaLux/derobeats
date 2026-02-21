// DeroBeats Registry — MV5
// MV4 + artist self-removal + donate to artist

// Return codes: 0=ok  1=error

Function Initialize() Uint64
10 IF EXISTS("owner") THEN GOTO 99
20 STORE("owner", ADDRESS_STRING(SIGNER()))
30 STORE("total_songs", 0)
40 STORE("platform_name", "DeroBeats")
50 STORE("platform_url", "derobeats.tela")
60 STORE("var_header_name", "DeroBeats Registry MV5")
61 STORE("var_header_description", "Song registry for DeroBeats. Publish, donate, upvote, track plays.")
62 STORE("var_header_icon", "")
63 STORE("total_hashes", 0)
98 RETURN 0
99 RETURN 1
End Function

Function RegisterSong(songSCID String, title String, artist String, genre String, ipfsHash String, previewArtCid String) Uint64
10 IF EXISTS(ADDRESS_STRING(SIGNER())) THEN GOTO 12
11 STORE(ADDRESS_STRING(SIGNER()), 1)
12 IF songSCID == "" THEN GOTO 99
15 IF title == "" THEN GOTO 99
20 IF artist == "" THEN GOTO 99
25 IF EXISTS(songSCID + "_registered") THEN GOTO 99
30 DIM count as Uint64
35 LET count = LOAD("total_songs")
40 STORE("song_" + count, songSCID)
45 STORE(songSCID + "_registered", 1)
50 STORE(songSCID + "_title", title)
55 STORE(songSCID + "_artist", artist)
60 STORE(songSCID + "_artist_addr", ADDRESS_STRING(SIGNER()))
65 IF genre == "" THEN GOTO 70
68 STORE(songSCID + "_genre", genre)
69 GOTO 75
70 STORE(songSCID + "_genre", "Unknown")
75 STORE(songSCID + "_ipfs", ipfsHash)
80 IF previewArtCid == "" THEN GOTO 90
85 STORE(songSCID + "_preview_art_cid", previewArtCid)
90 STORE(songSCID + "_upvotes", 0)
91 STORE(songSCID + "_timestamp", BLOCK_TIMESTAMP())
92 STORE("total_songs", count + 1)
98 RETURN 0
99 RETURN 1
End Function

Function UpvoteSong(songSCID String) Uint64
10 IF EXISTS(ADDRESS_STRING(SIGNER()) + "_upvoted_" + songSCID) THEN GOTO 99
20 IF EXISTS(songSCID + "_registered") THEN GOTO 40
30 RETURN 1
40 DIM upvotes as Uint64
50 LET upvotes = LOAD(songSCID + "_upvotes") + 1
60 STORE(songSCID + "_upvotes", upvotes)
70 STORE(ADDRESS_STRING(SIGNER()) + "_upvoted_" + songSCID, 1)
98 RETURN 0
99 RETURN 1
End Function

Function Donate(songSCID String) Uint64
10 IF EXISTS(songSCID + "_registered") THEN GOTO 20
15 RETURN 1
20 IF DEROVALUE() == 0 THEN GOTO 99
30 DIM artistAddr as String
35 LET artistAddr = LOAD(songSCID + "_artist_addr")
40 SEND_DERO_TO_ADDRESS(artistAddr, DEROVALUE())
50 DIM donations as Uint64
55 IF EXISTS(songSCID + "_donations") THEN GOTO 60
56 LET donations = 0
57 GOTO 65
60 LET donations = LOAD(songSCID + "_donations")
65 STORE(songSCID + "_donations", donations + 1)
70 DIM totalDero as Uint64
75 IF EXISTS(songSCID + "_donated_dero") THEN GOTO 80
76 LET totalDero = 0
77 GOTO 85
80 LET totalDero = LOAD(songSCID + "_donated_dero")
85 STORE(songSCID + "_donated_dero", totalDero + DEROVALUE())
98 RETURN 0
99 RETURN 1
End Function

Function RecordHashes(songSCID String, amount Uint64) Uint64
10 IF EXISTS(songSCID + "_registered") THEN GOTO 20
15 RETURN 1
20 DIM total as Uint64
25 IF EXISTS(songSCID + "_hashes") THEN GOTO 30
26 LET total = 0
27 GOTO 35
30 LET total = LOAD(songSCID + "_hashes")
35 STORE(songSCID + "_hashes", total + amount)
40 DIM globalTotal as Uint64
45 IF EXISTS("total_hashes") THEN GOTO 50
46 LET globalTotal = 0
47 GOTO 55
50 LET globalTotal = LOAD("total_hashes")
55 STORE("total_hashes", globalTotal + amount)
98 RETURN 0
End Function

Function RemoveSong(songSCID String) Uint64
10 IF EXISTS(songSCID + "_registered") THEN GOTO 20
15 RETURN 1
20 IF LOAD("owner") == ADDRESS_STRING(SIGNER()) THEN GOTO 50
30 IF LOAD(songSCID + "_artist_addr") == ADDRESS_STRING(SIGNER()) THEN GOTO 50
40 RETURN 1
50 STORE(songSCID + "_removed", 1)
60 STORE(songSCID + "_removed_at", BLOCK_TIMESTAMP())
98 RETURN 0
End Function

Function TransferOwnership(newOwner String) Uint64
10 IF LOAD("owner") == ADDRESS_STRING(SIGNER()) THEN GOTO 30
20 RETURN 1
30 IF newOwner == "" THEN GOTO 99
40 STORE("owner", newOwner)
98 RETURN 0
99 RETURN 1
End Function

Function GetTotalSongs() Uint64
10 RETURN LOAD("total_songs")
End Function

Function GetSong(index Uint64) String
10 IF EXISTS("song_" + index) THEN GOTO 30
20 RETURN ""
30 RETURN LOAD("song_" + index)
End Function
