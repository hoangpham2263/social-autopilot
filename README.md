# social-autopilot

Tool cho từng thương hiệu (DreamyVows, GRENHEIM...): lấy bài của các trang tham khảo vào **kho** riêng của thương hiệu, rồi từ kho làm ảnh + caption của chính thương hiệu, ghi vào thư mục skill của thương hiệu, đưa ảnh lên repo ảnh công khai và gửi lên Metricool (mặc định **nháp**). Không có bước duyệt: bài phải qua các kiểm tra tự động; bài nào không qua thì dừng riêng.

Hai chế độ, chạy bằng agent (Claude Code, Codex; ChatGPT chỉ phần gửi Metricool) với prompt dán sẵn:
1. **Chỉ nghiên cứu** (vd mỗi tuần, cần Chrome đã đăng nhập Facebook qua Playwright MCP): crawl hết bài (hoặc `--since` / `--max-posts`) của từng nguồn, tải ảnh, caption, link, ngày; bỏ trùng (link/mã bài, ảnh gần giống, caption giống) trên cả kho; lần sau dừng ở bài đã có; báo cáo bài mới / bài trùng / nguồn bị chặn.
2. **Làm bài & đưa lên** (khi người dùng bảo, không mở Facebook): gửi nốt bài cũ chưa gửi → đối chiếu Metricool → ý từ bài kho chưa dùng → ảnh (Codex CLI, ảnh sản phẩm của thương hiệu) → caption (EN đăng, VN chỉ để đọc) → kiểm tra tự động → ghi vào skill (approved, by `auto`) → host ảnh → Metricool qua MCP → báo cáo.

Chi tiết từng bước: `RUNBOOK.md`. Luật cho agent: `AGENTS.md` (Claude Code đọc qua `CLAUDE.md`). Prompt: `docs/scheduled-prompt.md` (hoặc tab **Prompt** của app, `node scripts/prompts.mjs list|show`). Cách crawl: `docs/research.md`. Metricool: `docs/metricool.md`.

**App** (chỉ để xem và quản lý): nhấp đúp `start-app.cmd` (Windows, cửa sổ WebView2) hoặc `start-app.command` (macOS). Máy chủ cục bộ `src/server.mjs` + `ui/index.html`, giao diện kiểu Windows cổ điển (`core/assets/tool.css`). Tab: Tổng quan (mỗi thương hiệu: kho mới/đã dùng/đã bỏ, nghiên cứu gần nhất và nguồn bị chặn, bài đã tạo, Metricool nháp/hẹn giờ/đã đăng/lỗi), Kho (lọc theo trạng thái/nguồn, ảnh, caption, link, "Bỏ"), Bài đã tạo (ảnh, xem trước EN/VN, kiểm tra, link ảnh, Metricool + link planner; "Bỏ" tuỳ chọn trước khi ghi), Prompt (chế độ × agent × thương hiệu, nút Chép prompt), Cài đặt (social.json từng thương hiệu, cài đặt tool). Thanh trên có Tải lại, Cấu hình (Node.js, Codex, đăng nhập), Cập nhật.

- Thương hiệu: thư mục skill chuẩn trong `C:\hoangpq\vaniecom-workspace\skills\` (`skillsRoot`), có `project/social.json` với `enabled: true` và qua `scripts/check-skill.mjs --tool-ready` của skill. Dữ kiện thương hiệu chỉ nằm trong skill; tool không giữ dữ kiện hay nguồn của thương hiệu nào.
- Ảnh: Codex CLI tạo; logo không bao giờ nằm trên sản phẩm; watermark góc chỉ khi thương hiệu bật; metadata bỏ bằng `C:\hoangpq\remove-watermark-skill` (ảnh gốc giữ, điểm ảnh không đổi, không gắn nhãn AI lên bài). Scene-swap (đổi cảnh ảnh của shop tham khảo) chỉ khi thương hiệu bật `product_images.reference_redraw`.
- Metricool: gói Starter (không REST API); agent dùng tool MCP của mình (`scripts/metricool-mcp.mjs` chuẩn bị tham số `createScheduledPost`, ghi id vào catalog). Mặc định nháp (`settings.metricool.default_mode`); không bao giờ đụng Fortera Apparel. CSV (`scripts/metricool-csv.mjs`) chỉ là dự phòng.
- Cần: Node.js 22+, Codex CLI đã đăng nhập, Playwright MCP + Chrome đã đăng nhập Facebook (chế độ 1), tool MCP Metricool (chế độ 2), ffmpeg (chỉ khi dùng watermark hoặc ảnh WebP).
- Kiểm tra: `npm test`.

```
config/settings.json   cài đặt chung: skillsRoot, research (delay_seconds, dedupe), metricool.default_mode, codex, ffmpeg, remove_watermark, imageHost
config/metricool-brands.json  các brand trong tài khoản Metricool: name, blog_id, timezone, networks, skill_id
src/server.mjs, ui/     app: máy chủ cục bộ (127.0.0.1, cổng theo thư mục, SA_PORT để đổi) + trang; start-app.cmd / start-app.command
core/                  vỏ app: launch, Cấu hình (setup), webview2, Cập nhật (update.ps1, GitHub Release qua .github/workflows/release.yml)
scripts/               chế độ 1: research, store, phash · chế độ 2: ideas, draft, image-clean, finalize, writeback, host-image, metricool-mcp, metricool-csv, queue · khác: brands, sources, social, prompts, preview, lib (in JSON)
prompts/               scene-edit.txt (ảnh thương hiệu), scene-swap.txt, caption-brief.md, idea-abstract.md
docs/                  plan.md, research.md, scheduled-prompt.md (prompt dán sẵn), metricool.md, metricool-mapping.md, metricool-csv-template.csv
tests/                 cycle (2 chế độ, kho, bỏ trùng), host-image, server, server-security, metricool-csv, metricool-mcp, qa-bugs (+ fake-codex.mjs)
workspace/             chỉ ở máy (git bỏ qua): store/<brand>/ (kho), runs/<brand>/<date>/ (nhật ký crawl), drafts/<brand>/<id>/, logs/, settings.json
```
