"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useSetAtom } from "jotai";
import { Music2, Loader2, Server, Key, User, Lock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { serverConnectionAtom, connectionStatusAtom, connectionErrorAtom } from "@/lib/store/auth";
import { initializeClient, SubsonicApiError } from "@/lib/api/client";
import type { ServerConnection } from "@/lib/api/types";

export default function LoginPage() {
  const router = useRouter();
  const setConnection = useSetAtom(serverConnectionAtom);
  const setConnectionStatus = useSetAtom(connectionStatusAtom);
  const setConnectionError = useSetAtom(connectionErrorAtom);

  const [serverUrl, setServerUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async (authMethod: "apikey" | "password") => {
    setIsConnecting(true);
    setError(null);
    setConnectionError(null);

    try {
      // Validate server URL
      let url = serverUrl.trim();
      if (!url) {
        throw new Error("Server URL is required");
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
      
      if (err instanceof SubsonicApiError) {
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

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
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
              Connect to your music server to get started
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
              {/* Server URL */}
              <div className="space-y-2">
                <label htmlFor="server-url" className="text-sm font-medium flex items-center gap-2">
                  <Server className="w-4 h-4" />
                  Server URL
                </label>
                <Input
                  id="server-url"
                  placeholder="http://localhost:4040"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  disabled={isConnecting}
                />
              </div>

              {/* Auth method tabs */}
              <Tabs defaultValue="password" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="password">Password</TabsTrigger>
                  <TabsTrigger value="apikey">API Key</TabsTrigger>
                </TabsList>

                <TabsContent value="password" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <label htmlFor="username" className="text-sm font-medium flex items-center gap-2">
                      <User className="w-4 h-4" />
                      Username
                    </label>
                    <Input
                      id="username"
                      placeholder="admin"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={isConnecting}
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="password" className="text-sm font-medium flex items-center gap-2">
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
                        if (e.key === "Enter" && serverUrl && username && password && !isConnecting) {
                          handleConnect("password");
                        }
                      }}
                      disabled={isConnecting}
                    />
                  </div>

                  <Button
                    className="w-full"
                    onClick={() => handleConnect("password")}
                    disabled={isConnecting || !serverUrl || !username || !password}
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
                    <label htmlFor="api-key" className="text-sm font-medium flex items-center gap-2">
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
                        if (e.key === "Enter" && serverUrl && apiKey && !isConnecting) {
                          handleConnect("apikey");
                        }
                      }}
                      disabled={isConnecting}
                    />
                    <p className="text-xs text-muted-foreground">
                      API keys provide secure authentication without sending passwords
                    </p>
                  </div>

                  <Button
                    className="w-full"
                    onClick={() => handleConnect("apikey")}
                    disabled={isConnecting || !serverUrl || !apiKey}
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
