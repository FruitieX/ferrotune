"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Shield, FolderOpen, Users, Server, RefreshCw } from "lucide-react";
import { useSetAtom } from "jotai";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { scanDialogOpenAtom } from "@/lib/store/scan";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MusicLibraries } from "@/components/settings/music-libraries";
import { UserManagement } from "@/components/settings/user-management";
import { ServerConfig } from "@/components/settings/server-config";

export default function AdministrationPage() {
  const router = useRouter();
  const { isReady, isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const isMounted = useIsMounted();
  const { user, isAdmin, isLoading: userLoading } = useCurrentUser();
  const setScanDialogOpen = useSetAtom(scanDialogOpenAtom);

  // Redirect non-admin users to settings
  useEffect(() => {
    if (!userLoading && user && !isAdmin) {
      router.push("/settings");
    }
  }, [userLoading, user, isAdmin, router]);

  // Always render the same loading state on server and during hydration
  if (!isMounted || authLoading || userLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  // Don't render if not admin (will redirect)
  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="px-4 lg:px-6 pt-8 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3"
        >
          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Administration</h1>
            <p className="text-sm text-muted-foreground">
              Server management and configuration
            </p>
          </div>
        </motion.div>
      </div>

      <div className="px-4 lg:px-6 pb-24 space-y-6">
        {/* Library Scanner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5" />
                Library Scanner
              </CardTitle>
              <CardDescription>
                Scan your music folders to update the database
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">
                    Full Library Scan
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Scan all music folders and update the database
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setScanDialogOpen(true)}
                  className="gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Open Scanner
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Music Libraries */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <MusicLibraries />
        </motion.div>

        {/* User Management */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <UserManagement />
        </motion.div>

        {/* Server Configuration */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <ServerConfig />
        </motion.div>
      </div>
    </div>
  );
}
