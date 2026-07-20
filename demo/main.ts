import { marked } from "marked";
import { convertJsonText, convertJsonValue, JsonToMarkdownError } from "../dist/index.js";

const input = document.getElementById("input") as HTMLTextAreaElement;
const output = document.getElementById("output") as HTMLDivElement;
const examplesBar = document.getElementById("examples") as HTMLDivElement;
const inputHint = document.getElementById("input-hint") as HTMLSpanElement;
const btnSerialized = document.getElementById("mode-serialized") as HTMLButtonElement;
const btnParsed = document.getElementById("mode-parsed") as HTMLButtonElement;
const btnPreview = document.getElementById("mode-preview") as HTMLButtonElement;
const btnSource = document.getElementById("mode-source") as HTMLButtonElement;
const btnCopy = document.getElementById("copy") as HTMLButtonElement;

marked.setOptions({ gfm: true, breaks: false });

type Example = { label: string; json: unknown };

const examples: Example[] = [
  {
    label: "Table",
    json: {
      table1: [
        { age: 14, degrees: [{ name: "B-Degree", year: "2023" }, { name: "C-Degree", year: "2024" }] },
        { age: 24, degrees: [{ name: "K-Degree", year: "2003" }, { name: "M-Degree", year: "2004" }] },
      ],
    },
  },
  { label: "Nested keys", json: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } },
  { label: "Mixed array", json: { values: [1, "two", null, [true, false], {}] } },
  {
    label: "Scalars & URLs",
    json: { site: "https://example.com", note: "literal **markdown** stays | escaped", price: 1.0, empty: "", missing: null },
  },
  // Raw text so the exact numeric spelling survives into the textarea; toggle
  // Serialized vs Parsed to see convertJsonText preserve it and convertJsonValue lose it.
  { label: "Big numbers", json: '{\n  "exact": 9007199254740993,\n  "trailing": 1.00,\n  "exp": 1e3\n}' },
  { label: "Duplicate keys (error)", json: '{"name":"first","name":"second"}' },
];

let outputMode: "preview" | "source" = "preview";
let inputMode: "serialized" | "parsed" = "serialized";
let lastMarkdown = "";

const HINTS = {
  serialized: "<code>convertJsonText(source)</code> — parses the raw text and preserves each number's exact spelling.",
  parsed: "<code>convertJsonValue(JSON.parse(source))</code> — converts the parsed value; numeric spelling is lost.",
};

function convert(source: string): string {
  if (inputMode === "serialized") return convertJsonText(source);
  // Parsed path: JSON.parse here stands in for a caller passing already-parsed data.
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new JsonToMarkdownError("INVALID_JSON_SYNTAX", `JSON.parse failed: ${(error as Error).message}`);
  }
  return convertJsonValue(value);
}

function render(): void {
  output.replaceChildren();
  let markdown: string;
  try {
    markdown = convert(input.value);
  } catch (error) {
    if (error instanceof JsonToMarkdownError) {
      lastMarkdown = "";
      output.appendChild(errorBox(error));
      return;
    }
    throw error;
  }
  lastMarkdown = markdown;

  if (outputMode === "source") {
    const pre = document.createElement("pre");
    pre.className = "source";
    pre.textContent = markdown;
    output.appendChild(pre);
    return;
  }

  const article = document.createElement("div");
  article.className = "preview";
  // Safe to inject: the converter escapes every GFM/HTML metacharacter in string
  // values, so the Markdown it emits carries no author-controlled HTML.
  article.innerHTML = marked.parse(markdown) as string;
  output.appendChild(article);
}

function errorBox(error: JsonToMarkdownError): HTMLElement {
  const box = document.createElement("p");
  box.className = "error";
  const parts = [`${error.code}: ${error.message}`];
  if (error.location) parts.push(`at line ${error.location.line}, column ${error.location.column}`);
  if (error.pointer !== undefined) parts.push(`pointer: ${error.pointer || "(root)"}`);
  box.textContent = parts.join("\n");
  return box;
}

function setOutputMode(next: "preview" | "source"): void {
  outputMode = next;
  btnPreview.setAttribute("aria-pressed", String(next === "preview"));
  btnSource.setAttribute("aria-pressed", String(next === "source"));
  render();
}

function setInputMode(next: "serialized" | "parsed"): void {
  inputMode = next;
  btnSerialized.setAttribute("aria-pressed", String(next === "serialized"));
  btnParsed.setAttribute("aria-pressed", String(next === "parsed"));
  inputHint.innerHTML = HINTS[next];
  render();
}

for (const example of examples) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = example.label;
  button.addEventListener("click", () => {
    input.value = typeof example.json === "string" ? example.json : JSON.stringify(example.json, null, 2);
    render();
  });
  examplesBar.appendChild(button);
}

btnSerialized.addEventListener("click", () => setInputMode("serialized"));
btnParsed.addEventListener("click", () => setInputMode("parsed"));
btnPreview.addEventListener("click", () => setOutputMode("preview"));
btnSource.addEventListener("click", () => setOutputMode("source"));
input.addEventListener("input", render);

btnCopy.addEventListener("click", async () => {
  if (!lastMarkdown) return;
  await navigator.clipboard.writeText(lastMarkdown);
  const original = btnCopy.textContent;
  btnCopy.textContent = "Copied!";
  window.setTimeout(() => {
    btnCopy.textContent = original;
  }, 1200);
});

// Seed with the first example.
inputHint.innerHTML = HINTS.serialized;
input.value = JSON.stringify(examples[0]!.json, null, 2);
render();
