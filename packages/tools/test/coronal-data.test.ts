import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { assessCoronalDataCoverage, verifyCoronalDataPack } from '../src/coronal-data.ts'

const temporaryRoots: string[] = []

async function makePack(includeValidMetadata: boolean): Promise<string> {
  const datasetDir = await mkdtemp(join(tmpdir(), 'open-scientist-coronal-'))
  temporaryRoots.push(datasetDir)
  const packRoot = join(datasetDir, 'test-hmi-pack')
  await mkdir(join(packRoot, 'raw'), { recursive: true })
  await writeFile(join(packRoot, 'raw', 'hmi.fits'), 'abc')
  const manifest: Record<string, unknown> = {
    format: 'open-scientist-coronal-observation-pack-v1',
    datasetId: 'test-hmi-pack',
    plannedTotalBytes: 3,
    uniqueAssetCount: 1,
    logicalObservationCount: 1,
    scientificBoundary: { statement: 'test boundary', knownGaps: [] },
    cases: [
      {
        caseId: 'test-case',
        label: 'test case',
        activeRegion: 'NOAA 1',
        startTai: '2010.01.01_00:00_TAI',
        duration: '12m',
        purpose: 'metadata verification',
        observations: [
          {
            logicalId: 'logical-1',
            assetId: 'asset-1',
            streamId: 'hmi-los',
            instrument: 'SDO/HMI',
            kind: 'fits',
            wavelengthOrBand: 'line-of-sight magnetogram',
            cadenceSeconds: 720,
            observedAt: '2010-01-01T00:00:00Z',
            quality: 'verified',
          },
        ],
      },
    ],
    assets: [
      {
        assetId: 'asset-1',
        kind: 'fits',
        instrument: 'SDO/HMI',
        segment: 'magnetogram',
        wavelengthOrBand: 'line-of-sight magnetogram',
        observedAt: '2010-01-01T00:00:00Z',
        sourceUrl: 'https://example.test/hmi.fits',
        sourcePath: '/SUM/test/hmi.fits',
        queries: ['hmi.M_720s[2010.01.01_00:00_TAI/12m@720s]'],
        quality: 'verified',
        caseIds: ['test-case'],
        logicalIds: ['logical-1'],
        relativePath: 'raw/hmi.fits',
        bytes: 3,
        sha256: createHash('sha256').update('abc').digest('hex'),
        downloadStatus: 'verified',
      },
    ],
  }
  if (includeValidMetadata) {
    await mkdir(join(packRoot, 'metadata'), { recursive: true })
    const metadata = `${JSON.stringify({
      format: 'open-scientist-jsoc-hmi-record-metadata-v1',
      datasetId: 'test-hmi-pack',
      assets: { 'asset-1': { keywords: { BUNIT: 'Gauss' } } },
      missingAssetIds: [],
      queryFailures: [],
    })}\n`
    await writeFile(join(packRoot, 'metadata', 'hmi-records-v1.json'), metadata)
    manifest.metadataSupplements = [
      {
        kind: 'jsoc-hmi-record-metadata',
        format: 'open-scientist-jsoc-hmi-record-metadata-v1',
        relativePath: 'metadata/hmi-records-v1.json',
        sha256: createHash('sha256').update(metadata).digest('hex'),
        assetCount: 1,
        requestedAssetCount: 1,
        complete: true,
        generatedAt: '2010-01-01T00:00:00Z',
      },
    ]
  }
  await writeFile(join(packRoot, 'manifest.json'), `${JSON.stringify(manifest)}\n`)
  return datasetDir
}

afterEach(async () => {
  delete process.env.CORONAL_DATASET_ID
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })))
})

describe('verifyCoronalDataPack HMI metadata', () => {
  it('rejects M_720s assets without the required metadata sidecar', async () => {
    process.env.CORONAL_DATASET_ID = 'test-hmi-pack'
    const verification = await verifyCoronalDataPack(await makePack(false))
    expect(verification.status).toBe('incomplete')
    expect(verification.invalidMetadataSupplements).toEqual(['jsoc-hmi-record-metadata'])
  })

  it('accepts a checksummed and semantically complete HMI sidecar', async () => {
    process.env.CORONAL_DATASET_ID = 'test-hmi-pack'
    const verification = await verifyCoronalDataPack(await makePack(true))
    expect(verification.status).toBe('ready')
    expect(verification.verifiedMetadataSupplementCount).toBe(1)
    expect(verification.invalidMetadataSupplements).toEqual([])
  })

  it('verifies every registered SHARP vector supplement asset', async () => {
    process.env.CORONAL_DATASET_ID = 'test-hmi-pack'
    const datasetDir = await makePack(true)
    const packRoot = join(datasetDir, 'test-hmi-pack')
    const supplementDir = join(packRoot, 'supplements', 'hmi-sharp-vector-v1')
    await mkdir(join(supplementDir, 'raw'), { recursive: true })
    await writeFile(join(supplementDir, 'raw', 'Br.fits'), 'xyz')
    const supplement = `${JSON.stringify({
      format: 'open-scientist-hmi-sharp-vector-pack-v1',
      complete: true,
      assetCount: 1,
      plannedTotalBytes: 3,
      assets: [
        {
          relativePath: 'supplements/hmi-sharp-vector-v1/raw/Br.fits',
          bytes: 3,
          sha256: createHash('sha256').update('xyz').digest('hex'),
          downloadStatus: 'verified',
        },
      ],
    })}\n`
    await writeFile(join(supplementDir, 'manifest.json'), supplement)
    const rootManifestPath = join(packRoot, 'manifest.json')
    const manifest = JSON.parse(await readFile(rootManifestPath, 'utf8')) as Record<string, unknown>
    manifest.dataSupplements = [
      {
        kind: 'hmi-sharp-vector',
        format: 'open-scientist-hmi-sharp-vector-pack-v1',
        relativePath: 'supplements/hmi-sharp-vector-v1/manifest.json',
        sha256: createHash('sha256').update(supplement).digest('hex'),
        assetCount: 1,
        requestedAssetCount: 1,
        bytes: 3,
        complete: true,
        generatedAt: '2010-01-01T00:00:00Z',
      },
    ]
    manifest.supplementalBytes = 3
    manifest.totalBytesIncludingSupplements = 6
    await writeFile(rootManifestPath, `${JSON.stringify(manifest)}\n`)

    const verification = await verifyCoronalDataPack(datasetDir)
    expect(verification.status).toBe('ready')
    expect(verification.verifiedDataSupplementCount).toBe(1)
    expect(verification.verifiedDataSupplementAssetCount).toBe(1)
    expect(verification.verifiedDataSupplementBytes).toBe(3)
    expect(verification.invalidDataSupplements).toEqual([])
  })

  it('keeps verified primary capabilities available when an unrelated optional supplement fails', async () => {
    process.env.CORONAL_DATASET_ID = 'test-hmi-pack'
    const datasetDir = await makePack(true)
    const rootManifestPath = join(datasetDir, 'test-hmi-pack', 'manifest.json')
    const manifest = JSON.parse(await readFile(rootManifestPath, 'utf8')) as Record<string, unknown>
    manifest.dataSupplements = [
      {
        kind: 'targeted-discriminants-hxr-spectroscopy-v1',
        format: 'open-scientist-targeted-discriminants-pack-v1',
        relativePath: 'supplements/missing-optional/manifest.json',
        sha256: '0'.repeat(64),
        assetCount: 1,
        requestedAssetCount: 1,
        bytes: 1,
        complete: true,
        generatedAt: '2010-01-01T00:00:00Z',
      },
    ]
    manifest.supplementalBytes = 1
    manifest.totalBytesIncludingSupplements = 4
    await writeFile(rootManifestPath, `${JSON.stringify(manifest)}\n`)

    const verification = await verifyCoronalDataPack(datasetDir)
    const coverage = await assessCoronalDataCoverage({
      caseId: 'test-case',
      requirements: ['magnetic-context'],
      datasetDir,
    })

    expect(verification.status).toBe('incomplete')
    expect(verification.primaryPackReady).toBe(true)
    expect(verification.invalidDataSupplements).toEqual([
      'targeted-discriminants-hxr-spectroscopy-v1',
    ])
    expect(coverage.status).toBe('incomplete')
    expect(coverage.satisfied).toEqual(['magnetic-context'])
    expect(coverage.unavailable).toEqual([])
    expect(coverage.limitations.join(' ')).toContain('仅禁用受影响的补充诊断')
  })

  it('exposes spectroscopy only for its checksummed, frozen holdout case', async () => {
    process.env.CORONAL_DATASET_ID = 'test-hmi-pack'
    const datasetDir = await makePack(true)
    const packRoot = join(datasetDir, 'test-hmi-pack')
    const supplementDir = join(packRoot, 'supplements', 'joint-spectroscopy-v1')
    await mkdir(join(supplementDir, 'raw'), { recursive: true })
    await writeFile(join(supplementDir, 'raw', 'iris.fits'), 'iris')
    const supplement = `${JSON.stringify({
      format: 'open-scientist-joint-spectroscopy-pack-v1',
      complete: true,
      caseId: 'test-case',
      analysisSplit: 'holdout',
      assetCount: 1,
      plannedTotalBytes: 4,
      assets: [
        {
          instrument: 'IRIS',
          productLevel: 'level2',
          relativePath: 'supplements/joint-spectroscopy-v1/raw/iris.fits',
          bytes: 4,
          sha256: createHash('sha256').update('iris').digest('hex'),
          downloadStatus: 'verified',
        },
      ],
    })}\n`
    await writeFile(join(supplementDir, 'manifest.json'), supplement)
    const rootManifestPath = join(packRoot, 'manifest.json')
    const manifest = JSON.parse(await readFile(rootManifestPath, 'utf8')) as Record<string, unknown>
    manifest.dataSupplements = [
      {
        kind: 'joint-spectroscopy-iris-eis-v1',
        format: 'open-scientist-joint-spectroscopy-pack-v1',
        relativePath: 'supplements/joint-spectroscopy-v1/manifest.json',
        sha256: createHash('sha256').update(supplement).digest('hex'),
        assetCount: 1,
        requestedAssetCount: 1,
        bytes: 4,
        complete: true,
        generatedAt: '2010-01-01T00:00:00Z',
      },
    ]
    manifest.supplementalBytes = 4
    manifest.totalBytesIncludingSupplements = 7
    await writeFile(rootManifestPath, `${JSON.stringify(manifest)}\n`)

    const coverage = await assessCoronalDataCoverage({
      caseId: 'test-case',
      requirements: ['spectroscopy'],
      datasetDir,
    })
    expect(coverage.status).toBe('ready')
    expect(coverage.satisfied).toEqual(['spectroscopy'])
    expect(coverage.unavailable).toEqual([])
  })
})
