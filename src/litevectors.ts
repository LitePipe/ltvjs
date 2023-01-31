enum TypeCode {
    Nil = 0,
    Struct = 1,
    List = 2, 
    End = 3,  
    String = 4,
    Bool = 5,
    U8 = 6,
    U16 = 7,
    U32 = 8,
    U64 = 9,
    I8 = 10,
    I16 = 11,
    I32 = 12,
    I64 = 13,
    F32 = 14,
    F64 = 15
}

enum SizeCode {
    Single = 0,
    Size1  = 1,
    Size2  = 2,
    Size4  = 3,
    Size8  = 4
}

const NOP_TAG = 0xFF;
const typeSizes = [0, 0, 0, 0, 1, 1, 1, 2, 4, 8, 1, 2, 4, 8, 4, 8];

const INT8_MIN = BigInt(-128);
const UINT8_MAX = BigInt(255);
const UINT16_MAX = BigInt(65535);
const INT16_MIN = BigInt(-32768);
const INT32_MIN = BigInt(-2147483648);
const UINT32_MAX = BigInt(4294967295);

const utf8decoder = new TextDecoder('utf-8', {fatal: true});
const utf8Encoder = new TextEncoder();

////////////////////////////////////////////////////////////////////////////////
// Serialization
////////////////////////////////////////////////////////////////////////////////

class BufferBuilder {

    buf: Uint8Array;
    idx: number;
    private view: DataView;

    constructor(capacity: number) {
        this.idx = 0;
        this.buf = new Uint8Array(capacity);
        this.view = new DataView(this.buf.buffer);
    }

    // Ensure that the backing buffer is sized to receive a new chunk
    private sizeCheck(size: number) {
        if (this.idx + size < this.buf.byteLength) {
            // Size fits
            return;
        }

        // Expand buffer
        const bufferGrowthFactor = 1.5;
        let newCapacity = Math.ceil(((this.buf.byteLength + size) * bufferGrowthFactor));
        let newBuf = new Uint8Array(newCapacity);
        newBuf.set(this.buf.subarray(0, this.idx));
        this.buf = newBuf;
        this.view = new DataView(this.buf.buffer);
    }

    appendTag(typeCode: TypeCode, sizeCode: SizeCode = SizeCode.Single) {
        this.appendU8((typeCode << 4) | sizeCode);
    }

    appendNop() {
        this.appendU8(NOP_TAG);
    }

    append(val: Uint8Array) {
        this.sizeCheck(val.byteLength);
        this.buf.set(val, this.idx);
        this.idx += val.byteLength;
    }

    appendU8(val: number) {
        this.sizeCheck(1);
        this.view.setUint8(this.idx, val);
        this.idx += 1;
    }

    appendInt(val: bigint, byteLength: number) {
        this.append(new Uint8Array(new BigInt64Array([val]).buffer, 0, byteLength));
    }

    appendUInt(val: bigint, byteLength: number) {
        this.append(new Uint8Array(new BigUint64Array([val]).buffer, 0, byteLength));
    }

    appendF64(val: number) {
        this.sizeCheck(8);
        this.view.setFloat64(this.idx, val, true);
        this.idx += 8;
    }
}

function encodeVector(b: BufferBuilder, typeCode: TypeCode, val: Uint8Array) {
    const vecLen = BigInt(val.byteLength);
    let lenSize = 8;
    let sizeCode = SizeCode.Size8; 

    if (vecLen < UINT8_MAX) {
        lenSize = 1;
        sizeCode = SizeCode.Size1;
    } else if (vecLen < UINT16_MAX) {
        lenSize = 2;
        sizeCode = SizeCode.Size2;
    } else if(vecLen < UINT32_MAX) {
        lenSize = 4;
        sizeCode = SizeCode.Size4;
    } 
    
    const typeSize = typeSizes[typeCode];
    const alignmentDelta = (b.idx + 1 + lenSize) & (typeSize - 1);

    if (alignmentDelta != 0) {
		const paddingLen = typeSize - alignmentDelta;
		for (let i = 0; i < paddingLen; i++) {
			b.appendNop();
		}
	}

    b.appendTag(typeCode, sizeCode);
    b.appendUInt(vecLen, lenSize);

    b.append(val);
}

function goldilocksEncodeInteger(b: BufferBuilder, val: bigint) {
    if (val < INT32_MIN) {
        b.appendTag(TypeCode.I64);
        b.appendInt(BigInt.asIntN(64, val), 8);
    } else if (val < INT16_MIN) {
        b.appendTag(TypeCode.I32);
        b.appendInt(val, 4);
    } else if (val < INT8_MIN) {
        b.appendTag(TypeCode.I16);
        b.appendInt(val, 2);
    } else if(val < 0) {
        b.appendTag(TypeCode.I8);
        b.appendInt(val, 1);
    } else if (val <= UINT8_MAX) {
        b.appendTag(TypeCode.U8);
        b.appendUInt(val, 1);
    } else if (val <= UINT16_MAX) {
        b.appendTag(TypeCode.U16);
        b.appendUInt(val, 2);
    } else if(val <= UINT32_MAX) {
        b.appendTag(TypeCode.U32);
        b.appendUInt(val, 4);
    } else {
        b.appendTag(TypeCode.U64);
        b.appendUInt(BigInt.asUintN(64, val), 8);
    }
}

function encode(b: BufferBuilder, val: any) {
    if (val == null) {
        // nil or undefined
        b.appendTag(TypeCode.Nil);
    } else if (typeof(val) === "string") {
        // String
        encodeVector(b, TypeCode.String, utf8Encoder.encode(val));
    } else if(typeof(val) === "boolean") {
        // Bool
        b.appendTag(TypeCode.Bool);
        b.appendU8(val ? 1 : 0);
    } else if (typeof(val) === "number") {
        if (Number.isInteger(val)) {
            // Integer
            goldilocksEncodeInteger(b, BigInt(val));
        } else {
            // Float
            b.appendTag(TypeCode.F64);
            b.appendF64(val);
        }
    } else if(typeof(val) === "bigint") {
        // Bigint
        goldilocksEncodeInteger(b, val);
    } else if (Array.isArray(val)) {
        // List
        b.appendTag(TypeCode.List);
        for(let element of val) {
            encode(b, element);
        } 
        b.appendTag(TypeCode.End);
    } else if (val instanceof(ArrayBuffer)) {
        // Bytes
        encodeVector(b, TypeCode.U8, new Uint8Array(val));
    } else if (ArrayBuffer.isView(val)) {
        // Numeric Vectors
        let typeCode;
        if (val instanceof Int8Array) {
            typeCode = TypeCode.I8;
        } else if(val instanceof Int16Array) {
            typeCode = TypeCode.I16;
        } else if (val instanceof Int32Array) {
            typeCode = TypeCode.I32;
        } else if (val instanceof BigInt64Array) {
            typeCode = TypeCode.I64;
        } else if (val instanceof Uint8Array) {
            typeCode = TypeCode.U8;
        } else if (val instanceof Uint8ClampedArray) {
            typeCode = TypeCode.U8;
        } else if (val instanceof Uint16Array) {
            typeCode = TypeCode.U16;
        } else if (val instanceof Uint32Array) {
            typeCode = TypeCode.U32;
        } else if (val instanceof BigUint64Array) {
            typeCode = TypeCode.U64;
        } else if (val instanceof Float32Array) {
            typeCode = TypeCode.F32;
        } else if (val instanceof Float64Array) {
            typeCode = TypeCode.F64;
        } else {
            throw(`Unsupported vector encountered during serialization: ${val}`);

        }

        encodeVector(b, typeCode, new Uint8Array(val.buffer, val.byteOffset, val.byteLength));
    } else if(val instanceof Map) {
        // Map/Struct
        b.appendTag(TypeCode.Struct);
        for(const [key, value] of val.entries()){
            encode(b, key);
            encode(b, value);
        }
        b.appendTag(TypeCode.End);

    } else if(typeof(val) === "object") {
        // Object/Struct
        b.appendTag(TypeCode.Struct);
        for(let key of Object.keys(val)){
            encode(b, key);
            encode(b, val[key]);
        }
        b.appendTag(TypeCode.End);
    } else {
        throw(`Unsupported element encountered during serialization: ${val}`);
    }
}

export function serialize(o: any): Uint8Array {
    let b = new BufferBuilder(64);
    encode(b, o);
    return b.buf.subarray(0, b.idx);
}

////////////////////////////////////////////////////////////////////////////////
// Deserialization
////////////////////////////////////////////////////////////////////////////////

function readTag(buf: Uint8Array, idx: number): [number, TypeCode, SizeCode] {
    let typeCode = (buf[idx] & 0xF0) >> 4;
    let sizeCode = (buf[idx] & 0x0F);
    idx += 1;

    // Validity check
    if (sizeCode > SizeCode.Size8 || (typeCode <= TypeCode.End && sizeCode != SizeCode.Single)) {
        throw("Invalid tag");
    }

    return [idx, typeCode, sizeCode];
}

function readLen(buf: Uint8Array, idx: number, sizeCode: SizeCode): [number, number] {
    let lenSize = 1 << (sizeCode - 1);
    let val = 0;

    if (idx + lenSize > buf.length) {
        throw("truncated input");
    }

    for(let i=0; i < lenSize; i++) {
        val += buf[idx] * (2 ** i);
        idx += 1;
    }
    return [idx, val];
}

function decode(buf: Uint8Array, idx: number, nestingStack: TypeCode[]): [number, any] {
    let typeCode: TypeCode
    let sizeCode: SizeCode
    let len;

    if (idx >= buf.byteLength) {
        // Check correct structure
        if (nestingStack.length) {
            throw("Unclosed " + TypeCode[nestingStack[nestingStack.length-1]])
        }
        return [idx, undefined];
    }

    // Skip NOP bytes
    while(buf[idx] == NOP_TAG) {
        idx += 1;
        if (idx >= buf.byteLength) {
            // Check correct structure
            if (nestingStack.length) {
                throw("Unclosed " + TypeCode[nestingStack[nestingStack.length-1]])
            }
            return [idx, undefined];
        }
    }

    // Read tag
    [idx, typeCode, sizeCode] = readTag(buf, idx);

    // Nil
    if (typeCode === TypeCode.Nil) {
        return [idx, null];
    }

    // End
    if (typeCode === TypeCode.End) {
        if (nestingStack.length === 0) {
            throw("unmatched end tag");
        }

        nestingStack.pop();
        return [idx, undefined];
    }

    // List
    if (typeCode === TypeCode.List) {
        nestingStack.push(TypeCode.List);
        let lst = [];
        let nextElement;
        [idx, nextElement] = decode(buf, idx, nestingStack);
        while(nextElement !== undefined) {
            lst.push(nextElement);
            [idx, nextElement] = decode(buf, idx, nestingStack);
        }
        return [idx, lst];
    }

    // Struct
    if (typeCode === TypeCode.Struct) {
        nestingStack.push(TypeCode.Struct);
        let struct = {} as any;
        let key, value;
        while(idx < buf.byteLength) {
            [idx, key] = decode(buf, idx, nestingStack);

            if (key === undefined) {
                return [idx, struct];
            }

            // Key validation
            if (typeof(key) !== "string") {
                throw('struct key: string expected');
            }

            // TODO: Make this an optional check that can flag an error on duplicates if desired.
            // // Duplicate check
            // if (key in struct) {
            //     throw('duplicate struct key');
            // }

            [idx, value] = decode(buf, idx, nestingStack);
            if (value === undefined) {
                throw('struct missing value');
            }

            struct[key] = value;
        }
        return [idx, struct];
    }

    if (sizeCode === SizeCode.Single) {
        // Single Elements
        if (idx + typeSizes[typeCode] > buf.byteLength) {
            throw('unexpected EOF');
        }

        const view = new DataView(buf.buffer, buf.byteOffset + idx, typeSizes[typeCode]);

        switch(typeCode) {
        case TypeCode.String:
            return [idx +1, utf8decoder.decode(buf.subarray(idx, idx+1), {stream: false})];
        case TypeCode.Bool:
            return [idx + 1, view.getUint8(0) === 0 ? false : true];
        case TypeCode.U8:
            return [idx + 1, view.getUint8(0)];
        case TypeCode.U16:
            return [idx + 2, view.getUint16(0, true)];
        case TypeCode.U32:
            return [idx + 4, view.getUint32(0, true)];
        case TypeCode.U64:
            return [idx + 8, view.getBigUint64(0, true)];
        case TypeCode.I8:
            return [idx + 1, view.getInt8(0)];
        case TypeCode.I16:
            return [idx + 2, view.getInt16(0, true)];
        case TypeCode.I32:
            return [idx + 4, view.getInt32(0, true)];
        case TypeCode.I64:
            return [idx + 8, view.getBigInt64(0, true)];
        case TypeCode.F32:
            return [idx + 4, view.getFloat32(0, true)];
        case TypeCode.F64:
            return [idx + 8, view.getFloat64(0, true)];
        default:
            throw(`Unexpected typeCode: ${typeCode}`);
        }
    } else {
        // Vectors
        [idx, len] = readLen(buf, idx, sizeCode);

        //Check: we have all the data
        if (idx + len > buf.byteLength) {
            throw("Missing vector data");
        }

        let vecType;
        switch(typeCode) {
        case TypeCode.String:
            return [idx+len, utf8decoder.decode(buf.subarray(idx, idx+len), {stream: false})];
        case TypeCode.Bool:
            // This degenerates a boolean vector into a JavaScript array.
            // An alternative might be to comment out the following line, and let the
            // bool type fallthrough to a Uint8Array, interpreted as booleans.
            return [idx+len, Array.from(buf.subarray(idx, idx+len), v => v !== 0)];
        case TypeCode.U8:
            vecType = Uint8Array;
            break;
        case TypeCode.U16:
            vecType = Uint16Array;
            break;
        case TypeCode.U32:
            vecType = Uint32Array;
            break;
        case TypeCode.U64:
            vecType = BigUint64Array;
            break;
        case TypeCode.I8:
            vecType = Int8Array;
            break;
        case TypeCode.I16:
            vecType = Int16Array;
            break;
        case TypeCode.I32:
            vecType = Int32Array;
            break;
        case TypeCode.I64:
            vecType = BigInt64Array;
            break;
        case TypeCode.F32:
            vecType = Float32Array;
            break;
        case TypeCode.F64:
            vecType = Float64Array;
            break;
        default:
            return [idx + len, buf.subarray(idx, idx+len)];
        }

        // Check: vector size is a multiple of type size.
        if (len % vecType.BYTES_PER_ELEMENT !== 0) {
            throw("Invalid vector length for type");
        }

        // JavaScript's typed arrays require aligned array buffers.
        // If the array is already aligned, we can just take a view directly on it.
        // Otherwise, we have to copy the array to a new backing buffer.
        if (idx % vecType.BYTES_PER_ELEMENT === 0) {
            return [idx + len, new vecType(buf.buffer, buf.byteOffset + idx, len/vecType.BYTES_PER_ELEMENT)];
        } else {
            return [idx + len, new vecType(buf.buffer.slice(buf.byteOffset + idx, buf.byteOffset+idx+len))];
        }
    }
}

export function deserialize(buf: Uint8Array): any {
    let nestingStack = Array<TypeCode>();
    const [_, element] = decode(buf, 0, nestingStack);
    return element;
}

