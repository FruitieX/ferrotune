"use client";

import { useRouter } from "next/navigation";
import { useAtomValue } from "jotai";
import { User, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ResponsiveDropdownMenu } from "@/components/shared/responsive-context-menu";
import {
  serverConnectionAtom,
  savedAccountsAtom,
  accountLabel,
} from "@/lib/store/auth";
import { AccountMenuItems } from "./account-menu-items";

interface UserSwitcherProps {
  isCollapsed: boolean;
  isActive: boolean;
}

export function UserSwitcher({ isCollapsed, isActive }: UserSwitcherProps) {
  const router = useRouter();
  const connection = useAtomValue(serverConnectionAtom);
  const savedAccounts = useAtomValue(savedAccountsAtom);

  const hasMultipleAccounts = savedAccounts.length > 1;
  const displayLabel = hasMultipleAccounts
    ? connection
      ? accountLabel(connection)
      : "Not connected"
    : "Profile";

  // No saved accounts - show a simple button that goes to profile
  if (savedAccounts.length === 0) {
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
          <span className="truncate whitespace-nowrap">{displayLabel}</span>
        )}
      </Button>
    );
  }

  return (
    <ResponsiveDropdownMenu
      trigger={
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
                {displayLabel}
              </span>
              <ChevronsUpDown className="w-4 h-4 shrink-0 text-muted-foreground" />
            </>
          )}
        </Button>
      }
      renderMenuContent={(components) => (
        <AccountMenuItems components={components} />
      )}
      contentClassName="w-64"
      align="start"
      side="top"
      drawerTitle="Account"
    />
  );
}
