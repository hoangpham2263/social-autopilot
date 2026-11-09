# social-autopilot

Tool cho mỗi thương hiệu: xem trang tham khảo → rút ý → làm ảnh và caption riêng của thương hiệu → **người duyệt** → ghi bài đã duyệt vào thư mục skill của thương hiệu. Ảnh bài đã duyệt được đẩy lên repo ảnh công khai `social-autopilot-sources` để có link cho Metricool (`host-image.mjs`). Bài đã duyệt được agent gửi lên Metricool qua MCP (connector claude.ai "Metricool", gói Starter không có REST API): `scripts/metricool-mcp.mjs` chuẩn bị tham số `createScheduledPost` (mặc định nháp) và ghi id Metricool vào catalog; không bao giờ đụng Fortera Apparel. CSV (`scripts/metricool-csv.mjs`) là đường dự phòng. Chi tiết: `RUNBOOK.md` bước 5c, `docs/metricool.md`.

Một quy trình, hai mặt (cùng gọi các hàm trong `scripts/`):
- **App (cách chạy duy nhất cho người dùng)**: nhấp đúp `start-app.cmd` (Windows, cửa sổ WebView2 của `core/launch.ps1`) hoặc `start-app.command` (macOS, cửa sổ app Chrome). Máy chủ cục bộ `src/server.mjs` + `ui/index.html` (giao diện kiểu Windows cổ điển của `core/assets/tool.css`). Gọn, mặc định chỉ xem, sửa là ngoại lệ. Mỗi lần mở trang là đọc dữ liệu mới: bản nháp (ảnh thu nhỏ, caption thu gọn, Duyệt/Bỏ ở hàng tiêu đề, "Xem trước" mô phỏng bài Facebook/Instagram theo language_policy, không tải gì từ ngoài; ô lý do hiện sau khi bấm Bỏ; scene-swap có ảnh gốc của shop; bài đã duyệt có link ảnh hoặc "chưa có link" + nút "Đưa ảnh lên"), thương hiệu (mọi brand trong tài khoản Metricool, trạng thái skill và phần còn thiếu, cảnh báo lệch múi giờ; nút Sửa chỉ mở các mục hay đổi, phần còn lại ở Nâng cao), nghiên cứu, cài đặt (tóm tắt, nút Sửa). Thanh trên có Tải lại, Cấu hình (Node.js, Codex, đăng nhập), Cập nhật (vỏ `core/`).
- **Headless** (nguồn quy trình): agent theo lịch (Claude Code scheduled task/routine, Codex/ChatGPT automation) chạy `RUNBOOK.md` bằng các script trong `scripts/`. Prompt dán vào lịch: `docs/scheduled-prompt.md`. Vòng chạy không dựng trang nào; app đọc dữ liệu mới mỗi lần mở.

- Thương hiệu: thư mục skill chuẩn trong `C:\hoangpq\vaniecom-workspace\skills\` (`skillsRoot`), có `project/social.json` với `enabled: true` và qua `scripts/check-skill.mjs --tool-ready` của skill. Thêm thương hiệu = đặt thư mục skill vào đó. Dữ kiện thương hiệu chỉ nằm trong `skills\<brand>\project\social.json` (và `project.md`); tool không giữ dữ kiện hay nguồn của thương hiệu nào.
- Ảnh: Codex CLI tạo; logo không bao giờ nằm trên sản phẩm; watermark góc chỉ khi thương hiệu bật; metadata bỏ bằng `C:\hoangpq\remove-watermark-skill` (ảnh gốc giữ, điểm ảnh không đổi, không gắn nhãn AI lên bài). Scene-swap (đổi cảnh ảnh của shop tham khảo) chỉ khi thương hiệu bật `product_images.reference_redraw`.
- Cần: Node.js 22+, Codex CLI đã đăng nhập, Playwright MCP gắn Chrome đã đăng nhập Facebook (nghiên cứu), ffmpeg (chỉ khi dùng watermark).
- Kiểm tra: `npm test`.

```
config/settings.json   cài đặt chung: skillsRoot, nhịp nghiên cứu (delay_seconds), codex, ffmpeg, remove_watermark, luật duyệt, imageHost
config/metricool-brands.json  các brand trong tài khoản Metricool (gói không có API, ghi tay): name, blog_id, timezone, networks, skill_id
src/server.mjs, ui/     app: máy chủ cục bộ (127.0.0.1, cổng theo thư mục, SA_PORT để đổi) + trang; start-app.cmd / start-app.command
core/                  vỏ app: launch, Cấu hình (setup: Node.js, Codex), webview2, Cập nhật (update.ps1, GitHub Release qua .github/workflows/release.yml)
scripts/               brands, sources, social, research, ideas, draft, image-clean, queue, approve, writeback, host-image, metricool-csv, metricool-mcp, preview (in JSON)
prompts/               scene-edit.txt (ảnh thương hiệu), scene-swap.txt, caption-brief.md, idea-abstract.md
docs/                  plan.md, research.md (Playwright), scheduled-prompt.md, metricool.md (MCP + CSV), metricool-mapping.md
tests/                 cycle, host-image, server, server-security, metricool-csv, metricool-mcp (+ fake-codex.mjs)
workspace/             chỉ ở máy (git bỏ qua): runs/<brand>/<date>/<source>/, drafts/<brand>/<id>/, logs/, settings.json
```

## Host ảnh (link cho Metricool)

`node scripts/host-image.mjs publish --brand <id> --post POST-xx` (tự chạy sau `approve`/`writeback`) đẩy ảnh bài đã duyệt lên repo ảnh công khai và ghi `media_url` vào catalog; `remove` gỡ file chỉ gỡ sau khi bài đã đăng (Metricool không chép ảnh ngoài, bài vẫn trỏ về link raw). Chi tiết từng bước: `RUNBOOK.md` bước 5b; cấu hình: `imageHost` trong `config/settings.json`.
