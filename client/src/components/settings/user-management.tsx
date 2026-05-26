"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  User,
  Plus,
  MoreVertical,
  Trash2,
  Shield,
  FolderOpen,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { getClient } from "@/lib/api/client";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import type { UserInfo, MusicFolderInfo } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

interface UserCardProps {
  user: UserInfo;
  folders: MusicFolderInfo[];
  currentUserId: number;
  onEdit: (user: UserInfo) => void;
  onDelete: (user: UserInfo) => void;
  onManageAccess: (user: UserInfo) => void;
}

function UserCard({
  user,
  folders,
  currentUserId,
  onEdit,
  onDelete,
  onManageAccess,
}: UserCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const isSelf = user.id === currentUserId;

  const accessibleFolders = folders.filter((f) =>
    user.libraryAccess.includes(f.id),
  );
  const hasAllAccess = user.libraryAccess.length === folders.length;

  return (
    <>
      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 active:bg-muted/70 transition-colors touch-manipulation active:scale-[0.995]">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <User className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{user.username}</span>
            {user.isAdmin && (
              <Badge variant="secondary" className="shrink-0 gap-1">
                <Shield className="w-3 h-3" />
                Admin
              </Badge>
            )}
            {isSelf && (
              <Badge variant="outline" className="shrink-0">
                You
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <FolderOpen className="w-3 h-3" />
            {hasAllAccess
              ? "All libraries"
              : `${accessibleFolders.length} of ${folders.length} libraries`}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(user)}>
              <User className="w-4 h-4 mr-2" />
              Edit User
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onManageAccess(user)}>
              <FolderOpen className="w-4 h-4 mr-2" />
              Library Access
            </DropdownMenuItem>
            {!isSelf && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete User
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete user &quot;{user.username}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this user account. Their playlists
              and preferences will be lost. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete(user);
                setShowDeleteDialog(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/80 active:bg-destructive/70"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function UserManagement() {
  const queryClient = useQueryClient();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserInfo | null>(null);
  const [accessDialogUser, setAccessDialogUser] = useState<UserInfo | null>(
    null,
  );

  // Form state
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [selectedFolders, setSelectedFolders] = useState<number[]>([]);

  // Get current user ID from auth context
  const { user: currentUser } = useCurrentUser();
  const currentUserId = currentUser?.id ?? 0;

  // Fetch users
  const {
    data: usersData,
    isLoading: usersLoading,
    error: usersError,
  } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getUsers();
    },
  });

  // Fetch music folders for library access
  const { data: foldersData } = useQuery({
    queryKey: ["adminMusicFolders"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getAdminMusicFolders();
    },
  });

  // Create user mutation
  const createUserMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.createUser({
        username: newUsername,
        password: newPassword,
        email: null,
        isAdmin: newIsAdmin,
        libraryAccess: selectedFolders,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setCreateDialogOpen(false);
      resetForm();
      toast.success("User created successfully");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to create user",
      );
    },
  });

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client || !editingUser) throw new Error("Not connected");
      return client.updateUser(editingUser.id, {
        username: newUsername !== editingUser.username ? newUsername : null,
        password: newPassword || null,
        email: null,
        isAdmin: newIsAdmin !== editingUser.isAdmin ? newIsAdmin : null,
        libraryAccess: null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setEditingUser(null);
      resetForm();
      toast.success("User updated successfully");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to update user",
      );
    },
  });

  // Delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.deleteUser(userId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      toast.success("User deleted successfully");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete user",
      );
    },
  });

  // Update library access mutation
  const updateAccessMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client || !accessDialogUser) throw new Error("Not connected");
      return client.setUserLibraryAccess(accessDialogUser.id, selectedFolders);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setAccessDialogUser(null);
      toast.success("Library access updated");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to update access",
      );
    },
  });

  const resetForm = () => {
    setNewUsername("");
    setNewPassword("");
    setNewIsAdmin(false);
    setShowPassword(false);
    setSelectedFolders([]);
  };

  const handleEditUser = (user: UserInfo) => {
    setNewUsername(user.username);
    setNewPassword("");
    setNewIsAdmin(user.isAdmin);
    setEditingUser(user);
  };

  const handleManageAccess = (user: UserInfo) => {
    setSelectedFolders(user.libraryAccess);
    setAccessDialogUser(user);
  };

  const toggleFolderAccess = (folderId: number) => {
    setSelectedFolders((prev) =>
      prev.includes(folderId)
        ? prev.filter((id) => id !== folderId)
        : [...prev, folderId],
    );
  };

  const folders = foldersData?.musicFolders ?? [];
  const users = usersData?.users ?? [];

  if (usersError) {
    // If forbidden, user is likely not an admin - don't show the card
    return null;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                User Management
              </CardTitle>
              <CardDescription>
                Manage user accounts and their library access
              </CardDescription>
            </div>
            <Dialog
              open={createDialogOpen}
              onOpenChange={(open) => {
                setCreateDialogOpen(open);
                if (!open) resetForm();
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1">
                  <Plus className="w-4 h-4" />
                  Add User
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New User</DialogTitle>
                  <DialogDescription>
                    Add a new user to the server
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      placeholder="johndoe"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="isAdmin"
                      checked={newIsAdmin}
                      onCheckedChange={setNewIsAdmin}
                    />
                    <Label htmlFor="isAdmin">Administrator</Label>
                  </div>
                  {folders.length > 0 && (
                    <div className="space-y-2">
                      <Label>Library Access</Label>
                      <div className="border rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
                        {folders.map((folder) => (
                          <div
                            key={folder.id}
                            className="flex items-center gap-2"
                          >
                            <Checkbox
                              id={`folder-${folder.id}`}
                              checked={selectedFolders.includes(folder.id)}
                              onCheckedChange={() =>
                                toggleFolderAccess(folder.id)
                              }
                            />
                            <Label
                              htmlFor={`folder-${folder.id}`}
                              className="flex items-center gap-2 font-normal cursor-pointer"
                            >
                              <FolderOpen className="w-4 h-4 text-muted-foreground" />
                              {folder.name}
                            </Label>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Leave empty to grant access to all libraries
                      </p>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setCreateDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => createUserMutation.mutate()}
                    disabled={
                      !newUsername ||
                      !newPassword ||
                      createUserMutation.isPending
                    }
                  >
                    {createUserMutation.isPending
                      ? "Creating..."
                      : "Create User"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {usersLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 p-3">
                  <Skeleton className="w-10 h-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <User className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>No users found</p>
            </div>
          ) : (
            users.map((user) => (
              <UserCard
                key={user.id}
                user={user}
                folders={folders}
                currentUserId={currentUserId}
                onEdit={handleEditUser}
                onDelete={(u) => deleteUserMutation.mutate(u.id)}
                onManageAccess={handleManageAccess}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Edit User Dialog */}
      <Dialog
        open={!!editingUser}
        onOpenChange={(open) => {
          if (!open) {
            setEditingUser(null);
            resetForm();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update user account settings</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-username">Username</Label>
              <Input
                id="edit-username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-password">New Password (optional)</Label>
              <div className="relative">
                <Input
                  id="edit-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Leave empty to keep current"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
            {editingUser?.id !== currentUserId && (
              <div className="flex items-center gap-2">
                <Switch
                  id="edit-isAdmin"
                  checked={newIsAdmin}
                  onCheckedChange={setNewIsAdmin}
                />
                <Label htmlFor="edit-isAdmin">Administrator</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => updateUserMutation.mutate()}
              disabled={!newUsername || updateUserMutation.isPending}
            >
              {updateUserMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Library Access Dialog */}
      <Dialog
        open={!!accessDialogUser}
        onOpenChange={(open) => {
          if (!open) setAccessDialogUser(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Library Access for {accessDialogUser?.username}
            </DialogTitle>
            <DialogDescription>
              Select which music libraries this user can access
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {folders.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">
                No music libraries configured
              </p>
            ) : (
              <div className="border rounded-lg p-3 space-y-2 max-h-64 overflow-y-auto">
                <div className="flex items-center gap-2 pb-2 border-b mb-2">
                  <Checkbox
                    id="select-all"
                    checked={selectedFolders.length === folders.length}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedFolders(folders.map((f) => f.id));
                      } else {
                        setSelectedFolders([]);
                      }
                    }}
                  />
                  <Label
                    htmlFor="select-all"
                    className="font-medium cursor-pointer"
                  >
                    All Libraries
                  </Label>
                </div>
                {folders.map((folder) => (
                  <div key={folder.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`access-folder-${folder.id}`}
                      checked={selectedFolders.includes(folder.id)}
                      onCheckedChange={() => toggleFolderAccess(folder.id)}
                    />
                    <Label
                      htmlFor={`access-folder-${folder.id}`}
                      className="flex items-center gap-2 font-normal cursor-pointer flex-1"
                    >
                      <FolderOpen className="w-4 h-4 text-muted-foreground" />
                      <span className="flex-1">{folder.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {folder.stats?.songCount ?? 0} songs
                      </span>
                    </Label>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccessDialogUser(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => updateAccessMutation.mutate()}
              disabled={updateAccessMutation.isPending}
            >
              {updateAccessMutation.isPending ? "Saving..." : "Save Access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
