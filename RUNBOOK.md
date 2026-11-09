# RUNBOOK: một vòng social-autopilot

Scripts + RUNBOOK là nguồn duy nhất của quy trình. Giao diện duy nhất là `dashboard.html` tĩnh, chỉ xem, dựng lại ở bước 7; mọi thao tác quản lý (duyệt, bỏ, sửa social.json) làm qua chat hoặc script.

Dành cho agent (Claude Code scheduled task/routine, Codex/ChatGPT automation) được gọi theo lịch. Chạy từ thư mục `C:\hoangpq\social-autopilot`. Mọi script in **một JSON** (`ok: true|false`); đọc JSON, không đoán. Script chạy lại không sinh trùng.

Quy tắc cứng:
- Thương hiệu chỉ đến từ `config/settings.json` → `skillsRoot` (mặc định `C:\hoangpq\vaniecom-workspace\skills\`). Mọi thứ riêng của thương hiệu (nguồn tham khảo, kênh, ngôn ngữ, người duyệt, giọng, ảnh gốc) đọc từ thư mục skill của nó. Không hard-code thương hiệu, không trộn nguồn giữa thương hiệu.
- Các thương hiệu chạy **nối tiếp** (một Chrome, một agent).
- Không ghi gì vào thư mục thương hiệu trước khi được duyệt. Không đăng bài ở đâu cả.
- Không dùng ảnh hay câu chữ của đối thủ trong bài; ảnh đưa vào Codex phải là ảnh của chính thương hiệu.
- Gặp lỗi `ok: false` thì ghi lại và chuyển sang thương hiệu/bước tiếp, không lách giới hạn.

## Bước 0. Thương hiệu và nguồn

```
node scripts/brands.mjs          # usable = thương hiệu chạy được; problems/skipped = lý do bỏ qua
node scripts/sources.mjs         # mỗi thương hiệu: các research.sources đang bật trong social.json của nó
```
`usable` rỗng thì báo cáo (bước 6) và dừng.

Lặp **từng thương hiệu trong `usable`**, mỗi lần một thương hiệu, bước 1-5.

## Bước 1. Nghiên cứu (giới hạn trong code)

```
node scripts/research.mjs start --brand <id>
```
- `ok: false` vì giới hạn (`limits`): bỏ qua nghiên cứu hôm nay, sang bước 2 với lượt cũ (nếu có).
- `reused: true`: lượt hôm nay đã mở; làm tiếp những source chưa có `raw.json`.
- Với **từng source** trong `run.sources` (chỉ source của thương hiệu này): làm theo `docs/research.md` bằng Playwright, lấy tối đa `max_posts` bài, nghỉ `delay_seconds` ngẫu nhiên giữa các thao tác, tải ảnh vào `<source>/raw/`, ghi `<source>/raw.json`.
- Gặp checkpoint, captcha, yêu cầu đăng nhập: dừng nghiên cứu ngay, ghi vào báo cáo.

```
node scripts/research.mjs ingest --brand <id>
```
Làm sạch caption (U+034F, ký tự ẩn), bỏ trùng, cắt theo giới hạn, ra `<source>/refs.json`, `refs.csv`, `refs/`.

## Bước 2. Ý tưởng

```
node scripts/ideas.mjs init --brand <id>
```
Với từng ý `todo`: xem `ref_image` + caption, đọc `project/project.md` của thương hiệu, điền theo `prompts/idea-abstract.md`:
```
node scripts/ideas.mjs set --brand <id> --id I01 --json "{\"product_type\":\"...\",\"scene\":\"...\",\"angle\":\"...\",\"props\":\"...\",\"caption_structure\":\"...\",\"hook\":\"...\",\"why\":\"...\"}"
```
Không hợp thương hiệu: `ideas.mjs reject --id I01 --note "<lý do>"`. Chọn **tối đa 1 ý mỗi vòng** cho thương hiệu mới bật (thử 1 bài trước), tối đa `cadence.posts_per_week` của social.json khi đã quen: `ideas.mjs pick --id I01`.

## Bước 3. Bản nháp

Chỉ khi `product_images.ai_scenes_allowed: true`. Logo không bao giờ nằm trên sản phẩm (prompt có lệnh NO LOGO; `draft.mjs check` cảnh báo nếu prompt thiếu).

1. Chọn ảnh sản phẩm. Mặc định (`brand-image`): ảnh **của thương hiệu**, trong thư mục skill hoặc thư mục ở `product_images.sources`. Ảnh không khí (tuỳ chọn) không được là ảnh tham khảo.
   ```
   node scripts/draft.mjs new --brand <id> --idea <date>/I01 --product "<ảnh của thương hiệu>" [--scene "<ảnh không khí>"]
   ```
   **Scene-swap** (chỉ khi social.json `product_images.reference_redraw.enabled: true`; người dùng đã chấp nhận rủi ro bản quyền/bị báo cáo): ảnh tham khảo của chính thương hiệu này làm ảnh sản phẩm, chỉ đổi cảnh, xoá mọi logo/watermark/nhãn size/số điện thoại của shop. Chỉ với sản phẩm thương hiệu làm được (project.md mục 5):
   ```
   node scripts/draft.mjs new --brand <id> --idea <date>/I01 --ref-image "<workspace/runs/<id>/<date>/<source>/refs/R01-....jpg>" --brand-can-produce
   ```
2. Mở `prompt.txt` trong thư mục nháp, thay `{{PRODUCT_DESCRIPTION}}` bằng mô tả đúng sản phẩm nhìn thấy trong ảnh (chữ từng ký tự, dấu, font, màu, vật liệu, tỉ lệ). Không xoá các dòng NO LOGO.
3. Tạo ảnh (Codex CLI, mất vài phút):
   ```
   node scripts/draft.mjs image --id <draft>
   ```
   Lệnh thật: `codex exec --skip-git-repo-check -s workspace-write - -i <ảnh sản phẩm> [-i <ảnh không khí>] < prompt.txt`. Ngay sau đó tool tự làm sạch metadata bằng **remove-watermark-skill** (provider `chatgpt` cho ảnh Codex): `image-generated.png` là ảnh gốc của Codex (không sửa), `image.png` là bản sạch dùng cho bài, `image-clean-report.json` là report. Chỉ bỏ metadata (C2PA, EXIF, XMP, text); điểm ảnh giữ nguyên; ảnh vẫn là ảnh AI và vẫn khai báo AI. Không bao giờ nói đã qua được nhận diện AI. Chạy lại riêng: `node scripts/image-clean.mjs --id <draft>`. Hết hạn mức Codex thì dừng tạo ảnh, ghi vào báo cáo.
4. Xem `image.png`: sản phẩm giữ y hệt, đúng chữ, không logo/watermark lạ. Không đạt: sửa prompt, `draft.mjs image --id <draft> --force` (tối đa 2 lần).
5. Chỉ khi social.json `product_images.watermark.enabled: true`: `node scripts/draft.mjs watermark --id <draft>` (logo nhỏ ở góc, cần ffmpeg; sau đó ảnh được làm sạch lại).
6. Scene-swap: so `image.png` với ảnh gốc của shop; khi chắc không còn tên shop, logo, watermark, nhãn size, số điện thoại: `node scripts/draft.mjs confirm-clean --id <draft> --by "<tên>"`. Còn thì sửa prompt, tạo lại.
7. Viết caption theo `brief.md` (dùng SKILL.md mục A và project.md của thương hiệu), mỗi ngôn ngữ một file `content-<lang>.txt` trong thư mục nháp. Không nhắc tên shop nguồn.
8. `node scripts/draft.mjs check --id <draft>` → `awaiting_approval`, hoặc sửa theo `problems` rồi check lại. Check không đạt khi ảnh chưa sạch metadata hay điểm ảnh bị đổi, chưa chèn watermark mà thương hiệu bật, scene-swap chưa xác nhận sạch logo hoặc caption có tên shop.

## Bước 4. Duyệt (trong chat)

Bước 6 đưa danh sách chờ duyệt cho người. Khi người duyệt nói "duyệt <id>" / "approve <id>":
```
node scripts/approve.mjs approve --id <draft> --by "<tên người duyệt>" [--note "..."]
```
`--by` phải là `approval.owner` trong social.json của thương hiệu, nếu không script từ chối. "Bỏ <id>, lý do ...":
```
node scripts/approve.mjs reject --id <draft> --by "<tên>" --note "<lý do>"
```
Người có thể sửa tay `status.json` của bản nháp (`"status": "approved"` hoặc `"rejected"`, kèm `"by"`, `"note"`); đầu mỗi vòng chạy:
```
node scripts/approve.mjs sync
```
Dashboard chỉ để xem, không có nút duyệt; người duyệt trả lời trong chat. Không tự duyệt thay người.

## Bước 5. Ghi vào thương hiệu

`approve` tự gọi `writeback.mjs`: làm sạch lại nếu cần (remove-watermark-skill; rồi `scripts/clean-image.mjs` của skill chỉ khi `--check` chưa báo SẠCH), tạo `workspace/posts/POST-<slug>/` (image.png, `content-<lang>.txt`), thêm một mục `approved` vào `workspace/catalog.json`, rồi chạy `scripts/check-post.mjs` của skill. Ghi lỗi thì chạy lại `node scripts/writeback.mjs --id <draft>`.

### Bước 5b. Host ảnh (sau khi duyệt)

Metricool lấy ảnh qua link công khai, nên ảnh của bài **đã duyệt** được đẩy lên repo công khai `C:hoangpqsocial-autopilot-sources` (settings `imageHost`, `type: "github-repo"`). `approve` / `writeback` tự chạy bước này ngay sau khi ghi vào thương hiệu (`imageHost.auto_after_writeback`); kết quả nằm trong `image_host` của JSON. Chạy tay hoặc chạy lại:
```
node scripts/host-image.mjs publish --brand <id> --post POST-xx
```
- Chỉ nhận bài có trạng thái `approved`/`scheduled`/`published` trong `catalog.json` của thương hiệu; không bao giờ bản nháp hay ảnh tham khảo của đối thủ.
- Kiểm lại ảnh không còn metadata (`image-clean` + `clean-image.mjs --check` của skill), chép vào `<brand>/<yyyy>/<mm>/<post-id>.<ext>`, commit "`<brand> <post-id>`", push, chờ link raw trả HTTP 200 đúng nội dung (thử lại vài lần vì GitHub raw chậm), rồi ghi `media_url` vào mục catalog của bài và chạy `check-post.mjs`.
- `image_host.ok: false` không huỷ việc duyệt: ghi lỗi vào báo cáo, chạy lại lệnh trong `image_host.next` sau vài phút.
- Khi Metricool đã lưu bản riêng của ảnh, có thể gỡ file: `node scripts/host-image.mjs remove --brand <id> --post POST-xx` (commit + push xoá file, bỏ `media_url`).
- Chỉ đẩy file lên repo ảnh; không đăng, không gửi gì tới Metricool hay mạng xã hội.

**Publish (later: Metricool)**: chưa làm. Không đăng, không hẹn giờ ở đâu.

## Bước 6. Báo cáo

```
node scripts/queue.mjs
```
Gửi người dùng một tin ngắn, mỗi thương hiệu:
- nghiên cứu: đã lấy bao nhiêu bài / bị chặn vì giới hạn / dừng vì checkpoint;
- **chờ duyệt**: mỗi bản `id`, đường dẫn `image`, caption từng ngôn ngữ (nguyên văn), ý + link bài tham khảo; bản scene-swap thì kèm đường dẫn ảnh gốc của shop (`reference_image`) để người duyệt xem hai ảnh cạnh nhau; cách trả lời: "duyệt <id>" hoặc "bỏ <id>: lý do";
- đã duyệt và ghi vào thương hiệu (POST-xx, thư mục, link ảnh `media_url` hoặc "chưa có link" kèm lỗi host);
- lỗi cần người xử lý (thiếu owner, Codex hết lượt, ảnh không đạt).

## Bước 7. Dựng lại dashboard

```
node scripts/dashboard.mjs
```
Ghi lại `dashboard.html` (tĩnh, chỉ xem) từ `workspace/` và thư mục skill; không sửa gì khác. Chạy cả khi vòng dừng sớm, và sau mỗi lần duyệt/bỏ trong chat. Nhắc người dùng nhấp đúp `dashboard.html` (hoặc `open-dashboard.cmd`) để xem.
