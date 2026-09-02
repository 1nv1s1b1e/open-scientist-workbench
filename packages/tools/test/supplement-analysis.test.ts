import { describe, expect, it } from 'vite-plus/test'
import {
  EisSpectroscopyMetricsV2Schema,
  IrisReplicationV1Schema,
  NustarGeometryV2Schema,
} from '@open-scientist/schema'
import {
  loadSupplementAnalysisDiagnostics,
  supplementProductQuantitativeResults,
} from '../src/coronal-data.ts'
import { getDatasetDir } from '@open-scientist/config'

function eisFixture(): unknown {
  return {
    schemaVersion: 2,
    analysisVersion: 'eis-spectroscopy-v2:eispac-0.99.4',
    generatedAt: '2026-08-29T02:30:00Z',
    caseId: 'ar11899-joint-spectroscopy-20131119',
    instrument: 'Hinode/EIS',
    productLevel: 'level-1-derived',
    inputAssets: [{ assetId: 'eis-ar11899-level1-data', sha256: 'a'.repeat(64) }],
    densityCalibration: {
      productId: 'eis-si10-density-curve-v1',
      chiantiVersion: '11.0.2',
      calibrationVersion: 'chianti-11.0.2-si10-level-population',
      checksum: 'b'.repeat(64),
      primaryLogTemperature: '6.10',
      publishedAnchorDeviationDex: 0.111,
    },
    roiRegistration: { kind: 'literature-defined positive-control ROI' },
    lines: {
      si_x_258: {
        wavelengthAngstrom: 258.375,
        template: 'si_10_258_375.1c.template.h5',
        ccdBand: 'lw',
        fitSuccessCount: 51,
        fitPixelCount: 51,
        intensityErgPerSecondSteradianCm2: {
          estimate: 303.6,
          lowerBound: 291.1,
          upperBound: 318.3,
          sampleCount: 51,
        },
        relativeDopplerVelocityKmPerSecond: {
          estimate: 0,
          lowerBound: -0.51,
          upperBound: 0.62,
          sampleCount: 51,
        },
        observedGaussianWidthAngstrom: {
          estimate: 0.0337,
          lowerBound: 0.0328,
          upperBound: 0.034,
          sampleCount: 51,
        },
        instrumentalFwhmAngstrom: { estimate: 0.0548, lowerBound: 0.0547, upperBound: 0.0549 },
        logFormationTemperatureK: 6.15,
        nonthermalVelocityKmPerSecond: {
          estimate: 19.85,
          lowerBound: 17.8,
          upperBound: 20.59,
          sampleCount: 51,
        },
        nonthermalValidPixelFraction: 1,
        nonthermalDefinition: 'width minus instrumental and thermal contributions',
      },
    },
    siX258To261IntensityRatio: {
      estimate: 2.34,
      lowerBound: 2.278,
      upperBound: 2.428,
      sampleCount: 51,
    },
    electronDensityCm3: {
      log10Estimate: 8.81,
      log10LowerBound: 8.767,
      log10UpperBound: 8.871,
      estimate: 645316167.7,
      lowerBound: 584857371.4,
      upperBound: 742843602.3,
      sampleCount: 3,
      unconstrainedCount: 0,
      method: 'monotone inversion of the registered CHIANTI curve',
    },
    mechanismEvidencePermitted: false,
    evidenceRole: 'positive_control_descriptive_spectroscopy',
    boundaries: ['EIS has no absolute wavelength reference here.'],
  }
}

describe('supplement analysis product contracts', () => {
  it('parses the registered EIS v2 metrics', () => {
    const parsed = EisSpectroscopyMetricsV2Schema.safeParse(eisFixture())
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.mechanismEvidencePermitted).toBe(false)
      expect(Object.keys(parsed.data.lines)).toContain('si_x_258')
    }
  })

  it('maps EIS products onto interval-carrying quantitative results', () => {
    const results = supplementProductQuantitativeResults('eis-versioned-line-fitting-v2', eisFixture())
    const metrics = results.map((result) => result.metric)
    expect(metrics).toContain('eis_six_258_261_intensity_ratio')
    expect(metrics).toContain('eis_six_log10_electron_density')
    expect(metrics).toContain('eis_si_x_258_nonthermal_velocity')
    for (const result of results) {
      expect(result.lowerBound).toBeLessThanOrEqual(result.estimate)
      expect(result.estimate).toBeLessThanOrEqual(result.upperBound)
    }
  })

  it('maps only non-detection NuSTAR bands onto honest upper-limit intervals', () => {
    const payload = {
      schemaVersion: 2,
      analysisVersion: 'nustar-hxr-solar-geometry-v2',
      generatedAt: '2026-08-29T02:46:00Z',
      instrument: 'NuSTAR',
      moduleObservationCount: 2,
      analyzedMode: '06',
      registeredModesNotAnalyzed: ['02', '03'],
      piBands: { soft_2_6_keV: [50, 150] },
      frozenGeometry: { solarRadiusArcsec: 959.63 },
      observations: [
        {
          obsid: '80414201001',
          caseId: 'ar12222-nustar-postflare-20141211',
          module: 'A',
          mode: '06',
          dateObs: '2014-12-11T18:21:07',
          dateEnd: '2014-12-11T19:06:07',
          gtiExposureSeconds: 1000,
          effectiveLivetimeExposureSeconds: 50,
          housekeepingSampleCount: 1000,
          medianLivetimeFraction: 0.05,
          pointingAudit: {
            usable: true,
            medianSunOffAxisDeg: 0.28,
            medianEarthLimbElevationDeg: 45,
            saaRowFraction: 0,
            unoccultedRowFraction: 1,
            ghostRayRisk: true,
          },
          grade0EventCount: 5000,
          flaggedEventCount: 10,
          countBands: {
            soft_2_6_keV: { piRange: [50, 150], counts: 4542, countRatePerSecond: 264.4 },
          },
          geometry: {
            usable: true,
            centerXArcsec: 839.6,
            centerYArcsec: -407.6,
            discContrast: 4.5,
            estimatedLimbRadiusArcsec: 980,
            radiusConsistentWithSolarRadius: true,
            bands: {
              soft_2_6_keV: {
                sourceCounts: 3838,
                offLimbBackgroundCounts: 260,
                scaledBackgroundCounts: 454,
                excessCounts: 3384,
                significanceSigma: 8,
                detection: true,
              },
            },
            regionAreas: { onDiscArcsec2: 283408, offLimbArcsec2: 162288 },
            onDiscEventCount: 4000,
            offLimbEventCount: 300,
          },
        },
        {
          obsid: '80414202001',
          caseId: 'ar12721-nustar-quiet-20180927',
          module: 'B',
          mode: '06',
          dateObs: '2018-09-27T00:00:00',
          dateEnd: '2018-09-27T01:00:00',
          gtiExposureSeconds: 1000,
          effectiveLivetimeExposureSeconds: 50,
          housekeepingSampleCount: 1000,
          medianLivetimeFraction: 0.05,
          pointingAudit: {
            usable: true,
            medianSunOffAxisDeg: 0.3,
            medianEarthLimbElevationDeg: 40,
            saaRowFraction: 0,
            unoccultedRowFraction: 1,
            ghostRayRisk: false,
          },
          grade0EventCount: 3,
          flaggedEventCount: 0,
          countBands: {
            soft_2_6_keV: { piRange: [50, 150], counts: 1, countRatePerSecond: 0.116 },
          },
          geometry: {
            usable: true,
            centerXArcsec: 100,
            centerYArcsec: 200,
            discContrast: 1,
            estimatedLimbRadiusArcsec: 970,
            radiusConsistentWithSolarRadius: true,
            bands: {
              soft_2_6_keV: {
                sourceCounts: 1,
                offLimbBackgroundCounts: 0,
                scaledBackgroundCounts: 0,
                excessCounts: 1,
                significanceSigma: 0,
                detection: false,
                countRateUpperLimitPerSecond: 0.384623,
              },
            },
            regionAreas: { onDiscArcsec2: 283408, offLimbArcsec2: 162288 },
            onDiscEventCount: 2,
            offLimbEventCount: 1,
          },
        },
      ],
      crossModuleConsistency: [
        {
          obsid: '80414201001',
          grade0EventCountRatioAtoB: 1.05,
          effectiveExposureRatioAtoB: 1.12,
          softBandCountRatioAtoB: 2.86,
          consistencyPass: true,
        },
      ],
      inputAssetIds: ['nustar-80414201001-a-housekeeping'],
      mechanismEvidencePermitted: false,
      evidenceRole: 'hxr_count_rate_chain',
      physicalFluxAvailable: false,
      countRateProductsAvailable: true,
      boundaries: ['livetime-corrected count rates are not physical fluxes.'],
    }
    const results = supplementProductQuantitativeResults(
      'nustar-hxr-solar-geometry-v2',
      payload,
    )
    expect(results).toHaveLength(1)
    expect(results[0]?.metric).toBe('nustar_80414202001_B_soft_2_6_keV_count_rate_upper_limit')
    expect(results[0]?.upperBound).toBeCloseTo(0.384623)
  })

  it('loads and hash-verifies the real registered products from the dataset', async () => {
    // The targeted-discriminants supplement only exists in the full pack.
    process.env.CORONAL_DATASET_ID = 'coronal-evidence-70gb-v1'
    const diagnostics = await loadSupplementAnalysisDiagnostics(getDatasetDir())
    expect(diagnostics.status).toBe('ready')
    const kinds = diagnostics.products.map((product) => product.kind)
    expect(kinds).toContain('eis-versioned-line-fitting-v2')
    expect(kinds).toContain('nustar-hxr-solar-geometry-v2')
    expect(kinds).toContain('iris-method-replication-v1')
    for (const product of diagnostics.products) {
      expect(product.mechanismEvidencePermitted).toBe(false)
      if (product.fileSha256Matches) {
        for (const result of product.quantitativeResults) {
          expect(result.lowerBound).toBeLessThanOrEqual(result.estimate)
          expect(result.estimate).toBeLessThanOrEqual(result.upperBound)
        }
      }
    }
    const eis = diagnostics.products.find((product) =>
      product.kind.startsWith('eis-versioned-line-fitting-v2'),
    )
    expect(eis?.quantitativeResults.map((r) => r.metric), 'eis metrics').toContain('eis_six_log10_electron_density')
    expect(diagnostics.mechanismEvidencePermitted).toBe(false)
  })
})
