# RUNBOOK: một vòng social-autopilot

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

1. Chọn ảnh sản phẩm **của thương hiệu**, trong thư mục skill (theo `product_images.sources` của social.json, thường `project/sources/...`); chỉ khi `product_images.ai_scenes_allowed: true`. Ảnh không khí (tuỳ chọn) không được là ảnh tham khảo.
   ```
   node scripts/draft.mjs new --brand <id> --idea <date>/I01 --product "<ảnh của thương hiệu>" [--scene "<ảnh không khí>"]
   ```
2. Mở `prompt.txt` trong thư mục nháp, thay `{{PRODUCT_DESCRIPTION}}` bằng mô tả đúng sản phẩm nhìn thấy trong ảnh (chữ từng ký tự, dấu, font, màu, vật liệu, tỉ lệ).
3. Tạo ảnh (Codex CLI, mất vài phút):
   ```
   node scripts/draft.mjs image --id <draft>
   ```
   Lệnh thật: `codex exec --skip-git-repo-check -s workspace-write - -i <ảnh thương hiệu> [-i <ảnh không khí>] < prompt.txt`. Hết hạn mức thì dừng tạo ảnh, ghi vào báo cáo.
4. Xem `image.png`: sản phẩm giữ y hệt, đúng chữ, không logo/watermark lạ. Không đạt: sửa prompt, `draft.mjs image --id <draft> --force` (tối đa 2 lần).
5. Viết caption theo `brief.md` (dùng SKILL.md mục A và project.md của thương hiệu), mỗi ngôn ngữ một file `content-<lang>.txt` trong thư mục nháp.
6. `node scripts/draft.mjs check --id <draft>` → `awaiting_approval`, hoặc sửa theo `problems` rồi check lại.

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
Không tự duyệt thay người.

## Bước 5. Ghi vào thương hiệu

`approve` tự gọi `writeback.mjs`: tạo `workspace/posts/POST-<slug>/` (image.png đã làm sạch metadata bằng `scripts/clean-image.mjs` của skill, `content-<lang>.txt`), thêm một mục `approved` vào `workspace/catalog.json`, rồi chạy `scripts/check-post.mjs` của skill. Ghi lỗi thì chạy lại `node scripts/writeback.mjs --id <draft>`.

**Publish (later: Metricool)**: chưa làm. Không đăng, không hẹn giờ ở đâu.

## Bước 6. Báo cáo

```
node scripts/queue.mjs
```
Gửi người dùng một tin ngắn, mỗi thương hiệu:
- nghiên cứu: đã lấy bao nhiêu bài / bị chặn vì giới hạn / dừng vì checkpoint;
- **chờ duyệt**: mỗi bản `id`, đường dẫn `image`, caption từng ngôn ngữ (nguyên văn), ý + link bài tham khảo; cách trả lời: "duyệt <id>" hoặc "bỏ <id>: lý do";
- đã duyệt và ghi vào thương hiệu (POST-xx, thư mục);
- lỗi cần người xử lý (thiếu owner, Codex hết lượt, ảnh không đạt).
