# Design notes

Non-obvious behaviour that has caused bugs before. Read the relevant section before changing playback sessions or the library scanner.

## Playback sessions

- **One session row per user, plus in-memory state** per session: a broadcast channel, the registered clients and the latest owner heartbeat snapshot. Only an owner heartbeat refreshes the live snapshot. The snapshot is deliberately not persisted, because persisting heartbeat positions would race ordered queue mutations. The canonical queue position (written on explicit seeks and track transitions) is the fallback after a restart, or for a client that never saw a heartbeat.
- A newly opened SSE stream receives the live snapshot as its initial position. That is what makes a follower joining mid-song start where the owner actually is.
- **Ownership policy is Spotify-like.** Pressing play in a follower does not take over: `server-queue.ts` checks `isRemoteControllingAtom` and sends a remote `playAtIndex` (or play/pause) to the owner. Queue mutations claim the queue-position owner with `resume_playback: false`, so an edit never restarts playback. A follower whose owner goes away keeps a paused, controllable state (`applyOwnerSnapshot` with a null owner).
- A non-owner gets `403 Only the session owner can update queue position` from the queue paths unless the recorded owner looks disconnected (beacon or heartbeat grace). The app auto-claims ownership through `queue/start` only when the session has no owner.
- **Idle disown:** the server disowns an owner whose playback has been idle for `FERROTUNE_SESSION_IDLE_DISOWN_SECS` (default 600 s; the sweep runs at most every 30 s). Do not exempt owners with a fresh heartbeat: a paused but open tab would then hold the session forever.
- `get_or_create_session` must stay safe under concurrent first requests (unique index on `user_id`); a check-then-insert made `GET /api/sessions` return 500.

## Library scanning and tagging

- **Albums are keyed by (album name, `ALBUMARTIST`)**, read in `src/scanner.rs`. Without `ALBUMARTIST` the scanner falls back to the per-track artist, so compilations and soundtracks split into one album per track artist. Fix the tags; do not special-case the scanner.
- Orphaned album/artist cleanup and the totals refresh run after every scan, not only when files are missing. A rescan after re-tagging is cheap, because `update_song_row` preserves analyzer fields when the payload is absent.
- **`PATCH /api/tagger/batch-tags`:** keep batches to about 8 files. Larger requests hit the ingress timeout and return 504, and a 504 does not mean the write failed: verify with `GET /api/tagger/batch-tags?songIds=...` and re-patch what is missing. The tagger's `get_song_by_id` ignores songs marked for deletion.
- Listening statistics and playlist references hang off the song row, so a tag-only fixup plus rescan preserves them.
- **Tag keys** (`src/api/common/tag_io/`): standard fields use the Vorbis field names in every format (`TITLE`, `ALBUMARTIST`, `TRACKNUMBER`/`TRACKTOTAL` split from `TRCK`/`trkn`/`Track`), everything else its native key: Vorbis field names, ID3v2 `TXXX` descriptions (`TXXX:<desc>` when the bare description would mean another frame), `WXXX:`/`COMM:`/`USLT:<desc>`, MP4 atom codes or freeform names (`----:<mean>:<name>` outside `com.apple.iTunes`), `APE:<key>`. `nativeKey` carries the stored key. Repeating a key in `set` writes several values; an empty value deletes. `YEAR` rewrites the year of an existing date field, as lofty's generic tag did.
- ID3v2.3 tags are written back as v2.3 unless they contain v2.4-only frames (iTunes puts `TSOP`/`TSOA` in v2.3 tags), which lofty would drop. The tag layer also works around lofty writing UTF-16 `WXXX` URLs garbled, refusing `COMM` frames with NUL languages, and WAV files whose `id3 ` chunk sits past the RIFF size. A file whose tags do not read back as written (e.g. a RIFF/WAVE file named `.mp3`) is left untouched and the edit fails.

## Play history

Play history lives in two mirrored tables. `scrobbles` drives the user-visible play count (per-song `SUM(play_count)` over `submission` rows). `listening_sessions` drives listening statistics, including sub-threshold sessions that never became scrobbles. Imports such as the Google Play Music import fill both, with `match_dictionary` resolving track names to songs. To correct a misattributed match, reassign the affected rows in both tables.
