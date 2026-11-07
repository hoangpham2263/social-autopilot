# social-autopilot – hướng dẫn cho agent

Tool headless, không server, không giao diện, không cổng. Agent chạy theo `RUNBOOK.md`; mọi việc qua các script Node trong `scripts/`, mỗi script in một JSON (`ok`), chạy lại không sinh trùng, ghi vết vào `workspace/logs/<ngày>.log`.

## Nguyên tắc (người dùng chốt 07/11/2026)
- **Thương hiệu chỉ từ `skillsRoot`** (`config/settings.json`, mặc định `../vaniecom-workspace/skills`). Một thương hiệu = một thư mục skill chuẩn (`project-skill-standard`) có `SKILL.md`, `project/project.md`, `project/social.json`. Chạy được khi `enabled: true` và `scripts/check-skill.mjs --tool-ready` của chính skill exit 0 (tool không tự kiểm lại khuôn).
- **Mọi thứ riêng thương hiệu đọc từ thư mục skill**: nguồn nghiên cứu (`research.sources[]`), kênh (`channels[]`), ngôn ngữ (`language_policy`), ảnh gốc (`product_images`), mục project.md cho caption (`caption_rules`), người duyệt (`approval.owner`). Tên trường theo `project-skill-standard/README.md`, mục "Khai báo social". Tool không chứa danh sách nguồn, kênh hay dữ kiện thương hiệu nào.
- **Một quy trình cho mọi thương hiệu**, không nhánh code theo thương hiệu. Thương hiệu chạy nối tiếp; nguồn không trộn giữa thương hiệu.
- **Giới hạn nghiên cứu nằm trong code** (`research.mjs`): `research.max_per_day` của thương hiệu (0 = tắt; một thư mục lượt mỗi ngày), `max_sources_per_run`, `max_posts_per_source`, `max_posts_per_day_all_brands` (chung một tài khoản Facebook) trong settings. Không lách.
- **Tham khảo chỉ là cảm hứng**: ảnh và caption đối thủ chỉ nằm trong `workspace/runs/`; ý phải trừu tượng (`ideas.mjs` chặn chép 6 từ liền, số điện thoại, link, tên shop); ảnh đưa vào Codex phải là ảnh của thương hiệu (trong thư mục skill hoặc thư mục `product_images.sources[].path`), ảnh không khí không được là ảnh tham khảo; chỉ dựng cảnh AI khi `product_images.ai_scenes_allowed: true`.
- **Duyệt trong chat, bằng code**: chỉ bản `awaiting_approval`, qua lại mọi kiểm tra, người duyệt khớp `approval.owner` mới được `approve.mjs`; từ chối cần lý do. Trước khi duyệt không ghi gì vào thư mục thương hiệu. Agent không tự duyệt thay người.
- **Ghi vào thương hiệu** (`writeback.mjs`): `workspace/posts/POST-<slug>/` (ảnh làm sạch bằng `scripts/clean-image.mjs` của skill, `content-<lang>.txt`) và một mục `approved` trong `workspace/catalog.json` (`inspiration`, `ai_disclosure`, `approval`), rồi chạy `scripts/check-post.mjs` của skill.
- **Publish (later: Metricool)**: chưa có code. Không đăng, không hẹn giờ.
- Commit chỉ đứng tên người dùng (hoangpham2263 / teambao@vaniecom.com), không thêm dòng Claude/co-author.

## Cấu trúc
- `scripts/lib.mjs`: settings, dò thương hiệu, làm sạch chữ (U+034F, zero-width, NBSP), CSV, đường dẫn workspace. `SA_WORKSPACE`, `SA_SKILLS_ROOT`, `SA_CODEX` chỉ dùng cho test.
- `scripts/brands.mjs`, `sources.mjs`: đọc. `research.mjs` (start/ingest/clean/limits), `ideas.mjs`, `draft.mjs` (new/image/check/show/list), `queue.mjs` (báo cáo), `approve.mjs` (approve/reject/sync), `writeback.mjs`.
- `workspace/` (git bỏ qua): `settings.json` (đè cài đặt trên máy này), `research-log.json`, `runs/<brand>/<date>/run.json`, `ideas.json`, `<source-id>/{raw.json, raw/, refs/, refs.json, refs.csv}`, `drafts/<brand>/<brand>-<yyyymmdd>-<nn>/{draft.json, status.json, prompt.txt, brief.md, codex.log, image.png, content-<lang>.txt}`, `logs/`.
- Trạng thái bản nháp (`status.json`): `needs_prompt` → `generating` → `needs_caption` (hoặc `image_failed`) → `awaiting_approval` → `approved` (có `brand_post`) | `rejected`.
- Phiên bản: `package.json` `version`. Cập nhật: `git pull` (chưa có repo GitHub).

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
