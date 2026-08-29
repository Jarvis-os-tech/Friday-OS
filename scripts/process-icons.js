import fs from "fs";
import path from "path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const SOURCE_IMAGE = path.resolve(
  "C:/Users/srinu/.gemini/antigravity-ide/brain/911c5a44-05a3-40f8-8bf4-e64b1cbaa58d/aetheria_app_icon_1787999823101.jpg"
);

const TARGET_DIRS = [
  path.resolve("assets"),
  path.resolve("build"),
  path.resolve("public"),
];

async function generateIcons() {
  console.log("Generating high-resolution desktop application icons...");

  TARGET_DIRS.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  const pngBuffers = [];

  // Generate PNG for each resolution
  for (const size of sizes) {
    const buffer = await sharp(SOURCE_IMAGE)
      .resize(size, size, { fit: "cover" })
      .png({ quality: 100 })
      .toBuffer();

    if ([16, 32, 48, 64, 128, 256].includes(size)) {
      pngBuffers.push(buffer);
    }

    if (size === 512) {
      fs.writeFileSync(path.resolve("assets/icon.png"), buffer);
      fs.writeFileSync(path.resolve("build/icon.png"), buffer);
      fs.writeFileSync(path.resolve("public/icon.png"), buffer);
    }
    if (size === 256) {
      fs.writeFileSync(path.resolve("assets/icon-256.png"), buffer);
    }
    if (size === 32) {
      fs.writeFileSync(path.resolve("public/favicon-32x32.png"), buffer);
    }
  }

  // Generate multi-resolution ICO for Windows
  console.log("Generating Windows multi-resolution icon (.ico)...");
  const icoBuffer = await pngToIco(pngBuffers);
  fs.writeFileSync(path.resolve("assets/icon.ico"), icoBuffer);
  fs.writeFileSync(path.resolve("build/icon.ico"), icoBuffer);
  fs.writeFileSync(path.resolve("public/favicon.ico"), icoBuffer);

  console.log("✓ Successfully generated all desktop and web icons!");
}

generateIcons().catch((err) => {
  console.error("Error generating icons:", err);
  process.exit(1);
});
