# social-autopilot – hướng dẫn cho agent

Quy trình chạy headless: agent theo lịch làm theo `RUNBOOK.md`; mọi việc qua các script Node trong `scripts/`, mỗi script in một JSON (`ok`), chạy lại không sinh trùng, ghi vết vào `workspace/logs/<ngày>.log`. **Scripts + RUNBOOK là nguồn duy nhất.** Giao diện quản lý (`src/server.mjs` + `ui/`, vỏ `core/` của Product Review/Video) chỉ là lớp mỏng gọi đúng các hàm đó; không thêm logic quy trình vào server hay trang.

## Nguyên tắc (người dùng chốt 07/11/2026)
- **Thương hiệu chỉ từ `skillsRoot`** (`config/settings.json`, mặc định `../vaniecom-workspace/skills`). Một thương hiệu = một thư mục skill chuẩn có `SKILL.md`, `project/project.md`, `project/social.json`. Chạy được khi `enabled: true` và `scripts/check-skill.mjs --tool-ready` của chính skill exit 0 (tool không tự kiểm lại khuôn).
- **Mọi thứ riêng thương hiệu đọc từ thư mục skill**: `research.sources[]`, `research.max_per_day`, `channels[]`, `language_policy`, `product_images` (`sources`, `ai_scenes_allowed`, `ai_disclosure_label`, `watermark`, `reference_redraw`), `caption_rules`, `cadence`, `approval.owner`. Tên trường theo `project-skill-standard/README.md`, mục "Khai báo social". Tool không chứa nguồn, kênh hay dữ kiện thương hiệu nào.
- **Một quy trình cho mọi thương hiệu**, không nhánh code theo thương hiệu. Thương hiệu chạy nối tiếp; nguồn không trộn giữa thương hiệu.
- **Giới hạn nghiên cứu nằm trong code** (`research.mjs`): `research.max_per_day` của thương hiệu (0 = tắt; một thư mục lượt mỗi ngày), `max_sources_per_run`, `max_posts_per_source`, `max_posts_per_day_all_brands` (chung một tài khoản Facebook). Không lách.
- **Tham khảo chỉ là cảm hứng** (mặc định `brand-image`): ý trừu tượng (`ideas.mjs` chặn chép 6 từ liền, số điện thoại, link, tên shop); ảnh vào Codex là ảnh của thương hiệu; ảnh không khí không được là ảnh tham khảo; chỉ dựng cảnh AI khi `ai_scenes_allowed: true`.
- **Scene-swap** (opt-in, `product_images.reference_redraw.enabled: true`; người dùng chấp nhận rủi ro bản quyền): `draft.mjs new --ref-image` lấy ảnh tham khảo của chính thương hiệu đó, chỉ đổi cảnh (`prompts/scene-swap.txt`), bắt buộc `--brand-can-produce` khi `only_if_brand_can_produce`; `check` đòi `confirm-clean` (xem bằng mắt: không còn tên shop/logo/watermark/nhãn size/số điện thoại) và chặn caption nhắc tên shop; người duyệt thấy ảnh gốc của shop cạnh ảnh mới; catalog ghi `image_mode: scene-swap`, `inspiration.source_shop`, `ai_disclosure: true`.
- **Không logo trên sản phẩm**: prompt luôn có lệnh NO LOGO (check cảnh báo nếu thiếu). Logo chỉ là watermark nhỏ ở góc, thêm sau (`draft.mjs watermark`, ffmpeg), chỉ khi `product_images.watermark.enabled`.
- **Làm sạch metadata bằng remove-watermark-skill** (`settings.remove_watermark.script`, provider theo AI: `codex → chatgpt`): ngay sau Codex, sau watermark và trước writeback. `image-generated.png` (gốc, không sửa) → `image.png` (bản sạch) + `image-clean-report.json`; check không đạt khi điểm ảnh đổi hay còn chunk metadata. Theo quy tắc của skill đó: chỉ metadata, không EXIF giả, chỉ ở máy, không bao giờ nói đã qua nhận diện AI; khai báo AI (`ai_disclosure`, nhãn của thương hiệu) không đổi.
- **Duyệt bằng code**: chỉ bản `awaiting_approval`, qua lại mọi kiểm tra, người duyệt khớp `approval.owner` (chat → `approve.mjs`, hoặc nút ở giao diện); từ chối cần lý do. Trước khi duyệt không ghi gì vào thư mục thương hiệu. Agent không tự duyệt thay người.
- **Ghi vào thương hiệu** (`writeback.mjs`): `workspace/posts/POST-<slug>/` và một mục `approved` trong `workspace/catalog.json`, `clean-image.mjs` của skill chỉ chạy khi `--check` chưa SẠCH, rồi `check-post.mjs` của skill.
- **Chạy cùng lúc**: giao diện và agent theo lịch có thể chạy song song; mọi đọc-sửa-ghi file chung đi qua `withLock` (thư mục `<file>.lock`) và ghi nguyên tử (`writeJson`/`writeText`).
- **Publish (later: Metricool)**: chưa có code. Không đăng, không hẹn giờ.
- Commit chỉ đứng tên người dùng (hoangpham2263 / teambao@vaniecom.com), không thêm dòng Claude/co-author.

## Cấu trúc
- `scripts/lib.mjs`: settings (`config/settings.json` + `workspace/settings.json`), dò thương hiệu, khoá + ghi nguyên tử, làm sạch chữ (U+034F, zero-width, NBSP), CSV. `SA_WORKSPACE`, `SA_SKILLS_ROOT`, `SA_CODEX`, `SA_STRIP_SCRIPT`, `SA_FFMPEG` chỉ dùng cho test.
- `brands.mjs`, `sources.mjs`: đọc. `social.mjs` (show/set social.json an toàn: chặn token, chạy check-skill, sai thì trả file cũ). `research.mjs` (start/ingest/clean/limits), `ideas.mjs`, `draft.mjs` (new/image/watermark/confirm-clean/check/show/list), `image-clean.mjs`, `queue.mjs` (báo cáo), `approve.mjs` (approve/reject/sync), `writeback.mjs`.
- Giao diện: `src/server.mjs` (cổng 47000 + hash thư mục, `SA_PORT` đè), `ui/index.html`; vỏ `core/` (launcher WebView2, Cấu hình Node.js + Codex, Cập nhật, bridge 8795 không dùng tới).
- `workspace/` (git bỏ qua): `settings.json`, `research-log.json`, `runs/<brand>/<date>/{run.json, ideas.json, <source-id>/{raw.json, raw/, refs/, refs.json, refs.csv}}`, `drafts/<brand>/<brand>-<yyyymmdd>-<nn>/{draft.json, status.json, prompt.txt, brief.md, codex.log, image-generated.png, [image-watermarked.png], image.png, image-clean-report.json, content-<lang>.txt}`, `logs/`.
- Trạng thái bản nháp (`status.json`): `needs_prompt` → `generating` → `needs_caption` (hoặc `image_failed`) → `awaiting_approval` → `approved` (có `brand_post`) | `rejected`.
- Phiên bản: `package.json` `version`. Cập nhật: `git pull` (chưa có repo GitHub; nút Cập nhật báo không kiểm tra được).

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
<!-- app-lessons:end -->
