import { z } from 'zod'

/**
 * Contracts for the registered supplement analysis products under
 * `supplements/targeted-discriminants-v1/manifest.json → analysisProducts`.
 *
 * These products are produced by the frozen Python chains
 * (`analyze_eis_level1.py`, `analyze_nustar_hxr.py`,
 * `analyze_joint_spectroscopy.py`) and carry explicit
 * `mechanismEvidencePermitted: false` boundaries: they are positive-control /
 * descriptive diagnostics, never mechanism evidence by themselves. The TS
 * side may only *read* them for traceability and evidence-layer visibility;
 * converting them into gate-ready support would violate the registered
 * scientific boundary.
 */

/** Finite estimate/bound interval shared by every supplement product. */
export const SupplementIntervalSchema = z.object({
  estimate: z.number().finite(),
  lowerBound: z.number().finite(),
  upperBound: z.number().finite(),
  sampleCount: z.number().int().positive().optional(),
})
export type SupplementInterval = z.infer<typeof SupplementIntervalSchema>

/** Registered CHIANTI Si X density curve the EIS inversion must be tied to. */
export const EisDensityCalibrationSchema = z.object({
  productId: z.string().min(1),
  chiantiVersion: z.string().min(1),
  calibrationVersion: z.string().min(1),
  checksum: z.string().length(64),
  primaryLogTemperature: z.string().min(1),
  publishedAnchorDeviationDex: z.number().finite(),
})
export type EisDensityCalibration = z.infer<typeof EisDensityCalibrationSchema>

export const EisLineFitSchema = z.object({
  wavelengthAngstrom: z.number().finite(),
  template: z.string().min(1),
  ccdBand: z.string().min(1),
  fitSuccessCount: z.number().int().nonnegative(),
  fitPixelCount: z.number().int().nonnegative(),
  intensityErgPerSecondSteradianCm2: SupplementIntervalSchema,
  relativeDopplerVelocityKmPerSecond: SupplementIntervalSchema,
  observedGaussianWidthAngstrom: SupplementIntervalSchema,
  /** Scalar frozen instrumental FWHM for most lines; interval kept for safety. */
  instrumentalFwhmAngstrom: z.union([SupplementIntervalSchema, z.number().finite()]),
  logFormationTemperatureK: z.number().finite(),
  nonthermalVelocityKmPerSecond: SupplementIntervalSchema.optional(),
  nonthermalValidPixelFraction: z.number().finite().optional(),
  nonthermalDefinition: z.string().min(1).optional(),
})
export type EisLineFit = z.infer<typeof EisLineFitSchema>

export const EisElectronDensitySchema = z.object({
  log10Estimate: z.number().finite(),
  log10LowerBound: z.number().finite(),
  log10UpperBound: z.number().finite(),
  estimate: z.number().finite(),
  lowerBound: z.number().finite(),
  upperBound: z.number().finite(),
  sampleCount: z.number().int().nonnegative(),
  unconstrainedCount: z.number().int().nonnegative(),
  method: z.string().min(1),
})
export type EisElectronDensity = z.infer<typeof EisElectronDensitySchema>

export const EisSpectroscopyMetricsV2Schema = z.object({
  schemaVersion: z.number().int(),
  analysisVersion: z.string().startsWith('eis-spectroscopy-v2'),
  generatedAt: z.string().min(1),
  caseId: z.string().min(1),
  instrument: z.string().min(1),
  productLevel: z.string().min(1),
  inputAssets: z
    .array(
      z.object({
        assetId: z.string().min(1),
        sha256: z.string().length(64),
      }),
    )
    .default([]),
  densityCalibration: EisDensityCalibrationSchema,
  roiRegistration: z.record(z.string(), z.unknown()),
  lines: z.record(z.string().min(1), EisLineFitSchema),
  siX258To261IntensityRatio: SupplementIntervalSchema,
  electronDensityCm3: EisElectronDensitySchema,
  mechanismEvidencePermitted: z.literal(false),
  evidenceRole: z.string().min(1),
  boundaries: z.array(z.string().min(1)),
})
export type EisSpectroscopyMetricsV2 = z.infer<typeof EisSpectroscopyMetricsV2Schema>

export const NustarCountBandSchema = z.object({
  piRange: z.tuple([z.number(), z.number()]),
  counts: z.number().int().nonnegative(),
  countRatePerSecond: z.number().finite(),
})
export type NustarCountBand = z.infer<typeof NustarCountBandSchema>

export const NustarGeometryBandSchema = z.object({
  sourceCounts: z.number().nonnegative(),
  offLimbBackgroundCounts: z.number().nonnegative(),
  scaledBackgroundCounts: z.number().nonnegative(),
  excessCounts: z.number().finite(),
  significanceSigma: z.number().finite(),
  detection: z.boolean(),
  /** Exact-Poisson 3σ rate limit; present (non-null) exactly on non-detections. */
  countRateUpperLimitPerSecond: z.number().finite().nullable().optional(),
})
export type NustarGeometryBand = z.infer<typeof NustarGeometryBandSchema>

export const NustarPointingAuditSchema = z.object({
  usable: z.boolean(),
  medianSunOffAxisDeg: z.number().finite(),
  medianEarthLimbElevationDeg: z.number().finite(),
  saaRowFraction: z.number().finite(),
  unoccultedRowFraction: z.number().finite(),
  ghostRayRisk: z.boolean(),
})
export type NustarPointingAudit = z.infer<typeof NustarPointingAuditSchema>

export const NustarObservationSchema = z.object({
  obsid: z.string().min(1),
  caseId: z.string().min(1),
  module: z.enum(['A', 'B']),
  mode: z.string().min(1),
  dateObs: z.string().min(1),
  dateEnd: z.string().min(1),
  gtiExposureSeconds: z.number().finite(),
  effectiveLivetimeExposureSeconds: z.number().finite(),
  housekeepingSampleCount: z.number().int().nonnegative(),
  medianLivetimeFraction: z.number().finite(),
  pointingAudit: NustarPointingAuditSchema,
  grade0EventCount: z.number().int().nonnegative(),
  flaggedEventCount: z.number().int().nonnegative(),
  countBands: z.record(z.string().min(1), NustarCountBandSchema),
  geometry: z.object({
    usable: z.boolean(),
    /** Limb-fit failure reason; present on unusable geometries. */
    reason: z.string().optional(),
    centerXArcsec: z.number().finite().optional(),
    centerYArcsec: z.number().finite().optional(),
    discContrast: z.number().finite().optional(),
    estimatedLimbRadiusArcsec: z.number().finite().optional(),
    radiusConsistentWithSolarRadius: z.boolean().optional(),
    /** Frozen-band source/background split; present only when usable. */
    bands: z.record(z.string().min(1), NustarGeometryBandSchema).optional(),
    regionAreas: z.record(z.string(), z.unknown()).optional(),
    onDiscEventCount: z.number().int().nonnegative().optional(),
    offLimbEventCount: z.number().int().nonnegative().optional(),
  }),
})
export type NustarObservation = z.infer<typeof NustarObservationSchema>

export const NustarCrossModuleConsistencySchema = z.object({
  obsid: z.string().min(1),
  grade0EventCountRatioAtoB: z.number().finite(),
  effectiveExposureRatioAtoB: z.number().finite(),
  softBandCountRatioAtoB: z.number().finite(),
  consistencyPass: z.boolean(),
})
export type NustarCrossModuleConsistency = z.infer<typeof NustarCrossModuleConsistencySchema>

export const NustarGeometryV2Schema = z.object({
  schemaVersion: z.number().int(),
  analysisVersion: z.string().startsWith('nustar-hxr-solar-geometry-v2'),
  generatedAt: z.string().min(1),
  instrument: z.string().min(1),
  moduleObservationCount: z.number().int().nonnegative(),
  analyzedMode: z.string().min(1),
  registeredModesNotAnalyzed: z.array(z.string().min(1)),
  piBands: z.record(z.string().min(1), z.tuple([z.number(), z.number()])),
  frozenGeometry: z.record(z.string(), z.unknown()),
  observations: z.array(NustarObservationSchema).min(1),
  crossModuleConsistency: z.array(NustarCrossModuleConsistencySchema),
  inputAssetIds: z.array(z.string().min(1)),
  mechanismEvidencePermitted: z.literal(false),
  evidenceRole: z.string().min(1),
  physicalFluxAvailable: z.literal(false),
  countRateProductsAvailable: z.boolean(),
  boundaries: z.array(z.string().min(1)),
})
export type NustarGeometryV2 = z.infer<typeof NustarGeometryV2Schema>

export const IrisPublishedControlSchema = z.object({
  reference: z.string().min(1),
  doi: z.string().min(1),
  observation: z.string().min(1),
})
export type IrisPublishedControl = z.infer<typeof IrisPublishedControlSchema>

export const IrisReplicationV1Schema = z.object({
  schemaVersion: z.number().int(),
  analysisVersion: z.string().startsWith('iris-method-replication-'),
  generatedAt: z.string().min(1),
  caseId: z.string().min(1),
  sourceManifestSha256: z.string().length(64),
  sourceAssetId: z.string().min(1),
  sourceAssetSha256: z.string().length(64),
  methodProvenance: z.string().min(1),
  /** v1: published control object; v2 event replication: null (no published ROI). */
  publishedPositiveControl: IrisPublishedControlSchema.nullable().optional(),
  frozenCriterion: z.string().min(1),
  observableStatus: z.string().min(1),
  rasterCount: z.number().int().nonnegative(),
  failedRasterCount: z.number().int().nonnegative(),
  medianBrightMinusReferenceVelocityKmPerSecond: z.number().finite(),
  velocityInterval95KmPerSecond: SupplementIntervalSchema.nullable(),
  velocityIntervalBootstrapUnit: z.string().min(1).optional(),
  quantitativeResults: z.array(z.record(z.string(), z.unknown())).default([]),
  rasters: z.array(z.record(z.string(), z.unknown())),
  failures: z.array(z.record(z.string(), z.unknown())).default([]),
  mechanismEvidencePermitted: z.literal(false),
  evidenceRole: z.string().min(1),
  boundaries: z.array(z.string().min(1)),
})
export type IrisReplicationV1 = z.infer<typeof IrisReplicationV1Schema>
