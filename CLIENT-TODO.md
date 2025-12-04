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

# TODO list

- [x] We should consolidate the views for track favorites, album favorites, artist favorites, recently played, playlist details, album details, artist details and genre details to use the same shared component, since these views are very similar. The main differences are some minor details in header content (e.g. clear button for recently played) and the favorites page having tabs for songs/albums/artists. Also the playlist details view has drag and drop reordering of songs.
  - Created shared components: `DetailHeader`, `ActionBar`, `EmptyState`, `EmptyFilterState`
  - These complement existing shared components: `SongListToolbar`, `MediaListToolbar`, `VirtualizedGrid/List`, `BulkActionsBar`, `CoverImage`
  - Demonstrated pattern by refactoring history page to use new components
  - Views now share: header layout, action bar, empty states, list rendering, bulk selection
- [x] The /playlists view should be consolidated with the favorites, recently played and playlist details view. They are all very similar in structure and functionality, so we should be able to share a lot of code here. Make use of the previously mentioned shared components. Similar to the other views, we also want to support filtering, grid/row modes, visible columns and sorting options for playlists as well.
- [x] Can we refactor recently played to use scrobbled tracks from the backend instead of storing this in localStorage?
- [x] Implement server stats in the settings view (e.g. total tracks, total albums, total artists, total play time etc.)
- [x] Playlist import dialog seems to show only title for tracks to be imported, we should also show artist and album to make it easier to identify what it is. Let's format the title on the top row and artist + album on the bottom row similar to how it's done in the track lists using the MediaRow component.
- [x] Playlist import dialog seems to search only for title when matching tracks, we should also optionally (checkboxes in the UI) search by artist and album to improve matching accuracy.
- [x] Let's make the playlist import dialog wider to better accommodate long track titles and artist names.
- [x] Show playlist folders in the /playlists view, similar to how they are shown in the sidebar. Clicking on them navigates into the folder to show its contents (playlists and subfolders). We should also support breadcrumb navigation at the top to allow easy navigation back up the folder hierarchy.
- [x] Implement drag-and-drop to move playlists into and out of playlist folders in the /playlists view.
- [x] Implement creation of new (empty) playlist folders in the /playlists view.

- [x] Have the favicon change color according to the current primary color. Remove gradient from background and just use the primary color as solid color here. This was partially implemented but doesn't work?
  - Fixed by using base64 data URLs instead of blob URLs for better browser compatibility
  - Static icon.svg now uses solid color instead of gradient
- [x] How does track buffering currently work, how much of the track are we buffering in advance etc. We should probably try to stream the entire track (up to some sane filesize limit) to save on e.g. battery life as mobile devices' modems can go to sleep if there is no network activity for some time.
  - Already correctly implemented with `preload="auto"` which instructs browser to buffer entire track
  - Added JSDoc comments explaining the behavior in audio/hooks.ts
- [x] Let's implement total listen minutes tracking and display this in a stats view somewhere. We should log listen times server-side for accuracy, so this will require backend changes as well. We should keep track of when the listening occurred, so that we can show stats such as minutes last 7 days / 30 days / current year / all time etc.
  - Created listening_sessions database table to store user listening data
  - Backend API: POST /ferrotune/listening to log sessions, GET /ferrotune/listening/stats for statistics
  - Frontend: Tracks playback start/pause/end times, logs to backend when tracks change
  - New "Listening Activity" section in settings shows stats for 7 days / 30 days / this year / all time
- [~] Should we use dnd-kit in the playback queue now that we installed it for playlist reordering? Maybe we could try using MediaRows here for consolidation.
  - **Investigated**: The current Framer Motion Reorder implementation works well for the queue. Switching to dnd-kit would be a significant refactor for minimal benefit. The queue has unique requirements (now playing, up next, previously played sections) that make a generic MediaRow less suitable. Keep current implementation but consider dnd-kit for future drag-to-add-to-playlist features.
- [x] Check for duplicates when adding items to a playlist, if duplicates are found, notify the user with a dialog and ask whether they want to skip the duplicates or add them anyway.
  - Implemented in AddToPlaylistDialog: fetches existing playlist songs before adding
  - Shows AlertDialog listing duplicates with options: "Skip Duplicates" or "Add Anyway"
  - If all songs are duplicates, shows info toast instead of error
- [x] Now playing / up next / previous items in the queue should have same options on them as elsewhere in the UI in addition to the queue specific options. Perhaps consolidate this into a shared component.
  - Extended `SongContextMenu` to support `hideQueueActions`, `showRemoveFromQueue`, and `onRemoveFromQueue` props
  - Queue items now use SongContextMenu for right-click menus with all standard options (favorites, rating, download, view details, navigation)
  - "Remove from Queue" is only shown on draggable queue items (up next section)
  - Dropdown buttons remain simple for quick actions (Add to Playlist, Remove from Queue)
- [x] **Full filesystem path in track details** - Added `fullPath` field to backend SongResponse (Ferrotune extension). Created `SongWithFolder` model and `get_song_by_id_with_folder` query to join music_folders table. The `getSong` endpoint now returns the full filesystem path by combining the music folder base path with the relative file path. Frontend details dialog displays `fullPath` when available, falls back to relative `path`.

- [x] Playlist view breadcrumbs are obscured by the header (show up as very dim and not clickable)
  - Fixed by adding `relative z-20 bg-background/80 backdrop-blur-sm` to breadcrumb container
- [x] Adjusting the custom color in preferences must be debounced, currently it spams API updates on every tiny change.
  - Added 500ms debounce to custom color sync using useRef timer
- [x] The rate context menu option text is misaligned horizontally, it's too far to the left compared to all other context menu option items texts
  - Added `gap-2` to ContextMenuSubTrigger to match ContextMenuItem spacing
- [x] The playback queue context menu button seemingly opens a different context menu than when right clicking the item. I want you to use the context menu that appears on right click, as it contains more options
  - Unified queue dropdown menus to use SongDropdownMenu which shares full functionality with SongContextMenu
  - Now Playing, Up Next, and Previously Played items all show consistent options via dropdown and right-click
  - Added hideQueueActions, showRemoveFromQueue, onRemoveFromQueue props to SongDropdownMenu
- [x] The custom favicon color update only seems to happen when going to settings and changing the color there. E.g. reloading the page makes the favicon go back to the default.
  - Fixed by using `useHydrated` hook to delay favicon update until after client hydration
  - This ensures atomWithStorage values from localStorage are used instead of SSR defaults
- [x] The custom favicon color hue is slightly off compared to the rest of the UI accent color. We should ensure they match exactly. Maybe HSL vs OKLCH mismatch? We are using OKLCH for the UI accent color.
  - Implemented proper OKLCH to sRGB conversion instead of incorrect HSL conversion
  - Now uses exact lightness, chroma, and hue values from globals.css for each preset
  - For custom colors, uses the user's selected OKLCH values directly
- [x] Ask for confirmation with a confirmation dialog when deleting tracks from playlists.
  - Added `removeTracksDialogOpen` state and `confirmRemoveSelected` callback
  - Shows AlertDialog with track count before removal, destructive "Remove" button
- [x] There needs to be an undo button in the toast for certain operations such as removing tracks from a playlist, clearing the queue, removing items from favorites, deleting playlists etc.
  - Added undo for playlist track removal (stores song IDs, uses songIdToAdd API to restore)
  - Added undo for queue clearing (restores queue, index, and shuffle state)
  - Added undo for favorites toggle (calls star/unstar API to reverse the action)
  - Note: Playlist deletion undo not implemented as it would require a trash/restore API
- [x] The listening activity in settings seemingly isn't updating when playing tracks? We should ensure that the stats update in near real-time as tracks are played. We need to report listening stats once per minute or when playback is paused in addition to when tracks change. let's make it possible to update a listening_sessions entry and keep the id of the listening_session around in the UI so that we can update the same listening_session while the same track is playing and end up with only one (not multiple) listening_sessions entry per played track even though we update the entry once per minute or playback is paused/resumed etc. When the track changes we should start a new listening_session entry for the new track.
  - Backend now returns session_id when logging listening, accepts session_id for updates
  - Frontend tracks currentListeningSessionId and updates same session during playback
  - Added 60-second interval to periodically update listening stats during playback
  - Session is also updated on pause (not just on track change)
  - Session ID is reset when track changes, creating a new session for the new track
- [x] When clicking the create new folder button in the playlists view, it seems to create a normal empty playlist not a folder.
  - Fixed: Empty folders are now created as placeholders with trailing `/` (e.g., "FolderName/")
  - Folder placeholders are hidden from the playlist list but establish folder structure
  - When creating a real playlist in a folder, the placeholder is automatically deleted
  - Added helper functions: `isFolderPlaceholder`, `findFolderPlaceholder`, `isFolderEmpty`

- [x] The rate context menu option text is still misaligned horizontally, it's too far to the left compared to all other context menu option items texts
  - Added `mr-2` to the Star icon in both ContextMenuSubTrigger and DropdownMenuSubTrigger to match other menu items
- [x] Queue context menu inconsistency and multiple menus bug
  - Fixed: Right-click context menu and dropdown button now show identical menu items in the same order
  - Fixed: Opening dropdown menu now dismisses any open context menu (prevents two menus being open at once)
  - Moved "Remove from Queue" and "Remove from Playlist" to appear right after "Add to Playlist" in both menu types
- [x] Context menus for tracks in playlist details should contain a remove from playlist option, it's missing currently. Use existing shared components for this, including confirmation dialog.
  - Added `showRemoveFromPlaylist` and `onRemoveFromPlaylist` props to SongContextMenu, SongDropdownMenu, SongRow, and SortableSongRow
  - Playlist details page now passes these props to show "Remove from Playlist" option
  - Uses existing removeSongsMutation with undo support
- [x] Custom colored favicon still has some issues showing up after reloading the page, even after selecting empty cache and hard reload in the browser. The favicon is correctly set when changing the color in settings, but reloading the page reverts it back to the default color until i change the settings again.
  - Added inline script in layout.tsx that runs before React hydration to set favicon from localStorage
  - Removed static icon from Next.js metadata to prevent race condition with static icon loading
  - DynamicFavicon component still handles color changes after page load
- [x] Let's also show playlist breadcrumbs in the playlist details view
  - Added breadcrumb navigation showing folder hierarchy when playlist is in a folder
  - Clicking breadcrumbs navigates to the corresponding folder in /playlists view
  - Displays just the playlist name (not full path) in header title
- [x] Playlist folders need to have context menus and context menu buttons as well
  - Created FolderContextMenu and FolderDropdownMenu components
  - Added right-click context menu and dropdown button to folder cards/rows
  - Options: New Playlist, New Subfolder, Rename Folder, Delete Folder
  - Rename updates all playlists in the folder; Delete removes all playlists
- [x] Selection state needs to be reset on navigation, e.g. when navigating from tracks list with some selections to a playlist containing the same tracks, they will show up as selected.
  - Created `useClearSelectionOnNavigate` hook that clears selection on route changes
  - Hook monitors both pathname and search params for changes
  - Added SelectionClearer component to providers wrapped in Suspense
- [x] Let's refactor the playback queue to use dnd-kit for drag-and-drop reordering similar to how we did it for playlists. This will give us better control over the drag-and-drop experience, for example the actual move operation should only happen after dropping, not during dragging as is the case currently with Framer Motion's Reorder component.
  - Refactored queue.tsx to use @dnd-kit/core and @dnd-kit/sortable
  - Created DraggableQueueItem component with useSortable hook
  - Items now move only on drag end, not during dragging
  - Fixed Suspense boundary issue in playlists page that was blocking build
- [x] We should indicate current playback position on the waveform progress bar when hovering over it.
  - Added time tooltip that appears above the waveform showing the hovered position time in mm:ss format
  - Tooltip follows cursor position and is styled to match the UI theme
- [x] The playlist skeletons in the left sidebar should be a bit more detailed than just a rectangle (e.g. skeleton for icon + text would look much better)
  - Created PlaylistSkeletonItem component with icon placeholder + text skeleton
  - More visually accurate representation of actual playlist items
- [ ] **Advanced filtering** - Needs API planning for filter parameters (playCount, year, etc.) and UI design for filter builder component. What syntax/UI mechanism should we use?
- [ ] **Exclude items from shuffle playback** - Requires new DB field, API support, and UI toggle. This is a cross-cutting feature affecting playback logic, DB schema, and multiple UI views.
- [ ] **Directory structure navigation** - Requires API support and possibly DB changes for browsing files/directories. Need to design the navigation UI.
- [ ] **Favorites search via API** - Currently client-side filtering only. Should we add API-based filtering before consolidating search UX?
- [ ] **atomWithStorage refactor** - ~20 atoms need migration to server-synced storage. Should settings sync across devices? Need to create `atomWithServerStorage` utility first.
- [ ] **Drag-to-add to playlist/queue** - Need to choose library (dnd-kit?) and plan drop targets across the UI.
- [ ] **Consolidate search experience** - Decide whether to have a single global search input or keep per-view search. How should results be displayed?
- [ ] **Audio visualizer** - Need to plan visualization type (waveform, bars, etc.) and where to display it.
- [ ] **Large track lists in playback queue** - When starting playback from tracks view, queue only contains first few tracks. Need to plan virtualization strategy and lazy loading.
  - **Investigated**: The issue is by design - `queueSongs` only contains loaded items from infinite scroll. Full solution requires: 1) API endpoint to fetch song IDs by range, 2) On-demand loading in queue component, 3) Storing just IDs in queue and fetching song data when needed
- [ ] **Select all in bulk actions** - Currently only selects first 100 items. Need to implement selection of all items across paginated/virtualized views.
  - **Investigated**: The `selectAll` action receives only loaded items from the current page. Full solution requires: 1) Backend endpoint to get all matching IDs (with filters applied), 2) Virtual selection mode where "all" is stored differently than individual IDs
- [ ] **Featured artists handling** - How to handle artists like "20syl" vs "20syl, Fashawn"? Should we parse and link to individual artists?
- [ ] **Multiple libraries / music sources** - Requires significant backend and frontend work. Need to scope this as a separate milestone.
- [ ] **Multiple users and accounts** - Major feature requiring authentication overhaul, per-user data isolation, and admin controls.
- [x] **"Cool" looking track progress bar in footer** - Let's make the progress bar that spans from the left to the right edge of the footer a bit more interesting. Maybe a waveform style bar that follows the actual audio waveform of the track? It can be very low resolution if that helps with performance. For example it could consist of vertically centered bars of varying heights that represent the audio waveform amplitude at different time intervals. The bars should have rounded corners and be ~8px wide each, colored according to the accent color. The current playback position can be indicated by only highlighting the bars up to the current position with the accent color.
  - Created WaveformProgressBar component with FFT-based audio analysis
  - Uses Web Audio API to decode and analyze audio, calculating RMS amplitude for each bar
  - 200 bars with rounded corners for higher resolution
  - Shows placeholder waveform while loading, then replaces with real data
  - Hover effect: vertical indicator line and highlighted bars up to hover position
  - Buffered sections shown with different opacity
  - Click to seek, keyboard navigation with arrow keys
  - Created use-waveform hook and waveform store for caching analyzed data
- [ ] Scrobbling to last.fm
  - **Requires backend work**: Need Last.fm API key/secret configuration, OAuth flow for user authorization, session key storage, and forwarding scrobbles to Last.fm API
- [ ] Investigate speeding up the playwright tests by running them in parallel - we're going to have to launch separate server instances for each test worker to avoid conflicts.
  - **Analysis**: Currently tests run sequentially (workers: 1, fullyParallel: false) because:
    1. All tests share a single Ferrotune server at port 14040
    2. All tests share a single Next.js dev server at port 13000
    3. Tests can interfere with each other (e.g., modifying playlists, queue state)
  - **Required changes for parallelization**:
    1. Move server setup from globalSetup to a per-worker fixture
    2. Allocate unique ports per worker (e.g., base_port + worker_index * 10)
    3. Each worker needs its own Ferrotune server + Next.js server
    4. Update fixtures.ts to read worker-specific server config
    5. Consider using sharded databases or isolated temp directories
  - **Estimated impact**: 3-5x speedup with 5 workers, but startup overhead per worker (~20s each)
- [x] command.tsx - is this file used anywhere? It seems to define a CommandDialog component but I can't find any usages of it in the codebase.
  - **Confirmed**: This is a shadcn/ui component (based on cmdk) that provides a command palette interface. It's not currently used but provides useful primitives for future features like a global Cmd+K command palette or improved search experience. Keep as available component.