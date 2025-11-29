# Ferrotune Music Player Client - Implementation Plan

## Overview

A modern, responsive music player web client for Ferrotune using Next.js 16, React 19, Tailwind CSS, shadcn/ui, and Framer Motion. The client provides a Spotify-like experience that works seamlessly on both desktop and mobile.

## Tech Stack

- **Framework:** Next.js 16.0.5 with App Router & Turbopack
- **UI Library:** React 19.2.0 with React Compiler
- **Styling:** Tailwind CSS 4
- **Components:** shadcn/ui (18 components installed)
- **Animations:** Framer Motion 12.23.24
- **State Management:** Jotai 2.15.1 for atomic state management
- **Data Fetching:** TanStack React Query 5.90.11
- **Testing:** Playwright for E2E tests
- **Icons:** Lucide React 0.555.0
- **Notifications:** Sonner

## Implementation Phases

### Phase 1: Project Setup & Foundation ✅ COMPLETE

- [x] 1.1 Scaffold Next.js 16 project with `create-next-app`
- [x] 1.2 Install and configure Tailwind CSS 4
- [x] 1.3 Install and configure shadcn/ui
- [x] 1.4 Install Framer Motion for animations
- [x] 1.5 Set up project structure (folders, base layouts)
- [x] 1.6 Configure TypeScript strict mode and path aliases
- [x] 1.7 Create base theme (dark mode by default, Spotify-inspired colors)

### Phase 2: API Client Layer ✅ COMPLETE

- [x] 2.1 Create typed API client with fetch wrapper
- [x] 2.2 Implement authentication handling (API key in localStorage)
- [x] 2.3 Create React hooks for data fetching with React Query
- [x] 2.4 Implement API endpoints:
  - [x] System: `ping`, `getLicense`, `getMusicFolders`
  - [x] Browse: `getArtists`, `getArtist`, `getAlbum`, `getSong`, `getGenres`
  - [x] Lists: `getAlbumList2`, `getRandomSongs`
  - [x] Search: `search3`
  - [x] Starring: `star`, `unstar`, `setRating`, `getStarred2`
  - [x] Scrobble: `scrobble`
  - [x] Media: `stream` URL builder, `getCoverArt` URL builder, `download` URL builder
  - [x] Playlists: `getPlaylists`, `getPlaylist`, `createPlaylist`, `updatePlaylist`, `deletePlaylist`

### Phase 3: Core Layout & Navigation ✅ COMPLETE

- [x] 3.1 Create root layout with dark theme
- [x] 3.2 Build persistent sidebar for desktop
  - [x] Logo/branding
  - [x] Navigation: Home, Search, Library
  - [x] Library section with Liked Songs, Playlists
  - [x] Settings link
- [x] 3.3 Build mobile bottom navigation bar
- [x] 3.4 Create responsive breakpoint handling
- [x] 3.5 Build persistent bottom player bar (always visible when track loaded)

### Phase 4: Authentication & Settings ✅ COMPLETE

- [x] 4.1 Create login page with server URL + API key/password inputs
- [x] 4.2 Implement connection testing on login
- [x] 4.3 Store credentials in localStorage (via Jotai atomWithStorage)
- [x] 4.4 Create settings page for:
  - [x] Server connection display
  - [x] Playback preferences (volume, repeat, shuffle)
  - [x] Sign out functionality

### Phase 5: Home Page ✅ COMPLETE

- [x] 5.1 Create home page layout
- [x] 5.2 "Recently Added" albums section (`getAlbumList2` type=newest)
- [x] 5.3 "Random Albums" section (`getAlbumList2` type=random)
- [x] 5.4 "Highest Rated" albums section (`getAlbumList2` type=highest)

### Phase 6: Browse Views ✅ COMPLETE

- [x] 6.1 **Artists View**
  - [x] Artists grid from index
  - [x] Artist cards with cover art
  - [x] Click to artist detail page
- [x] 6.2 **Artist Detail Page**
  - [x] Artist header with image
  - [x] Albums grid
  - [x] Play all / shuffle buttons
- [x] 6.3 **Albums View**
  - [x] Album grid in library
  - [x] Album cards with play buttons
- [x] 6.4 **Album Detail Page**
  - [x] Album header (cover, title, artist, year, stats)
  - [x] Track listing with numbers
  - [x] Play all / shuffle buttons
  - [x] Star/rating controls via context menu
- [x] 6.5 **Genres View**
  - [x] Genre list in library tabs

### Phase 7: Search ✅ COMPLETE

- [x] 7.1 Search input in header
- [x] 7.2 Real-time search with debouncing (300ms)
- [x] 7.3 Search results page with tabs: All, Artists, Albums, Songs
- [x] 7.4 Search result cards with quick play actions
- [x] 7.5 URL-based search state (query param)

### Phase 8: Audio Playback Engine ✅ COMPLETE

- [x] 8.1 Create AudioContext provider (via Jotai atoms)
- [x] 8.2 Implement HTML5 Audio wrapper with:
  - [x] Play/pause
  - [x] Track loading and buffering states
  - [x] Progress tracking
  - [x] Seeking
  - [x] Volume control
  - [x] Mute toggle
- [x] 8.3 Implement queue management:
  - [x] Current queue array
  - [x] Add to queue (next / last)
  - [x] Remove from queue
  - [x] Reorder queue (drag & drop in queue panel)
  - [x] Clear queue
  - [x] Play now (replace queue)
- [x] 8.4 Implement playback modes:
  - [x] Shuffle on/off
  - [x] Repeat: off / all / one
- [x] 8.5 Previous/Next track logic
- [x] 8.6 Scrobble integration (configurable threshold)

### Phase 9: Player UI ✅ COMPLETE

- [x] 9.1 **Bottom Player Bar**
  - [x] Now playing info (cover, title, artist)
  - [x] Progress bar with time display
  - [x] Play/pause, prev/next buttons
  - [x] Volume slider
  - [x] Shuffle/repeat toggles
  - [x] Queue button
  - [x] Fullscreen view button
- [x] 9.2 **Fullscreen Player**
  - [x] Large album art with blur background
  - [x] Full controls
  - [x] Progress slider
  - [x] Volume control
  - [x] Star button
- [x] 9.3 **Queue Panel (Drawer)**
  - [x] Current track highlighted
  - [x] Drag to reorder (Framer Motion Reorder)
  - [x] Remove tracks
  - [x] Clear all
  - [x] Now Playing / Up Next / Previously Played sections

### Phase 10: Playlists ✅ COMPLETE

- [x] 10.1 **Playlists List View**
  - [x] Grid of user playlists
  - [x] Create new playlist button (UI ready)
  - [x] Playlist cards with cover and stats
- [x] 10.2 **Playlist Detail Page**
  - [x] Playlist header (name, song count, duration)
  - [x] Track listing
  - [x] Play all / shuffle buttons
  - [x] Delete playlist with confirmation

### Phase 11: Favorites & Ratings ✅ COMPLETE

- [x] 11.1 Star toggle on songs (via context menu and song row)
- [x] 11.2 5-star rating component (in context menu)
- [x] 11.3 "Liked Songs" page (`/favorites`) from `getStarred2`
- [x] 11.4 Tabs for starred songs/albums/artists

### Phase 12: Polish & Animations ✅ COMPLETE

- [x] 12.1 Page animations with Framer Motion
- [x] 12.2 Micro-interactions (button presses, hovers)
- [x] 12.3 Skeleton loading states
- [x] 12.4 Empty states with icons
- [x] 12.5 Toast notifications for actions (Sonner)

### Phase 13: Mobile Optimization ✅ COMPLETE

- [x] 13.1 Touch-friendly hit targets
- [x] 13.2 Mobile bottom navigation
- [x] 13.3 Mobile-specific layouts
- [x] 13.4 Responsive player bar

### Phase 14: E2E Testing with Playwright ✅ COMPLETE

- [x] 14.1 Set up Playwright configuration
- [x] 14.2 Create test utilities and fixtures
- [x] 14.3 Test cases:
  - [x] Login flow (auth.spec.ts)
  - [x] Browse artists/albums (browse.spec.ts)
  - [x] Search and filter (search.spec.ts)
  - [x] Play a track (playback.spec.ts)
  - [x] Queue management (queue.spec.ts)
  - [x] Playlist operations (playlists.spec.ts)
  - [x] Star/rate songs (starring.spec.ts)
  - [x] Responsive layout (mobile-chrome project)

---

## File Structure (Implemented)

```
client/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout with providers
│   │   ├── page.tsx                # Home page
│   │   ├── globals.css             # Theme and global styles
│   │   ├── login/
│   │   │   └── page.tsx            # Login page
│   │   ├── search/
│   │   │   ├── page.tsx            # Search page (with Suspense)
│   │   │   └── search-content.tsx  # Search content component
│   │   ├── library/
│   │   │   ├── page.tsx            # Library with tabs
│   │   │   ├── albums/
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx    # Album detail
│   │   │   └── artists/
│   │   │       └── [id]/
│   │   │           └── page.tsx    # Artist detail
│   │   ├── playlists/
│   │   │   ├── page.tsx            # Playlists list
│   │   │   └── [id]/
│   │   │       └── page.tsx        # Playlist detail
│   │   ├── favorites/
│   │   │   └── page.tsx            # Starred items
│   │   └── settings/
│   │       └── page.tsx            # Settings
│   ├── components/
│   │   ├── ui/                     # shadcn/ui components (18 installed)
│   │   ├── layout/
│   │   │   ├── sidebar.tsx
│   │   │   ├── mobile-nav.tsx
│   │   │   └── player-bar.tsx
│   │   ├── player/
│   │   │   └── fullscreen-player.tsx
│   │   ├── queue/
│   │   │   └── queue-panel.tsx
│   │   ├── browse/
│   │   │   ├── album-card.tsx
│   │   │   ├── artist-card.tsx
│   │   │   ├── song-row.tsx
│   │   │   └── song-context-menu.tsx
│   │   ├── shared/
│   │   │   └── cover-image.tsx
│   │   └── providers.tsx           # Query + Jotai + Theme providers
│   └── lib/
│       ├── api/
│       │   ├── client.ts           # SubsonicClient class
│       │   └── types.ts            # API response types
│       ├── store/
│       │   ├── auth.ts             # Connection state
│       │   ├── player.ts           # Playback state
│       │   ├── queue.ts            # Queue management
│       │   └── ui.ts               # UI state
│       ├── audio/
│       │   └── hooks.ts            # useAudioEngine and related hooks
│       └── utils/
│           └── format.ts           # Duration, date, count formatting
├── public/
├── package.json
├── next.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

## Design System (Implemented)

### Colors (Dark Theme - Ferrotune Green)

```css
--background: oklch(0.1 0 0)           /* Near black */
--card: oklch(0.12 0 0)                /* Slightly lighter */
--primary: oklch(0.75 0.18 145)        /* Ferrotune green */
--muted: oklch(0.2 0 0)
--accent: oklch(0.15 0 0)
--destructive: oklch(0.55 0.2 25)      /* Red for errors */
```

### Components Installed (shadcn/ui)

- button, card, input, slider, dialog, sheet
- dropdown-menu, context-menu, scroll-area
- skeleton, tabs, separator, avatar, badge
- popover, tooltip, sonner, command
- switch, select, alert-dialog

---

## Current Status

**✅ Implementation Complete**

The music player client is fully functional with:
- Full authentication (API key + password)
- Complete library browsing (artists, albums, genres)
- Full-text search with live results
- Audio playback with queue management
- Favorites and ratings
- Playlist viewing and management
- Responsive design for mobile and desktop
- Dark theme with animations
- Comprehensive Playwright E2E test suite

---

## Future Enhancements (Not Blocking)

- [ ] Light theme option
- [ ] Keyboard shortcuts
- [ ] Media Session API for OS integration
- [ ] Lyrics display
- [ ] Audio visualizer
- [ ] Playlist creation modal
- [ ] Drag-to-add to playlist
- [ ] Recently played history
- [ ] Offline caching (PWA)
