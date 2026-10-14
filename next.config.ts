import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OAuth callbacks carry one-time codes: keep them out of development request logs.
  logging: { incomingRequests: { ignore: [/^\/auth\/callback(?:\?|$)/] } },
};

export default nextConfig;
