"use client";

import { useRouter } from "next/navigation";
import { useAtom, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { User, LogOut, UserPlus, Check, X } from "lucide-react";
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
import { initializeClient } from "@/lib/api/client";

export function AccountMenuItems() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [connection, setConnection] = useAtom(serverConnectionAtom);
  const [savedAccounts, setSavedAccounts] = useAtom(savedAccountsAtom);
  const setConnectionStatus = useSetAtom(connectionStatusAtom);

  const currentKey = connection ? accountKey(connection) : null;
  const hasMultipleAccounts = savedAccounts.length > 1;

  const switchToAccount = async (account: (typeof savedAccounts)[0]) => {
    const key = accountKey(account);
    if (key === currentKey) return;

    try {
      const client = initializeClient(account);
      setConnectionStatus("connecting");
      await client.ping();

      setConnection(account);
      setConnectionStatus("connected");

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
    </>
  );
}
