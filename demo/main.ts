import { marked } from "marked";
import { convertJsonText, JsonToMarkdownError } from "../dist/index.js";

const input = document.getElementById("input") as HTMLTextAreaElement;
const output = document.getElementById("output") as HTMLDivElement;
const examplesBar = document.getElementById("examples") as HTMLDivElement;
const btnPreview = document.getElementById("mode-preview") as HTMLButtonElement;
const btnSource = document.getElementById("mode-source") as HTMLButtonElement;

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
  {
    label: "Nested keys",
    json: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } },
  },
  {
    label: "Mixed array",
    json: { values: [1, "two", null, [true, false], {}] },
  },
  {
    label: "Scalars & URLs",
    json: {
      site: "https://example.com",
      note: "literal **markdown** stays | escaped",
      price: 1.0,
      empty: "",
      missing: null,
    },
  },
  {
    label: "Duplicate keys (error)",
    json: '{"name":"first","name":"second"}',
  },
];

let mode: "preview" | "source" = "preview";

function render(): void {
  const source = input.value;
  output.replaceChildren();

  let markdown: string;
  try {
    markdown = convertJsonText(source);
  } catch (error) {
    if (error instanceof JsonToMarkdownError) {
      output.appendChild(errorBox(error));
      return;
    }
    throw error;
  }

  if (mode === "source") {
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

function setMode(next: "preview" | "source"): void {
  mode = next;
  btnPreview.setAttribute("aria-pressed", String(next === "preview"));
  btnSource.setAttribute("aria-pressed", String(next === "source"));
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

btnPreview.addEventListener("click", () => setMode("preview"));
btnSource.addEventListener("click", () => setMode("source"));
input.addEventListener("input", render);

// Seed with the first example.
input.value = JSON.stringify(examples[0]!.json, null, 2);
render();
