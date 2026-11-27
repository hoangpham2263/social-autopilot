# Flow UI notes (Vietnamese UI, Playwright MCP) - mined from real Create runs 2026-11-22/23

Read BEFORE opening Flow. Newer one-liners: `workspace/flow-ui-lessons.md`. Labels as shown; the same buttons appear in English in some profiles (in brackets). Pace gate, stop rules and status lines stay in `docs/flow-images.md`.

## Tốc độ (đo 2026-11-27: Antigravity + Flow ~4 phút/ảnh, ~8 lượt agent mỗi ảnh, mỗi lượt 7-36 s; Flow render không phải cổ chai. Cùng cách product-review 2026-11-26)
- `flow-brief` in `js.{prep,submit,ready,collect}`: file trong `workspace/tmp/run-<run>/flow/` (sinh bởi `scripts/flow-snippets.mjs`, mỗi file cho đúng MỘT ảnh). Chạy bằng `browser_run_code_unsafe` với `filename`. prep = bước 5-8 gộp một lệnh (kiểm chip 1:1 / Nano Banana 2.1, tải ảnh tham chiếu của ảnh này, gắn chip, gõ prompt; không gửi); submit = bước 10; ready = kiểm ảnh xong chưa (không thao tác); collect = bước 12-13 (mở ô kết quả + bấm 1K). Trả `{stop: ...}` thì làm phần đó bằng tay theo các bước dưới.
- Ảnh 2-4: prep tải chính image.png của bài (bản đã đăng ký) làm tham chiếu, không cần tìm ô ảnh bìa trong dự án.
- Tải: `node scripts/flow-pace.mjs download-lock acquire --tag <draft>#<n>` > collect > `node scripts/flow-pace.mjs download-collect --tag <draft>#<n>` (đợi file, chuyển vào workspace/tmp/flow-downloads/<run>/<draft>-<n>.<ext>, kiểm là ảnh, LUÔN nhả khoá; in sẵn lệnh register) > NHÌN ảnh một lần > register-image. Khoá dùng chung file với product-review (`<tmp>/flow-download.lock`), chỉ giữ lúc bấm + chuyển file.
- Không browser_snapshot / chụp màn hình / browser_wait_for. Chưa xong thì làm flow-brief + prep của ảnh kế, rồi kiểm lại bằng `ready`.
- Gate không đổi (5-12 s, nhóm 2-3, 20-45 s sau nhóm, tối đa 8 prompt/2 phút).

## Steps (typical time)
0. Reuse the Flow project: `node scripts/flow-pace.mjs project get` (one per Chrome profile). A url = open it directly (settings are kept; check the chip). None / fails to open: create one, then `project set --url <url>`. Work the posts grouped by ratio.
1. `node scripts/draft.mjs flow-brief --id <draft> --n 1` first (prompt + reference copied to Downloads). Then `pw_tabs list`, and EVERY `run_code_unsafe` starts with `await page.bringToFront()`.
2. Account (only when `browser.flow_account` is set): navigate `https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fflow.google.com%2F`, `pw_snapshot`, click the account. The plain click is often blocked by an overlay: use `page.locator('[data-identifier="<email>"]').click({force:true})`, wait 4 s, then navigate `https://flow.google.com` (~15 s).
3. Viewport can come out huge/odd (screenshots unreadable, buttons far away): `page.setViewportSize({width:1400,height:900})` right after opening Flow.
4. Home: click "Dự án mới" (New project) (~5 s). A welcome / "Nhật ký thay đổi" (changelog) dialog may cover it: press "Next" a few times (inside `iframe[title="Nhật ký thay đổi"]`) then "Bắt đầu", or close it.
5. Settings chip, bottom right of the prompt box (`button[aria-label="Điều kiện kích hoạt cài đặt"]`, text like "Nano Banana 2.1 crop_16_9 x2"). If "Tác nhân Flow" (Flow agent) is on (`button[aria-label="Tác nhân Flow"]`), switch it off for the classic image box. Open the chip: Hình ảnh, tab 1:1, button `x1`, model "Nano Banana 2.1" (NEVER Pro; absent = stop and report), Escape. Verify the chip text reads "Nano Banana 2.1 crop_square x1" (~15 s).
6. Prompt: the bottom box is `getByRole('textbox',{name:'Bạn muốn tạo những gì?'})` (ProseMirror, no placeholder attribute; `.fill` and `getByPlaceholder` fail). Click it, then `page.keyboard.insertText(<prompt>)`. Never the first textbox (project title).
7. Reference upload: button `[aria-label="Thêm thành phần vào ô nhập câu lệnh"]` ("+") > "Tải nội dung nghe nhìn lên" (Upload media) opens a file chooser. Playwright only reads under the tool folder: `cp C:/Users/Admin/Downloads/sa-ref-<draft>-<n>.<ext> .playwright-mcp/ref-<n>.<ext>` and upload THAT path (via `fc.setFiles` or `pw_file_upload`); the Downloads path is refused (~10 s).
8. After upload the file is in the picker (tab "Tệp tải lên", search box "Tìm kiếm thành phần"): click the item (text = file name) then "Thêm vào câu lệnh" (Add to prompt). Check a thumbnail chip (`img[alt="Ingredient image"]`) sits in the box. The prompt text can be typed before or after; look at the box before sending.
9. `node scripts/flow-pace.mjs gate --tag <draft>#<n>` right before sending (waits a random time; run it, do not skip).
10. Send: button "Bắt đầu tạo" (Start generation). Do not wait in place; a cover renders in ~40 s, an extra in 30-60 s.
11. Extras (n>=2, same post): fastest = open the cover's detail page (click its thumbnail, URL ends `/edit/<media-id>`), type the album prompt in the bottom box there (image 1 is already the context; the chip shows it) and send. Alternative: back to the project grid (`/project/<id>`), click the bottom box, "+" > click the thumbnail named like the cover ("Edit product photo ...") > "Thêm vào câu lệnh" > send (~25 s each). Navigating by URL beats clicking back.
12. Result tiles: `main img[alt="Ô hiển thị hình ảnh của người dùng"]` or `img[data-media-id="<id>"]` (use `.click({force:true})`); list ids with `evaluateAll`. Newest tile is first. Open one: the detail view shows the prompt text, use it to match tile to draft/n.
13. Download: button "Tải nội dung nghe nhìn xuống" top right > menuitem "1K Kích thước gốc" ("Original size"). Wait 4-6 s. Chrome saves `<Flow title>_<id8>.jpg` in Downloads: `ls -t C:/Users/Admin/Downloads/*.jpg | head`; the id8 equals the start of the tile's media id.
14. LOOK at the file (Read), then `register-image --id <draft> --n <k> --from <file>` (or `register-batch`). ~5 s.

## Hay vướng / Pitfalls
- Typed in the project title: the first `role=textbox` is the title; use the named bottom box (step 6).
- `page.waitForEvent('download')` + `d.saveAs(...)` timed out (30 s) in the headless profile: click the menuitem natively (a `pw_snapshot` ref or `getByText('Kích thước gốc')`) and take the newest file from Downloads (step 13).
- Download button not found by `name:/download/` in the Vietnamese UI: use `name:'Tải nội dung nghe nhìn xuống'`.
- File chooser refused `C:\Users\Admin\Downloads\...`: copy into `.playwright-mcp` first (step 7).
- A reference picked after the picker closed: `Add to prompt` button missing; redo "+" > item > "Thêm vào câu lệnh" step by step and check the chip.
- Send does nothing / button disabled: the box is empty or a dialog is open; check the screenshot.
- "Hoạt động bất thường" (unusual activity) on the first prompt: Flow blocked the account (seen once on the very first prompt of a run): stop and report, do not retry.
- A cover or extra cuts off the sign text or shows the wrong name: redo that image once with a sharper prompt ("show the full text"); not a reason to stop the run.
