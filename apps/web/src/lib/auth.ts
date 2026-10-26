import { apiKeyClient } from "@better-auth/api-key/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  // oauthProviderClient forwards the signed OAuth query on /login and /oauth/consent so MCP sign-ins resume.
  plugins: [apiKeyClient(), oauthProviderClient()],
});
