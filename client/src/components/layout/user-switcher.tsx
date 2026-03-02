"use client";

import { useRouter } from "next/navigation";
import { useAtom, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { User, ChevronsUpDown, LogOut, UserPlus, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  serverConnectionAtom,
  savedAccountsAtom,
  accountKey,
  accountLabel,
  connectionStatusAtom,
} from "@/lib/store/auth";
import { initializeClient } from "@/lib/api/client";

interface UserSwitcherProps {
  isCollapsed: boolean;
  isActive: boolean;
}

export function UserSwitcher({ isCollapsed, isActive }: UserSwitcherProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [connection, setConnection] = useAtom(serverConnectionAtom);
  const [savedAccounts, setSavedAccounts] = useAtom(savedAccountsAtom);
  const setConnectionStatus = useSetAtom(connectionStatusAtom);

  const currentKey = connection ? accountKey(connection) : null;
  const currentLabel = connection ? accountLabel(connection) : "Not connected";
  const hasMultipleAccounts = savedAccounts.length > 1;
  const hasAnySavedAccounts = savedAccounts.length > 0;

  const switchToAccount = async (account: (typeof savedAccounts)[0]) => {
    const key = accountKey(account);
    if (key === currentKey) return;

    try {
      const client = initializeClient(account);
      setConnectionStatus("connecting");
      await client.ping();

      setConnection(account);
      setConnectionStatus("connected");

      // Clear all cached data for the previous user
      queryClient.clear();

      toast.success(`Switched to ${accountLabel(account)}`);
    } catch {
      setConnectionStatus("error");
      toast.error("Failed to connect. The account may have expired.");
    }
  };

  const removeAccount = (account: (typeof savedAccounts)[0]) => {
    const key = accountKey(account);
    setSavedAccounts((prev) => prev.filter((a) => accountKey(a) !== key));

    // If removing the current account, log out
    if (key === currentKey) {
      setConnection(null);
      router.push("/login");
    }
  };

  const handleLogout = () => {
    setConnection(null);
    queryClient.clear();
    router.push("/login");
    toast.success("Logged out successfully");
  };

  // If no saved accounts or only one, show a simple button
  if (!hasAnySavedAccounts || (!hasMultipleAccounts && !connection)) {
    return (
      <Button
        variant="ghost"
        className={cn(
          "w-full justify-start gap-4 h-10 px-3 hover:bg-sidebar-accent overflow-hidden",
          isActive && "bg-sidebar-accent text-sidebar-primary font-semibold",
          isCollapsed && "justify-center px-0",
        )}
        onClick={() => router.push("/profile")}
      >
        <User
          className={cn("w-5 h-5 shrink-0", isActive && "text-sidebar-primary")}
        />
        {!isCollapsed && (
          <span className="truncate whitespace-nowrap">{currentLabel}</span>
        )}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start gap-4 h-10 px-3 hover:bg-sidebar-accent overflow-hidden",
            isActive && "bg-sidebar-accent text-sidebar-primary font-semibold",
            isCollapsed && "justify-center px-0",
          )}
        >
          <User
            className={cn(
              "w-5 h-5 shrink-0",
              isActive && "text-sidebar-primary",
            )}
          />
          {!isCollapsed && (
            <>
              <span className="truncate whitespace-nowrap flex-1 text-left">
                {currentLabel}
              </span>
              <ChevronsUpDown className="w-4 h-4 shrink-0 text-muted-foreground" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
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
        <DropdownMenuItem onClick={() => router.push("/profile")}>
          <User className="w-4 h-4 mr-2" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            router.push("/login");
          }}
        >
          <UserPlus className="w-4 h-4 mr-2" />
          Add Account
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
