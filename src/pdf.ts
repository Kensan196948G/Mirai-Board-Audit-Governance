/**
 * 依存パッケージ無しの最小PDF生成器（Cloudflare Workersランタイムでも動作）。
 * 等幅フォントでのプレーンテキスト帳票（証拠パッケージ・議事録・廃棄証明書）専用。
 * バックログ B-05（PDF帳票のサーバ生成）対応。
 */

const PAGE_WIDTH = 595; // A4 pt
const PAGE_HEIGHT = 842;
const MARGIN = 48;
const FONT_SIZE = 10;
const LINE_HEIGHT = 14;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT);
const CHARS_PER_LINE = 95;

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLine(line: string): string[] {
  if (line.length <= CHARS_PER_LINE) return [line];
  const out: string[] = [];
  let rest = line;
  while (rest.length > CHARS_PER_LINE) {
    out.push(rest.slice(0, CHARS_PER_LINE));
    rest = rest.slice(CHARS_PER_LINE);
  }
  out.push(rest);
  return out;
}

function paginate(lines: string[]): string[][] {
  const wrapped = lines.flatMap((l) => wrapLine(l));
  const pages: string[][] = [];
  for (let i = 0; i < wrapped.length; i += LINES_PER_PAGE) {
    pages.push(wrapped.slice(i, i + LINES_PER_PAGE));
  }
  return pages.length ? pages : [[]];
}

function contentStreamFor(pageLines: string[]): string {
  const ops: string[] = ["BT", `/F1 ${FONT_SIZE} Tf`, `${LINE_HEIGHT} TL`, `${MARGIN} ${PAGE_HEIGHT - MARGIN} Td`];
  pageLines.forEach((line, idx) => {
    if (idx > 0) ops.push("T*");
    ops.push(`(${escapePdfText(line)}) Tj`);
  });
  ops.push("ET");
  return ops.join("\n");
}

/**
 * title と本文行から単純なPDFバイト列を生成する。
 * 表・画像は扱わず、監査証跡の文字情報を確実に固定PDF化することを目的とする。
 */
export function generateSimplePdf(title: string, lines: string[]): Uint8Array {
  const pages = paginate([title, "=".repeat(Math.min(title.length, CHARS_PER_LINE)), "", ...lines]);
  const encoder = new TextEncoder();
  const objects: string[] = [];

  const pageCount = pages.length;
  const fontObjNum = 3;
  const firstPageObjNum = 4;
  const firstContentObjNum = firstPageObjNum + pageCount;

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  const kids = Array.from({ length: pageCount }, (_, i) => `${firstPageObjNum + i} 0 R`).join(" ");
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[fontObjNum] = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`;

  pages.forEach((pageLines, i) => {
    const pageObjNum = firstPageObjNum + i;
    const contentObjNum = firstContentObjNum + i;
    objects[pageObjNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /Contents ${contentObjNum} 0 R >>`;
    const stream = contentStreamFor(pageLines);
    const streamBytes = encoder.encode(stream).length;
    objects[contentObjNum] = `<< /Length ${streamBytes} >>\nstream\n${stream}\nendstream`;
  });

  const totalObjects = firstContentObjNum + pageCount;
  let body = "%PDF-1.4\n";
  const offsets: number[] = new Array(totalObjects);
  for (let n = 1; n < totalObjects; n += 1) {
    offsets[n] = encoder.encode(body).length;
    body += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xrefStart = encoder.encode(body).length;
  body += `xref\n0 ${totalObjects}\n0000000000 65535 f \n`;
  for (let n = 1; n < totalObjects; n += 1) {
    body += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${totalObjects} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return encoder.encode(body);
}
