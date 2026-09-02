# Targeted mechanism-discriminating data and literature expansion (2026-08-26)

## Purpose

Close the highest-value evidence gaps without adding another undifferentiated AIA image layer. Literature defines testable predictions and known ambiguities; it is never counted as local observational support.

## Official archive queries and products

- NuSTAR observations were identified through the HEASARC `numaster` TAP table at `https://heasarc.gsfc.nasa.gov/xamin/vo/tap/sync` and checked against `https://heasarc.gsfc.nasa.gov/W3Browse/nustar/numaster.html`.
- The public data layout and release policy were checked at `https://heasarc.gsfc.nasa.gov/docs/nustar/archive/nustar_archive.html`.
- Files were retrieved from NASA's public HEASARC Open Data mirror documented at `https://registry.opendata.aws/nasa-heasarc/`; every local file has an exact byte count and SHA-256 in the supplement manifest.
- AR 12222: ObsID `20001005001`, 2014-12-11, HEASARC coordination field `FOXSI VLA RHESSI`. This is the event analyzed by DOI `10.3847/1538-4357/835/1/6`.
- AR 12721 microflare campaign: ObsIDs `80414201001`, `80414202001`, and `80414203001`, 2018-09-09. The 11:04 UT microflare is analyzed by DOI `10.3847/2041-8213/ab873e`.
- The published AR 11890 IRIS observation was frozen to observation ID `20131109_120415_3860257403`, 2013-11-09 12:04:15–12:17:26 UT, using the LMSAL HCR at `https://www.lmsal.com/hek/hcr` and Level-2 archive at `https://www.lmsal.com/solarsoft/irisa/data/level2_compressed/`.
- The existing AR 11899 EIS Level-0 exposure `eis_l0_20131119_104020` was matched to the official calibrated Level-1 HDF5 pair at `https://umbra.nascom.nasa.gov/hinode/eis/level1/hdf5/2013/11/19/`. EISPAC processing conventions were checked at `https://eispac.readthedocs.io/en/latest/guide/01-data.html`.

The checksummed supplement is `data/dataset/coronal-evidence-70gb-v1/supplements/targeted-discriminants-v1/manifest.json`: 61/61 assets, 1,377,399,480 bytes.

## Literature search and validation

Search families covered Alfvén/kink damping and energy flux, magnetic braiding/reconnection topology, EIS/IRIS line diagnostics, thermal nonequilibrium alternatives, hard-X-ray upper limits, and observation-matched synthetic diagnostics. Candidate metadata were gathered from OpenAlex searches and the selected DOI records were verified against Crossref's `https://api.crossref.org/works/{doi}` endpoint.

The curated corpus increased from 40 to 80 records. The deterministic audit reports:

- foundational review/theory: 18;
- discriminating observation: 54;
- forward model/simulation: 29;
- counterexample/alternative/limitation: 14;
- wave coverage: 22;
- reconnection/nanoflare coverage: 20;
- thermal-process/alternative coverage: 31;
- unique IDs, normalized titles, and DOIs: all true.

The corpus is therefore marked `frozen_verified_corpus`. “Frozen” means the competition retrieval baseline meets the registered 80–150 target and coverage floors. It does not mean the scientific literature is complete or that a mechanism is established.

## Scientific boundaries

- NuSTAR Level-2 event lists are not mechanism evidence until livetime, GTI, source/background, response, ghost-ray and solar-coordinate checks have passed.
- AR 12222 is a post-flare late-phase event. It cannot be transferred to the original AR 11158 claim or treated as a quiet-corona nanoflare detection.
- The AR 12721 microflare is an independent positive-control/holdout event. A thermal detection or a non-thermal upper limit constrains a bounded event population, not all active-region heating.
- AR 11890 is a literature-anchored positive control. A local reproduction must remain separate from blind discovery and external validation.
- The EIS Level-1 pair removes the previous “Level-0 only” blocker, but density, Doppler and non-thermal width still require versioned fits, calibration choice and propagated uncertainties.
- No public MHD snapshot located in this search is observation-matched to the local event geometry. Generic simulations remain retrieval/forward-prediction sources and cannot be promoted as local direct evidence.
