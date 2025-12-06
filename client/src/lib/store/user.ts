import { atom } from "jotai";
import type { UserInfo } from "@/lib/api/types";

// Current user info - null when not loaded yet
export const currentUserAtom = atom<UserInfo | null>(null);

// Derived atom for checking if current user is admin
export const isCurrentUserAdminAtom = atom((get) => {
  const user = get(currentUserAtom);
  return user?.isAdmin ?? false;
});
