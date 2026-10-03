# Validation and live acceptance

Automated tests must not silently spend API credits. The integration and browser suites use synthetic inputs and a deterministic provider, with real SQLite persistence, image processing, job execution and server routes.

## Verified on 2026-10-03

- Strict TypeScript check and ESLint: passed.
- Unit/integration suite: 19 tests passed across 3 files.
- Optimized production build: passed.
- Chromium workflow against the production server (`E2E_PRODUCTION=1`): passed, including image decoding, seed reuse, archive persistence, console-error checks and mobile overflow checks.
- Desktop studio, archive and mobile screenshots: visually inspected. They show explicitly labeled synthetic fixtures, not real photographic results.
- `npm audit --omit=dev`: zero reported production dependency vulnerabilities. This does not certify the development toolchain or replace future audits.

No paid fal request was made. Live endpoint execution, personal likeness and photographic quality remain unverified; use the acceptance procedure below before relying on the application for real results.

## Automated coverage

- Fidelity mapping, independent identity strength, explicit overrides and valid dimensions.
- Random/manual seed validation and distinct per-output seeds.
- File decoding, exact duplicates, dataset minimum size and snapshot retention.
- Local path confinement, trusted provider hosts and same-origin mutation checks.
- Provider response schemas and blocked-output handling.
- Submission idempotency, durable request tracking, uncertain submission recovery and idempotent artifact saving.
- Interrupted reference preparation restarts only missing work, blocks uncertain submissions, and preserves manual mask repairs.
- LoRA uploads retain the safetensors filename; provider changes cannot mix reference preparation backends.
- Provider wire inputs keep identity, pose, reference and transformation controls distinct, including a zero seed.
- Training → reusable weights → reference pose/mask → protected image → seeded generation → history.
- Regeneration from immutable reference artifacts after mask edits.
- Identity deletion retains historical outputs and removes training bytes.
- Browser workflow, distinct saved outputs after seed reuse, decoded archive images, console errors and narrow-screen overflow.

## Real acceptance procedure

Requires user-supplied identity photos and a configured fal account. Do not represent the offline fixture as photographic quality evidence.

1. Set `AI_PROVIDER=fal` and configure `FAL_KEY`.
2. Upload 15–30 varied photos of yourself. Hold out 3–5 additional photos for likeness review.
3. Train once at 1,000 steps; record the job ID, training estimate and final dashboard charge.
4. Use three reference photographs: a close portrait, a half-body editorial pose and a full-body pose. Start with one person, a visible face and unobstructed limbs.
5. Inspect the body pose and face protection. Correct any missed face areas.
6. Generate one output at fidelity 60, identity 1.0, 28 steps, guidance 3.5 and 1024px long edge.
7. Score likeness, reference-face leakage, pose, outfit, composition, lighting, skin texture and anatomy separately. Inspect the entire body and background for coherence.
8. Compare fidelity 30/60/90 using the same seed. Then adjust identity strength independently. Record which changes help and which conflict.
9. Stop and restart the application; verify images, weights and settings remain available. Regenerate using the saved seed without retraining.
10. Confirm output retrieval and compare estimated charges with the provider dashboard.

Failure to resemble the trained identity is a model-quality failure even if every API request succeeds. Improve the dataset or compare another trainer/model before declaring photographic acceptance complete. No fully automatic metric can replace the user's likeness judgment here.
