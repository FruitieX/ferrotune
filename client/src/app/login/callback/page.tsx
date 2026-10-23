import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSetAtom } from "jotai";
import { Loader2 } from "lucide-react";
import {
  connectionStatusAtom,
  saveAccountAtom,
  serverConnectionAtom,
} from "@/lib/store/auth";
import { FerrotuneClient, initializeClient } from "@/lib/api/client";
import { connectionFromLogin, takePendingOidcLogin } from "@/lib/auth/oidc";

/** End of "Sign in with passkey": redeems the server's code for a session. */
export default function OidcCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setConnection = useSetAtom(serverConnectionAtom);
  const setConnectionStatus = useSetAtom(connectionStatusAtom);
  const saveAccount = useSetAtom(saveAccountAtom);
  // The code is single use: never redeem it twice (StrictMode re-runs effects).
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) {
      return;
    }
    handled.current = true;

    const fail = (message: string) =>
      navigate("/login", { replace: true, state: { oidcError: message } });
    const error = searchParams.get("error");
    const code = searchParams.get("code");
    const pending = takePendingOidcLogin();
    if (error) {
      fail(error);
      return;
    }
    if (!code || !pending) {
      fail("The sign-in expired. Please try again.");
      return;
    }

    const finish = async () => {
      try {
        const response = await new FerrotuneClient({
          serverUrl: pending.serverUrl,
        }).oidcExchange(code, pending.verifier);
        const connection = connectionFromLogin(pending.serverUrl, response);
        const client = initializeClient(connection);
        await client.ping();
        setConnection(connection);
        setConnectionStatus("connected");
        saveAccount(connection);
        navigate("/", { replace: true });
      } catch (err) {
        fail(err instanceof Error ? err.message : "Sign-in failed");
      }
    };
    void finish();
  }, [navigate, searchParams, setConnection, setConnectionStatus, saveAccount]);

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-background">
      <div className="text-center">
        <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground">Signing in...</p>
      </div>
    </div>
  );
}
