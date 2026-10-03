import { test, expect } from "@playwright/test";
import sharp from "sharp";
test("train, protect reference, generate, reuse seed and revisit the archive", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  async function imagesLoaded(selector: string) {
    await expect
      .poll(() =>
        page.locator(selector).evaluateAll(
          (elements) =>
            elements.length > 0 &&
            elements.every((element) => {
              const img = element as HTMLImageElement;
              return img.complete && img.naturalWidth > 0;
            }),
        ),
      )
      .toBe(true);
  }
  await page.goto("/identities");
  await page.getByRole("button", { name: "New identity" }).click();
  await page.getByLabel("Identity name").fill(`Browser test ${Date.now()}`);
  await page
    .getByRole("button", { name: "Create identity", exact: true })
    .click();
  const images = await Promise.all(
    Array.from({ length: 10 }, async (_, n) => ({
      name: `test-${n}.jpg`,
      mimeType: "image/jpeg",
      buffer: await sharp({
        create: {
          width: 400,
          height: 512,
          channels: 3,
          background: { r: n * 20 + 20, g: 100, b: 140 },
        },
      })
        .jpeg()
        .toBuffer(),
    })),
  );
  await page.getByLabel("Add your identity photos").setInputFiles(images);
  await expect(page.getByText("10 / 40 photos")).toBeVisible({
    timeout: 60_000,
  });
  await page
    .getByRole("button", { name: "Train identity", exact: true })
    .click();
  await page.getByRole("button", { name: "Start paid training" }).click();
  await expect(
    page.getByRole("link", { name: "Use in studio" }).first(),
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: "Use in studio" }).first().click();
  await page
    .getByLabel("Choose a reference photograph")
    .setInputFiles(images[0]);
  await page.getByRole("button", { name: "Prepare reference" }).click();
  await page
    .getByRole("button", { name: "Review face protection" })
    .click({ timeout: 60_000 });
  await page
    .getByRole("button", { name: "Approve protected reference" })
    .click();
  await expect(page.getByText("Face protected · pose ready")).toBeVisible();
  await page.getByText("Advanced controls", { exact: true }).click();
  await page.getByLabel("Seed", { exact: true }).fill("42");
  await page.getByRole("button", { name: "Generate photograph" }).click();
  await expect(page.getByText("SEED 42", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await imagesLoaded(".result-image img");
  const firstImage = await page
    .locator(".result-image img")
    .getAttribute("src");
  await page.getByRole("button", { name: "Same seed", exact: true }).click();
  await page
    .getByRole("button", { name: "Generate one image", exact: true })
    .click();
  await expect(page.getByText("SEED 42", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator(".result-image img")).not.toHaveAttribute(
    "src",
    firstImage!,
    { timeout: 60_000 },
  );
  await imagesLoaded(".result-image img");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/studio.png",
    fullPage: true,
    caret: "initial",
  });
  await page.getByRole("button", { name: "Use settings", exact: true }).click();
  await expect(page.getByLabel("Seed", { exact: true })).toHaveValue("42");
  await page.reload();
  await page.getByRole("link", { name: "Archive", exact: true }).click();
  await expect(page.locator(".archive-card")).toHaveCount(2);
  await imagesLoaded(".archive-card img");
  await page.screenshot({
    path: "test-results/archive.png",
    fullPage: true,
    caret: "initial",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText(/Offline test mode/)).toBeVisible();
  await expect(page.getByLabel("Selected identity model")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/studio-mobile.png",
    fullPage: true,
    caret: "initial",
  });
  expect(errors).toEqual([]);
});
