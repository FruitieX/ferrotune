"use client";

import { useRouter } from "next/navigation";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { toast } from "sonner";
import {
  User,
  LogOut,
  UserPlus,
  Check,
  X,
  Monitor,
  Smartphone,
  Plus,
  Music,
  ArrowRightLeft,
} from "lucide-react";
import type { MenuComponents } from "@/components/shared/media-menu-items";
import {
  serverConnectionAtom,
  savedAccountsAtom,
  accountKey,
  accountLabel,
  connectionStatusAtom,
} from "@/lib/store/auth";
import {
  currentSessionIdAtom,
  activeSessionsAtom,
  controllingSessionIdAtom,
  effectiveSessionIdAtom,
  isAudioOwnerAtom,
  remotePlaybackStateAtom,
  pendingTakeoverPlayAtom,
} from "@/lib/store/session";
import {
  currentSongAtom,
  fetchQueueAndPlayAtom,
} from "@/lib/store/server-queue";
import { playbackStateAtom } from "@/lib/store/player";
import { initializeClient, getClient, getClientName } from "@/lib/api/client";
import { useHasFinePointer } from "@/lib/hooks/use-media-query";
import { hasNativeAudio } from "@/lib/tauri";

interface AccountMenuItemsProps {
  components: MenuComponents;
}

export function AccountMenuItems({
  components: { Item, Separator },
}: AccountMenuItemsProps) {
  const hasFinePointer = useHasFinePointer();
  const router = useRouter();
  const [connection, setConnection] = useAtom(serverConnectionAtom);
  const [savedAccounts, setSavedAccounts] = useAtom(savedAccountsAtom);
  const setConnectionStatus = useSetAtom(connectionStatusAtom);

  const currentKey = connection ? accountKey(connection) : null;
  const hasMultipleAccounts = savedAccounts.length > 1;

  const [currentSessionId, setCurrentSessionId] = useAtom(currentSessionIdAtom);
  const activeSessions = useAtomValue(activeSessionsAtom);
  const effectiveSessionId = useAtomValue(effectiveSessionIdAtom);
  const setControllingSessionId = useSetAtom(controllingSessionIdAtom);
  const [isAudioOwner, setIsAudioOwner] = useAtom(isAudioOwnerAtom);
  const setActiveSessions = useSetAtom(activeSessionsAtom);
  const setRemotePlaybackState = useSetAtom(remotePlaybackStateAtom);
  const setPendingTakeoverPlay = useSetAtom(pendingTakeoverPlayAtom);
  const fetchQueueAndPlay = useSetAtom(fetchQueueAndPlayAtom);

  // Local playback state for own session display
  const localCurrentSong = useAtomValue(currentSongAtom);
  const localPlaybackState = useAtomValue(playbackStateAtom);

  const switchToAccount = async (account: (typeof savedAccounts)[0]) => {
    const key = accountKey(account);
    if (key === currentKey) return;

    try {
      const client = initializeClient(account);
      setConnectionStatus("connecting");
      await client.ping();

      setConnection(account);
      setConnectionStatus("connected");

      toast.success(`Switched to ${accountLabel(account)}`);
    } catch {
      setConnectionStatus("error");
      toast.error("Failed to connect. The account may have expired.");
    }
  };

  const removeAccount = (account: (typeof savedAccounts)[0]) => {
    const key = accountKey(account);
    setSavedAccounts((prev) => prev.filter((a) => accountKey(a) !== key));

    if (key === currentKey) {
      setConnection(null);
      router.push("/login");
    }
  };

  const handleLogout = () => {
    setConnection(null);
    router.push("/login");
    toast.success("Logged out successfully");
  };

  const switchToSession = (sessionId: string) => {
    if (sessionId === effectiveSessionId) {
      // Already on this session (own or followed), do nothing
      return;
    }
    if (sessionId === currentSessionId) {
      // Switch back to own session
      setControllingSessionId(null);
      setIsAudioOwner(true);
      setRemotePlaybackState(null);
      return;
    }
    // Remote-control another session
    setControllingSessionId(sessionId);
    setIsAudioOwner(false);
  };

  const createNewSession = async () => {
    const client = getClient();
    if (!client) return;

    try {
      const created = await client.createSession(getClientName());
      setCurrentSessionId(created.id);
      setControllingSessionId(null);
      setIsAudioOwner(true);
      // Refresh list
      const response = await client.listSessions();
      setActiveSessions(response.sessions);
      toast.success("New session created");
    } catch {
      toast.error("Failed to create session");
    }
  };

  const takeOverSession = async (sessionId: string) => {
    const client = getClient();
    if (!client) return;

    const session = activeSessions.find((s) => s.id === sessionId);
    const wasFollowing = effectiveSessionId === sessionId;
    const wasPlaying = session?.isPlaying ?? false;

    try {
      // Tell the current owner to stop playback and update session client type
      await client.sendSessionCommand(
        sessionId,
        "takeOver",
        undefined,
        undefined,
        undefined,
        getClientName(),
      );

      // Signal auto-play for the queue fetch triggered by session change
      if (wasPlaying && !wasFollowing) {
        setPendingTakeoverPlay(true);
      }

      // Adopt the session
      setCurrentSessionId(sessionId);
      setControllingSessionId(null);
      setIsAudioOwner(true);
      setRemotePlaybackState(null);

      // If already following, effectiveSessionId doesn't change so the
      // automatic queue refetch won't fire — trigger playback directly
      if (wasPlaying && wasFollowing) {
        fetchQueueAndPlay();
      }

      toast.success("Session taken over");
    } catch {
      toast.error("Failed to take over session");
    }
  };

  const deleteSession = async (sessionId: string) => {
    const client = getClient();
    if (!client) return;

    try {
      await client.deleteSession(sessionId);
      // Refresh list
      const response = await client.listSessions();
      setActiveSessions(response.sessions);
      // If we deleted the session we were controlling, go back to our own
      if (sessionId === currentSessionId) {
        setCurrentSessionId(null);
        setControllingSessionId(null);
      }
      toast.success("Session ended");
    } catch {
      toast.error("Failed to end session");
    }
  };

  return (
    <>
      {hasMultipleAccounts && (
        <>
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground font-semibold">
            <div className="w-4 shrink-0" />
            Accounts
          </div>
          {savedAccounts.map((account) => {
            const key = accountKey(account);
            const isCurrent = key === currentKey;
            return (
              <Item
                key={key}
                className="flex items-center gap-2 group"
                onClick={() => switchToAccount(account)}
              >
                <User className="w-4 h-4 shrink-0 mr-2" />
                <span className="truncate flex-1">
                  {account.label || accountLabel(account)}
                </span>
                {isCurrent ? (
                  <Check className="w-4 h-4 shrink-0 text-primary" />
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    className={`shrink-0 transition-opacity p-0.5 rounded hover:bg-muted ${hasFinePointer ? "opacity-0 group-hover:opacity-100" : "opacity-100"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAccount(account);
                    }}
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                )}
              </Item>
            );
          })}
          <Separator />
        </>
      )}
      <Item onClick={() => router.push("/profile")}>
        <User className="w-4 h-4 mr-2" />
        Profile
      </Item>
      <Item onClick={() => router.push("/login")}>
        <UserPlus className="w-4 h-4 mr-2" />
        Add Account
      </Item>
      <Separator />
      <Item onClick={handleLogout}>
        <LogOut className="w-4 h-4 mr-2" />
        Sign Out
      </Item>
      {activeSessions.length > 0 && (
        <>
          <Separator />
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground font-semibold">
            <div className="w-4 shrink-0" />
            Sessions
          </div>
          {activeSessions.map((session) => {
            const isOwn = session.id === currentSessionId;
            const isActive = session.id === effectiveSessionId;
            // For the active session (own or controlled), use local playback state
            const songTitle = isActive
              ? localCurrentSong?.title
              : session.currentSongTitle;
            const songArtist = isActive
              ? localCurrentSong?.artist
              : session.currentSongArtist;
            const playing = isActive
              ? localPlaybackState === "playing"
              : session.isPlaying;
            return (
              <Item
                key={session.id}
                className="flex items-center gap-2 group"
                onClick={() => switchToSession(session.id)}
              >
                {session.clientName === "ferrotune-mobile" ? (
                  <Smartphone className="w-4 h-4 shrink-0 mr-2" />
                ) : (
                  <Monitor className="w-4 h-4 shrink-0 mr-2" />
                )}
                <div className="flex-1 min-w-0">
                  <span className="truncate block text-sm">
                    {session.name}
                    {isOwn &&
                      isAudioOwner &&
                      (hasNativeAudio() ? " (this app)" : " (this tab)")}
                  </span>
                  {songTitle && (
                    <span className="truncate block text-xs text-muted-foreground">
                      {playing && <Music className="w-3 h-3 inline mr-1" />}
                      {songTitle}
                      {songArtist && ` — ${songArtist}`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {isActive && <Check className="w-4 h-4 text-primary" />}
                  {(!isOwn || (isActive && !isAudioOwner)) && (
                    <div
                      role="button"
                      tabIndex={0}
                      className={`transition-opacity p-0.5 rounded hover:bg-muted ${!isActive && hasFinePointer ? "opacity-0 group-hover:opacity-100" : "opacity-100"}`}
                      title="Take over session"
                      onClick={(e) => {
                        e.stopPropagation();
                        takeOverSession(session.id);
                      }}
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                  )}
                  {!isOwn && !isActive && (
                    <div
                      role="button"
                      tabIndex={0}
                      className={`transition-opacity p-0.5 rounded hover:bg-muted ${hasFinePointer ? "opacity-0 group-hover:opacity-100" : "opacity-100"}`}
                      title="End session"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSession(session.id);
                      }}
                    >
                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                  )}
                </div>
              </Item>
            );
          })}
          <Item onClick={createNewSession}>
            <Plus className="w-4 h-4 mr-2" />
            New Session
          </Item>
        </>
      )}
    </>
  );
}
