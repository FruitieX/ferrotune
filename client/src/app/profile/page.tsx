"use client";

import { useState } from "react";
import Link from "next/link";
import { useAtom, useSetAtom } from "jotai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  User,
  LogOut,
  Headphones,
  Calendar,
  Clock,
  ExternalLink,
  TrendingUp,
  Upload,
  FileSpreadsheet,
  Heart,
  SkipForward,
  Music,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { serverConnectionAtom } from "@/lib/store/auth";
import { clearQueueAtom } from "@/lib/store/server-queue";
import { getClient } from "@/lib/api/client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatListeningTime } from "@/lib/utils/format";
import { ImportPlayCountsDialog } from "@/components/stats/import-play-counts-dialog";
import { ImportFavoritesDialog } from "@/components/stats/import-favorites-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function ProfilePage() {
  const router = useRouter();
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const isMounted = useIsMounted();
  const { user, isLoading: userLoading } = useCurrentUser();
  const [, setConnection] = useAtom(serverConnectionAtom);
  const clearQueue = useSetAtom(clearQueueAtom);
  const queryClient = useQueryClient();

  // Import dialog states
  const [importPlayCountsDialogOpen, setImportPlayCountsDialogOpen] =
    useState(false);
  const [importFavoritesDialogOpen, setImportFavoritesDialogOpen] =
    useState(false);

  // Fetch listening stats
  const { data: listeningStats, isLoading: listeningStatsLoading } = useQuery({
    queryKey: ["listeningStats"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getListeningStats();
    },
    enabled: isReady,
    staleTime: 60000, // Cache for 1 minute
  });

  const handleLogout = () => {
    queryClient.clear();
    setConnection(null);
    clearQueue();
    router.push("/login");
    toast.success("Logged out successfully");
  };

  // Sign Out card - always render this even during loading so users can log out if there's an error
  const signOutCard = (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
    >
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive flex items-center gap-2">
            <LogOut className="w-5 h-5" />
            Sign Out
          </CardTitle>
          <CardDescription>
            Disconnect from the server and clear your session
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="w-full">
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Sign out?</AlertDialogTitle>
                <AlertDialogDescription>
                  You will be disconnected from the server and your playback
                  queue will be cleared.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleLogout}>
                  Sign Out
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </motion.div>
  );

  // Always render the same loading state on server and during hydration
  // But always show the sign out card so users can log out if there's an auth error
  if (!isMounted || authLoading || userLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[200px] w-full" />
        {signOutCard}
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      {/* Header */}
      <div className="px-4 lg:px-6 pt-8 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3"
        >
          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
            <User className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">
                {user?.username ?? "Profile"}
              </h1>
              {user?.isAdmin && (
                <Badge variant="secondary" className="text-xs">
                  Admin
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Your account and listening activity
            </p>
          </div>
        </motion.div>
      </div>

      <div className="px-4 lg:px-6 pb-24 space-y-6">
        {/* Account Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Account
              </CardTitle>
              <CardDescription>Your account details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <User className="w-4 h-4" />
                    <span className="text-xs uppercase tracking-wider">
                      Username
                    </span>
                  </div>
                  <p className="font-medium">{user?.username}</p>
                </div>
                {user?.email && (
                  <div className="p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <ExternalLink className="w-4 h-4" />
                      <span className="text-xs uppercase tracking-wider">
                        Email
                      </span>
                    </div>
                    <p className="font-medium">{user.email}</p>
                  </div>
                )}
                <div className="p-3 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Calendar className="w-4 h-4" />
                    <span className="text-xs uppercase tracking-wider">
                      Member Since
                    </span>
                  </div>
                  <p className="font-medium">
                    {user?.createdAt
                      ? new Date(user.createdAt).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })
                      : "Unknown"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Listening Activity */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex-1">
                <CardTitle className="flex items-center gap-2">
                  <Headphones className="w-5 h-5" />
                  Listening Activity
                </CardTitle>
                <CardDescription>
                  Your music listening statistics
                </CardDescription>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-2">
                    <Upload className="w-4 h-4" />
                    Import
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => setImportPlayCountsDialogOpen(true)}
                  >
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Import Play Counts
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setImportFavoritesDialogOpen(true)}
                  >
                    <Heart className="w-4 h-4 mr-2" />
                    Import Favorites
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Link href="/review">
                <Button
                  size="sm"
                  className="gap-2 bg-primary hover:bg-primary/80"
                >
                  <TrendingUp className="w-4 h-4" />
                  Your Review
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {listeningStatsLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="p-3 rounded-lg bg-muted/30">
                      <Skeleton className="h-4 w-16 mb-2" />
                      <Skeleton className="h-6 w-20" />
                    </div>
                  ))}
                </div>
              ) : listeningStats ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-3 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <Calendar className="w-4 h-4" />
                        <span className="text-xs uppercase tracking-wider">
                          Last 7 Days
                        </span>
                      </div>
                      <p className="text-lg font-bold">
                        {formatListeningTime(
                          listeningStats.last7Days.totalSeconds,
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {listeningStats.last7Days.uniqueSongs} songs
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <Calendar className="w-4 h-4" />
                        <span className="text-xs uppercase tracking-wider">
                          Last 30 Days
                        </span>
                      </div>
                      <p className="text-lg font-bold">
                        {formatListeningTime(
                          listeningStats.last30Days.totalSeconds,
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {listeningStats.last30Days.uniqueSongs} songs
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <Calendar className="w-4 h-4" />
                        <span className="text-xs uppercase tracking-wider">
                          This Year
                        </span>
                      </div>
                      <p className="text-lg font-bold">
                        {formatListeningTime(
                          listeningStats.thisYear.totalSeconds,
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {listeningStats.thisYear.uniqueSongs} songs
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <Clock className="w-4 h-4" />
                        <span className="text-xs uppercase tracking-wider">
                          All Time
                        </span>
                      </div>
                      <p className="text-lg font-bold">
                        {formatListeningTime(
                          listeningStats.allTime.totalSeconds,
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {listeningStats.allTime.uniqueSongs} songs
                      </p>
                    </div>
                  </div>

                  {/* Detailed stats */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-3 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <Music className="w-4 h-4" />
                        <span className="text-xs uppercase tracking-wider">
                          Total Plays
                        </span>
                      </div>
                      <p className="text-lg font-bold">
                        {listeningStats.allTime.scrobbleCount.toLocaleString()}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <SkipForward className="w-4 h-4" />
                        <span className="text-xs uppercase tracking-wider">
                          Songs Skipped
                        </span>
                      </div>
                      <p className="text-lg font-bold">
                        {listeningStats.allTime.skipCount.toLocaleString()}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <TrendingUp className="w-4 h-4" />
                        <span className="text-xs uppercase tracking-wider">
                          Skip Rate
                        </span>
                      </div>
                      <p className="text-lg font-bold">
                        {listeningStats.allTime.sessionCount > 0
                          ? `${Math.round((listeningStats.allTime.skipCount / listeningStats.allTime.sessionCount) * 100)}%`
                          : "0%"}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No listening data yet. Start playing some music!
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Sign Out */}
        {signOutCard}
      </div>

      {/* Import Play Counts Dialog */}
      <ImportPlayCountsDialog
        open={importPlayCountsDialogOpen}
        onOpenChange={setImportPlayCountsDialogOpen}
      />

      {/* Import Favorites Dialog */}
      <ImportFavoritesDialog
        open={importFavoritesDialogOpen}
        onOpenChange={setImportFavoritesDialogOpen}
      />
    </div>
  );
}
