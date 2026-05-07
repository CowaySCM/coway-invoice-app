// api/extract.js
// Vercel serverless function — receives PDF(s), calls Claude, returns .xlsx

const ANTHROPIC_API_KEY = "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"; // ← paste your key here

const https = require("https");

// ── VENDOR RULES ─────────────────────────────────────────────
const GL_12150400 = ["YIC LOGISTICS INC", "SAMSUNG SDS AMERICA, INC.", "APAC CUSTOMS BROKERS LLC", "TOGETHER LOGISTICS INC", "GLOVIS AMERICA.INC", "GLOVIS AMERICA INC"];
const GL_54231100 = ["CJ LOGISTICS AMERICA, LLC", "DUOTECH AMERICA INC"];
const GL_54230400 = ["INSPIEN, INC.", "INSPIEN INC"];
const GL_54550600 = ["GOLD COAST LOGISTICS", "PRIORITY1", "EDI EXPRESS, INC.", "365 MOVING FAST", "BTX GLOBAL LOGISTICS", "BACARELLA TRANSPORTATION SERVICES INC.", "SOUTHWEST EXPRESS LINE WAY INC"];
const NO_COST_CENTER = [...GL_54550600];
const REMARK_HBL = [...GL_12150400];

const HEADERS = [
  "File Name", "GL Account", "Invoice Date", "Cost Center",
  "Vendor Name", "Total Amount", "Invoice Number",
  "Participants", "Remark", "Tax", "MBL No", "HBL No",
  "Ship From", "Ship To"
];

// Cost Center lookup data (mirrors your Google Sheet — update as needed)
// Format: { zip: "CXXX", city: "CITY NAME" } -> costCenter
// You can expand this array to match your actual Cost Center sheet
const COST_CENTER_DATA = [
  // Example entries — replace with your actual data
  // { zip: "90001", city: "LOS ANGELES", state: "CA", costCenter: "C101" },
];

function matchVendor(name, list) {
  const upper = (name || "").toUpperCase();
  return list.some(v => upper.includes(v.toUpperCase()));
}

function getGLAccount(vendorName) {
  if (matchVendor(vendorName, GL_12150400)) return "12150400";
  if (matchVendor(vendorName, GL_54231100)) return "54231100";
  if (matchVendor(vendorName, GL_54230400)) return "54230400";
  if (matchVendor(vendorName, GL_54550600)) return "54550600";
  return "";
}

function getCostCenter(vendorName, shipTo) {
  if (!matchVendor(vendorName, NO_COST_CENTER)) return "C105";
  if (!shipTo) return "";

  const shipUpper = (shipTo || "").toUpperCase();
  const zips = (shipTo.match(/\b\d{5}\b/g) || []);

  for (const entry of COST_CENTER_DATA) {
    if (entry.zip && zips.includes(entry.zip)) return entry.costCenter;
  }
  for (const entry of COST_CENTER_DATA) {
    if (entry.city && shipUpper.includes(entry.city.toUpperCase())) return entry.costCenter;
  }
  return "";
}

function getRemark(vendorName, hblNo) {
  return matchVendor(vendorName, REMARK_HBL) ? (hblNo || "") : "";
}

function formatDate(d) {
  if (!d) return "";
  if (/^\d{8}$/.test(d)) return d;
  const parsed = new Date(d);
  if (isNaN(parsed)) return d;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function buildRow(inv, fileName) {
  const vendor = inv.vendor_name || "";
  return [
    fileName,
    getGLAccount(vendor),
    formatDate(inv.invoice_date),
    getCostCenter(vendor, inv.ship_to),
    vendor,
    inv.total_amount ?? "",
    inv.invoice_number || "",
    "",
    getRemark(vendor, inv.hbl_no),
    inv.tax ?? "",
    inv.mbl_no || "",
    inv.hbl_no || "",
    inv.ship_from || "",
    inv.ship_to || "",
  ];
}

// ── CLAUDE API CALL ───────────────────────────────────────────
function callClaude(apiKey, base64Data, merged) {
  const prompt = merged
    ? `You are an invoice data extraction assistant. This PDF may contain one or multiple invoices.
Count how many separate invoices are in this document, then extract each as a separate object.
Return ONLY a valid JSON array (even for 1 invoice). No markdown, no explanation.
Each element:
{
  "invoice_number": string, "invoice_date": string (YYYYMMDD),
  "vendor_name": string, "vendor_address": string, "bill_to": string,
  "line_items_summary": string, "subtotal": number, "tax": number,
  "total_amount": number, "currency": string, "payment_terms": string,
  "po_number": string, "mbl_no": string, "hbl_no": string,
  "ship_from": string, "ship_to": string, "notes": string
}`
    : `You are an invoice data extraction assistant. Extract all fields from this invoice PDF.
Return ONLY a valid JSON object. No markdown, no explanation.
{
  "invoice_number": string, "invoice_date": string (YYYYMMDD),
  "vendor_name": string, "vendor_address": string, "bill_to": string,
  "line_items_summary": string, "subtotal": number, "tax": number,
  "total_amount": number, "currency": string, "payment_terms": string,
  "po_number": string, "mbl_no": string, "hbl_no": string,
  "ship_from": string, "ship_to": string, "notes": string
}`;

  const body = JSON.stringify({
    model: "claude-opus-4-5",
    max_tokens: merged ? 4096 : 1024,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } },
        { type: "text", text: prompt }
      ]
    }]
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
        "Content-Length": Buffer.byteLength(body),
      }
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`Claude API ${res.statusCode}: ${data}`));
        try {
          const json = JSON.parse(data);
          const raw = json.content.filter(b => b.type === "text").map(b => b.text).join("");
          const cleaned = raw.replace(/```json|```/g, "").trim();
          resolve(JSON.parse(cleaned));
        } catch (e) {
          reject(new Error("Failed to parse Claude response: " + e.message));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── MINIMAL XLSX BUILDER (no dependencies) ───────────────────
// Builds a valid .xlsx file using only Node built-ins + zlib
const zlib = require("zlib");

function escapeXml(val) {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function colLetter(n) {
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function buildXlsx(sheets) {
  // sheets: [{ name, rows: [[...], [...]] }]
  const files = {};

  // [Content_Types].xml
  const sheetContentTypes = sheets.map((_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");

  files["[Content_Types].xml"] = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetContentTypes}
</Types>`;

  // _rels/.rels
  files["_rels/.rels"] = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  // xl/_rels/workbook.xml.rels
  const wbRels = sheets.map((_, i) =>
    `<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`
  ).join("");
  files["xl/_rels/workbook.xml.rels"] = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${wbRels}
  <Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  // xl/workbook.xml
  const sheetEls = sheets.map((s, i) =>
    `<sheet name="${escapeXml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`
  ).join("");
  files["xl/workbook.xml"] = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetEls}</sheets>
</workbook>`;

  // xl/styles.xml — header style (s=1: bold, blue bg, white text) + normal (s=0)
  files["xl/styles.xml"] = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts>
    <font><sz val="11"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><name val="Arial"/><color rgb="FFFFFFFF"/></font>
  </fonts>
  <fills>
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1A56FF"/></patternFill></fill>
  </fills>
  <borders><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
</styleSheet>`;

  // xl/worksheets/sheetN.xml
  sheets.forEach((sheet, si) => {
    let sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetView workbookViewId="0"><selection activeCell="A1"/></sheetView>
  <sheetData>`;

    sheet.rows.forEach((row, ri) => {
      const rowNum = ri + 1;
      const isHeader = ri === 0;
      sheetXml += `<row r="${rowNum}">`;
      row.forEach((cell, ci) => {
        const col = colLetter(ci + 1);
        const ref = `${col}${rowNum}`;
        const style = isHeader ? ` s="1"` : "";
        if (cell === null || cell === undefined || cell === "") {
          sheetXml += `<c r="${ref}"${style}/>`;
        } else if (typeof cell === "number") {
          sheetXml += `<c r="${ref}"${style} t="n"><v>${cell}</v></c>`;
        } else {
          sheetXml += `<c r="${ref}"${style} t="inlineStr"><is><t>${escapeXml(String(cell))}</t></is></c>`;
        }
      });
      sheetXml += `</row>`;
    });

    sheetXml += `</sheetData><sheetProtection/></worksheet>`;
    files[`xl/worksheets/sheet${si+1}.xml`] = sheetXml;
  });

  // Build ZIP
  return buildZip(files);
}

function buildZip(files) {
  const entries = [];
  let offset = 0;
  const centralDir = [];

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf8");
    const dataBytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const compressed = zlib.deflateRawSync(dataBytes);
    const crc = crc32(dataBytes);
    const modTime = 0x0000;
    const modDate = 0x0000;

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(modTime, 10);
    local.writeUInt16LE(modDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(dataBytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);

    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(modTime, 12);
    cd.writeUInt16LE(modDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(dataBytes.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    nameBytes.copy(cd, 46);

    entries.push(local, compressed);
    centralDir.push(cd);
    offset += local.length + compressed.length;
  }

  const cdBuf = Buffer.concat(centralDir);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centralDir.length, 8);
  eocd.writeUInt16LE(centralDir.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...entries, cdBuf, eocd]);
}

function crc32(buf) {
  const table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ── MAIN HANDLER ─────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!req.body) {
      return res.status(400).json({ error: "Empty request body" });
    }
    const { files, merged } = req.body || {};
    const apiKey = ANTHROPIC_API_KEY;
    if (!files || !files.length) return res.status(400).json({ error: "No files provided" });

    // sheets keyed by vendor name
    const sheetMap = {};

    for (const { base64, fileName } of files) {
      let invoices;
      if (merged) {
        const arr = await callClaude(apiKey, base64, true);
        invoices = Array.isArray(arr) ? arr : [arr];
      } else {
        const single = await callClaude(apiKey, base64, false);
        invoices = [single];
      }

      invoices.forEach((inv, idx) => {
        const fName = invoices.length > 1 ? `${fileName} [${idx+1}/${invoices.length}]` : fileName;
        const row = buildRow(inv, fName);
        const vendor = (inv.vendor_name || "Unknown Vendor").trim().replace(/[\\/*?:[\]]/g, "").substring(0, 100) || "Unknown Vendor";
        if (!sheetMap[vendor]) sheetMap[vendor] = [HEADERS];
        sheetMap[vendor].push(row);
      });
    }

    const sheets = Object.entries(sheetMap).map(([name, rows]) => ({ name, rows }));
    const xlsxBuf = buildXlsx(sheets);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="invoices_${Date.now()}.xlsx"`);
    res.send(xlsxBuf);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = handler;
