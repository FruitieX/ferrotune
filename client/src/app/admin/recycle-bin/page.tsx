"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Trash2, ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useIsMounted } from "@/lib/hooks/use-is-mounted";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RecycleBin } from "@/components/settings/recycle-bin";
import Link from "next/link";

export default function RecycleBinPage() {
  const router = useRouter();
  const { isLoading: authLoading } = useAuth({
    redirectToLogin: true,
  });
  const isMounted = useIsMounted();
  const { user, isAdmin, isLoading: userLoading } = useCurrentUser();

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
        <Skeleton className="h-[400px] w-full" />
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
          <Link href="/admin">
            <Button variant="ghost" size="icon" className="mr-2">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="w-12 h-12 rounded-lg bg-destructive/10 flex items-center justify-center">
            <Trash2 className="w-6 h-6 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Recycle Bin</h1>
            <p className="text-sm text-muted-foreground">
              Files marked for deletion (automatically removed after 30 days)
            </p>
          </div>
        </motion.div>
      </div>

      <div className="px-4 lg:px-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <RecycleBin />
        </motion.div>
      </div>
    </div>
  );
}
