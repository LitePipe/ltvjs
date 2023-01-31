import * as fs from 'fs';
import { Buffer } from 'node:buffer';
import * as ltv from "../src/index";

enum VectorType {
    Positive, 
    Negative,
}


function processVectors(fileName: string, vectorType: VectorType) {
    const vec = fs.readFileSync(fileName, 'utf8');
    const lines = vec.split('\n')

    for(let i=0; i < lines.length; i += 2) {
        const descLine = lines[i];
        const dataLine = lines[i+1];

        if (!dataLine) {
            continue;
        }

        console.log("Desc: ", descLine);
        console.log("Data: ", dataLine);

        const dataBuf = Buffer.from(dataLine, "hex");
        let decoded;

        try {
            decoded = ltv.deserialize(dataBuf);
        } catch (ex) {

            // Invalid vectors should get here
            if(vectorType === VectorType.Negative) {
                continue;
            }
            throw(ex);
        }

        // Only valid vectors should reach this point
        console.log(decoded); 
        if (vectorType === VectorType.Negative) {
            throw('invalid vector decoded');
        }
    }
}

console.log("Positive Vectors");
console.log()
processVectors(__dirname + "/litevectors_positive.txt", VectorType.Positive);
console.log()

console.log("Negative Vectors");
console.log()
processVectors(__dirname + "/litevectors_negative.txt", VectorType.Negative);
console.log()

console.log("All test vectors passed");
