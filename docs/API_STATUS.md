# OpenSubsonic API Implementation Status

This document tracks the implementation status of OpenSubsonic API endpoints in Ferrotune.

## ✅ Implemented Endpoints (26)

### System
- `ping` - Server health check
- `getLicense` - License info (always returns valid)
- `getOpenSubsonicExtensions` - Supported extensions
- `getMusicFolders` - Configured music directories

### Browse
- `getArtists` - Artist index with album counts
- `getArtist` - Artist details with albums
- `getArtistInfo2` - Artist metadata ⚠️ stub (returns empty)
- `getAlbum` - Album with songs
- `getSong` - Single song details
- `getGenres` - Available genres

### Media
- `stream` - Audio streaming with HTTP range requests
- `download` - File download
- `getCoverArt` - Album artwork

### Annotation
- `star` - Star songs/albums/artists
- `unstar` - Remove stars
- `setRating` - Rate items 1-5 (0 removes rating)
- `getStarred` - List starred items
- `getStarred2` - List starred items (ID3 format)
- `scrobble` - Track play history

### Lists
- `getAlbumList2` - Album lists by various criteria
- `getRandomSongs` - Random song selection

### Search
- `search3` - Full-text search across library

### Playlists
- `getPlaylists` - List all playlists
- `getPlaylist` - Playlist details with songs
- `createPlaylist` - Create new playlist
- `updatePlaylist` - Modify playlist
- `deletePlaylist` - Remove playlist

### Play Queue ⚠️ Stub Implementation
- `savePlayQueue` - Save current play queue (returns success without persisting)
- `getPlayQueue` - Retrieve play queue (always returns empty)

---

## ❌ Missing Endpoints

### High Priority (Commonly used by clients)
| Endpoint | Purpose |
|----------|---------|
| `startScan` | Trigger library scan via API |
| `getScanStatus` | Check scan progress |
| `getIndexes` | Directory-based browsing |
| `getMusicDirectory` | Directory listing |
| `getAlbumList` | Non-ID3 album lists |
| `getSongsByGenre` | Filter songs by genre |

### Medium Priority
| Endpoint | Purpose |
|----------|---------|
| `getAlbumInfo2` | External album metadata |
| `getArtistInfo` | External artist metadata |
| `getSimilarSongs2` | Song recommendations |
| `getTopSongs` | Top songs for artist |
| `getNowPlaying` | Currently playing |
| `getLyricsBySongId` | Song lyrics |

### User Management
| Endpoint | Purpose |
|----------|---------|
| `getUser` | User details |
| `getUsers` | List all users |
| `createUser` | Create user |
| `updateUser` | Modify user |
| `deleteUser` | Remove user |
| `changePassword` | Password change |

### Bookmarks
| Endpoint | Purpose |
|----------|---------|
| `getBookmarks` | Position bookmarks |
| `createBookmark` | Save position |
| `deleteBookmark` | Remove bookmark |

### Sharing
| Endpoint | Purpose |
|----------|---------|
| `getShares` | Public share links |
| `createShare` | Create share |
| `updateShare` | Modify share |
| `deleteShare` | Remove share |

### Low Priority
- Internet radio stations
- Podcasts
- Video support
- Chat (deprecated)
- Jukebox control

---

## Ferrotune Custom API

The Admin API runs on a separate port (default 4041) and provides modern REST endpoints.

### Current Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Health check with version |
| POST | `/scan` | Trigger library scan |
| GET | `/scan/status` | Scan progress ⚠️ stub |

### Planned Features
- Async scanning with WebSocket progress updates
- User management API
- Library statistics
- Configuration management
- Backup/restore
