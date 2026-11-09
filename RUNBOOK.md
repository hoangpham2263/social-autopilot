# RUNBOOK: một vòng social-autopilot

Scripts + RUNBOOK là nguồn duy nhất của quy trình. Người dùng quản lý trong **app** (`start-app.cmd` / `start-app.command`): duyệt/bỏ, sửa social.json, đưa ảnh lên, cài đặt; app gọi đúng các hàm script dưới đây và đọc dữ liệu mới mỗi lần mở. Agent làm cùng việc qua script hoặc chat.

Dành cho agent (Claude Code scheduled task/routine, Codex/ChatGPT automation) được gọi theo lịch. Chạy từ thư mục `C:\hoangpq\social-autopilot`. Mọi script in **một JSON** (`ok: true|false`); đọc JSON, không đoán. Script chạy lại không sinh trùng.

Quy tắc cứng:
- Thương hiệu chỉ đến từ `config/settings.json` → `skillsRoot` (mặc định `C:\hoangpq\vaniecom-workspace\skills\`). Mọi thứ riêng của thương hiệu (nguồn tham khảo, kênh, ngôn ngữ đăng và ngôn ngữ chỉ để duyệt, giọng, ảnh gốc) đọc từ thư mục skill của nó. Không hard-code thương hiệu, không trộn nguồn giữa thương hiệu.
- Các thương hiệu chạy **nối tiếp** (một Chrome, một agent).
- Không ghi gì vào thư mục thương hiệu trước khi được duyệt. Không đăng bài ở đâu cả.
- Không dùng ảnh hay câu chữ của đối thủ trong bài; ảnh đưa vào Codex phải là ảnh của chính thương hiệu.
- Gặp lỗi `ok: false` thì ghi lại và chuyển sang thương hiệu/bước tiếp, không lách luật.
- Không bao giờ gắn nhãn AI lên bài ("made with AI", "tạo bằng AI", `#AIgenerated`...): `draft.mjs check` và `metricool-csv.mjs validate` chặn.

## Bước 0. Thương hiệu và nguồn

```
node scripts/brands.mjs          # usable = thương hiệu chạy được; problems/skipped = lý do bỏ qua
node scripts/sources.mjs         # mỗi thương hiệu: các research.sources đang bật trong social.json của nó
```
`usable` rỗng thì báo cáo (bước 6) và dừng.

Lặp **từng thương hiệu trong `usable`**, mỗi lần một thương hiệu, bước 1-5.

## Bước 1. Nghiên cứu (không giới hạn lượt/bài)

```
node scripts/research.mjs start --brand <id>
```
- Không có giới hạn lượt hay số bài (người dùng, 09/11/2026); `start` chạy lại trong ngày được (`reused: true`, cùng thư mục ngày theo múi giờ thương hiệu).
- Với **từng source** trong `run.sources` (chỉ source của thương hiệu này): làm theo `docs/research.md` bằng Playwright, nghỉ `delay_seconds` ngẫu nhiên giữa các thao tác, tải ảnh vào `<source>/raw/`, ghi `<source>/raw.json` (bài của lượt này).
- Gặp checkpoint, captcha, yêu cầu đăng nhập: dừng nghiên cứu ngay, ghi vào báo cáo.

```
node scripts/research.mjs ingest --brand <id>
```
Làm sạch caption (U+034F, ký tự ẩn), nối bài mới vào refs đã có, bỏ trùng (link bài, ảnh), ra `<source>/refs.json`, `refs.csv`, `refs/`. Chỉ nhận file ảnh jpg/png/webp thật nằm trong thư mục source của lượt (`dropped` ghi lý do); file thừa trong `refs/` bị dọn.

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

Dựng cảnh AI bật mặc định cho mọi thương hiệu (chỉ `product_images.ai_scenes_allowed: false` mới tắt); không bao giờ gắn nhãn AI lên bài. Logo không bao giờ nằm trên sản phẩm (prompt có lệnh NO LOGO; `draft.mjs check` cảnh báo nếu prompt thiếu).

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
   Lệnh thật: `codex exec --skip-git-repo-check -s workspace-write - -i <ảnh sản phẩm> [-i <ảnh không khí>] < prompt.txt`. Ngay sau đó tool tự làm sạch metadata bằng **remove-watermark-skill** (provider `chatgpt` cho ảnh Codex): `image-generated.png` là ảnh gốc của Codex (không sửa), `image.png` là bản sạch dùng cho bài, `image-clean-report.json` là report. Chỉ bỏ metadata (C2PA, EXIF, XMP, text); điểm ảnh giữ nguyên; ảnh vẫn là ảnh AI (catalog ghi `ai_disclosure` chỉ để lưu vết, không gắn nhãn AI lên bài). Không bao giờ nói đã qua được nhận diện AI. Chạy lại riêng: `node scripts/image-clean.mjs --id <draft>`. Hết hạn mức Codex thì dừng tạo ảnh, ghi vào báo cáo.
4. Xem `image.png`: sản phẩm giữ y hệt, đúng chữ, không logo/watermark lạ. Không đạt: sửa prompt, `draft.mjs image --id <draft> --force` (tối đa 2 lần).
5. Chỉ khi social.json `product_images.watermark.enabled: true`: `node scripts/draft.mjs watermark --id <draft>` (logo nhỏ ở góc, cần ffmpeg; sau đó ảnh được làm sạch lại).
6. Scene-swap: so `image.png` với ảnh gốc của shop; khi chắc không còn tên shop, logo, watermark, nhãn size, số điện thoại: `node scripts/draft.mjs confirm-clean --id <draft> --by "<tên>"`. Còn thì sửa prompt, tạo lại.
7. Viết caption theo `brief.md` (dùng SKILL.md mục A và project.md của thương hiệu), mỗi ngôn ngữ một file `content-<lang>.txt` trong thư mục nháp: ngôn ngữ đăng (`channels[].lang`) và ngôn ngữ chỉ để duyệt (`language_policy.review_langs`, vd `content-vn.txt`; không bao giờ đăng). Không nhắc tên shop nguồn, không nhãn AI.
8. `node scripts/draft.mjs check --id <draft>` → `awaiting_approval`, hoặc sửa theo `problems` rồi check lại. Check không đạt khi ảnh chưa sạch metadata hay điểm ảnh bị đổi, chưa chèn watermark mà thương hiệu bật, scene-swap chưa xác nhận sạch logo hoặc caption có tên shop.

## Bước 4. Duyệt (trong chat)

Bước 6 đưa danh sách chờ duyệt cho người. Khi người duyệt nói "duyệt <id>" / "approve <id>":
```
node scripts/approve.mjs approve --id <draft> [--by "<tên>"] [--note "..."]
```
Không có người duyệt đích danh: người trả lời trong chat/app là người duyệt; `--by` chỉ ghi vết (mặc định `user`). "Bỏ <id>, lý do ..." (bắt buộc có lý do; bản đã bỏ không bỏ lại):
```
node scripts/approve.mjs reject --id <draft> --note "<lý do>" [--by "<tên>"]
```
Người có thể sửa tay `status.json` của bản nháp (`"status": "approved"` hoặc `"rejected"`, kèm `"note"`; bỏ thì phải có lý do); đầu mỗi vòng chạy:
```
node scripts/approve.mjs sync
```
Sửa tay sai luật thì bản nháp trở về trạng thái tool đặt lần cuối, kèm `error`.
Người duyệt cũng có thể bấm Duyệt/Bỏ trong app (tab Bản nháp; cùng luật, cùng hàm). Không tự duyệt thay người.

## Bước 5. Ghi vào thương hiệu

`approve` tự gọi `writeback.mjs`: làm sạch lại nếu cần (remove-watermark-skill; rồi `scripts/clean-image.mjs` của skill chỉ khi `--check` chưa báo SẠCH), tạo `workspace/posts/POST-<slug>/` (image.png, `content-<lang>.txt`), thêm một mục `approved` vào `workspace/catalog.json` (`captions` = ngôn ngữ đăng; `review_captions` = ngôn ngữ chỉ để duyệt), rồi chạy `scripts/check-post.mjs` của skill. Ghi lỗi thì chạy lại `node scripts/writeback.mjs --id <draft>`.

### Bước 5b. Host ảnh/video (sau khi duyệt)

Metricool lấy ảnh/video qua link công khai, nên media của bài **đã duyệt** được đẩy lên repo công khai `C:\hoangpq\social-autopilot-sources` (settings `imageHost`, `type: "github-repo"`), phục vụ qua GitHub Pages `imageHost.pagesBase` = `https://hoangpham.is-a.dev/social-autopilot-sources` (đúng MIME `video/mp4`, `image/png`, hỗ trợ Range). `rawBase` (raw.githubusercontent.com) chỉ là dự phòng cho ảnh: raw trả `application/octet-stream` cho `.mp4` nên video không bao giờ dùng link raw. `approve` / `writeback` / app tự chạy bước này ngay sau khi ghi vào thương hiệu (`imageHost.auto_after_writeback`). Chạy tay hoặc chạy lại:
```
node scripts/host-image.mjs publish --brand <id> --post POST-xx [--video]
```
- Chỉ nhận bài có trạng thái `approved`/`scheduled`/`published` trong `catalog.json` của thương hiệu; không bao giờ bản nháp hay ảnh tham khảo của đối thủ.
- Ảnh: kiểm lại không còn metadata (`image-clean` + `clean-image.mjs --check` của skill), chép vào `<brand>/<yyyy>/<mm>/<post-id>.<ext>`, commit "`<brand> <post-id>`", push; kiểm link raw trước (vài giây) và ghi ngay `media_url` = link raw, rồi chờ Pages (tối đa `verify.attempts` x `delay_seconds`, ~3 phút) trả 200 đúng nội dung + `image/*` thì đổi `media_url` sang link Pages. Pages chưa xong thì giữ link raw (`fallback` trong JSON); chạy lại publish sau để đổi sang Pages.
- Video (catalog `video`, vd bài `VID-`, hoặc file `.mp4`; `--video` bắt buộc phải có): chép `<post-id>.mp4` (+ ảnh bìa `<post-id>-thumb.png` nếu bài có ảnh), chờ link Pages trả 200 + `Content-Type: video/mp4`, rồi ghi `video_url` (+ `video_thumbnail_url`). `metricool-csv.mjs` đọc các trường này.
- Sau khi duyệt, bước host trả về nhanh (push + kiểm ngắn): ảnh có ngay link raw; phần chậm (đổi sang Pages, hoặc video) chạy nền. Mọi kết quả, kể cả lỗi (+ lệnh `next` để chạy lại), đều được ghi vào `image_host` trong `status.json` của bản nháp.
- `image_host.ok: false` không huỷ việc duyệt: ghi lỗi vào báo cáo, chạy lại lệnh trong `image_host.next` sau vài phút.
- Trong app: bài đã duyệt hiện link ảnh, hoặc "chưa có link" và nút "Đưa ảnh lên" (cùng lệnh publish).
- Chỉ gỡ file khi bài đã ở trạng thái `published` (Metricool không chép media ngoài; bài vẫn trỏ về link host, gỡ sớm là mất ảnh/video): `node scripts/host-image.mjs remove --brand <id> --post POST-xx` (commit + push xoá file, bỏ `media_url`/`video_url`/`video_thumbnail_url`). Bài chưa `published` thì lệnh từ chối; `--force` gỡ bất chấp và in cảnh báo. Không gỡ ngay sau khi nhập CSV.
- Chỉ đẩy file lên repo ảnh; không đăng, không gửi gì tới Metricool hay mạng xã hội.

**Metricool**: chưa gửi gì; chỉ có phụ lục CSV bên dưới (người nhập thủ công). Không đăng, không hẹn giờ ở đâu.

## Bước 6. Báo cáo

```
node scripts/queue.mjs
```
Gửi người dùng một tin ngắn, mỗi thương hiệu:
- nghiên cứu: đã lấy bao nhiêu bài / dừng vì checkpoint;
- **chờ duyệt**: mỗi bản `id`, đường dẫn `image`, caption đăng từng ngôn ngữ (`captions`, nguyên văn) và bản chỉ để duyệt (`review_captions`, ghi rõ "không đăng"), ý + link bài tham khảo; bản scene-swap thì kèm đường dẫn ảnh gốc của shop (`reference_image`) để người duyệt xem hai ảnh cạnh nhau; cách trả lời: "duyệt <id>" hoặc "bỏ <id>: lý do";
- đã duyệt và ghi vào thương hiệu (POST-xx, thư mục, link ảnh `media_url` hoặc "chưa có link" kèm lỗi host);
- lỗi cần người xử lý (Codex hết lượt, ảnh không đạt, host ảnh lỗi).

## Bước 7. Kết thúc vòng

Không dựng trang nào: app đọc dữ liệu mới mỗi lần mở. Kể cả khi vòng dừng sớm, nhắc người dùng mở app (nhấp đúp `start-app.cmd`, Mac: `start-app.command`) để duyệt/bỏ, hoặc trả lời trong chat.

## Phụ lục: xuất CSV cho Metricool (không import)

```
node scripts/metricool-csv.mjs export --brand <id> [--posts POST-01,POST-02] [--draft] [--lang en] [--date YYYY-MM-DD --time HH:MM] --out <file.csv>
node scripts/metricool-csv.mjs validate <file.csv> [--brand <id>] [--allow-today] [--check-urls]
```
- Chỉ bài `approved` có `media_url` (chuỗi hoặc mảng, tối đa 10) hoặc `video_url`. Đúng 99 cột theo `docs/metricool-csv-template.csv`. Không ghi vào thư mục thương hiệu, không gửi gì tới Metricool.
- `Brand name` = `social.json metricool.brand_name` (nhãn đúng trong Metricool, vd `Dreamy Vows`); giờ theo `metricool.timezone` (timezone của brand trong Metricool), giờ lấy từ catalog `schedule {date, time}`, `--date/--time`, `cadence.slots` (nếu có), hoặc **tự động** khi `slots` trống: rải `posts_per_week` vào ngày/giờ tốt của mạng (bảng ở `docs/metricool.md`), mỗi ngày tối đa một bài của thương hiệu.
- Chỉ ngôn ngữ đăng vào CSV; `--lang` với ngôn ngữ chỉ để duyệt bị từ chối. Text có nhãn AI bị từ chối.
- `validate` báo lỗi theo từng dòng và exit 1 khi có bất kỳ lỗi nào (Metricool sẽ nhập tất cả thành nháp, ngày sai thành "hôm nay giờ hiện tại"). Link ảnh WebP (`.webp`, `format=webp`/`fm=webp`...; với `--check-urls` cả content-type `image/webp`) bị từ chối.
- Metricool không chép ảnh ngoài: file trên repo ảnh phải còn đến khi bài đã đăng (xem bước 5b về `remove`).
