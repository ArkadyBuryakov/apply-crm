// Plain text of a document version, so LLM clients (MCP and the in-app assistant) can read uploaded files, not only
// LaTeX sources: text files as they are, PDFs and Word documents extracted.
import { strFromU8, unzipSync } from "fflate";
import { extractText } from "unpdf";

export const MAX_TEXT_CHARS = 200_000;

export type TextFormat = "latex" | "text" | "pdf" | "docx";

const TEXT_EXTENSIONS = /\.(md|markdown|txt|tex|cls|sty|bib|csv|tsv|json|ya?ml|xml|html?|log|rtf)$/i;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Which extractor applies to a file, or null when its text cannot be read. */
export function textFormatOf(filename: string, mime: string): Exclude<TextFormat, "latex"> | null {
  if (mime === "application/pdf" || /\.pdf$/i.test(filename)) return "pdf";
  if (mime === DOCX_MIME || /\.docx$/i.test(filename)) return "docx";
  if (mime.startsWith("text/") || mime === "application/json" || TEXT_EXTENSIONS.test(filename)) return "text";
  return null;
}

export async function extractFileText(format: Exclude<TextFormat, "latex">, bytes: Uint8Array) {
  switch (format) {
    case "text":
      return { text: new TextDecoder().decode(bytes), totalPages: null };
    case "pdf": {
      const { text, totalPages } = await extractText(new Uint8Array(bytes), { mergePages: false });
      return { text: text.map((page, i) => `--- Page ${i + 1} ---\n${page}`).join("\n\n"), totalPages };
    }
    case "docx":
      return { text: docxText(bytes), totalPages: null };
  }
}

/** Paragraph text of word/document.xml; tables come out one cell per line. Formatting is dropped. */
function docxText(bytes: Uint8Array) {
  const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("Not a Word document");
  return strFromU8(xml)
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:(br|cr)\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncate(text: string) {
  return text.length > MAX_TEXT_CHARS
    ? { text: text.slice(0, MAX_TEXT_CHARS), truncated: true }
    : { text, truncated: false };
}
