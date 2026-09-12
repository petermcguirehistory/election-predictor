// d3 is vendored as the UMD build, because engine/dashboard/geo.py drives the
// same file through node to project district centroids. One copy, two consumers:
// index.html loads it as a classic script and this shim hands it to the modules.
const d3 = globalThis.d3;
if (!d3) throw new Error('d3 is missing — vendor/d3.v7.min.js must load before the modules');
export default d3;
