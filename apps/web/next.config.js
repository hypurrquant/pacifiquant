const withBundleAnalyzer = require('@next/bundle-analyzer')({
    enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: false,
    output: 'export',
    images: {
        unoptimized: true,
    },
    // ESM packages that need transpilation
    transpilePackages: [
        '@simplewebauthn/browser',
        '@zerodev/webauthn-key',
        // lighter-ts-sdk ships a WASM signer + pulls in ws (bufferutil /
        // utf-8-validate). Next's default bundler chokes on both under
        // `output: 'export'` — the dynamic import chunk either fails to
        // resolve or the WASM init throws inside the browser. Transpiling
        // forces webpack to own the module graph rather than leaving it
        // to the package's own pre-bundled artefacts.
        'lighter-ts-sdk',
    ],
    webpack: (config, { isServer }) => {
        // Privy SDK bundles Solana wallet support we don't use (HyperEVM only).
        // Stub out the missing Solana dependency to unblock the build.
        config.resolve.fallback = {
            ...config.resolve.fallback,
            '@solana-program/system': false,
            encoding: false, // node-fetch optional dep — WalletConnect/Privy
            // ws optional native deps — lighter-ts-sdk pulls these in via `ws`
            // for Node-only perf paths. In the browser we have `WebSocket`
            // globally, so stub both to `false` rather than failing the bundle.
            bufferutil: false,
            'utf-8-validate': false,
        };
        // lighter-ts-sdk's signer ships as WASM. Static export (`output:
        // 'export'`) disables streaming compilation by default, so explicitly
        // opt in via experiments; otherwise the dynamic `await import(
        // 'lighter-ts-sdk')` chunk fails with "Loading chunk ... failed".
        config.experiments = {
            ...config.experiments,
            asyncWebAssembly: true,
        };
        config.output.webassemblyModuleFilename = isServer
            ? '../static/wasm/[modulehash].wasm'
            : 'static/wasm/[modulehash].wasm';
        return config;
    },
}

module.exports = withBundleAnalyzer(nextConfig)
