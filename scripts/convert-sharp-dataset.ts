#!/usr/bin/env tsx
/**
 * Convert the UAH SHARP solar flare dataset into a JSONL snapshot file
 * suitable for the Explore agent's filter function evaluation.
 *
 * Source: https://louis.uah.edu/open-data/1/
 * Newman et al. (2025), "Solar Flare Forecasting using ML and SDO/HMI Data"
 *
 * Label scheme:
 *   - xray_class N → label 0 (no flare / quiescent)
 *   - xray_class B/C/M/X → label 1 (flare event = coronal heating)
 *
 * We use the 24hrs timepoint files (parameters measured 24 hours before
 * flare onset), which is the most challenging forecasting window.
 *
 * Output: data/dataset/snapshots.jsonl (one JSON object per line)
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const SHARP_DIR = resolve(process.cwd(), 'data', 'dataset', 'sharp-flare-data', 'APJS25_data')
const OUTPUT_PATH = resolve(process.cwd(), 'data', 'dataset', 'snapshots.jsonl')

interface Snapshot {
  snapshot_id: number
  active_region: number
  timestamp: string
  flare_class: string
  magnitude: number
  label: number
  // SHARP magnetic field parameters
  usflux: number // Total unsigned flux (Maxwell)
  mean_gamma: number // Mean inclination angle (degrees)
  mean_gbt: number // Mean horizontal gradient of Bt
  mean_gbz: number // Mean horizontal gradient of Bz
  mean_gbh: number // Mean horizontal gradient of Bh
  mean_jzd: number // Mean vertical current density (mA/m²)
  totusjz: number // Total unsigned vertical current (A)
  mean_jzh: number // Mean horizontal current (A/m²)
  totusjh: number // Total unsigned horizontal current (A)
  absnjzh: number // Absolute value of net vertical current (A/m²)
  savncpp: number // Sum of absolute values of net currents per polarity (A)
  mean_pot: number // Mean photospheric free energy (ergs/cm³)
  totpot: number // Total photospheric free energy (ergs)
  mean_shr: number // Mean shear angle (degrees)
  shrgt45: number // Fraction of area with shear > 45°
  r_value: number // Sum of flux within R (Maxwell)
  area_acr: number // Area of active region (micro-hemispheres)
}

function parseCSVLine(line: string): Record<string, string> {
  // Simple CSV parser — handles the SHARP dataset's plain comma-separated format
  const headers = [
    'time_start',
    'time_peak',
    'time_end',
    'nar',
    'xray_class',
    'magnitude',
    'previous_flare',
    '2nd_previous_flare',
    '3rd_previous_flare',
    'solar_phase',
    'T_REC',
    'NOAA_AR',
    'USFLUX',
    'MEANGAM',
    'MEANGBT',
    'MEANGBZ',
    'MEANGBH',
    'MEANJZD',
    'TOTUSJZ',
    'MEANJZH',
    'TOTUSJH',
    'ABSNJZH',
    'SAVNCPP',
    'MEANPOT',
    'TOTPOT',
    'MEANSHR',
    'SHRGT45',
    'R_VALUE',
    'AREA_ACR',
    'QUALITY',
    'g_s',
    'slf',
    'd_l_f',
    'LONMIN',
    'LONMAX',
    'LATMIN',
    'LATMAX',
    'NOAA_ARS',
  ]
  const values = line.split(',')
  const obj: Record<string, string> = {}
  for (let i = 0; i < headers.length && i < values.length; i++) {
    obj[headers[i]] = values[i]
  }
  return obj
}

function toNum(v: string | undefined): number {
  if (!v || v === '') return 0
  const n = Number.parseFloat(v)
  return Number.isNaN(n) ? 0 : n
}

async function processFile(filePath: string, flareClass: string): Promise<Snapshot[]> {
  const content = await readFile(filePath, 'utf-8')
  const lines = content.trim().split('\n').slice(1) // skip header
  const snapshots: Snapshot[] = []

  for (const line of lines) {
    if (!line.trim()) continue
    const row = parseCSVLine(line)

    const xrayClass = row.xray_class || flareClass
    const label = xrayClass === 'N' ? 0 : 1

    snapshots.push({
      snapshot_id: 0, // will be assigned globally
      active_region: toNum(row.NOAA_AR),
      timestamp: row.T_REC || row.time_start || '',
      flare_class: xrayClass,
      magnitude: toNum(row.magnitude),
      label,
      usflux: toNum(row.USFLUX),
      mean_gamma: toNum(row.MEANGAM),
      mean_gbt: toNum(row.MEANGBT),
      mean_gbz: toNum(row.MEANGBZ),
      mean_gbh: toNum(row.MEANGBH),
      mean_jzd: toNum(row.MEANJZD),
      totusjz: toNum(row.TOTUSJZ),
      mean_jzh: toNum(row.MEANJZH),
      totusjh: toNum(row.TOTUSJH),
      absnjzh: toNum(row.ABSNJZH),
      savncpp: toNum(row.SAVNCPP),
      mean_pot: toNum(row.MEANPOT),
      totpot: toNum(row.TOTPOT),
      mean_shr: toNum(row.MEANSHR),
      shrgt45: toNum(row.SHRGT45),
      r_value: toNum(row.R_VALUE),
      area_acr: toNum(row.AREA_ACR),
    })
  }

  return snapshots
}

async function main() {
  console.log('Converting SHARP flare dataset → snapshots.jsonl')

  // Use ALL timepoint files (0-24 hrs before flare) for maximum data
  const { readdirSync } = await import('node:fs')
  const allFiles = readdirSync(SHARP_DIR).filter((f) => f.endsWith('.csv'))
  const files = allFiles.map((f) => ({
    class: f.charAt(0), // N, B, C, M, X
    file: f,
  }))

  let allSnapshots: Snapshot[] = []
  for (const { class: cls, file } of files) {
    const path = join(SHARP_DIR, file)
    const snaps = await processFile(path, cls)
    console.log(
      `  ${cls}_24hrs: ${snaps.length} rows (${snaps.filter((s) => s.label === 1).length} flare, ${snaps.filter((s) => s.label === 0).length} quiet)`,
    )
    allSnapshots = allSnapshots.concat(snaps)
  }

  // Assign sequential IDs
  allSnapshots = allSnapshots.map((s, i) => ({ ...s, snapshot_id: i }))

  // Shuffle for balanced ordering
  for (let i = allSnapshots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[allSnapshots[i], allSnapshots[j]] = [allSnapshots[j], allSnapshots[i]]
  }

  // Write JSONL
  await mkdir(resolve(OUTPUT_PATH, '..'), { recursive: true })
  let lines = ''
  for (const snap of allSnapshots) {
    lines += `${JSON.stringify(snap)}\n`
  }
  await writeFile(OUTPUT_PATH, lines)

  const positive = allSnapshots.filter((s) => s.label === 1).length
  console.log(`\nDone: ${allSnapshots.length} snapshots → ${OUTPUT_PATH}`)
  console.log(
    `Positive (flare): ${positive} (${((positive / allSnapshots.length) * 100).toFixed(1)}%)`,
  )
  console.log(
    `Negative (quiet): ${allSnapshots.length - positive} (${(((allSnapshots.length - positive) / allSnapshots.length) * 100).toFixed(1)}%)`,
  )
  console.log(`\nFlare class breakdown:`)
  for (const cls of ['N', 'B', 'C', 'M', 'X']) {
    const count = allSnapshots.filter((s) => s.flare_class === cls).length
    console.log(`  ${cls}: ${count}`)
  }
}

main().catch(console.error)
