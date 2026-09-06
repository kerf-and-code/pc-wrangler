// Ambient module declaration for vosk-browser.
//
// The package is installed and works at runtime (it is imported dynamically in
// lib/compendium/useVosk.ts and bundled by the app builder), but it does not expose TypeScript type
// declarations that this project's tsconfig resolves, so `import("vosk-browser")` raised
// TS2307 ("Cannot find module 'vosk-browser' or its corresponding type declarations") and failed the
// build's type-check. This declares the module so the type-checker is satisfied; useVosk casts the
// dynamic import to its own minimal interface, so nothing here is lost by typing it loosely.
declare module "vosk-browser";
