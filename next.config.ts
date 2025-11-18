import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // this avoids the Route = "never" type error you saw earlier
    typedRoutes: false,
  },
};

export default nextConfig;
