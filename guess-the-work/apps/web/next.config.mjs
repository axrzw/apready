/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@gtw/core", "@gtw/db", "@gtw/ingest"],
  serverExternalPackages: ["sharp", "@electric-sql/pglite", "ffmpeg-static", "tesseract.js"],
  // ffmpeg binary + db migrations must ship with the functions
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  outputFileTracingIncludes: {
    "/**": ["../../packages/db/migrations/**"],
    "/api/m/[token]": ["../../node_modules/.pnpm/ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg"],
    "/api/admin/clip": ["../../node_modules/.pnpm/ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg"],
  },
  // local data (PGlite folder, media cache) never ships
  outputFileTracingExcludes: { "/**": ["../../data/**", "../../snapshot/**", "**/tesseract.js-core/**"] },
  poweredByHeader: false,
  images: { unoptimized: true },
  async headers() {
    // private site: never indexed
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }, { key: "Referrer-Policy", value: "no-referrer" }] }];
  },
  webpack(config, { isServer }) {
    if (isServer) {
      // loaded from node_modules at run time (wasm / native binaries), even when imported from workspace packages
      config.externals = [...(config.externals || []), { "@electric-sql/pglite": "commonjs @electric-sql/pglite", "@electric-sql/pglite/vector": "commonjs @electric-sql/pglite/vector", "ffmpeg-static": "commonjs ffmpeg-static", "tesseract.js": "commonjs tesseract.js" }];
    }
    return config;
  },
};
export default nextConfig;
