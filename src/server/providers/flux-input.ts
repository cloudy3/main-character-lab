import type { ModelRequest } from "./types";
// fal-specific wire format. The offline contract adapter deliberately mirrors it.
export function buildFluxInput(request: ModelRequest): Record<string, unknown> {
  if (request.kind === "training")
    return {
      images_data_url: request.archiveUrl,
      trigger_word: request.trigger,
      steps: request.steps,
      is_style: false,
      create_masks: true,
      data_archive_format: "zip",
    };
  if (request.kind === "pose" || request.kind === "mask")
    return {
      image_url: request.imageUrl,
      draw_mode: request.kind === "pose" ? "body-pose" : "face-mask",
    };
  const c = request.controls;
  return {
    prompt: request.prompt,
    image_url: request.imageUrl,
    reference_image_url: request.imageUrl,
    reference_strength: c.reference,
    strength: c.transformation,
    loras: [{ path: request.loraUrl, scale: c.identity }],
    controlnet_unions:
      c.pose === 0
        ? []
        : [
            {
              path: "InstantX/FLUX.1-dev-Controlnet-Union",
              controls: [
                {
                  control_image_url: request.poseUrl,
                  control_mode: "pose",
                  conditioning_scale: c.pose,
                  start_percentage: 0,
                  end_percentage: 0.85,
                },
              ],
            },
          ],
    image_size: { width: c.width, height: c.height },
    seed: request.seed,
    num_inference_steps: c.steps,
    guidance_scale: c.guidance,
    num_images: 1,
    enable_safety_checker: true,
    output_format: "png",
    use_real_cfg: false,
  };
}
