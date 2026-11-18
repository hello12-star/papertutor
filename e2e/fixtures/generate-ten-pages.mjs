import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pages = 10;
const objects = [];
const pageIds = [];
const contentIds = [];
let next = 4;

for (let index = 0; index < pages; index += 1) {
  pageIds.push(next);
  contentIds.push(next + 1);
  next += 2;
}

objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
objects[2] = `<< /Type /Pages /Kids [${pageIds
  .map((id) => `${id} 0 R`)
  .join(" ")}] /Count ${pages} >>`;
objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

for (let index = 0; index < pages; index += 1) {
  const content = `BT /F1 24 Tf 72 720 Td (PaperTutor M1-E3 test page ${index + 1}) Tj ET`;
  objects[pageIds[index]] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
    `/Contents ${contentIds[index]} 0 R ` +
    "/Resources << /Font << /F1 3 0 R >> >> >>";
  objects[contentIds[index]] =
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
}

let pdf = "%PDF-1.4\n";
const offsets = [];
for (let id = 1; id < objects.length; id += 1) {
  offsets[id] = Buffer.byteLength(pdf);
  pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
}

const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
for (let id = 1; id < objects.length; id += 1) {
  pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

const target = fileURLToPath(new URL("./ten-pages.pdf", import.meta.url));
writeFileSync(target, pdf, "binary");
console.log(`wrote ${target} (${Buffer.byteLength(pdf)} bytes, ${pages} pages)`);