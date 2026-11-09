# social-autopilot

Tool cho từng thương hiệu (ví dụ: DreamyVows, GRENHEIM): lấy bài của các trang tham khảo vào **kho** riêng của thương hiệu, rồi từ kho làm ảnh + caption của chính thương hiệu. Người dùng duyệt từng bài trong app; bài đã duyệt được ghi vào thư mục skill của thương hiệu, ảnh lên repo ảnh công khai, và lượt sau hẹn giờ thật trên Metricool. Chạy được với mọi tài khoản Metricool, mọi máy.

Hai chế độ, chạy bằng agent (Claude Code, Codex; ChatGPT chỉ phần gửi Metricool) với prompt ngắn chép từ tab **Prompt** của app:
1. **Research only** (cần Chrome đã đăng nhập Facebook qua Playwright MCP): crawl bài của từng nguồn vào `workspace/store/<brand>/`, bỏ trùng; `--since` / `--max-posts` / `--backfill` / `--full`.
2. **Create & publish** (không mở Facebook): đồng bộ brand Metricool (`getBrandSettings` → `sync-brands`) → hẹn giờ thật các bài đã duyệt chưa gửi (không bao giờ nháp) → làm bài mới → kiểm tra tự động → **To review** và dừng. Người dùng Approve trong app; lượt sau hẹn giờ.

Trạng thái: **To review** / **Queued** / **Posted** (lỗi: dấu đỏ).

Chi tiết từng bước: `RUNBOOK.md`. Luật cho agent: `AGENTS.md` (Claude Code đọc qua `CLAUDE.md`). Prompt: `docs/scheduled-prompt.md`. Cách crawl: `docs/research.md`. Metricool: `docs/metricool.md`.

**App**: nhấp đúp `start-app.cmd` (Windows) hoặc `start-app.command` (macOS). Tab: Overview (mỗi brand Metricool và skill đã trỏ: Choose skill / Change skill / Disconnect, trạng thái sẵn sàng), Library (kho), Posts (xem trước, Approve, Drop), Prompt (chế độ × agent × thương hiệu, nút chép), Settings.

- Skill thương hiệu **không bao giờ được chép** vào tool: mỗi brand Metricool trỏ tới một thư mục skill theo đường dẫn (`workspace/metricool-brands.json`). Choose skill tìm sâu 2 tầng trong thư mục nguồn (mặc định `skillsRoot`, vd `../vaniecom-workspace/skills`). Sẵn sàng = `enabled: true` + `scripts/check-skill.mjs --tool-ready` của skill đạt. Brand chỉ được làm và gửi bài khi đã trỏ tới một skill dùng được (cổng duy nhất).
- Ảnh: Codex CLI tạo; không bao giờ logo trên sản phẩm; không bao giờ nhãn AI; metadata bỏ bằng `remove_watermark.script`.
- Host: repo công khai `social-autopilot-sources`, link `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/...` (không tên miền riêng).
- Metricool qua MCP của agent (`docs/metricool.md`). Codex: `codex mcp add metricool --url https://ai.metricool.com/mcp` rồi `codex mcp login metricool`. CSV chỉ dự phòng.
- Cần: Node.js 22+, Codex CLI đã đăng nhập, Playwright MCP + Chrome (Mode 1), MCP Metricool (Mode 2), ffmpeg (chỉ khi watermark hoặc ảnh WebP).
- Kiểm tra: `npm test`.

```
config/settings.json   cài đặt chung (đường dẫn tương đối): skillsRoot, research, codex, ffmpeg, remove_watermark, imageHost
config/metricool-brands.example.json  dạng của workspace/metricool-brands.json (do sync-brands ghi, chỉ ở máy)
src/server.mjs, ui/     app: máy chủ cục bộ (127.0.0.1, SA_PORT để đổi cổng) + trang
core/                  vỏ app: launch, setup, webview2, update
scripts/               Mode 1: research, store, phash · Mode 2: metricool-mcp, ideas, draft, image-clean, finalize, writeback, host-image, metricool-csv, queue · khác: brands, sources, skills, social, prompts, preview, lib
prompts/               scene-edit.txt, scene-swap.txt, caption-brief.md, idea-abstract.md
docs/                  plan.md, research.md, scheduled-prompt.md, metricool.md, metricool-mapping.md, metricool-csv-template.csv
tests/                 test của từng script
workspace/             chỉ ở máy (git bỏ qua): settings.json, metricool-brands.json, store/, runs/, drafts/, logs/
```
