// Local test-runner compatibility only: Undici binds this API at import time.
// These tests never request zstd content; fail explicitly if one does.
const zlib = require("node:zlib");
if (typeof zlib.createZstdDecompress !== "function") {
  zlib.createZstdDecompress = () => {
    throw new Error("This Node runtime cannot decompress zstd content.");
  };
}
