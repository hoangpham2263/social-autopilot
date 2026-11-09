# social-autopilot – hướng dẫn cho agent

File này là luật chung cho **mọi agent** (Claude Code đọc qua `CLAUDE.md`, Codex đọc trực tiếp; ChatGPT nhận qua prompt). Mọi việc qua các script Node trong `scripts/`: mỗi lệnh `node scripts/...` in một JSON (`ok`), chạy lại không sinh trùng, ghi vết vào `workspace/logs/<ngày>.log`. Không bước nào phụ thuộc một agent cụ thể; chỉ công cụ ngoài khác nhau (trình duyệt cho nghiên cứu, tool MCP Metricool cho bước gửi). **Scripts + `RUNBOOK.md` là nguồn duy nhất của quy trình**; prompt dán sẵn cho từng chế độ × agent ở `docs/scheduled-prompt.md`.

## Hai chế độ (người dùng chốt 09/11/2026), không có bước duyệt
1. **Chỉ nghiên cứu** (chạy riêng, vd mỗi tuần; cần trình duyệt đã đăng nhập Facebook qua Playwright MCP): mỗi nguồn bật của thương hiệu → crawl hết bài (hoặc `--since` / `--max-posts`), tải ảnh, caption, link, ngày → `research.mjs ingest` vào **kho** của thương hiệu (`workspace/store/<brand>/`), bỏ trùng → `result` từng nguồn → `report`. Lần sau dừng ở bài đã có (`stop_rule`, `known.json`) trừ khi `--full`. Không làm ý/bài.
2. **Làm bài & đưa lên** (khi người dùng bảo; không mở Facebook): gửi nốt bài đã xong mà chưa gửi Metricool + đối chiếu (`metricool-mcp.mjs payload/status`) → `ideas.mjs init` (chỉ bài kho `new`, đánh dấu `used`) → `draft.mjs new/image` (ảnh sản phẩm của thương hiệu, hoặc scene-swap nếu bật) → caption (EN đăng, VN chỉ để đọc) → `draft.mjs check` (`ready`) → `finalize.mjs run` (kiểm lại, ghi vào skill: catalog `approved`, `approval.by: "auto"`, `check-post.mjs`; host ảnh) → `metricool-mcp.mjs payload` → tool `createScheduledPost` → `record` → `queue.mjs` báo cáo. Bài nào không qua kiểm tra tự động thì dừng riêng bài đó (`check_failed` / `blocked`), bài khác đi tiếp. Agent không có tool Metricool: báo rõ, để bài lại cho lượt sau.

Người dùng chỉ xem và quản lý trong **app** (`start-app.cmd` Windows / `start-app.command` macOS → `src/server.mjs` + `ui/index.html`): Tổng quan, Kho (lọc, "Bỏ" bài kho), Bài đã tạo (xem trước EN/VN, trạng thái kiểm tra, link ảnh, Metricool; "Bỏ" tuỳ chọn trước khi ghi), Prompt (chép prompt theo chế độ × agent × thương hiệu), Cài đặt (social.json từng thương hiệu, cài đặt tool). App không chạy bước nào của quy trình và không có logic riêng: chỉ gọi hàm của `scripts/`.

## Nguyên tắc
- **Thương hiệu chỉ từ `skillsRoot`** (`config/settings.json`, mặc định `../vaniecom-workspace/skills`). Một thương hiệu = một thư mục skill chuẩn có `SKILL.md`, `project/project.md`, `project/social.json`. Chạy được khi `enabled: true` và `scripts/check-skill.mjs --tool-ready` của chính skill exit 0.
- **Mọi thứ riêng thương hiệu đọc từ thư mục skill**: `research.sources[]`, `channels[]`, `language_policy` (`mode`, `review_langs`), `product_images` (`sources`, `ai_scenes_allowed`, `watermark`, `reference_redraw`), `caption_rules`, `cadence` (`posts_per_week`, `timezone`, `slots` tuỳ chọn), `metricool`. Tên trường theo `project-skill-standard/README.md`, mục "Khai báo social". Khối `approval` cũ (nếu còn) bị bỏ qua. Tool không chứa nguồn, kênh hay dữ kiện thương hiệu nào.
- **Một quy trình cho mọi thương hiệu**, không nhánh code theo thương hiệu. Thương hiệu chạy nối tiếp; nguồn và kho không trộn giữa thương hiệu.
- **Kho nghiên cứu** (`scripts/store.mjs`): `items.json` (id `S0001`, `source_id`, `post_url`, `alt_urls`, `post_ids`, `captured`, `posted_date`, `caption`, `images[]`, `image_sha1[]`, `image_phash[]`, `caption_hash`, `status: new|used|rejected`, `used_by`), `images/`, `progress.json` (từng nguồn: lần cuối, `reached_end`, bị chặn), `duplicates.json`, `ideas.json`. Lượt crawl theo ngày ở `workspace/runs/<brand>/<date>/` chỉ là nhật ký (`run.json`, `known.json`, `raw.json`, `raw/`, `ingest.json`). Dữ liệu cũ: `store.mjs migrate`.
- **Không bao giờ lưu trùng** (người dùng): `ingest` bỏ bài trùng với cả kho của thương hiệu theo link/mã bài Facebook (cả `alt_urls`), SHA-1 ảnh, ảnh gần giống (dHash, `scripts/phash.mjs`, `research.dedupe.image_distance`), caption giống hệt hoặc ≥ `research.dedupe.caption_similarity`; mỗi bài trùng ghi vào `duplicates.json` kèm bài khớp và luật; báo cáo "x bài trùng bỏ qua". Agent bỏ qua bài đã có trong `known.json` trước khi tải.
- **Nghiên cứu không giới hạn mặc định**; chỉ giới hạn khi người dùng chọn (`--since`, `--max-posts`). Giữ an toàn hành vi: nghỉ ngẫu nhiên `research.delay_seconds` giữa thao tác; gặp checkpoint/captcha thì dừng ngay (`result --state blocked`).
- **Ngôn ngữ**: ngôn ngữ đăng = `channels[].lang` của kênh bật (`postedLangs(social)`); `language_policy.review_langs` (vd `["vn"]`) chỉ để người đọc (`reviewLangs(social)`): bản nháp viết và kiểm `content-vn.txt`, hiện riêng trong app, catalog ghi `review_captions`, KHÔNG BAO GIỜ vào bài đăng, xem trước phần đăng hay Metricool. DreamyVows và GRENHEIM chỉ đăng tiếng Anh.
- **Không nhãn AI trên bài**: `draft.mjs check`, `finalize.mjs`, `metricool-mcp.mjs payload` và `metricool-csv.mjs validate` chặn caption có nhãn AI (`aiLabelHits` trong `lib.mjs`).
- **Ngày giờ**: `today(tz)` theo múi giờ thương hiệu (`cadence.timezone`), mặc định `Asia/Ho_Chi_Minh`; không dùng ngày UTC.
- **Tham khảo chỉ là cảm hứng** (mặc định `brand-image`): ý trừu tượng (`ideas.mjs` chặn chép 6 từ liền, số điện thoại, link, tên shop); ảnh vào Codex là ảnh của thương hiệu; ảnh không khí không được là ảnh kho/đối thủ; dựng cảnh AI bật mặc định (chỉ `ai_scenes_allowed: false` mới tắt).
- **Scene-swap** (opt-in `product_images.reference_redraw.enabled: true`; người dùng chấp nhận rủi ro bản quyền): `draft.mjs new --ref-image` lấy ảnh trong kho của chính thương hiệu, chỉ đổi cảnh (`prompts/scene-swap.txt`), bắt buộc `--brand-can-produce` khi `only_if_brand_can_produce`; `check` đòi `confirm-clean` (agent xem ảnh: không còn tên shop/logo/watermark/nhãn size/số điện thoại) và chặn caption nhắc tên shop; catalog ghi `image_mode: scene-swap`, `inspiration.source_shop`, `ai_disclosure: true`.
- **Không logo trên sản phẩm**: prompt luôn có lệnh NO LOGO (check cảnh báo nếu thiếu). Logo chỉ là watermark nhỏ ở góc, thêm sau (`draft.mjs watermark`, ffmpeg), chỉ khi `product_images.watermark.enabled`.
- **Làm sạch metadata bằng remove-watermark-skill** (`settings.remove_watermark.script`, provider theo AI: `codex → chatgpt`): ngay sau Codex, sau watermark và trước writeback. `image-generated.png` (gốc) → `image.png` (sạch) + `image-clean-report.json`; check không đạt khi điểm ảnh đổi hay còn chunk metadata. Chỉ metadata, không EXIF giả, chỉ ở máy, không bao giờ nói đã qua nhận diện AI; `ai_disclosure` trong catalog chỉ để lưu vết.
- **Kiểm tra tự động thay cho duyệt**: trạng thái bản nháp `needs_prompt` → `generating` → `needs_caption` (hoặc `image_failed`) → `ready` (qua `draft.mjs check`) → `approved` (sau `finalize.mjs run`: kiểm lại, ghi vào thương hiệu, `brand_post`) | `check_failed` (kiểm lại không qua, có `problems`) | `rejected` (người dùng "Bỏ" trước khi ghi, `finalize.mjs cancel`). Trước `finalize` không ghi gì vào thư mục thương hiệu.
- **Ghi vào thương hiệu** (`writeback.mjs`, do `finalize.mjs` gọi): `workspace/posts/POST-<slug>/` và một mục `approved` trong `workspace/catalog.json` (`approval.by: "auto"`, `inspiration.store_item`), `clean-image.mjs` của skill chỉ chạy khi `--check` chưa SẠCH, rồi `check-post.mjs` của skill.
- **Chạy cùng lúc**: hai agent hoặc agent và app có thể chồng nhau; mọi đọc-sửa-ghi file chung đi qua `withLock` (thư mục `<file>.lock`) và ghi nguyên tử (`writeJson`/`writeText`).
- **Host ảnh** (`host-image.mjs`, settings `imageHost`): chỉ ảnh của bài đã ghi vào thương hiệu (catalog `approved`/`scheduled`/`published`) lên repo công khai `C:\hoangpq\social-autopilot-sources` (`<brand>/<yyyy>/<mm>/<post-id>.<ext>`), không bao giờ bản nháp hay ảnh đối thủ; kiểm lại sạch metadata; commit "<brand> <post-id>", push, chờ HTTP 200; ghi `media_url`. `finalize`/`writeback` tự gọi; lỗi host không huỷ bài (`image_host.next` để chạy lại). `remove` chỉ gỡ file sau khi bài đã đăng. Test dùng repo git tạm + bare remote.
- **Metricool qua MCP** (gói Starter, không REST API): Node không gọi Metricool; agent dùng tool MCP của mình (Claude: connector claude.ai "Metricool"; Codex: `codex mcp add metricool --url https://ai.metricool.com/mcp` + `codex mcp login metricool`; ChatGPT: connector Metricool, từ JSON `payload` người dùng dán). `metricool-mcp.mjs payload` in đúng tham số `createScheduledPost` (`blogId`, `date` ISO kèm offset múi giờ khách, `info` chuỗi JSON: text chỉ ngôn ngữ đăng, không nhãn AI; media link Pages; providers từ kênh bật; `publicationDate` theo `cadence.timezone`), mặc định **nháp** theo `settings.metricool.default_mode` (`draft` | `schedule`; `--draft`/`--schedule` ghi đè). Bài không qua `check-post.mjs` hay kiểm tra khác vào `blocked`, bài khác vẫn đi. Agent gọi tool rồi `record` ghi `metricool.<network>` vào catalog; bài có `metricool.<network>.id` không gửi lại (đầu mỗi lượt chế độ 2 gửi nốt bài chưa gửi); `status` đưa tham số `getScheduledPosts` để đối chiếu (ERROR báo, PUBLISHED → `mark-published.mjs`). Chỉ facebook/instagram; Fortera Apparel (blogId `<blog_id_1>`) bị chặn cứng; không dùng `createScheduledPostForReview`.
- **Metricool CSV** chỉ là dự phòng khi MCP không dùng được: `metricool-csv.mjs` xuất CSV, người tự nhập. Link/ảnh WebP bị từ chối.
- **Cài đặt** (`saveSettings`): chỉ ghi những khoá gửi lên (`research.delay_seconds`, `metricool.default_mode`, `codex`, `ffmpeg`, `remove_watermark`, `imageHost`, `skillsRoot`), phần còn lại giữ giá trị của máy; sai kiểu thì từ chối. Khối `approval` cũ bị xoá khi lưu. Bí mật (token, secret, password, api_key, cookie...) không bao giờ được ghi.
- Mọi lệnh `child_process` trong `scripts/` có `windowsHide: true`.
- Commit chỉ đứng tên người dùng (hoangpham2263 / teambao@vaniecom.com), không thêm dòng co-author của agent.

## Cấu trúc
- `config/settings.json` (bản máy: `workspace/settings.json`), `config/metricool-brands.json` (bản máy: `workspace/metricool-brands.json`).
- `scripts/lib.mjs`: settings, dò thương hiệu, khoá + ghi nguyên tử, làm sạch chữ (U+034F, zero-width, NBSP), CSV. `SA_WORKSPACE`, `SA_SKILLS_ROOT`, `SA_CODEX`, `SA_STRIP_SCRIPT`, `SA_FFMPEG`, `SA_IMAGE_HOST_CHECK_BASE` chỉ dùng cho test.
- Chế độ 1: `research.mjs` (start/ingest/result/report/clean), `store.mjs` (kho: list/show/reject/restore/known/migrate; bỏ trùng), `phash.mjs` (dHash ảnh, không phụ thuộc gói ngoài).
- Chế độ 2: `ideas.mjs`, `draft.mjs` (new/image/watermark/confirm-clean/check/show/list), `image-clean.mjs`, `finalize.mjs` (run/cancel), `writeback.mjs`, `host-image.mjs` (publish/remove), `metricool-mcp.mjs` (payload/record/status), `metricool-csv.mjs` (dự phòng), `queue.mjs` (báo cáo).
- Khác: `brands.mjs`, `sources.mjs`, `social.mjs` (show/set social.json an toàn), `prompts.mjs` (đọc `docs/scheduled-prompt.md`), `preview.mjs` (dữ liệu "Xem trước").
- App: `src/server.mjs` (127.0.0.1, cổng 47000 + hash thư mục, `SA_PORT` để đổi; `/api/*` gọi hàm của `scripts/`; `/file` chỉ phát ảnh trong `workspace/`) + `ui/index.html`; vỏ `core/` (launch, setup/Cấu hình, webview2, update).
- `workspace/` (git bỏ qua): `settings.json`, `store/<brand>/`, `runs/<brand>/<date>/` (nhật ký crawl), `drafts/<brand>/<brand>-<yyyymmdd>-<nn>/{draft.json, status.json, prompt.txt, brief.md, codex.log, image-generated.png, [image-watermarked.png], image.png, image-clean-report.json, content-<lang>.txt}`, `logs/`.
- Phiên bản: `package.json` `version`. Cập nhật: `git pull`.

<!-- app-lessons:start -->
## Bài học đã đúc kết

Bài học được đúc kết thành nguyên tắc ngắn để áp dụng lần sau, không chép lời phản hồi hoặc kể lịch sử xử lý.

### Facebook chèn ký tự ẩn vào caption
<!-- app-lesson: {"id":"fb-hidden-chars","scope":"research","created_at":"2026-11-07"} -->
Caption lấy từ Facebook có U+034F và ký tự zero-width; luôn qua `research.mjs ingest`/`clean`, không dùng caption thô.

### Dựng lại ảnh đối thủ vẫn là sản phẩm của họ
<!-- app-lesson: {"id":"no-competitor-product","scope":"draft","created_at":"2026-11-07"} -->
Bản thử bg-test (neon-competitors) đổi nền ảnh đối thủ: chỉ để thử prompt, không giao thành bài. Ảnh đầu vào của Codex luôn là ảnh sản phẩm của thương hiệu.

### Prompt Codex phải tả sản phẩm từng chữ
<!-- app-lesson: {"id":"codex-exact-product","scope":"draft","created_at":"2026-11-07"} -->
Tả chữ từng ký tự và dấu, font, màu, vật liệu, dây, tỉ lệ so với đồ xung quanh; cấm thêm chân đế/logo/chữ; kiểm lại chữ sau khi tạo (Codex từng đọc "a" thành "o").

### App chỉ để xem và quản lý
<!-- app-lesson: {"id":"app-primary-ui","scope":"ui","created_at":"2026-11-09"} -->
Một app duy nhất (`start-app.cmd` Windows / `start-app.command` macOS, `src/server.mjs`, `ui/`): Tổng quan, Kho, Bài đã tạo, Prompt, Cài đặt. Việc do agent làm theo prompt; app không có nút chạy bước quy trình (trừ "Bỏ" tuỳ chọn, "Tải lại"), không có mặt thứ hai (như dashboard tĩnh), chỉ gọi hàm của `scripts/` và đọc dữ liệu mới mỗi lần mở; giao diện kiểu Windows cổ điển (`core/assets/tool.css`), nút 32px.

<!-- app-lessons:end -->
