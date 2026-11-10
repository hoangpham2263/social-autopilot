# social-autopilot: thiết kế (v0.3, hai chế độ + duyệt trong app)

Các quyết định của người dùng dưới đây thắng mọi chỗ khác. Quy trình chi tiết: `RUNBOOK.md`. Tool phải chạy được trên mọi máy và mọi tài khoản Metricool: không đường dẫn tuyệt đối, không id tài khoản/blogId/thương hiệu cố định trong code hay tài liệu (tên thương hiệu chỉ là ví dụ).

## 1. Hai chế độ + app

| Phần | Ai chạy | Gồm |
|---|---|---|
| **Mode 1: Research only** | Claude Code hoặc Codex + Chrome đã đăng nhập Facebook (cổng `--remote-debugging-port`), chạy riêng, vd mỗi tuần | `research.mjs start` → `crawl-fb.mjs` crawl hết bằng script, tự `ingest` (bỏ trùng) + `result` → agent lọc một lượt (`store.mjs classify` / `verdict`) → `report`. Crawl tay bằng Playwright MCP chỉ dự phòng. Không ý/bài |
| **Mode 2: Create & publish** | Claude Code hoặc Codex khi người dùng bảo (ChatGPT chỉ gửi bài đã duyệt từ JSON payload); không mở Facebook | `getBrandSettings` → `sync-brands` → `payload` → `createScheduledPost` (hẹn giờ thật) → `record` → `status`/`getScheduledPosts` → `ideas.mjs` → `draft.mjs` (ảnh Codex, caption) → `check` → **To review**, dừng → `queue.mjs` |
| **App** | Người dùng | Overview (brand Metricool ↔ skill), Library, Posts (Approve / Drop), Prompt, Settings |

- Prompt ở tab Prompt ngắn 5-10 dòng, chỉ chế độ, thương hiệu, tuỳ chọn và "follow RUNBOOK.md Mode N"; mọi bước ở RUNBOOK.
- Trạng thái người dùng thấy: To review → Queued → Posted; lỗi hiện dấu đỏ.
- Hai agent hoặc agent và app có thể chồng nhau: mọi đọc-sửa-ghi file chung có khoá và ghi nguyên tử.

## 2. Thương hiệu
- Thương hiệu = một brand trong tài khoản Metricool (đồng bộ bằng `sync-brands` vào `workspace/metricool-brands.json`) trỏ tới một thư mục skill chuẩn (`SKILL.md`, `project/project.md`, `project/social.json`). Skill **không bao giờ được chép**: tool đọc/ghi thẳng thư mục đã trỏ (`skill_path`).
- Overview: Choose skill (tìm trong thư mục nguồn, mặc định `skillsRoot`, sâu 2 tầng, mỗi thư mục kèm trạng thái sẵn sàng), Change skill, Disconnect (chỉ bỏ liên kết). Sẵn sàng = `enabled: true` + `scripts/check-skill.mjs --tool-ready` của skill đạt.
- Brand chỉ được gửi bài khi đã trỏ tới một skill dùng được; brand chưa trỏ skill thì không.
- Dữ kiện thương hiệu chỉ nằm trong skill: `research.sources[]`, `research.fb_account`, `channels[]`, `language_policy`, `product_images`, `caption_rules`, `cadence`, `metricool`.

## 3. Kho nghiên cứu (`workspace/store/<brand>/`)
- `items.json` (`S0001`..., caption đã lọc ký tự ẩn, ảnh, hash, `status: new|used|rejected`), `progress.json`, `duplicates.json`, `ideas.json`.
- Bỏ trùng trên cả kho: link/mã bài Facebook (cả `alt_urls`), SHA-1 ảnh, ảnh gần giống (dHash, `scripts/phash.mjs`), caption giống hệt hoặc ≥ 90%. Ngưỡng ở `settings.research.dedupe`.
- Tăng dần: lần sau dừng khi gặp 3 bài liên tiếp đã có (trừ `--full`); `--backfill` lấy bài cũ hơn bài cũ nhất đã có; `--since`, `--max-posts` khi người dùng chọn.
- Người dùng xem kho ở tab Library, "Bỏ" bài không muốn dùng.

## 3b. Kiểm tra tự động + duyệt bởi người
Trạng thái bản nháp: `needs_prompt` → `generating` → `needs_caption` / `image_failed` → `ready` (**To review**) → `approved` (Approve trong app: `finalize.mjs approve --id <draft>`) | `check_failed` | `rejected` (Drop). Kiểm: ảnh sạch metadata, đủ caption, dòng Website + hashtag cố định, không Markdown/ký tự ẩn, không chép caption tham khảo, không nhãn AI, NO LOGO, watermark nếu bật, scene-swap đã xác nhận sạch logo; sau khi ghi: `check-post.mjs` của skill. Approve là đường duy nhất ghi bài vào skill; agent không bao giờ tự duyệt.

## 4. Luật ảnh
- Ảnh sản phẩm là ảnh của chính thương hiệu; ảnh không khí không được là ảnh tham khảo. Dựng cảnh AI bật mặc định (`ai_scenes_allowed: false` mới tắt).
- **Không bao giờ nhãn AI** lên bài. **Không logo trên sản phẩm**: prompt có NO LOGO; logo chỉ là watermark nhỏ ở góc khi `product_images.watermark.enabled`.
- Scene-swap (opt-in `product_images.reference_redraw.enabled`): chỉ đổi cảnh, xoá logo/watermark/nhãn size/số điện thoại của shop, bắt `--brand-can-produce` và `confirm-clean`, caption không tên shop.
- Metadata: `settings.remove_watermark.script` (đường dẫn tương đối) chạy sau Codex, sau watermark, trước writeback; chỉ bỏ metadata, không EXIF giả.

## 5. Host ảnh
- Repo **công khai** `social-autopilot-sources` (clone trong tool ở `imageHost.path`, mặc định `workspace/image-host`; tự clone từ `imageHost.remote_url` khi chưa có). Link raw GitHub: `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<brand>/<yyyy>/<mm>/<post-id>.<ext>` (`imageHost.rawBase`). Không dùng tên miền riêng/cá nhân.
- Chỉ media của bài đã duyệt; không bao giờ bản nháp hay ảnh đối thủ. Commit, push, chờ HTTP 200, ghi `media_url`. Lỗi host không huỷ bài.
- Raw trả `.mp4` là `application/octet-stream`. Qua MCP, Metricool chép media về kho của nó nên video nên vẫn được, nhưng **chưa test**.
- Chỉ gỡ file khi bài đã đăng (`host-image.mjs remove`).

## 6. Metricool
- Đường chính: MCP chính thức `https://ai.metricool.com/mcp` qua tool của agent (connector claude.ai "Metricool"; Codex `codex mcp add metricool --url https://ai.metricool.com/mcp` + `codex mcp login metricool`; connector ChatGPT từ JSON payload). Gói không cần REST API.
- Luôn bài **hẹn giờ thật** ở giờ slot của brand, không bao giờ nháp. Bài đã gửi không gửi lại; đối chiếu bằng `getScheduledPosts`.
- Dự phòng: `metricool-csv.mjs export|validate` (người tự import). Chi tiết: `docs/metricool.md`, `docs/metricool-mapping.md`.

## 7. Rủi ro

| Rủi ro | Mức | Cách giảm |
|---|---|---|
| Điều khoản Meta cấm thu thập dữ liệu tự động khi chưa được phép (https://developers.facebook.com/docs/development/terms-and-policies/automated-data-collection/) | Cao | Người dùng chấp nhận. Research chạy riêng, thưa, tăng dần, nhịp như người, dừng ở checkpoint, tài khoản phụ. |
| Bản quyền ảnh, caption; scene-swap tăng rủi ro bị báo cáo | Cao | Ảnh đối thủ chỉ trong `workspace/`. Ý trừu tượng, chặn chép chữ. Scene-swap tắt mặc định, bắt xác nhận đã xoá logo. |
| Bài hẹn giờ thật tự đăng | Trung bình | Người dùng duyệt từng bài (Approve); kiểm tra tự động + check-post trước khi gửi; brand chưa trỏ skill không được gửi. |
| Link raw không còn trước giờ đăng | Thấp | Chỉ gỡ file sau khi bài đã đăng. |
| Hạn mức Codex | Thấp | `image_failed` ghi lý do; lượt sau làm tiếp. |

**Không tự đăng được qua Metricool** (https://help.metricool.com/en/article/schedule-and-post-on-instagram-1xovmji/, https://help.metricool.com/pt/api-limitations-per-social-network-n7zlr)
- IG: tài khoản cá nhân; Story có link/sticker; Reel có nhạc ngoài thư viện; carousel có video trên 60 giây.
- FB: đăng vào Group.
- TikTok: xuống dòng, Story.
