"use client";

import { User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResponsiveDropdownMenu } from "@/components/shared/responsive-context-menu";
import { AccountMenuItems } from "./account-menu-items";

export function MobileProfileMenu() {
  return (
    <ResponsiveDropdownMenu
      trigger={
        <Button variant="ghost" size="icon" className="lg:hidden shrink-0">
          <User className="w-5 h-5" />
        </Button>
      }
      renderMenuContent={(components) => (
        <AccountMenuItems components={components} />
      )}
      contentClassName="w-64"
      align="start"
      drawerTitle="Account"
    />
  );
}
