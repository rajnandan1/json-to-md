// Loads the released library and marked straight from the CDN, so the demo
// runs from any static file server — no build step, no dist/, no node_modules.
// To demo uncommitted local changes instead: run `pnpm build`, then
// temporarily import "../dist/index.js" here.
import { marked } from "https://cdn.jsdelivr.net/npm/marked@15/+esm";
import {
  convertJsonText,
  convertJsonValue,
  JsonToMarkdownError,
} from "https://cdn.jsdelivr.net/npm/@rajnandan1/json-to-md@3/dist/index.js";

const input = document.getElementById("input");
const output = document.getElementById("output");
const examplesBar = document.getElementById("examples");
const inputHint = document.getElementById("input-hint");
const status = document.getElementById("status");
const btnSerialized = document.getElementById("mode-serialized");
const btnParsed = document.getElementById("mode-parsed");
const btnPreview = document.getElementById("mode-preview");
const btnSource = document.getElementById("mode-source");
const btnCopy = document.getElementById("copy");
const optHeading = document.getElementById("opt-heading");
const optTypes = document.getElementById("opt-types");
const btnCopyInstall = document.getElementById("copy-install");
const installCmd = document.getElementById("install-cmd");

marked.setOptions({ gfm: true, breaks: false });

const examples = [
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
  // the entry point to see convertJsonText preserve it and convertJsonValue lose it.
  { label: "Big numbers", json: '{\n  "exact": 9007199254740993,\n  "trailing": 1.00,\n  "exp": 1e3\n}' },
  { label: "Duplicate keys (error)", json: '{"name":"first","name":"second"}' },
];

let outputMode = "preview";
let inputMode = "serialized";
let lastMarkdown = "";

const HINTS = {
  serialized: "Parses the raw text — numeric spelling like <code>1.00</code> survives.",
  parsed: "<code>JSON.parse</code> first — numeric spelling is lost.",
};

function convert(source) {
  const options = {
    // A cleared field means "omit the heading" — the library rejects "".
    heading: optHeading.value === "" ? null : optHeading.value,
    showTypes: optTypes.checked,
  };
  if (inputMode === "serialized") return convertJsonText(source, options);
  // Parsed path: JSON.parse here stands in for a caller passing already-parsed data.
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new JsonToMarkdownError("INVALID_JSON_SYNTAX", `JSON.parse failed: ${error.message}`);
  }
  return convertJsonValue(value, options);
}

const bytes = (text) => new TextEncoder().encode(text).length;

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function setPressed(button, on) {
  button.setAttribute("aria-pressed", String(on));
  button.classList.toggle("is-link", on);
  button.classList.toggle("is-selected", on);
}

function placeholder(text) {
  const p = document.createElement("p");
  p.className = "placeholder";
  p.textContent = text;
  return p;
}

function render() {
  output.replaceChildren();
  btnCopy.disabled = true;

  if (input.value.trim() === "") {
    lastMarkdown = "";
    status.textContent = "";
    output.appendChild(placeholder("Paste JSON on the left — its Markdown appears here as you type."));
    return;
  }

  let markdown;
  const started = performance.now();
  try {
    markdown = convert(input.value);
  } catch (error) {
    if (error instanceof JsonToMarkdownError) {
      lastMarkdown = "";
      status.textContent = "";
      output.appendChild(errorBox(error));
      return;
    }
    throw error;
  }
  const elapsed = performance.now() - started;
  lastMarkdown = markdown;
  btnCopy.disabled = false;
  status.textContent = `${formatBytes(bytes(input.value))} → ${formatBytes(bytes(markdown))} · ${elapsed < 0.1 ? "<0.1" : elapsed.toFixed(1)} ms`;

  if (outputMode === "source") {
    const pre = document.createElement("pre");
    pre.className = "md-source";
    pre.textContent = markdown;
    output.appendChild(pre);
    return;
  }

  const article = document.createElement("div");
  article.className = "content";
  // Safe to inject: the converter escapes every GFM/HTML metacharacter in string
  // values, so the Markdown it emits carries no author-controlled HTML.
  article.innerHTML = marked.parse(markdown);
  output.appendChild(article);
}

function errorBox(error) {
  const box = document.createElement("article");
  box.className = "message is-danger error-msg";
  const header = document.createElement("div");
  header.className = "message-header";
  header.textContent = error.code;
  const body = document.createElement("div");
  body.className = "message-body";
  const parts = [error.message];
  if (error.location) parts.push(`at line ${error.location.line}, column ${error.location.column}`);
  if (error.pointer !== undefined) parts.push(`pointer: ${error.pointer || "(root)"}`);
  body.textContent = parts.join("\n");
  box.append(header, body);
  return box;
}

function setOutputMode(next) {
  outputMode = next;
  setPressed(btnPreview, next === "preview");
  setPressed(btnSource, next === "source");
  render();
}

function setInputMode(next) {
  inputMode = next;
  setPressed(btnSerialized, next === "serialized");
  setPressed(btnParsed, next === "parsed");
  inputHint.innerHTML = HINTS[next];
  render();
}

for (const example of examples) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button is-small";
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
optHeading.addEventListener("input", render);
optTypes.addEventListener("change", render);

function copyFeedback(button, text) {
  const original = button.textContent;
  button.textContent = text;
  window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

btnCopy.addEventListener("click", async () => {
  if (!lastMarkdown) return;
  await navigator.clipboard.writeText(lastMarkdown);
  copyFeedback(btnCopy, "Copied!");
});

btnCopyInstall.addEventListener("click", async () => {
  await navigator.clipboard.writeText(installCmd.textContent);
  copyFeedback(btnCopyInstall, "Copied!");
});

// Seed with the first example; the toggles start in their HTML default state.
setInputMode("serialized");
setOutputMode("preview");
input.value = JSON.stringify(examples[0].json, null, 2);
render();
