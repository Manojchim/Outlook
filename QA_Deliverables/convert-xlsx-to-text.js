const ExcelJS = require("exceljs");
const fs = require("node:fs");
const path = require("node:path");

const dir = __dirname;

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function markdownEscape(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

async function convert() {
  const files = fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".xlsx"));

  for (const fileName of files) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(dir, fileName));
    const baseName = fileName.replace(/\.xlsx$/i, "");
    const combinedMarkdown = [`# ${baseName.replace(/_/g, " ")}`, ""];

    for (const worksheet of workbook.worksheets) {
      const rows = worksheet.getSheetValues();
      const valueRows = [];

      for (let rowNumber = 1; rowNumber < rows.length; rowNumber += 1) {
        const row = rows[rowNumber];
        if (!row) continue;
        const values = [];
        for (let columnNumber = 1; columnNumber <= worksheet.columnCount; columnNumber += 1) {
          const cell = worksheet.getRow(rowNumber).getCell(columnNumber);
          values.push(cell.value?.text ?? cell.value?.result ?? cell.value ?? "");
        }
        if (values.some((value) => String(value).trim() !== "")) valueRows.push(values);
      }

      if (!valueRows.length) continue;

      const csv = valueRows.map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
      fs.writeFileSync(path.join(dir, `${baseName}.csv`), csv, "utf8");

      combinedMarkdown.push(`## ${worksheet.name}`, "");
      const header = valueRows[0];
      combinedMarkdown.push(`| ${header.map(markdownEscape).join(" | ")} |`);
      combinedMarkdown.push(`| ${header.map(() => "---").join(" | ")} |`);
      for (const row of valueRows.slice(1)) {
        combinedMarkdown.push(`| ${row.map(markdownEscape).join(" | ")} |`);
      }
      combinedMarkdown.push("");
    }

    fs.writeFileSync(path.join(dir, `${baseName}.md`), combinedMarkdown.join("\n"), "utf8");
  }
}

convert().catch((error) => {
  console.error(error);
  process.exit(1);
});
