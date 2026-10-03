# Decision: independent controls with a reusable identity

Status: implemented integration; real identity quality requires a paid acceptance run. Research date: 2026-10-03.

## Selected pipeline

Train a FLUX.1 subject LoRA using fal fast training; run fal FLUX General image-to-image with the LoRA, reference-only guidance and InstantX FLUX.1 ControlNet Union in pose mode. DWPose produces a body pose map and a separate face mask. The original facial pixels are replaced before either generative reference input is uploaded.

This choice prioritizes the user's need to independently experiment with identity, pose and photographic reference influence. It is an engineering judgment about documented API compatibility, not a claim that FLUX.1 leads current image-quality benchmarks.

| Candidate                              | Identity / reference capability                                                                        | Practical decision                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fal FLUX General                       | One endpoint documents LoRA, ControlNet Union, image-to-image, reference-only guidance and IP-Adapter. | First production adapter and pipeline. The controls directly represent model inputs.                                                                                                     |
| fal FLUX.2 dev LoRA edit               | LoRA plus up to four reference images; guidance, steps and seed.                                       | Promising alternative for semantic editing and photorealism. No separate pose or reference strength in the inspected schema. Requires FLUX.2 weights and a separately costed comparison. |
| FLUX.2 Klein 9B LoRA edit              | Newer compact editing model and LoRA support.                                                          | Documented alternative, not a drop-in base-model replacement. Needs its own identity training and evaluation.                                                                            |
| FLUX.2 Pro / Max                       | High-quality reference editing APIs.                                                                   | Do not assume arbitrary LoRA or numeric ControlNet support merely from general reference support.                                                                                        |
| Replicate fast trainer                 | Subject-specific LoRA training; docs estimate about $1.46 for a typical 20-image/1,000-step run.       | Credible provider alternative. Runtime pricing is variable.                                                                                                                              |
| Replicate community combined pipelines | LoRA with image-to-image, edge/depth conditioning or inpainting.                                       | The reviewed schemas are less directly aligned with the independent pose/reference controls needed here. Provider abstraction preserves a path to adding a verified endpoint later.      |
| Qwen Image Edit LoRA                   | Supports reference editing with custom LoRA.                                                           | A separate model family and training/evaluation effort. Do not substitute without comparison.                                                                                            |
| FLUX portrait trainer                  | Specialized portrait-training endpoint.                                                                | A useful future same-family training comparison. Fast training starts at a lower, clearly documented cost and supports subject masks and captions.                                       |

No hands-on comparison with personal photos was performed during documentation research. A meaningful quality comparison must use held-out identity photos, the same references and explicit cost accounting. Changing the default model should follow that evaluation.

## Conditioning decisions

- **LoRA:** identity signal, with a unique trigger and a saved immutable training version.
- **Pose:** a body pose image enters a real ControlNet Union pose input. No detailed facial-landmark conditioning is requested.
- **Reference-only + image-to-image:** the protected reference contributes clothing, framing, color and lighting. These signals are not independent or guaranteed to preserve every detail.
- **IP-Adapter:** evaluated as an available alternative, omitted from v1 to avoid another competing image-identity signal and added CFG cost before measuring a benefit.
- **Depth / canny:** can strengthen geometry and garment edges, but may constrain unwanted facial morphology and add complexity. Their controls are intentionally absent until validated.

The mask removes facial detail from conditioning. It is not an inpainting mask: generation still redraws the full photograph. The automatic mask is expanded; users review it and correct it manually. All conditioning images share a center crop and resize when the output aspect ratio changes.

For fidelity `f` in `[0,1]`, v1 defaults use `pose = 0.4 + 0.5f`, `reference = 0.2 + 0.45f`, and `transformation = 0.95 - 0.2f`. Identity remains 1.0. These are conservative initial presets to evaluate, not benchmarked optima. Manual overrides persist until cleared. Every generation saves effective values and the preset version.

## Reliability and portability

Training and generation are immutable records. Inputs and provider request IDs persist before polling. Finished provider results persist before artifact download. Output insertion is unique per job, preventing duplicate local output records on recovery. A submission with an unknown outcome never automatically retries. The browser also reuses an idempotency key after transport failures.

The abstraction intentionally does not claim that LoRAs are portable across model families. Each version records the provider, base family, endpoint, weights hash, training data hashes and configuration. Local weights remain authoritative; short-lived upload URLs are only a cache.

SQLite and filesystem storage suit a single long-running local Node process. Repositories, provider adapters and asset functions are separate. Cloud deployment would need an authenticated boundary and durable remote storage/execution, but domain semantics remain reusable.

## Primary sources

- [fal FLUX General input schema](https://fal.ai/models/fal-ai/flux-general/image-to-image/api)
- [fal fast subject trainer](https://fal.ai/models/fal-ai/flux-lora-fast-training/api)
- [fal portrait trainer](https://fal.ai/models/fal-ai/flux-lora-portrait-trainer/api)
- [DWPose inputs and mask modes](https://fal.ai/models/fal-ai/dwpose/api)
- [InstantX ControlNet Union model card](https://huggingface.co/InstantX/FLUX.1-dev-Controlnet-Union)
- [FLUX.2 LoRA edit schema](https://fal.ai/models/fal-ai/flux-2/lora/edit/api)
- [FLUX.2 trainer V2 pricing](https://fal.ai/models/fal-ai/flux-2-trainer-v2): $6.40 for 1,000 steps at research time.
- [FLUX.2 LoRA edit pricing](https://fal.ai/models/fal-ai/flux-2/lora/edit): $0.021 per input/output megapixel, with additional charges for large LoRAs, at research time.
- [Klein 9B LoRA edit](https://fal.ai/models/fal-ai/flux-2/klein/9b/base/edit/lora/api)
- [Qwen Image Edit LoRA](https://fal.ai/models/fal-ai/qwen-image-edit-2511/lora/api)
- [Replicate subject fine-tuning](https://replicate.com/docs/get-started/fine-tune-with-flux)
- [Replicate combined LoRA/ControlNet pipeline](https://replicate.com/fermatresearch/flux-controlnet-inpaint)
- [fal asynchronous request lifecycle](https://fal.ai/docs/documentation/model-apis/inference/queue)

Model IDs, behavior and prices can change independently. Preserve saved run metadata and rerun acceptance checks before changing the default stack.
