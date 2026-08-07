const fs = require("fs");
const s = fs.readFileSync("c:/Users/joaquin/Documents/Hidroponia-web V1.1/script.js", "utf8");
const stack = [];
let state = "code";
let line = 1;
let col = 0;
for (let i = 0; i < s.length; i++) {
  const c = s[i];
  const n = s[i + 1];
  col++;
  if (c === "\n") {
    line++;
    col = 0;
  }

  if (state === "code") {
    if (c === '"') { state = "d"; continue; }
    if (c === "'") { state = "s"; continue; }
    if (c === "`") { state = "t"; continue; }
    if (c === "/" && n === "/") { state = "lc"; i++; col++; continue; }
    if (c === "/" && n === "*") { state = "bc"; i++; col++; continue; }

    if (c === "{" || c === "(" || c === "[") {
      stack.push({ ch: c, line, col });
      continue;
    }

    if (c === "}" || c === ")" || c === "]") {
      const want = c === "}" ? "{" : c === ")" ? "(" : "[";
      const top = stack[stack.length - 1];
      if (!top || top.ch !== want) {
        console.log("Mismatch closing", c, "at", line + ":" + col, "top", top);
        process.exit(0);
      }
      stack.pop();
      continue;
    }
    continue;
  }

  if (state === "d") {
    if (c === "\\") { i++; col++; continue; }
    if (c === '"') { state = "code"; }
    continue;
  }

  if (state === "s") {
    if (c === "\\") { i++; col++; continue; }
    if (c === "'") { state = "code"; }
    continue;
  }

  if (state === "t") {
    if (c === "\\") { i++; col++; continue; }
    if (c === "`") { state = "code"; continue; }
    continue;
  }

  if (state === "lc") {
    if (c === "\n") state = "code";
    continue;
  }

  if (state === "bc") {
    if (c === "*" && n === "/") { state = "code"; i++; col++; continue; }
    continue;
  }
}

console.log("finalState", state);
console.log("unclosedCount", stack.length);
if (stack.length) {
  console.log("lastUnclosed", stack[stack.length - 1]);
}
