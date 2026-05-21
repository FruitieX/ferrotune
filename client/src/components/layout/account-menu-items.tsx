"use client";

import { useRouter } from "next/navigation";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  User,
  LogOut,
  UserPlus,
  Check,
  X,
  Cast,
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
  effectiveSessionIdAtom,
  connectedClientsAtom,
  clientIdAtom,
  isAudioOwnerAtom,
  ownerClientIdAtom,
  ownerClientNameAtom,
  markSelfTakeoverAtom,
} from "@/lib/store/session";
import { clearQueueAtom, currentSongAtom } from "@/lib/store/server-queue";
import {
  effectivePlaybackStateAtom,
  currentTimeAtom,
} from "@/lib/store/player";
import {
  FerrotuneClient,
  initializeClient,
  getClient,
  getClientName,
} from "@/lib/api/client";
import { useHasFinePointer } from "@/lib/hooks/use-media-query";
import { hasNativeAudio } from "@/lib/tauri";
import { isCastClientName } from "@/lib/cast/constants";

interface AccountMenuItemsProps {
  components: MenuComponents;
}

interface ConnectedClientsMenuItemsProps {
  components: MenuComponents;
  showSeparator?: boolean;
}

export function ConnectedClientsMenuItems({
  components: { Item, Separator },
  showSeparator = false,
}: ConnectedClientsMenuItemsProps) {
  const currentSessionId = useAtomValue(effectiveSessionIdAtom);
  const connectedClients = useAtomValue(connectedClientsAtom);
  const myClientId = useAtomValue(clientIdAtom);
  const ownerClientId = useAtomValue(ownerClientIdAtom);
  const setIsAudioOwner = useSetAtom(isAudioOwnerAtom);
  const setOwnerClientId = useSetAtom(ownerClientIdAtom);
  const setOwnerClientName = useSetAtom(ownerClientNameAtom);
  const markSelfTakeover = useSetAtom(markSelfTakeoverAtom);

  const localCurrentSong = useAtomValue(currentSongAtom);
  const effectivePlaybackState = useAtomValue(effectivePlaybackStateAtom);
  const currentTime = useAtomValue(currentTimeAtom);

  const transferToClient = async (
    targetClientId: string,
    targetClientName: string,
  ) => {
    const client = getClient();
    if (!client || !currentSessionId) return;

    const transferringToSelf = targetClientId === myClientId;
    const shouldResumePlayback =
      !!localCurrentSong &&
      (effectivePlaybackState === "playing" ||
        effectivePlaybackState === "loading");
    const positionMs =
      currentTime > 0 ? Math.round(currentTime * 1000) : undefined;

    try {
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
        markSelfTakeover();
        setIsAudioOwner(true);
        setOwnerClientId(myClientId);
        setOwnerClientName(getClientName());
      } else {
        setIsAudioOwner(false);
        setOwnerClientId(targetClientId);
        setOwnerClientName(targetClientName);
      }

      toast.success("Playback transferred");
    } catch {
      toast.error("Failed to transfer playback");
    }
  };

  if (connectedClients.length === 0) return null;

  return (
    <>
      {showSeparator && <Separator />}
      <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground font-semibold">
        <div className="w-4 shrink-0" />
        Connected Clients
      </div>
      {connectedClients.map((client) => {
        const isMe = client.clientId === myClientId;
        const isOwner = client.clientId === ownerClientId;
        const metadataLabel = client.deviceLabel ?? client.networkLabel;
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
            {isCastClientName(client.clientName) ? (
              <Cast className="w-4 h-4 shrink-0 mr-2" />
            ) : client.clientName === "ferrotune-mobile" ? (
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
                  {effectivePlaybackState === "playing" && (
                    <Music className="w-3 h-3 inline mr-1" />
                  )}
                  {localCurrentSong?.title
                    ? `${localCurrentSong.title}${localCurrentSong.artist ? ` — ${localCurrentSong.artist}` : ""}`
                    : "Owner"}
                </span>
              )}
              {metadataLabel && (
                <span className="truncate block text-xs text-muted-foreground">
                  {metadataLabel}
                </span>
              )}
            </div>
            {isOwner && <Check className="w-4 h-4 shrink-0 text-primary" />}
          </Item>
        );
      })}
    </>
  );
}

export function AccountMenuItems({
  components: { Item, Separator },
}: AccountMenuItemsProps) {
  const hasFinePointer = useHasFinePointer();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [connection, setConnection] = useAtom(serverConnectionAtom);
  const [savedAccounts, setSavedAccounts] = useAtom(savedAccountsAtom);
  const setConnectionStatus = useSetAtom(connectionStatusAtom);
  const clearQueue = useSetAtom(clearQueueAtom);

  const currentKey = connection ? accountKey(connection) : null;
  const hasMultipleAccounts = savedAccounts.length > 1;

  const switchToAccount = async (account: (typeof savedAccounts)[0]) => {
    const key = accountKey(account);
    if (key === currentKey) return;

    try {
      const client = new FerrotuneClient(account);
      setConnectionStatus("connecting");
      await client.ping();

      initializeClient(account);
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
      queryClient.clear();
      clearQueue();
      setConnection(null);
      router.push("/login");
    }
  };

  const handleLogout = () => {
    queryClient.clear();
    clearQueue();
    setConnection(null);
    router.push("/login");
    toast.success("Logged out successfully");
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
      <ConnectedClientsMenuItems
        components={{ Item, Separator }}
        showSeparator
      />
    </>
  );
}
