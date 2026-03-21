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
  Plus,
  Music,
  ArrowRightLeft,
} from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
  isAudioOwnerAtom,
  remotePlaybackStateAtom,
} from "@/lib/store/session";
import { currentSongAtom } from "@/lib/store/server-queue";
import { playbackStateAtom } from "@/lib/store/player";
import { initializeClient, getClient } from "@/lib/api/client";

export function AccountMenuItems() {
  const router = useRouter();
  const [connection, setConnection] = useAtom(serverConnectionAtom);
  const [savedAccounts, setSavedAccounts] = useAtom(savedAccountsAtom);
  const setConnectionStatus = useSetAtom(connectionStatusAtom);

  const currentKey = connection ? accountKey(connection) : null;
  const hasMultipleAccounts = savedAccounts.length > 1;

  const [currentSessionId, setCurrentSessionId] = useAtom(currentSessionIdAtom);
  const activeSessions = useAtomValue(activeSessionsAtom);
  const setControllingSessionId = useSetAtom(controllingSessionIdAtom);
  const setIsAudioOwner = useSetAtom(isAudioOwnerAtom);
  const setActiveSessions = useSetAtom(activeSessionsAtom);
  const setRemotePlaybackState = useSetAtom(remotePlaybackStateAtom);

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
      const created = await client.createSession("ferrotune-web");
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

    try {
      // Tell the current owner to stop playback
      await client.sendSessionCommand(sessionId, "takeOver");
      // Adopt the session
      setCurrentSessionId(sessionId);
      setControllingSessionId(null);
      setIsAudioOwner(true);
      setRemotePlaybackState(null);
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
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Accounts
          </DropdownMenuLabel>
          {savedAccounts.map((account) => {
            const key = accountKey(account);
            const isCurrent = key === currentKey;
            return (
              <DropdownMenuItem
                key={key}
                className="flex items-center gap-2 group"
                onClick={() => switchToAccount(account)}
              >
                <User className="w-4 h-4 shrink-0" />
                <span className="truncate flex-1">
                  {account.label || accountLabel(account)}
                </span>
                {isCurrent ? (
                  <Check className="w-4 h-4 shrink-0 text-primary" />
                ) : (
                  <button
                    type="button"
                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAccount(account);
                    }}
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem onClick={() => router.push("/profile")}>
        <User className="w-4 h-4 mr-2" />
        Profile
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => router.push("/login")}>
        <UserPlus className="w-4 h-4 mr-2" />
        Add Account
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={handleLogout}>
        <LogOut className="w-4 h-4 mr-2" />
        Sign Out
      </DropdownMenuItem>
      {activeSessions.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Sessions
          </DropdownMenuLabel>
          {activeSessions.map((session) => {
            const isOwn = session.id === currentSessionId;
            // For own session, use local playback state for real-time display
            const songTitle = isOwn
              ? localCurrentSong?.title
              : session.currentSongTitle;
            const songArtist = isOwn
              ? localCurrentSong?.artist
              : session.currentSongArtist;
            const playing = isOwn
              ? localPlaybackState === "playing"
              : session.isPlaying;
            return (
              <DropdownMenuItem
                key={session.id}
                className="flex items-center gap-2 group"
                onClick={() => switchToSession(session.id)}
              >
                <Monitor className="w-4 h-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="truncate block text-sm">
                    {session.clientName || session.name}
                    {isOwn && " (this tab)"}
                  </span>
                  {songTitle && (
                    <span className="truncate block text-xs text-muted-foreground">
                      {playing && <Music className="w-3 h-3 inline mr-1" />}
                      {songTitle}
                      {songArtist && ` — ${songArtist}`}
                    </span>
                  )}
                </div>
                {isOwn ? (
                  <Check className="w-4 h-4 shrink-0 text-primary" />
                ) : (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
                      title="Take over session"
                      onClick={(e) => {
                        e.stopPropagation();
                        takeOverSession(session.id);
                      }}
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
                      title="End session"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSession(session.id);
                      }}
                    >
                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </div>
                )}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuItem onClick={createNewSession}>
            <Plus className="w-4 h-4 mr-2" />
            New Session
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}
