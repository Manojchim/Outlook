"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PublicClientApplication, LogLevel } = require("@azure/msal-node");

const GRAPH_SCOPES = ["User.Read", "Mail.Send", "offline_access"];

function ensureCacheDir(cachePath) {
  fs.mkdirSync(path.dirname(path.resolve(cachePath)), { recursive: true });
}

function createCachePlugin(cachePath) {
  const absolute = path.resolve(cachePath);
  ensureCacheDir(absolute);
  return {
    beforeCacheAccess: async (cacheContext) => {
      if (fs.existsSync(absolute)) {
        cacheContext.tokenCache.deserialize(fs.readFileSync(absolute, "utf8"));
      }
    },
    afterCacheAccess: async (cacheContext) => {
      if (cacheContext.cacheHasChanged) {
        ensureCacheDir(absolute);
        fs.writeFileSync(absolute, cacheContext.tokenCache.serialize(), "utf8");
      }
    }
  };
}

function createPca(config) {
  if (!config.clientId) {
    const err = new Error(
      "AZURE_CLIENT_ID is missing. Register a public-client Entra ID app and set AZURE_CLIENT_ID / AZURE_TENANT_ID in .env."
    );
    err.code = "MISSING_AZURE_CLIENT_ID";
    throw err;
  }
  if (!config.tenantId) {
    const err = new Error(
      "AZURE_TENANT_ID is missing. Set your Directory (tenant) ID in .env."
    );
    err.code = "MISSING_AZURE_TENANT_ID";
    throw err;
  }

  const cachePlugin = createCachePlugin(config.tokenCachePath);
  return new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`
    },
    cache: { cachePlugin },
    system: {
      loggerOptions: {
        logLevel: LogLevel.Warning,
        loggerCallback: () => {
          /* never log tokens */
        }
      }
    }
  });
}

/**
 * Acquire a Graph access token via silent cache or interactive device code.
 */
async function acquireGraphToken(config, options = {}) {
  const pca = createPca(config);
  const accounts = await pca.getTokenCache().getAllAccounts();
  const account = accounts[0];

  if (account && !options.forceDeviceCode) {
    try {
      const silent = await pca.acquireTokenSilent({
        account,
        scopes: GRAPH_SCOPES
      });
      return {
        accessToken: silent.accessToken,
        account: silent.account,
        fromCache: true,
        scopes: GRAPH_SCOPES
      };
    } catch {
      /* fall through to device code */
    }
  }

  const deviceCodeRequest = {
    scopes: GRAPH_SCOPES,
    deviceCodeCallback: (response) => {
      const message =
        response.message ||
        `Visit ${response.verificationUri} and enter code ${response.userCode}`;
      if (typeof options.onDeviceCode === "function") {
        options.onDeviceCode(response);
      } else {
        console.log("\n=== Microsoft Graph device-code authentication ===");
        console.log(message);
        console.log("=================================================\n");
      }
    }
  };

  try {
    const result = await pca.acquireTokenByDeviceCode(deviceCodeRequest);
    return {
      accessToken: result.accessToken,
      account: result.account,
      fromCache: false,
      scopes: GRAPH_SCOPES
    };
  } catch (err) {
    const msg = String(err?.message || err);
    if (/AADSTS65001|consent_required|admin/i.test(msg)) {
      const wrapped = new Error(
        "Administrator consent may be required for Mail.Send. Ask your Microsoft 365 admin to grant admin consent for the app's Microsoft Graph delegated Mail.Send (and User.Read) permissions."
      );
      wrapped.code = "ADMIN_CONSENT_REQUIRED";
      wrapped.cause = err;
      throw wrapped;
    }
    if (/AADSTS700016|invalid_client/i.test(msg)) {
      const wrapped = new Error(
        "Invalid Azure application (client) ID or public-client configuration. Enable 'Allow public client flows' on the app registration."
      );
      wrapped.code = "INVALID_CLIENT";
      wrapped.cause = err;
      throw wrapped;
    }
    throw err;
  }
}

function getRequiredAzureSetupInstructions() {
  return `
Azure / Entra ID setup (delegated device-code):
1. Azure Portal → Microsoft Entra ID → App registrations → New registration.
2. Supported account types: single tenant (or as required by your org).
3. Redirect URI: Public client/native — http://localhost (optional for device code).
4. Authentication → Advanced → Allow public client flows = Yes.
5. API permissions → Microsoft Graph → Delegated: Mail.Send, User.Read, offline_access.
6. Click Grant admin consent if your tenant requires it for Mail.Send.
7. Copy Application (client) ID → AZURE_CLIENT_ID
8. Copy Directory (tenant) ID → AZURE_TENANT_ID
9. Set TEST_EMAIL_RECIPIENT=rmanoj@chimeratechnologies.com
10. Run: node --env-file-if-exists=.env scripts/qa-report-send.js --auth-only
`.trim();
}

module.exports = {
  acquireGraphToken,
  createPca,
  GRAPH_SCOPES,
  getRequiredAzureSetupInstructions
};
