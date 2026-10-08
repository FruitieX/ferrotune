import { Sparkles } from "lucide-react";
import { getClient } from "@/lib/api/client";
import { MediaCard } from "@/components/shared/media-card";
import { MediaRow } from "@/components/shared/media-row";
import {
  SmartPlaylistContextMenu,
  SmartPlaylistDropdownMenu,
} from "@/components/playlists/smart-playlist-context-menu";
import { formatCount } from "@/lib/utils/format";
import { parsePlaylistPath } from "@/lib/utils/playlist-folders";
import type { SmartPlaylistInfo } from "@/lib/api/generated/SmartPlaylistInfo";

// Smart playlist grid card
interface SmartPlaylistGridCardProps {
  smartPlaylist: SmartPlaylistInfo;
  onPlay?: () => void;
}

export function SmartPlaylistGridCard({
  smartPlaylist,
  onPlay,
}: SmartPlaylistGridCardProps) {
  // Get cover art URL for smart playlist (uses sp- prefix for tiled cover generation)
  const coverArtUrl = getClient()?.getCoverArtUrl(
    `sp-${smartPlaylist.id}`,
    "medium",
  );

  return (
    <SmartPlaylistContextMenu smartPlaylist={smartPlaylist}>
      <div className="group relative">
        <MediaCard
          title={
            parsePlaylistPath(smartPlaylist.name).displayName ||
            smartPlaylist.name
          }
          titleIcon={<Sparkles className="w-4 h-4 shrink-0 text-purple-500" />}
          subtitle={
            smartPlaylist.songCount === null
              ? "Dynamic playlist"
              : formatCount(smartPlaylist.songCount, "song")
          }
          href={`/playlists/smart?id=${encodeURIComponent(smartPlaylist.id)}`}
          coverArt={coverArtUrl}
          coverType="smartPlaylist"
          colorSeed={`smart-${smartPlaylist.id}`}
          onPlay={onPlay}
        />
        <SmartPlaylistDropdownMenu smartPlaylist={smartPlaylist} />
      </div>
    </SmartPlaylistContextMenu>
  );
}

// Smart playlist list row
interface SmartPlaylistListRowProps {
  smartPlaylist: SmartPlaylistInfo;
  index: number;
  showIndex?: boolean;
  onPlay?: () => void;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
}

export function SmartPlaylistListRow({
  smartPlaylist,
  index,
  showIndex = true,
  onPlay,
  isSelected,
  isSelectionMode,
  onSelect,
}: SmartPlaylistListRowProps) {
  // Get cover art URL for smart playlist (uses sp- prefix for tiled cover generation)
  const coverArtUrl = getClient()?.getCoverArtUrl(
    `sp-${smartPlaylist.id}`,
    "small",
  );

  return (
    <SmartPlaylistContextMenu smartPlaylist={smartPlaylist}>
      <div className="group relative">
        <MediaRow
          index={showIndex ? index : undefined}
          title={
            parsePlaylistPath(smartPlaylist.name).displayName ||
            smartPlaylist.name
          }
          titleIcon={<Sparkles className="w-4 h-4 shrink-0 text-purple-500" />}
          subtitle={
            smartPlaylist.songCount === null
              ? "Dynamic playlist"
              : formatCount(smartPlaylist.songCount, "song")
          }
          href={`/playlists/smart?id=${encodeURIComponent(smartPlaylist.id)}`}
          coverArt={coverArtUrl}
          coverType="smartPlaylist"
          colorSeed={`smart-${smartPlaylist.id}`}
          onPlay={onPlay}
          isSelected={isSelected}
          isSelectionMode={isSelectionMode}
          onSelect={onSelect}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <SmartPlaylistDropdownMenu smartPlaylist={smartPlaylist} inline />
        </div>
      </div>
    </SmartPlaylistContextMenu>
  );
}
