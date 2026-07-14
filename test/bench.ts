import { CA } from "../src/ca.js";
const ca = new CA({ cols: 600, rows: 600, dist: 100, stripes: false });
for (let i = 0; i < 120; i++) ca.step(); // warmup
const N = 600;
let t = performance.now();
for (let i = 0; i < N; i++) ca.step();
let ms = (performance.now() - t) / N;
console.log(
    `fused step()  : ${ms.toFixed(3)} ms/gen  ->  ${(1000 / ms).toFixed(0)} gen/s`,
);
t = performance.now();
for (let i = 0; i < N; i++) ca.process();
ms = (performance.now() - t) / N;
console.log(
    `process()     : ${ms.toFixed(3)} ms/gen  ->  ${(1000 / ms).toFixed(0)} gen/s`,
);
t = performance.now();
for (let i = 0; i < N; i++) ca.render();
ms = (performance.now() - t) / N;
console.log(`render()      : ${ms.toFixed(3)} ms`);
