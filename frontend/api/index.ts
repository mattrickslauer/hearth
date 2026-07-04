/**
 * Vercel entry for Hearth's Expo Router server output (web.output: "server").
 *
 * `expo export -p web` emits dist/client (static assets, served automatically by
 * vercel.json's outputDirectory) and dist/server (the API-route + SSR bundle).
 * Vercel's rewrites send every request here; this hands it to Expo's server
 * runtime, which dispatches to the +api.ts routes (e.g. /qwen, our key-holding
 * Qwen proxy) and SSR pages. dist/server is packaged into this function via
 * vercel.json's `includeFiles`.
 *
 * CommonJS on purpose: this is the exact adapter shape Expo documents for SDK 54+
 * (`expo-server/adapter/vercel`, added in SDK 57's expo-server@57). It is NOT an
 * Expo Router route — it lives in api/, outside src/app/, and is compiled by
 * @vercel/node, so it never ships to the browser.
 */
const { createRequestHandler } = require('expo-server/adapter/vercel');

module.exports = createRequestHandler({
  build: require('path').join(__dirname, '../dist/server'),
});
