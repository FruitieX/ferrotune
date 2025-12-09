"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Music2,
  FolderOpen,
  Check,
  User,
  ArrowRight,
  AlertCircle,
  Loader2,
  Plus,
  Trash2,
  RefreshCw,
  Server,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { useSetAtom, useAtomValue } from "jotai";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  serverConnectionAtom,
  connectionStatusAtom,
  isConnectedAtom,
} from "@/lib/store/auth";
import { scanDialogOpenAtom, scanFolderIdAtom, scanFolderNameAtom } from "@/lib/store/scan";
import { initializeClient, getClient } from "@/lib/api/client";
import { DirectoryBrowser } from "@/components/admin/directory-browser";
import { ScanDialog } from "@/components/admin/scan-dialog";
import type { SetupStatusResponse } from "@/lib/api/generated/SetupStatusResponse";

type SetupStep = "welcome" | "credentials" | "folders" | "scan" | "complete";

// Default server URL based on environment
const DEFAULT_SERVER_URL =
  process.env.NODE_ENV === "development" ? "http://localhost:4040" : "";

export default function SetupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setConnection = useSetAtom(serverConnectionAtom);
  const setConnectionStatus = useSetAtom(connectionStatusAtom);
  const isConnected = useAtomValue(isConnectedAtom);

  const [step, setStep] = useState<SetupStep>("welcome");
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [newPassword, setNewPassword] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Folder management state
  const [folders, setFolders] = useState<
    Array<{ name: string; path: string; tempId: string; validated?: boolean }>
  >([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderPath, setNewFolderPath] = useState("");
  const [folderValidationError, setFolderValidationError] = useState<
    string | null
  >(null);
  const [isValidatingFolder, setIsValidatingFolder] = useState(false);
  const setScanDialogOpen = useSetAtom(scanDialogOpenAtom);
  const setScanFolderId = useSetAtom(scanFolderIdAtom);
  const setScanFolderName = useSetAtom(scanFolderNameAtom);

  // Helper to open scanner for all libraries
  const openFullScan = () => {
    setScanFolderId(null);
    setScanFolderName(null);
    setScanDialogOpen(true);
  };

  // Compute backend URL for API calls
  const backendUrl =
    serverUrl.trim() ||
    (process.env.NODE_ENV === "development"
      ? "http://localhost:4040"
      : typeof window !== "undefined"
        ? window.location.origin
        : "");

  // Track if we've intentionally completed setup (to prevent redirect during completion screen)
  const [setupCompleted, setSetupCompleted] = useState(false);

  // Check setup status
  const { data: setupStatus, isLoading: statusLoading } = useQuery({
    queryKey: ["setupStatus", backendUrl],
    queryFn: async () => {
      const response = await fetch(`${backendUrl}/ferrotune/setup/status`);
      if (!response.ok) {
        throw new Error("Failed to check setup status");
      }
      return response.json() as Promise<SetupStatusResponse>;
    },
    retry: false,
    // Don't refetch if we just completed setup
    enabled: !setupCompleted,
  });

  // Redirect if setup was already complete when we loaded the page
  // (not if we just completed it ourselves)
  useEffect(() => {
    if (setupStatus?.setupComplete && !setupCompleted && step === "welcome") {
      // Setup was already done, redirect to appropriate page
      if (isConnected) {
        router.push("/");
      } else {
        router.push("/login");
      }
    }
  }, [setupStatus, setupCompleted, isConnected, step, router]);

  // Connect with credentials
  const handleConnect = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      let url = serverUrl.trim();
      if (!url) {
        url = typeof window !== "undefined" ? window.location.origin : "";
      }
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = `http://${url}`;
      }

      const connection = {
        serverUrl: url,
        username: username.trim(),
        password: password,
      };

      const client = initializeClient(connection);
      setConnectionStatus("connecting");
      await client.ping();

      // Connection successful
      setConnection(connection);
      setConnectionStatus("connected");
      setStep("folders");
    } catch (err) {
      console.error("Connection error:", err);
      setConnectionStatus("error");
      if (err instanceof Error) {
        if (err.message.includes("fetch")) {
          setError("Unable to connect to server. Check the URL and try again.");
        } else {
          setError(err.message);
        }
      } else {
        setError("An unexpected error occurred");
      }
    } finally {
      setIsConnecting(false);
    }
  };

  // Update password if changed
  const updatePasswordMutation = useMutation({
    mutationFn: async (newPassword: string) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const user = await client.getCurrentUser();
      await client.updateUser(user.id, {
        username: null,
        password: newPassword,
        email: null,
        isAdmin: null,
        libraryAccess: null,
      });
    },
    onSuccess: () => {
      toast.success("Password updated");
    },
    onError: (err: Error) => {
      toast.error(`Failed to update password: ${err.message}`);
    },
  });

  // Add folder with validation
  const handleAddFolder = async () => {
    if (!newFolderName.trim() || !newFolderPath.trim()) return;

    setFolderValidationError(null);
    setIsValidatingFolder(true);

    try {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      // Validate the path exists and is readable
      const validation = await client.validatePath(newFolderPath.trim());

      if (!validation.valid) {
        setFolderValidationError(
          validation.error || "Path is not a valid directory",
        );
        return;
      }

      // Check if path is already in the list
      if (folders.some((f) => f.path === newFolderPath.trim())) {
        setFolderValidationError("This folder is already in the list");
        return;
      }

      setFolders([
        ...folders,
        {
          name: newFolderName.trim(),
          path: newFolderPath.trim(),
          tempId: Math.random().toString(36).substring(7),
          validated: true,
        },
      ]);
      setNewFolderName("");
      setNewFolderPath("");
    } catch (err) {
      setFolderValidationError(
        err instanceof Error ? err.message : "Failed to validate path",
      );
    } finally {
      setIsValidatingFolder(false);
    }
  };

  // Remove folder
  const handleRemoveFolder = (tempId: string) => {
    setFolders(folders.filter((f) => f.tempId !== tempId));
  };

  // Create folders mutation
  const createFoldersMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");

      // Update password if changed
      if (newPassword.trim() && newPassword !== password) {
        await updatePasswordMutation.mutateAsync(newPassword);
        // Update the connection with new password
        const url =
          serverUrl.trim() ||
          (typeof window !== "undefined" ? window.location.origin : "");
        const connection = {
          serverUrl: url,
          username: username.trim(),
          password: newPassword,
        };
        setConnection(connection);
        initializeClient(connection);
      }

      // Create all folders
      for (const folder of folders) {
        await client.createMusicFolder(folder.name, folder.path);
      }
      return folders.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["adminMusicFolders"] });
      toast.success(`Added ${count} music folder${count !== 1 ? "s" : ""}`);
      setStep("scan");
    },
    onError: (err: Error) => {
      toast.error(`Failed to add folders: ${err.message}`);
    },
  });

  // Get scan status
  const { data: scanStatus } = useQuery({
    queryKey: ["scanStatus"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getScanStatus();
    },
    enabled: step === "scan",
    refetchInterval: step === "scan" ? 1000 : false,
  });

  // Complete setup mutation
  const completeSetupMutation = useMutation({
    mutationFn: async () => {
      const baseUrl =
        serverUrl.trim() ||
        (typeof window !== "undefined" ? window.location.origin : "");
      const response = await fetch(`${baseUrl}/ferrotune/setup/complete`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Failed to complete setup");
      }
      return response.json();
    },
    onSuccess: () => {
      // Mark setup as intentionally completed to prevent redirect loops
      setSetupCompleted(true);
      // Invalidate setup status query so other components see the update
      queryClient.invalidateQueries({ queryKey: ["setupStatus"] });
      setStep("complete");
    },
    onError: (err: Error) => {
      toast.error(`Failed to complete setup: ${err.message}`);
    },
  });

  // Finish setup - redirect to home if connected, otherwise to login
  const handleFinish = () => {
    if (isConnected) {
      router.push("/");
    } else {
      router.push("/login");
    }
  };

  // Loading state
  if (statusLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="text-center">
          <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Checking setup status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      {/* Scan Dialog - shared across setup */}
      <ScanDialog />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-lg"
      >
        {/* Progress indicator */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            {["welcome", "credentials", "folders", "scan", "complete"].map(
              (s, i) => (
                <div
                  key={s}
                  className={`flex items-center ${i > 0 ? "flex-1" : ""}`}
                >
                  {i > 0 && (
                    <div
                      className={`h-0.5 flex-1 mx-2 ${
                        [
                          "welcome",
                          "credentials",
                          "folders",
                          "scan",
                          "complete",
                        ].indexOf(step) >= i
                          ? "bg-primary"
                          : "bg-border"
                      }`}
                    />
                  )}
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      step === s
                        ? "bg-primary text-primary-foreground"
                        : [
                              "welcome",
                              "credentials",
                              "folders",
                              "scan",
                              "complete",
                            ].indexOf(step) > i
                          ? "bg-primary/20 text-primary"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {[
                      "welcome",
                      "credentials",
                      "folders",
                      "scan",
                      "complete",
                    ].indexOf(step) > i ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      i + 1
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {/* Step 1: Welcome */}
          {step === "welcome" && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card>
                <CardHeader className="text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", delay: 0.1 }}
                    className="mx-auto w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mb-4"
                  >
                    <Music2 className="w-8 h-8 text-primary-foreground" />
                  </motion.div>
                  <CardTitle className="text-2xl">
                    Welcome to Ferrotune
                  </CardTitle>
                  <CardDescription>
                    Let&apos;s set up your music server. This will only take a
                    few minutes.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-medium text-amber-500">
                          Experimental Software
                        </p>
                        <p className="text-muted-foreground mt-1">
                          Ferrotune is under active development. Please backup
                          your music library before proceeding.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>During setup, you will:</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>Sign in with the default admin credentials</li>
                      <li>Optionally change your password</li>
                      <li>Add your music folders</li>
                      <li>Scan your library</li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <Button
                      className="w-full"
                      onClick={() => setStep("credentials")}
                    >
                      Get Started
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => completeSetupMutation.mutate()}
                      disabled={completeSetupMutation.isPending}
                    >
                      {completeSetupMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Skipping...
                        </>
                      ) : (
                        "Skip Setup"
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Step 2: Credentials */}
          {step === "credentials" && (
            <motion.div
              key="credentials"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="w-5 h-5" />
                    Sign In
                  </CardTitle>
                  <CardDescription>
                    Sign in with the default admin credentials. You can change
                    your password after.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="server">Server URL</Label>
                    <div className="flex items-center gap-2">
                      <Server className="w-4 h-4 text-muted-foreground" />
                      <Input
                        id="server"
                        placeholder="Leave empty for current origin"
                        value={serverUrl}
                        onChange={(e) => setServerUrl(e.target.value)}
                        disabled={isConnecting}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {serverUrl
                        ? `Will connect to: ${serverUrl}`
                        : "Will connect to current page origin"}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={isConnecting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={isConnecting}
                    />
                    <p className="text-xs text-muted-foreground">
                      Default credentials: admin / admin
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="newPassword">New Password (optional)</Label>
                    <Input
                      id="newPassword"
                      type="password"
                      placeholder="Leave empty to keep current password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      disabled={isConnecting}
                    />
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setStep("welcome")}
                      disabled={isConnecting}
                    >
                      Back
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={handleConnect}
                      disabled={isConnecting || !username.trim() || !password}
                    >
                      {isConnecting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        <>
                          Continue
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Step 3: Folders */}
          {step === "folders" && (
            <motion.div
              key="folders"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FolderOpen className="w-5 h-5" />
                    Add Music Folders
                  </CardTitle>
                  <CardDescription>
                    Add the folders where your music is stored. You can add more
                    later from the admin panel.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Existing folders */}
                  {folders.length > 0 && (
                    <div className="space-y-2">
                      {folders.map((folder) => (
                        <div
                          key={folder.tempId}
                          className="flex items-center gap-2 p-3 rounded-lg bg-muted"
                        >
                          <FolderOpen className="w-4 h-4 text-primary" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">
                              {folder.name}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {folder.path}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0"
                            onClick={() => handleRemoveFolder(folder.tempId)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add new folder */}
                  <div className="space-y-3 p-4 border border-dashed rounded-lg">
                    <div className="space-y-2">
                      <Label htmlFor="folderName">Folder Name</Label>
                      <Input
                        id="folderName"
                        placeholder="My Music"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        disabled={isValidatingFolder}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="folderPath">Path</Label>
                      <DirectoryBrowser
                        value={newFolderPath}
                        onChange={(path) => {
                          setNewFolderPath(path);
                          setFolderValidationError(null);
                        }}
                        disabled={isValidatingFolder}
                        error={folderValidationError}
                      />
                    </div>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleAddFolder}
                      disabled={
                        !newFolderName.trim() ||
                        !newFolderPath.trim() ||
                        isValidatingFolder
                      }
                    >
                      {isValidatingFolder ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Validating...
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4 mr-2" />
                          Add Folder
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setStep("credentials")}
                      disabled={createFoldersMutation.isPending}
                    >
                      Back
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={() => createFoldersMutation.mutate()}
                      disabled={
                        folders.length === 0 || createFoldersMutation.isPending
                      }
                    >
                      {createFoldersMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Adding...
                        </>
                      ) : (
                        <>
                          Continue
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Step 4: Scan */}
          {step === "scan" && (
            <motion.div
              key="scan"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <RefreshCw className="w-5 h-5" />
                    Scan Your Library
                  </CardTitle>
                  <CardDescription>
                    Start a library scan to index your music files. You can
                    start using Ferrotune immediately - the library will
                    populate as the scan progresses.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-medium text-blue-500">
                          Scanning runs in the background
                        </p>
                        <p className="text-muted-foreground mt-1">
                          You can start browsing your library while the scan is
                          in progress. New files will appear as they are
                          indexed.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="text-center py-4">
                    <p className="text-muted-foreground mb-4">
                      Open the scanner dialog to start scanning and monitor
                      progress
                    </p>
                    <Button onClick={openFullScan}>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Open Scanner
                      <ExternalLink className="w-4 h-4 ml-2" />
                    </Button>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setStep("folders")}
                      disabled={scanStatus?.scanning}
                    >
                      Back
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={() => completeSetupMutation.mutate()}
                      disabled={completeSetupMutation.isPending}
                    >
                      {completeSetupMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Completing...
                        </>
                      ) : (
                        <>
                          Continue
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Step 5: Complete */}
          {step === "complete" && (
            <motion.div
              key="complete"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card>
                <CardHeader className="text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", delay: 0.1 }}
                    className="mx-auto w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4"
                  >
                    <Check className="w-8 h-8 text-green-500" />
                  </motion.div>
                  <CardTitle className="text-2xl">Setup Complete!</CardTitle>
                  <CardDescription>
                    Your Ferrotune server is ready to use.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground text-center">
                    <p>You can now:</p>
                    <ul className="list-disc list-inside mt-2">
                      <li>Browse your music library</li>
                      <li>Create playlists</li>
                      <li>Connect other Subsonic clients</li>
                    </ul>
                  </div>

                  <Button className="w-full" onClick={handleFinish}>
                    Start Listening
                    <Music2 className="w-4 h-4 ml-2" />
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
