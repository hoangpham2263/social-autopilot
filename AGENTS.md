# social-autopilot – hướng dẫn cho agent

Quy trình chạy headless: agent theo lịch làm theo `RUNBOOK.md`; mọi việc qua các script Node trong `scripts/`, mỗi script in một JSON (`ok`), chạy lại không sinh trùng, ghi vết vào `workspace/logs/<ngày>.log`. **Scripts + RUNBOOK là nguồn duy nhất của quy trình.** Người dùng chỉ có một cách chạy: **app** (`start-app.cmd` trên Windows / `start-app.command` trên macOS → `src/server.mjs` + `ui/index.html`): một lớp mỏng gọi đúng các hàm trong `scripts/` (duyệt/bỏ, sửa social.json, đưa ảnh lên, cài đặt), không có logic quy trình riêng.

## Nguyên tắc (người dùng chốt 07/11/2026)
- **Thương hiệu chỉ từ `skillsRoot`** (`config/settings.json`, mặc định `../vaniecom-workspace/skills`). Một thương hiệu = một thư mục skill chuẩn có `SKILL.md`, `project/project.md`, `project/social.json`. Chạy được khi `enabled: true` và `scripts/check-skill.mjs --tool-ready` của chính skill exit 0 (tool không tự kiểm lại khuôn).
- **Mọi thứ riêng thương hiệu đọc từ thư mục skill**: `research.sources[]`, `research.max_per_day`, `channels[]`, `language_policy`, `product_images` (`sources`, `ai_scenes_allowed`, `watermark`, `reference_redraw`), `caption_rules`, `cadence`, `approval.owner`. Tên trường theo `project-skill-standard/README.md`, mục "Khai báo social". Tool không chứa nguồn, kênh hay dữ kiện thương hiệu nào.
- **Một quy trình cho mọi thương hiệu**, không nhánh code theo thương hiệu. Thương hiệu chạy nối tiếp; nguồn không trộn giữa thương hiệu.
- **Giới hạn nghiên cứu nằm trong code** (`research.mjs`): `research.max_per_day` của thương hiệu (0 = tắt; một thư mục lượt mỗi ngày), `max_sources_per_run`, `max_posts_per_source`, `max_posts_per_day_all_brands` (chung một tài khoản Facebook). Không lách.
- **Tham khảo chỉ là cảm hứng** (mặc định `brand-image`): ý trừu tượng (`ideas.mjs` chặn chép 6 từ liền, số điện thoại, link, tên shop); ảnh vào Codex là ảnh của thương hiệu; ảnh không khí không được là ảnh tham khảo; chỉ dựng cảnh AI khi `ai_scenes_allowed: true`.
- **Scene-swap** (opt-in, `product_images.reference_redraw.enabled: true`; người dùng chấp nhận rủi ro bản quyền): `draft.mjs new --ref-image` lấy ảnh tham khảo của chính thương hiệu đó, chỉ đổi cảnh (`prompts/scene-swap.txt`), bắt buộc `--brand-can-produce` khi `only_if_brand_can_produce`; `check` đòi `confirm-clean` (xem bằng mắt: không còn tên shop/logo/watermark/nhãn size/số điện thoại) và chặn caption nhắc tên shop; người duyệt thấy ảnh gốc của shop cạnh ảnh mới; catalog ghi `image_mode: scene-swap`, `inspiration.source_shop`, `ai_disclosure: true`.
- **Không logo trên sản phẩm**: prompt luôn có lệnh NO LOGO (check cảnh báo nếu thiếu). Logo chỉ là watermark nhỏ ở góc, thêm sau (`draft.mjs watermark`, ffmpeg), chỉ khi `product_images.watermark.enabled`.
- **Làm sạch metadata bằng remove-watermark-skill** (`settings.remove_watermark.script`, provider theo AI: `codex → chatgpt`): ngay sau Codex, sau watermark và trước writeback. `image-generated.png` (gốc, không sửa) → `image.png` (bản sạch) + `image-clean-report.json`; check không đạt khi điểm ảnh đổi hay còn chunk metadata. Theo quy tắc của skill đó: chỉ metadata, không EXIF giả, chỉ ở máy, không bao giờ nói đã qua nhận diện AI; không bao giờ gắn nhãn AI lên bài (`ai_disclosure` trong catalog chỉ để lưu vết).
- **Duyệt bằng code**: chỉ bản `awaiting_approval`, qua lại mọi kiểm tra, người duyệt khớp `approval.owner` (chat → `approve.mjs`, hoặc nút Duyệt/Bỏ trong app → cùng hàm `approve()`/`reject()`); từ chối cần lý do. Trước khi duyệt không ghi gì vào thư mục thương hiệu. Agent không tự duyệt thay người.
- **Ghi vào thương hiệu** (`writeback.mjs`): `workspace/posts/POST-<slug>/` và một mục `approved` trong `workspace/catalog.json`, `clean-image.mjs` của skill chỉ chạy khi `--check` chưa SẠCH, rồi `check-post.mjs` của skill.
- **Chạy cùng lúc**: agent theo lịch và một lệnh chạy tay trong chat có thể chồng nhau; mọi đọc-sửa-ghi file chung đi qua `withLock` (thư mục `<file>.lock`) và ghi nguyên tử (`writeJson`/`writeText`).
- **Host ảnh** (`host-image.mjs`, settings `imageHost`, người dùng chốt 09/11/2026): chỉ ảnh của bài đã được người duyệt (catalog `approved`/`scheduled`/`published`) lên repo công khai `C:\hoangpq\social-autopilot-sources` (`<brand>/<yyyy>/<mm>/<post-id>.<ext>`), không bao giờ bản nháp hay ảnh đối thủ; kiểm lại sạch metadata; commit "<brand> <post-id>", push, chờ HTTP 200; ghi `media_url` vào catalog (trường tuỳ chọn của chuẩn, check-post kiểm). `approve`/`writeback` tự gọi sau khi ghi; lỗi host không huỷ duyệt. `remove` chỉ gỡ file sau khi bài đã đăng: Metricool không chép ảnh ngoài, bài vẫn trỏ về link raw. `type: "shopify-files"` chưa làm (báo lỗi rõ). Test dùng repo git tạm + bare remote, không đụng repo thật.
- **Metricool**: chỉ xuất CSV (`metricool-csv.mjs`, người nhập thủ công); không đăng, không hẹn giờ, không gửi gì tới Metricool.
- Commit chỉ đứng tên người dùng (hoangpham2263 / teambao@vaniecom.com), không thêm dòng Claude/co-author.

## Cấu trúc
- `config/metricool-brands.json` (bản máy: `workspace/metricool-brands.json`, sửa trong Cài đặt, Nâng cao): các brand của tài khoản Metricool, mỗi brand gắn `skill_id` hoặc `null`; tab Thương hiệu của app liệt kê theo danh sách này (`brandOverview()` trong `lib.mjs`).
- `scripts/lib.mjs`: settings (`config/settings.json` + `workspace/settings.json`), dò thương hiệu, khoá + ghi nguyên tử, làm sạch chữ (U+034F, zero-width, NBSP), CSV. `SA_WORKSPACE`, `SA_SKILLS_ROOT`, `SA_CODEX`, `SA_STRIP_SCRIPT`, `SA_FFMPEG`, `SA_IMAGE_HOST_CHECK_BASE` chỉ dùng cho test.
- `brands.mjs`, `sources.mjs`: đọc. `social.mjs` (show/set social.json an toàn: chặn token, chạy check-skill, sai thì trả file cũ). `research.mjs` (start/ingest/clean/limits), `ideas.mjs`, `draft.mjs` (new/image/watermark/confirm-clean/check/show/list), `image-clean.mjs`, `queue.mjs` (báo cáo), `approve.mjs` (approve/reject/sync), `writeback.mjs`, `host-image.mjs` (publish/remove), `metricool-csv.mjs` (export/validate CSV, chỉ ghi file `--out`), `preview.mjs` (dữ liệu "Xem trước" cho app).
- App: `src/server.mjs` (127.0.0.1, cổng 47000 + hash thư mục, `SA_PORT` để đổi; `/api/*` gọi hàm của `scripts/`; `/file` chỉ phát ảnh trong `workspace/`) + `ui/index.html` (Bản nháp, Thương hiệu, Nghiên cứu, Cài đặt; đọc lại dữ liệu mỗi lần mở trang; tự chứa trong `ui/` + `core/assets/`). Vỏ `core/` (launch, setup/Cấu hình: Node.js, Codex, đăng nhập; webview2; update); Cập nhật đọc GitHub Release (`.github/workflows/release.yml`, đẩy tag `v*`) với bản cài ZIP, `git pull` với bản git.
- `workspace/` (git bỏ qua): `settings.json`, `research-log.json`, `runs/<brand>/<date>/{run.json, ideas.json, <source-id>/{raw.json, raw/, refs/, refs.json, refs.csv}}`, `drafts/<brand>/<brand>-<yyyymmdd>-<nn>/{draft.json, status.json, prompt.txt, brief.md, codex.log, image-generated.png, [image-watermarked.png], image.png, image-clean-report.json, content-<lang>.txt}`, `logs/`.
- Trạng thái bản nháp (`status.json`): `needs_prompt` → `generating` → `needs_caption` (hoặc `image_failed`) → `awaiting_approval` → `approved` (có `brand_post`; ảnh host thì catalog thương hiệu có `media_url`) | `rejected`.
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

### App là cách chạy duy nhất
<!-- app-lesson: {"id":"app-primary-ui","scope":"ui","created_at":"2026-11-09"} -->
Chỉ một cách chạy: app (`start-app.cmd` Windows / `start-app.command` macOS, `src/server.mjs`, `ui/`), có nút Duyệt/Bỏ, sửa social.json, Đưa ảnh lên. Không thêm mặt thứ hai (như dashboard tĩnh). App chỉ gọi hàm của `scripts/` (một đường quy trình cho app, chat và agent theo lịch); trang app đọc dữ liệu mới mỗi lần mở, nên vòng chạy không dựng trang nào; giao diện kiểu Windows cổ điển (`core/assets/tool.css`), không shadcn.

<!-- app-lessons:end -->
