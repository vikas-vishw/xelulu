// Jest stub for `global.css`. Metro compiles the Tailwind entry stylesheet, but Jest has no CSS
// transform, so `jest.config.js` maps every `.css` import to this empty module. It is not a test.

export default {};
