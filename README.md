JavaScript/TypeScript library for LiteVectors.

This is a simplified reference implementation. There are numerous interesting implementation options such as a streaming interface or taking advantage of resizable array buffers (when available) of that could be explored.

# Implementation Details

Standalone `bool` values are interpreted as `boolean`. Vectors of `bool` are returned as a `Uint8Array` mapping directly to the LiteVectors boolean specification.

# Limitations
This code is written assuming a _little endian_ architecture.

Buffer size indexes and calculations are currently implemented with native JavaScript numbers, limiting the size of individual messages/vectors to approximately 9 Petabytes. If you need buffers larger than this, extend the indexes to use BigInts internally.