import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import png2icons from "png2icons";

const projectRoot = resolve(import.meta.dirname, "..");
const sourceSvg = join(projectRoot, "src", "assets", "icons", "queryeer-logo.svg");
const outputDir = join(projectRoot, "resources", "icons");

const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function generatePngs(svgBuffer) {
  const generated = [];
  for (const size of pngSizes) {
    const output = join(outputDir, `icon-${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(output);
    generated.push(output);
  }
  return generated;
}

async function generateIco() {
  const png256 = await readFile(join(outputDir, "icon-256.png"));
  const ico = png2icons.createICO(png256, png2icons.BICUBIC, 0, false, true);
  if (!ico) {
    throw new Error("Failed to generate ICO output");
  }
  await writeFile(join(outputDir, "icon.ico"), ico);
}

async function generateIcns() {
  const png1024 = await readFile(join(outputDir, "icon-1024.png"));
  const icns = png2icons.createICNS(png1024, png2icons.BICUBIC, 0);
  if (!icns) {
    throw new Error("Failed to generate ICNS output");
  }
  await writeFile(join(outputDir, "icon.icns"), icns);
}

async function main() {
  await ensureDir(outputDir);
  const svgBuffer = await readFile(sourceSvg);
  await generatePngs(svgBuffer);
  await generateIco();
  await generateIcns();

  await writeFile(join(projectRoot, "resources", "icon.png"), await readFile(join(outputDir, "icon-512.png")));
  await writeFile(join(projectRoot, "resources", "icon.ico"), await readFile(join(outputDir, "icon.ico")));
  await writeFile(join(projectRoot, "resources", "icon.icns"), await readFile(join(outputDir, "icon.icns")));

  console.log("Generated app icons in resources/ and resources/icons/");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
