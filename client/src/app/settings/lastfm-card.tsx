"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Music2, ExternalLink, Check, X, Loader2 } from "lucide-react";
import { getClient } from "@/lib/api/client";
import { useAuth } from "@/lib/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function LastfmCard() {
  const { isReady } = useAuth({ redirectToLogin: false });
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["lastfmStatus"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getLastfmStatus();
    },
    enabled: isReady,
  });

  const { isLoading: configLoading } = useQuery({
    queryKey: ["lastfmConfig"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getLastfmConfig();
    },
    enabled: isReady,
    select: (data) => {
      if (!configLoaded) {
        setApiKey(data.apiKey);
        setApiSecret(data.apiSecret);
        setConfigLoaded(true);
      }
      return data;
    },
  });

  const saveConfigMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.saveLastfmConfig(apiKey, apiSecret);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lastfmStatus"] });
      queryClient.invalidateQueries({ queryKey: ["lastfmConfig"] });
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      const callbackUrl = `${window.location.origin}/settings?lastfm_callback=1`;
      const authResponse = await client.getLastfmAuthUrl(callbackUrl);
      if (authResponse.url) {
        window.location.href = authResponse.url;
      }
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.disconnectLastfm();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lastfmStatus"] });
    },
  });

  // Handle Last.fm callback token
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const isCallback = params.get("lastfm_callback");
    if (token && isCallback && isReady) {
      // Clean URL
      const url = new URL(window.location.href);
      url.searchParams.delete("token");
      url.searchParams.delete("lastfm_callback");
      window.history.replaceState({}, "", url.toString());

      // Exchange token
      const client = getClient();
      if (client) {
        client.lastfmCallback(token).then(() => {
          queryClient.invalidateQueries({ queryKey: ["lastfmStatus"] });
        });
      }
    }
  }

  const isLoading = statusLoading || configLoading;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.32 }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Music2 className="w-5 h-5" />
            Last.fm Scrobbling
          </CardTitle>
          <CardDescription>
            Connect your Last.fm account to scrobble your listening history
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* API Credentials */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="lastfm-api-key" className="text-sm font-medium">
                API Key
              </Label>
              <Input
                id="lastfm-api-key"
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Your Last.fm API key"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="lastfm-api-secret"
                className="text-sm font-medium"
              >
                API Secret
              </Label>
              <Input
                id="lastfm-api-secret"
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="Your Last.fm API secret"
                disabled={isLoading}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => saveConfigMutation.mutate()}
                disabled={saveConfigMutation.isPending || !apiKey || !apiSecret}
              >
                {saveConfigMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                ) : null}
                Save Credentials
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a
                  href="https://www.last.fm/api/account/create"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gap-1.5"
                >
                  Get API Key
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </Button>
            </div>
          </div>

          <Separator />

          {/* Connection Status */}
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  status?.connected ? "bg-green-500/20" : "bg-muted"
                }`}
              >
                {status?.connected ? (
                  <Check className="w-5 h-5 text-green-500" />
                ) : (
                  <X className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium">
                  {status?.connected
                    ? "Connected"
                    : status?.enabled
                      ? "Not connected"
                      : "Not configured"}
                </p>
                {status?.username && (
                  <p className="text-sm text-muted-foreground truncate">
                    {status.username}
                  </p>
                )}
              </div>
              {status?.enabled && !status?.connected && (
                <Button
                  size="sm"
                  onClick={() => connectMutation.mutate()}
                  disabled={connectMutation.isPending}
                >
                  {connectMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                  ) : null}
                  Connect
                </Button>
              )}
              {status?.connected && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                >
                  Disconnect
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
