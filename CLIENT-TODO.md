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

## Future Enhancements

- [ ] Make the playback queue drawer a sidebar that stays open on desktop, with only the toggle button toggling it on/off. Use similar strategy for resizing the main container with animations as the left sidebar does.
- [ ] Fix left sidebar items temporarily line wrapping when the expand animation is running
- [ ] Tracks list on artist details page
- [ ] Media Session API for OS integration
- [ ] Recently played history
- [ ] Keyboard shortcuts
- [ ] Light theme option
- [ ] Audio visualizer
- [ ] Drag-to-add to playlist
