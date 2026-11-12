# Google Flow images (image engine "flow")

Settings `image_engine` = `codex` (default) or `flow` (Settings tab, Tool settings, "Image engine"; or `workspace/settings.json`). With `flow`
Create & publish does not run Codex for images: the agent (Claude Code) makes each image in Google Flow in the signed-in Chrome through the
Playwright MCP, then registers it with one command. Brand rules stay in the brand skill and in each draft's `prompt.txt` / `prompt-0N.txt`
(no logo on the product, text on images in English, album of 1 to 3 images): those files are the prompts you type into Flow.

## Google's sparkle
Every Flow picture carries Google's sparkle (a four-point star, bottom right, centre about 101 px from the right and bottom edges). It is removed
locally by `scripts/image-unsparkle.mjs` (undoes the white veil, keeps the detail under it). Never ask Flow to remove a watermark or change a brand
name: Flow refuses. A faint, thin outline of the star can remain on very textured or strongly JPEG-compressed areas: LOOK at the corner of every
image. The original download is kept next to the draft image.

## Commands
- `node scripts/image-unsparkle.mjs --image <png|jpg> --out <png>` prints `{"applied":true|false,"alpha":0.33}`. Input stays untouched; a picture without the star is returned unchanged (as PNG). Own copy of Product Review's remover plus a vendored JPEG decoder (`scripts/vendor/`).
- `node scripts/draft.mjs register-image --id <draft> --from <downloaded file> [--n 1|2|3]` (the one command per image): keeps the raw download (`image-generated-flow-original.jpg|png`, extras `image-02-flow-original.*`), converts to PNG (`image-generated.png`, extras `image-02-generated.png`), removes the sparkle, then the usual metadata clean (`image.png`, `image-02.png`, `image-03.png`), the watermark overlay when the brand has it on, and `draft.mjs check`. Status: `image_engine: flow`, `sparkle: removed|none` (per image in `flow_images`). A new call for the same `--n` puts the old image aside (`image-old-...`).
- `pipeline.mjs create` with engine `flow`: Stage B does not start `image-batch`; Stage C answers `C waiting for Flow images` with, per draft, the images to make, the prompt file and the register command, until every image is registered. A "redo" puts the old images aside and waits for new ones.

## Procedure (Vietnamese Flow interface, plan PLUS; adapt if the language or layout differs; use text/role locators, never fixed coordinates unless unavoidable)
1. Open `https://flow.google.com`. On the home page click the floating "Dự án mới" (New project) button.
2. The bottom prompt box ("Bạn muốn tạo những gì?") has chips: Tác nhân, model "Nano Banana Pro", an aspect icon and a count chip ("x4"). Click the count chip: a panel with Hình ảnh/Video, aspect ratios 16:9 4:3 1:1 3:4 9:16, the model, and x1..x4 (generation costs 0 credits on this plan). Choose Hình ảnh, the ratio the post needs (1:1 for feed), x1 (or the number needed), press Escape.
3. CLICK THE BOTTOM PROMPT BOX and type the prompt with the keyboard. Pitfall: the first `role=textbox` on the page is the PROJECT TITLE field at the top; typing there renames the project (if it happens, press the X next to it).
4. Press the round arrow button at the right of the box; wait about 20 to 30 seconds until the thumbnail appears.
5. Click the thumbnail (detail view), click the download icon ("Tải nội dung nghe nhìn xuống"), pick "1K Kích thước gốc" (2K "Đã tăng độ phân giải" is also there; 4K needs a plan upgrade).
6. Chrome saves a JPG into the Downloads folder (download events are not delivered in extension mode and the Playwright sandbox cannot write files). With node/shell take the newest file in `C:\Users\<user>\Downloads` (or Chrome's download folder) named like `<project name>_<id>.jpg`, then `draft.mjs register-image --id <draft> --n <k> --from <that file>`. The command only reads the file (move or delete it afterwards if you like).
7. Reference images: the "+" button at the left of the prompt box adds reference/ingredient images (scene-swap from a library item: attach the product photo and say exactly what must stay).

## Stop rules
Login wall, captcha, a consent dialog the agent cannot pass, no credits, or a refusal from Flow: stop and report; do not retry endlessly. One browser = one agent: images are made one after another (the Run now run waits for the person to click Connect in Chrome, same as Research).

## Run now
With `image_engine: flow` a Create run started from the app allows the Playwright browser tools (`browser_tabs`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_press_key`, `browser_wait_for`, `browser_run_code_unsafe`, `browser_take_screenshot`, `browser_evaluate`, `browser_file_upload`) next to the create tools, and gets the same wait-for-Connect note as Research. With `codex` nothing changes.
