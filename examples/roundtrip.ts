// Example round trip from NodeJS

import * as fs from 'fs';
import * as ltv from "../src/index";

const o = {
    "string": "Yep",
    "null": null,
    "bool": true,
    "u8": 123,
    "i8": -7,
    "u16": 50000,
    "sub": {
        "One": 1,
        "Two": 2,
    },
    "a list": ["Uno", "Dos", "Tres"],
    "uint16[]": new Uint16Array(10),
    "float32[]": new Float32Array(10),
    "float64": 123.456
}

console.log(o);
let bin = ltv.serialize(o);
console.log(bin);

fs.writeFileSync("js_data.ltv", Buffer.from(bin));

let round = ltv.deserialize(bin);
console.log(round);

// let b = fs.readFileSync("../c/tools/c_data.ltb");
// let o1 = ltv.deserialize(b);
// console.log(o1);
