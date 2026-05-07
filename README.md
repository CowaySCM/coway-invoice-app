# Coway SCM · PDF Invoice Extractor

A standalone web app — no Google account needed. Upload PDFs, get an Excel file.

## Deploy to Vercel (free, ~3 minutes)

### 1. Create a GitHub repo
1. Go to github.com → New repository → name it `coway-invoice-app`
2. Upload these files maintaining the folder structure:
   ```
   vercel.json
   api/extract.js
   public/index.html
   ```

### 2. Deploy on Vercel
1. Go to vercel.com → Sign up free → "Add New Project"
2. Import your GitHub repo
3. Click **Deploy** — no settings needed
4. Vercel gives you a URL like `https://coway-invoice-app.vercel.app`

### 3. Share with your team
Send them the Vercel URL. That's it — no installation required.

### 4. API Key
Each user enters their Anthropic API key once in the app — it's saved to their browser.
Alternatively, you can hardcode the key in `api/extract.js` line 1 so users don't need to enter it:
```js
// At the top of api/extract.js, add:
const TEAM_API_KEY = "sk-ant-your-key-here";
// Then in the handler, replace: const { files, merged, apiKey } = req.body;
// With: const { files, merged } = req.body; const apiKey = TEAM_API_KEY;
```

## Cost Center Sheet
To enable cost center lookup by zip/city, edit the `COST_CENTER_DATA` array in `api/extract.js`:
```js
const COST_CENTER_DATA = [
  { zip: "90001", city: "LOS ANGELES", state: "CA", costCenter: "C101" },
  { zip: "10001", city: "NEW YORK",    state: "NY", costCenter: "C102" },
  // ... add all rows from your Cost Center Google Sheet
];
```

## Columns (A–N)
| Col | Field         |
|-----|---------------|
| A   | File Name     |
| B   | GL Account    |
| C   | Invoice Date  |
| D   | Cost Center   |
| E   | Vendor Name   |
| F   | Total Amount  |
| G   | Invoice Number|
| H   | Participants  |
| I   | Remark        |
| J   | Tax           |
| K   | MBL No        |
| L   | HBL No        |
| M   | Ship From     |
| N   | Ship To       |
