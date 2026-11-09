# social-autopilot

Tool cho mỗi thương hiệu: xem trang tham khảo → rút ý → làm ảnh và caption riêng của thương hiệu → **người duyệt** → ghi bài đã duyệt vào thư mục skill của thương hiệu. Không tự đăng bài; Publish (Metricool) làm sau.

Một quy trình, hai mặt:
- **Headless** (nguồn duy nhất): agent theo lịch (Claude Code scheduled task/routine, Codex/ChatGPT automation) chạy `RUNBOOK.md` bằng các script trong `scripts/`. Prompt dán vào lịch: `docs/scheduled-prompt.md`. Cuối mỗi vòng agent chạy `node scripts/dashboard.mjs`.
- **Dashboard tĩnh, chỉ xem**: `dashboard.html`, nhấp đúp là mở; không server, không nút thao tác. Quản lý (duyệt/bỏ, sửa `social.json`, chạy lại một bước) làm trong chat với agent hoặc bằng script. Xem mục Dashboard.

- Thương hiệu: thư mục skill chuẩn trong `C:\hoangpq\vaniecom-workspace\skills\` (`skillsRoot`), có `project/social.json` với `enabled: true` và qua `scripts/check-skill.mjs --tool-ready` của skill. Thêm thương hiệu = đặt thư mục skill vào đó. Dữ kiện thương hiệu chỉ nằm trong `skills\<brand>\project\social.json` (và `project.md`); tool không giữ dữ kiện hay nguồn của thương hiệu nào.
- Ảnh: Codex CLI tạo; logo không bao giờ nằm trên sản phẩm; watermark góc chỉ khi thương hiệu bật; metadata bỏ bằng `C:\hoangpq\remove-watermark-skill` (ảnh gốc giữ, điểm ảnh không đổi, vẫn khai báo AI). Scene-swap (đổi cảnh ảnh của shop tham khảo) chỉ khi thương hiệu bật `product_images.reference_redraw`.
- Cần: Node.js 22+, Codex CLI đã đăng nhập, Playwright MCP gắn Chrome đã đăng nhập Facebook (nghiên cứu), ffmpeg (chỉ khi dùng watermark).
- Kiểm tra: `npm test`.

```
config/settings.json   cài đặt chung: skillsRoot, giới hạn nghiên cứu, codex, ffmpeg, remove_watermark, luật duyệt
scripts/               brands, sources, social, research, ideas, draft, image-clean, queue, approve, writeback (in JSON), dashboard
prompts/               scene-edit.txt (ảnh thương hiệu), scene-swap.txt, caption-brief.md, idea-abstract.md
docs/                  plan.md, research.md (Playwright), scheduled-prompt.md, metricool*.md (giai đoạn sau)
tests/                 cycle.test.mjs (+ fake-codex.mjs), dashboard.test.mjs
workspace/             chỉ ở máy (git bỏ qua): runs/<brand>/<date>/<source>/, drafts/<brand>/<id>/, logs/, settings.json
```

## Dashboard
