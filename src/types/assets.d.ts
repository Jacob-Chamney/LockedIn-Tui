/** Bun file-loader imports return an embedded file path. */
declare module "*.wasm" {
  const path: string
  export default path
}

declare module "*.scm" {
  const path: string
  export default path
}
