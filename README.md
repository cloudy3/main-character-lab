# Main Character Lab

A local-first personal photography workstation. Train a reusable identity LoRA from your own photos, prepare a reference photograph, and generate a new photograph with your identity and the reference's photographic setup.

The app stores its library, model weights, photos and history on your computer. **Training and inference run on fal.ai and require uploads and API credits.** Local-first does not mean offline AI inference.

## Requirements and setup

- Node.js 22.17 or newer (Node 22 LTS recommended).
- A fal account with API credits and a server-side API key.
- Roughly 15–30 varied photos of yourself; the app accepts 10–40.
- Disk space for your photos, generated images and LoRA weights.

Use either Windows Node from PowerShell or Linux Node inside WSL. Do not share an installed `node_modules` between these runtimes: SQLite and Sharp have platform-specific binaries. WSL projects run faster on the Linux filesystem than under `/mnt/c`.

```sh
npm ci
```

Copy `.env.example` to `.env.local` using your editor, then set:

```dotenv
FAL_KEY=your_fal_key
AI_PROVIDER=fal
DATA_DIR=./data
```

```sh
npm run dev
```

Open <http://127.0.0.1:3000>. Migrations apply automatically on first database access. To apply them manually with the default data directory, run `npm run db:migrate`.

For production mode on your computer:

```sh
npm run build
npm start
```

Both start commands bind to loopback. Keep the server running while jobs are active. Remote jobs may continue when the app is closed; local polling and artifact download resume when it is reopened. A crashed job lease can take up to ten minutes to expire.

### Environment variables

| Variable      | Purpose                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `FAL_KEY`     | fal API key, read only by server code. Never use a `NEXT_PUBLIC_` prefix.                                                                  |
| `AI_PROVIDER` | `fal` by default. `mock` enables the visibly labeled offline test adapter.                                                                 |
| `DATA_DIR`    | Database and private asset directory; defaults to `./data`. Relative paths resolve from the project directory.                             |
| `APP_ORIGIN`  | Optional explicitly trusted origin. Normal loopback use needs no setting. This does not add authentication or make public deployment safe. |

Restart after changing environment variables. CLI migrations read shell environment variables, while Next.js also loads `.env.local`; export a custom `DATA_DIR` for CLI use.

## Train your identity

1. Open **Identities** and create a named identity.
2. Drop in your photos. Use sharp, minimally edited images of only you, with different angles, distances, clothing and lighting. Include some full-body shots if full-body appearance matters.
3. Remove poor photos. The app validates decoding, dimensions, file size and exact duplicates. It does not automatically judge whether each photo depicts the same person.
4. Review the cost, then explicitly start training. Start with 1,000 steps; more steps can overfit.
5. Keep the browser open or return later to view progress. Completed weights and configuration are downloaded locally.

Training uses `fal-ai/flux-lora-fast-training`, with subject masking and automatic captions enabled. A unique token identifies your identity in generation prompts. Every training creates an immutable dataset snapshot and version. The app never retrains automatically. Removing a photo from the editable dataset retains its file for prior training snapshots.

Deleting an identity removes its local photos, weights and configuration files. Generated images and historical metadata remain, but regeneration with the deleted identity becomes unavailable. Deletion cannot remove copies retained by an external provider. Keep backups if you want to restore a deleted model.

## Generate a photograph

1. Select a completed identity version in **Studio**.
2. Upload one reference image. Initial support targets photographs containing one primary person.
3. Click **Prepare reference**. This starts two paid DWPose requests: body pose and face mask. Preparation is cached for repeat uploads of the same normalized image within the same provider.
4. Review the highlighted face mask. Paint over missed facial details and ears, erase excessive coverage, then approve. The masked pixels are replaced with a neutral fill before reference conditioning. You can revise the mask later.
5. Optionally describe changes, set aspect ratio and output count, and adjust **Reference Fidelity**.
6. Generate. Results and their settings are saved locally and appear in **Archive**.

If preparation is interrupted, resolve any uncertain requests first. **Restart missing steps** explicitly submits only the missing pose or mask work; completed steps are reused. A failed automatic mask can also be corrected manually once the body pose is available.

The application generates the entire image using FLUX General. There is no face-swap or face-pasting step. The original reference is used for pose/mask extraction and retained in your local history; only its face-protected version enters the generative image-conditioning paths.

### Controls

- **Identity strength:** scale of the selected LoRA.
- **Reference Fidelity:** an application preset that raises pose and reference guidance while reducing image-to-image transformation. It never changes identity strength.
- **Pose strength:** actual ControlNet conditioning scale.
- **Reference strength:** reference-only image guidance. Clothing, lighting and composition share this signal.
- **Transformation strength:** higher values redraw more of the input photograph.
- **Guidance / steps:** supported model controls, with bounded ranges.
- **Aspect / resolution:** dimensions aligned to 32-pixel increments. Changing aspect ratio center-crops the pose and conditioning image consistently.

Advanced overrides stay fixed when you move Reference Fidelity. Use **Clear overrides** to follow the preset again. The slider is a tuning preset, not a measured percentage of similarity.

Seed is a random-number initialization, not strength. Use random, enter a specific integer, lock it across requests, or reuse it from an output. Each extra output receives the next seed. One provider request is made per output so seeds remain unambiguous. **Regenerate with the same seed** uses the original immutable reference artifacts, even after a mask edit. **Use settings** restores controls for further editing. Hosted model updates can change results even with an identical seed.

## Costs

Published estimates checked on **2026-10-03**:

| Operation                    | Estimate                                                             |
| ---------------------------- | -------------------------------------------------------------------- |
| FLUX fast identity training  | $2 per 1,000 steps                                                   |
| FLUX General generation      | $0.075 per rounded-up megapixel, per output                          |
| DWPose reference preparation | $0.0006 per compute second, for each of two requests; runtime varies |

The app conservatively rounds decimal megapixels up. A 768×1024 frame is estimated at $0.075; 1024×1024 at $0.15. Provider billing conventions or account pricing may differ. Four outputs cost four requests. Training and preparation require separate explicit actions; uploads alone cost nothing.

Estimates are labeled and dated. Actual cost is stored only if the provider supplies it; the standard fal result schema does not currently include a per-request dollar total, so its dashboard is the source for final charges. The offline adapter reports zero and never calls fal.

Sources: [trainer](https://fal.ai/models/fal-ai/flux-lora-fast-training), [generation](https://fal.ai/models/fal-ai/flux-general/image-to-image), [DWPose](https://fal.ai/models/fal-ai/dwpose).

## Architecture

```text
Browser workstation
        │ same-origin requests
Next.js server routes → application services → SQLite / local assets
                              │
                     durable provider jobs
                              │
                     fal provider adapter
```

- Next.js App Router, React and strict TypeScript.
- Drizzle + SQLite with foreign keys, WAL, migrations and durable job records.
- Local files outside `public`, served through guarded asset routes.
- `AIProvider` interface for upload, submission, polling, results, cancellation and artifact download. Capabilities declare model family and real supported controls.
- fal implementation plus a deterministic offline test implementation. Adding another production service does not require replacing screens or database records, but model compatibility must be explicitly verified.
- A small in-process reconciler resumes pending jobs. The provider executes the long-running AI work. No Redis, workers, public webhooks or application queue service.

Provider submission retries are disabled. Intent is saved first; the provider request ID is saved immediately afterward. A lost submission response enters **uncertain** state instead of automatically submitting another charge. Check fal request history and attach its ID, or explicitly abandon local tracking after investigating. Abandoning local tracking does not cancel remote work. Existing jobs can resume status checks or artifact downloads without retraining or generating again.

### Project structure

```text
src/app/             Screens, layout and server API routes
src/components/      Uploads, masking, results, reusable controls
src/domain/          Types, validation, seeds, costs and parameter mapping
src/server/          Services, image processing, storage and job lifecycle
src/server/providers/ fal and offline adapters
src/server/db/       Drizzle schema and database initialization
drizzle/             Committed SQL migrations
tests/               Domain, integration, security and browser tests
docs/                Model decision and validation notes
```

The external API boundary and file-storage functions are deliberately small. A future deployment can replace persistence/storage and the reconciler host without rewriting generation logic. Public hosting also requires authentication, authorization, remote storage and a deployment-specific job lifecycle; none is included in the local single-user release.

## Validation

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests run a separate local server on port 3100 with `AI_PROVIDER=mock`. Integration tests use temporary databases. Synthetic images and fake weights are clearly labeled and cannot be used with the live fal provider. Tests do not incur charges.

To test the production build, run `npm run build`, set the shell environment variable `E2E_PRODUCTION=1`, then run `npm run test:e2e`. The default browser test uses the development server. On Linux, Playwright may also require browser system libraries (`npx playwright install-deps chromium`).

For a real acceptance run, configure fal, upload your identity photos, train once, generate against several references, restart the app and reuse the same trained version. Evaluate likeness, unwanted reference identity, pose, outfit, lighting, hand anatomy and photographic quality separately. See [validation notes](docs/validation.md).

## Security and backups

API keys never enter browser bundles. Server routes validate inputs and origin/host, enforce upload byte and decoded-pixel limits, strip image metadata and reject unexpected download hosts. Sensitive provider responses are not printed in logs. The app has no authentication and is intended for loopback use by one trusted local user.

The `data` directory is private but **not encrypted at rest**. Protect it with your operating system's permissions and disk encryption. Stop the application before copying the entire data directory for a backup; preserve the database and assets together. Environment files are separate. Avoid deleting individual files from the library manually.

## Limitations

- API support establishes feasibility, not proven identity quality. Real-photo benchmarking is still required for your identity and chosen references.
- Facial masking reduces reference identity leakage; it cannot guarantee exact likeness or complete identity separation. Facial angle and hair may need iteration.
- Tight wardrobe/lighting fidelity and identity fidelity can conflict. Controls are coupled by the model.
- Pose detection can fail with unusual angles, occlusion or multiple people. The first release provides mask correction, but no pose drawing editor or multi-person assignment.
- No automatic pose-quality scoring, face recognition, beauty scoring, upscaling or local GPU inference.
- FLUX.1 LoRAs cannot be assumed compatible with FLUX.2 or other model families. The first release uses one documented compatible stack.
- Provider artifact links can expire. Completed weights and images are downloaded locally; leaving the app closed until a result expires can make a job unrecoverable.
- Training or generation may be rejected by provider policy. The application retains the failure and keeps safety checking enabled.

See [the model and architecture decision](docs/architecture.md) for the alternatives evaluated and why this pipeline was chosen.
