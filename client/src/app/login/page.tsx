"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useSetAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import {
  Music2,
  Loader2,
  Server,
  Key,
  User,
  Lock,
  AlertCircle,
  ChevronDown,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  serverConnectionAtom,
  connectionStatusAtom,
  connectionErrorAtom,
} from "@/lib/store/auth";
import { initializeClient, FerrotuneApiError } from "@/lib/api/client";
import type { ServerConnection } from "@/lib/api/types";
import type { SetupStatusResponse } from "@/lib/api/generated/SetupStatusResponse";
import {
  isTauri,
  isTauriDesktop,
  getApiBaseUrl,
  getEmbeddedAdminPassword,
} from "@/lib/tauri";

// Default server URL - empty means use current origin (works in dev with proxy)
const DEFAULT_SERVER_URL = "";

export default function LoginPage() {
  const router = useRouter();
  const setConnection = useSetAtom(serverConnectionAtom);
  const setConnectionStatus = useSetAtom(connectionStatusAtom);
  const setConnectionError = useSetAtom(connectionErrorAtom);

  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [apiKey, setApiKey] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // On Tauri mobile (Android/iOS), there's no embedded server, so the server URL
  // must always be visible since it can't default to window.location.origin
  const isMobileTauri = isTauri() && !isTauriDesktop();
  const [showAdvanced, setShowAdvanced] = useState(isMobileTauri);

  // Embedded server mode (Tauri desktop only)
  const [useEmbeddedServer, setUseEmbeddedServer] = useState(false);
  const [isEmbeddedAvailable, setIsEmbeddedAvailable] = useState(false);
  const [embeddedLoading, setEmbeddedLoading] = useState(true);

  // Check if embedded server is available on mount
  useEffect(() => {
    const checkEmbedded = async () => {
      if (isTauriDesktop()) {
        setIsEmbeddedAvailable(true);
        setUseEmbeddedServer(true); // Default to embedded on desktop
      }
      setEmbeddedLoading(false);
    };
    checkEmbedded();
  }, []);

  // Compute stable backend URL for setup check
  // On Tauri desktop with embedded server, use the custom protocol URL
  // On Tauri mobile, we can't check setup until the user actually connects
  // (deriving from serverUrl would trigger a query on every keystroke, causing
  // setupLoading=true which unmounts the form and loses input focus)
  // On web, use current origin (works in dev with proxy)
  const setupCheckUrl =
    typeof window !== "undefined"
      ? useEmbeddedServer && isEmbeddedAvailable
        ? getApiBaseUrl()
        : isMobileTauri
          ? ""
          : window.location.origin
      : "";

  // Check setup status - redirect to setup if not complete
  const { data: setupStatus, isLoading: setupLoading } = useQuery({
    queryKey: ["setupStatus", setupCheckUrl],
    queryFn: async () => {
      try {
        // Add timeout to prevent hanging when server is unreachable
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(
          `${setupCheckUrl}/ferrotune/setup/status`,
          {
            signal: controller.signal,
          },
        );
        clearTimeout(timeoutId);

        if (!response.ok) {
          // If endpoint doesn't exist (old server), assume setup is complete
          return { setupComplete: true } as SetupStatusResponse;
        }
        return response.json() as Promise<SetupStatusResponse>;
      } catch {
        // Network error or timeout - assume setup is complete to avoid blocking
        return { setupComplete: true } as SetupStatusResponse;
      }
    },
    retry: false,
    enabled: !embeddedLoading && !!setupCheckUrl,
  });

  // Redirect to setup if not complete
  useEffect(() => {
    if (setupStatus && !setupStatus.setupComplete) {
      router.push("/setup");
    }
  }, [setupStatus, router]);

  // Auto-connect to embedded server
  useEffect(() => {
    if (
      !embeddedLoading &&
      useEmbeddedServer &&
      isEmbeddedAvailable &&
      setupStatus?.setupComplete
    ) {
      handleEmbeddedConnect();
    }
    // Only run when embedded state is ready
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embeddedLoading, useEmbeddedServer, isEmbeddedAvailable, setupStatus]);

  const handleEmbeddedConnect = async () => {
    setIsConnecting(true);
    setError(null);
    setConnectionError(null);

    try {
      // Get the embedded server URL and password
      const embeddedUrl = getApiBaseUrl();
      const embeddedPassword = await getEmbeddedAdminPassword();

      if (!embeddedPassword) {
        // Server might not be ready yet, wait a bit
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const retryPassword = await getEmbeddedAdminPassword();
        if (!retryPassword) {
          throw new Error("Embedded server not ready. Please try again.");
        }
      }

      const connection: ServerConnection = {
        serverUrl: embeddedUrl,
        username: "admin",
        password: embeddedPassword || "",
      };

      const client = initializeClient(connection);
      setConnectionStatus("connecting");

      await client.ping();

      setConnection(connection);
      setConnectionStatus("connected");
      router.push("/");
    } catch (err) {
      console.error("Embedded connection error:", err);
      setConnectionStatus("error");
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to connect to embedded server");
      }
      setConnectionError(error);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConnect = async (authMethod: "apikey" | "password") => {
    setIsConnecting(true);
    setError(null);
    setConnectionError(null);

    try {
      // Validate and normalize server URL
      let url = serverUrl.trim();

      // On Tauri mobile, the user must provide a server URL
      if (!url && isMobileTauri) {
        throw new Error("Server URL is required");
      }

      // If empty, use current origin (for embedded deployments)
      if (!url) {
        url = typeof window !== "undefined" ? window.location.origin : "";
      }

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = `http://${url}`;
      }

      // Build connection object
      const connection: ServerConnection = {
        serverUrl: url,
      };

      if (authMethod === "apikey") {
        if (!apiKey.trim()) {
          throw new Error("API key is required");
        }
        connection.apiKey = apiKey.trim();
      } else {
        if (!username.trim() || !password) {
          throw new Error("Username and password are required");
        }
        connection.username = username.trim();
        connection.password = password;
      }

      // Initialize client and test connection
      const client = initializeClient(connection);
      setConnectionStatus("connecting");

      await client.ping();

      // Connection successful
      setConnection(connection);
      setConnectionStatus("connected");
      router.push("/");
    } catch (err) {
      console.error("Connection error:", err);
      setConnectionStatus("error");

      if (err instanceof FerrotuneApiError) {
        setError(`Authentication failed: ${err.message}`);
      } else if (err instanceof Error) {
        if (err.message.includes("fetch")) {
          setError("Unable to connect to server. Check the URL and try again.");
        } else {
          setError(err.message);
        }
      } else {
        setError("An unexpected error occurred");
      }
      setConnectionError(error);
    } finally {
      setIsConnecting(false);
    }
  };

  // Show loading state while checking setup status or embedded availability
  if (setupLoading || embeddedLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4 bg-background">
        <div className="text-center">
          <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // If setup not complete, the effect will redirect - show loading
  if (setupStatus && !setupStatus.setupComplete) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4 bg-background">
        <div className="text-center">
          <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Redirecting to setup...</p>
        </div>
      </div>
    );
  }

  // If using embedded server and connecting, show loading
  if (useEmbeddedServer && isEmbeddedAvailable && isConnecting) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-4 bg-background">
        <div className="text-center">
          <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">
            Connecting to embedded server...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-background">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", delay: 0.1 }}
              className="mx-auto w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mb-4"
            >
              <Music2 className="w-8 h-8 text-primary-foreground" />
            </motion.div>
            <CardTitle className="text-2xl">Welcome to Ferrotune</CardTitle>
            <CardDescription>
              {isEmbeddedAvailable
                ? "Choose to use the built-in server or connect to a remote one"
                : "Connect to your music server to get started"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
              {/* Embedded server toggle (Tauri desktop only) */}
              {isEmbeddedAvailable && (
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border">
                  <div className="space-y-0.5">
                    <Label htmlFor="embedded-toggle" className="font-medium">
                      Use Built-in Server
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Run the server locally within the app
                    </p>
                  </div>
                  <Switch
                    id="embedded-toggle"
                    checked={useEmbeddedServer}
                    onCheckedChange={setUseEmbeddedServer}
                    disabled={isConnecting}
                  />
                </div>
              )}

              {/* Show remote server options when not using embedded */}
              {(!isEmbeddedAvailable || !useEmbeddedServer) && (
                <>
                  {/* Server URL - shown prominently above auth on Tauri mobile */}
                  {isMobileTauri && (
                    <div className="space-y-2">
                      <label
                        htmlFor="server-url"
                        className="text-sm font-medium flex items-center gap-2"
                      >
                        <Server className="w-4 h-4" />
                        Server URL
                      </label>
                      <Input
                        id="server-url"
                        placeholder="http://192.168.1.100:4040"
                        value={serverUrl}
                        onChange={(e) => setServerUrl(e.target.value)}
                        disabled={isConnecting}
                        autoCapitalize="off"
                        autoCorrect="off"
                      />
                      <p className="text-xs text-muted-foreground">
                        {serverUrl
                          ? `Will connect to: ${serverUrl}`
                          : "Enter the URL of your Ferrotune server"}
                      </p>
                    </div>
                  )}

                  {/* Auth method tabs */}
                  <Tabs defaultValue="password" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="password">Password</TabsTrigger>
                      <TabsTrigger value="apikey">API Key</TabsTrigger>
                    </TabsList>

                    <TabsContent value="password" className="space-y-4 mt-4">
                      <div className="space-y-2">
                        <label
                          htmlFor="username"
                          className="text-sm font-medium flex items-center gap-2"
                        >
                          <User className="w-4 h-4" />
                          Username
                        </label>
                        <Input
                          id="username"
                          placeholder="admin"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          disabled={isConnecting}
                          autoCapitalize="off"
                          autoCorrect="off"
                        />
                      </div>

                      <div className="space-y-2">
                        <label
                          htmlFor="password"
                          className="text-sm font-medium flex items-center gap-2"
                        >
                          <Lock className="w-4 h-4" />
                          Password
                        </label>
                        <Input
                          id="password"
                          type="password"
                          placeholder="Enter your password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          onKeyDown={(e) => {
                            if (
                              e.key === "Enter" &&
                              username &&
                              password &&
                              !isConnecting
                            ) {
                              handleConnect("password");
                            }
                          }}
                          disabled={isConnecting}
                        />
                      </div>

                      <Button
                        className="w-full"
                        onClick={() => handleConnect("password")}
                        disabled={isConnecting || !username || !password}
                      >
                        {isConnecting ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Connecting...
                          </>
                        ) : (
                          "Connect"
                        )}
                      </Button>
                    </TabsContent>

                    <TabsContent value="apikey" className="space-y-4 mt-4">
                      <div className="space-y-2">
                        <label
                          htmlFor="api-key"
                          className="text-sm font-medium flex items-center gap-2"
                        >
                          <Key className="w-4 h-4" />
                          API Key
                        </label>
                        <Input
                          id="api-key"
                          type="password"
                          placeholder="Enter your API key"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && apiKey && !isConnecting) {
                              handleConnect("apikey");
                            }
                          }}
                          disabled={isConnecting}
                        />
                        <p className="text-xs text-muted-foreground">
                          API keys provide secure authentication without sending
                          passwords
                        </p>
                      </div>

                      <Button
                        className="w-full"
                        onClick={() => handleConnect("apikey")}
                        disabled={isConnecting || !apiKey}
                      >
                        {isConnecting ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Connecting...
                          </>
                        ) : (
                          "Connect"
                        )}
                      </Button>
                    </TabsContent>
                  </Tabs>

                  {/* Server URL - in Advanced collapsible on web (non-mobile Tauri) */}
                  {!isMobileTauri && (
                    <Collapsible
                      open={showAdvanced}
                      onOpenChange={setShowAdvanced}
                    >
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-between text-muted-foreground hover:text-foreground"
                        >
                          <span className="flex items-center gap-2">
                            <Settings className="w-4 h-4" />
                            Advanced Settings
                          </span>
                          <motion.div
                            animate={{ rotate: showAdvanced ? 180 : 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <ChevronDown className="w-4 h-4" />
                          </motion.div>
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <AnimatePresence>
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                            className="pt-2"
                          >
                            <div className="space-y-2">
                              <label
                                htmlFor="server-url"
                                className="text-sm font-medium flex items-center gap-2"
                              >
                                <Server className="w-4 h-4" />
                                Server URL
                              </label>
                              <Input
                                id="server-url"
                                placeholder="Leave empty to use current origin"
                                value={serverUrl}
                                onChange={(e) => setServerUrl(e.target.value)}
                                disabled={isConnecting}
                                autoCapitalize="off"
                                autoCorrect="off"
                              />
                              <p className="text-xs text-muted-foreground">
                                {serverUrl
                                  ? `Will connect to: ${serverUrl}`
                                  : "Will connect to current page origin"}
                              </p>
                            </div>
                          </motion.div>
                        </AnimatePresence>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </>
              )}

              {/* Connect button for embedded mode */}
              {isEmbeddedAvailable && useEmbeddedServer && (
                <Button
                  className="w-full"
                  onClick={handleEmbeddedConnect}
                  disabled={isConnecting}
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    "Continue"
                  )}
                </Button>
              )}

              {/* Error message */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </motion.div>
              )}
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Ferrotune is an OpenSubsonic-compatible music player
        </p>
      </motion.div>
    </div>
  );
}
