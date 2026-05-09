// Ambient module declaration for webpack CSS side-effect imports.
// Required since TypeScript 6 (TS2882) no longer tolerates unknown
// module specifiers in side-effect imports.
declare module '*.css';
