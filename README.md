# social-autopilot

Tool không giao diện, do agent chạy theo lịch (Claude Code scheduled task/routine, Codex/ChatGPT automation). Với mỗi thương hiệu: xem trang tham khảo → rút ý → làm ảnh và caption riêng của thương hiệu → **người duyệt trong chat** → ghi bài đã duyệt vào thư mục skill của thương hiệu. Không tự đăng bài; Metricool làm sau.

- Thương hiệu: thư mục skill chuẩn trong `C:\hoangpq\vaniecom-workspace\skills\` (`skillsRoot` trong `config/settings.json`), có `project/social.json` với `enabled: true` và qua `scripts/check-skill.mjs --tool-ready` của skill. Thêm thương hiệu = đặt thư mục skill vào đó. Tool không giữ dữ kiện hay nguồn của thương hiệu nào.
- Một quy trình cho mọi thương hiệu, không có code riêng thương hiệu.
- Cách chạy một vòng: `RUNBOOK.md`. Prompt dán vào lịch: `docs/scheduled-prompt.md`.
- Cần: Node.js 22+, Codex CLI đã đăng nhập (tạo ảnh), Playwright MCP gắn Chrome đã đăng nhập Facebook (nghiên cứu).
- Kiểm tra: `npm test` (= `node --test "tests/*.test.mjs"`).

```
config/settings.json   cài đặt chung: skillsRoot, giới hạn nghiên cứu, lệnh codex, luật duyệt
scripts/               brands, sources, research, ideas, draft, queue, approve, writeback (in JSON)
prompts/               khuôn prompt ảnh, brief caption, cách rút ý
docs/                  plan.md, research.md (Playwright), scheduled-prompt.md
workspace/             chỉ ở máy (git bỏ qua): runs/<brand>/<date>/<source>/, drafts/<brand>/<id>/, logs/
```
