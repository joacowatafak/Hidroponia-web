const fs = require("fs");
const filePath = "c:/Users/joaquin/Documents/Hidroponia-web V1.1/script.js";
const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
function ok(n) {
  try {
    new Function(lines.slice(0, n).join("\n"));
    return true;
  } catch (e) {
    return false;
  }
}
let lo = 1;
let hi = lines.length;
let ans = lines.length;
while (lo <= hi) {
  const mid = Math.floor((lo + hi) / 2);
  if (ok(mid)) {
    lo = mid + 1;
  } else {
    ans = mid;
    hi = mid - 1;
  }
}
console.log("firstFailLine", ans);
try {
  new Function(lines.slice(0, ans).join("\n"));
} catch (e) {
  console.log("error", e.message);
}
