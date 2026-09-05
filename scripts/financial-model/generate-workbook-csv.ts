/**
 * Regenerate the institutional copy-pasteable workbook artifact:
 *   scripts/financial-model/tvv-institutional-model.csv
 *
 * Usage:
 *   node --import tsx scripts/financial-model/generate-workbook-csv.ts [out.csv]
 *
 * The CSV is built by sdk/src/spreadsheet.ts (computeWorkbook / buildWorkbookCsv)
 * so the sheet can never drift from the pinned TVV economics. Re-run after any
 * economic model change.
 */
import { writeFileSync } from 'node:fs';
import { DEFAULT_INPUTS, buildWorkbookCsv } from '../../sdk/src/spreadsheet';

const outPath = process.argv[2] ?? 'scripts/financial-model/tvv-institutional-model.csv';
writeFileSync(outPath, buildWorkbookCsv(DEFAULT_INPUTS), 'utf8');
console.log(`wrote ${outPath}`);