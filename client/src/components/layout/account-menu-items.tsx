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
  Music,
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
  connectedClientsAtom,
  clientIdAtom,
  isAudioOwnerAtom,
  ownerClientIdAtom,
  ownerClientNameAtom,
  markSelfTakeoverAtom,
} from "@/lib/store/session";
import { currentSongAtom } from "@/lib/store/server-queue";
import { playbackStateAtom, currentTimeAtom } from "@/lib/store/player";
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

  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const connectedClients = useAtomValue(connectedClientsAtom);
  const myClientId = useAtomValue(clientIdAtom);
  const ownerClientId = useAtomValue(ownerClientIdAtom);
  const setIsAudioOwner = useSetAtom(isAudioOwnerAtom);
  const setOwnerClientId = useSetAtom(ownerClientIdAtom);
  const setOwnerClientName = useSetAtom(ownerClientNameAtom);
  const markSelfTakeover = useSetAtom(markSelfTakeoverAtom);

  // Local playback state for own session display
  const localCurrentSong = useAtomValue(currentSongAtom);
  const localPlaybackState = useAtomValue(playbackStateAtom);
  const currentTime = useAtomValue(currentTimeAtom);

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

  const transferToClient = async (
    targetClientId: string,
    targetClientName: string,
  ) => {
    const client = getClient();
    if (!client || !currentSessionId) return;

    const transferringToSelf = targetClientId === myClientId;
    const shouldResumePlayback =
      !!localCurrentSong &&
      (localPlaybackState === "playing" || localPlaybackState === "loading");

    // Calculate current position to send with takeover so the new owner
    // picks up from the right spot (avoids stale DB position from heartbeat lag).
    // currentTime already has interpolated position for both follower and owner.
    const positionMs =
      currentTime > 0 ? Math.round(currentTime * 1000) : undefined;

    try {
      // Tell the server to transfer ownership
      await client.sendSessionCommand(
        currentSessionId,
        "takeOver",
        positionMs,
        undefined,
        undefined,
        targetClientName,
        targetClientId,
        shouldResumePlayback,
      );

      if (transferringToSelf) {
        // We're taking over — become the owner.
        // Don't call fetchQueueAndPlay or clear remotePlaybackState here;
        // the ownerChanged SSE handler will do both exactly once.
        markSelfTakeover();
        setIsAudioOwner(true);
        setOwnerClientId(myClientId);
        setOwnerClientName(getClientName());
      } else {
        // Transferring to another client — become a follower
        setIsAudioOwner(false);
        setOwnerClientId(targetClientId);
        setOwnerClientName(targetClientName);
      }

      toast.success("Playback transferred");
    } catch {
      toast.error("Failed to transfer playback");
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
      {connectedClients.length > 0 && (
        <>
          <Separator />
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground font-semibold">
            <div className="w-4 shrink-0" />
            Connected Clients
          </div>
          {connectedClients.map((client) => {
            const isMe = client.clientId === myClientId;
            const isOwner = client.clientId === ownerClientId;
            return (
              <Item
                key={client.clientId}
                className="flex items-center gap-2 group"
                onClick={() => {
                  if (!isOwner) {
                    transferToClient(client.clientId, client.clientName);
                  }
                }}
              >
                {client.clientName === "ferrotune-mobile" ? (
                  <Smartphone className="w-4 h-4 shrink-0 mr-2" />
                ) : (
                  <Monitor className="w-4 h-4 shrink-0 mr-2" />
                )}
                <div className="flex-1 min-w-0">
                  <span className="truncate block text-sm">
                    {client.displayName}
                    {isMe && (hasNativeAudio() ? " (this app)" : " (this tab)")}
                  </span>
                  {isOwner && (
                    <span className="truncate block text-xs text-muted-foreground">
                      {localPlaybackState === "playing" && (
                        <Music className="w-3 h-3 inline mr-1" />
                      )}
                      {localCurrentSong?.title
                        ? `${localCurrentSong.title}${localCurrentSong.artist ? ` — ${localCurrentSong.artist}` : ""}`
                        : "Owner"}
                    </span>
                  )}
                </div>
                {isOwner && <Check className="w-4 h-4 shrink-0 text-primary" />}
              </Item>
            );
          })}
        </>
      )}
    </>
  );
}
