function dataUrl(mimeType: "image/jpeg" | "image/png", bytes: Buffer) {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

/** Structurally sufficient JPEG fixture with a SOF0 dimension segment. */
export function jpegDataUrl(width = 1, height = 1) {
  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
  ]);
  return dataUrl("image/jpeg", Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    sof,
    Buffer.from([0xff, 0xd9]),
  ]));
}

/** Structurally sufficient PNG fixture with IHDR and IEND chunks. */
export function pngDataUrl(width = 1, height = 1) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 6;
  const iend = Buffer.alloc(12);
  iend.write("IEND", 4, "ascii");
  return dataUrl("image/png", Buffer.concat([signature, ihdr, iend]));
}
