/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@gtw/core", "@gtw/db", "@gtw/ingest"],
  serverExternalPackages: ["sharp"],
  poweredByHeader: false,
  images: { unoptimized: true },
  async headers() {
    // private site: never indexed
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }, { key: "Referrer-Policy", value: "no-referrer" }] }];
  },
  webpack(config, { isServer }) {
    if (isServer) {
      config.externals = [...(config.externals || []), { "node:sqlite": "commonjs node:sqlite" }];
    }
    return config;
  },
};
export default nextConfig;
