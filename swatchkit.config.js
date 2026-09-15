// swatchkit.config.js
export default {
  cssDir: "./src/css",

  // Integrated app: esbuild (scripts/build-assets.js) owns the CSS, so
  // SwatchKit references the shared stylesheet instead of copying it. Both the
  // app and the pattern library point at dist/css/main.css.
  cssCopy: false,
  cssPath: "../css/",

  order: {
    swatches: {
      tokens: ["waterline-palette"],
    },
  },
};
