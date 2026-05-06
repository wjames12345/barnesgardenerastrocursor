// Empty PostCSS config. Astro's Vite searches for one and was finding a
// stray empty/corrupt file somewhere up the directory tree, causing a
// JSON parse error and 500ing every route. Providing an explicit empty
// config here short-circuits that search.
module.exports = {};
