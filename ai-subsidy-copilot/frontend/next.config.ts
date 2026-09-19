import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app", "*.ngrok.dev"],
};

export default nextConfig;
