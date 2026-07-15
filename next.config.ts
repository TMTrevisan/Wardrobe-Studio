import type { NextConfig } from "next";

// OAuth client IDs are public browser configuration. Prefer the conventional
// NEXT_PUBLIC name, but accept the existing Vercel variable Todd created.
const googlePhotosClientId =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.Google_OAuth_client_ID;

const nextConfig: NextConfig = {
  env: googlePhotosClientId
    ? { NEXT_PUBLIC_GOOGLE_CLIENT_ID: googlePhotosClientId }
    : undefined,
};

export default nextConfig;
