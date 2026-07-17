// Toggle for exposing dev routes outside of development builds.
// Set to true to keep the /dev routes visible even in production builds (e.g. debug mobile packages).
export const FORCE_ENABLE_DEV_PAGES = process.env.NODE_ENV === 'development'
