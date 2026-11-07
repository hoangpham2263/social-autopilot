# social-autopilot

Tool cho mỗi thương hiệu: xem trang tham khảo → rút ý → làm ảnh và caption riêng của thương hiệu → **người duyệt** → ghi bài đã duyệt vào thư mục skill của thương hiệu. Không tự đăng bài; Publish (Metricool) làm sau.

Hai cách dùng, cùng một quy trình:
- **Headless** (chính): agent theo lịch (Claude Code scheduled task/routine, Codex/ChatGPT automation) chạy `RUNBOOK.md` bằng các script trong `scripts/`. Prompt dán vào lịch: `docs/scheduled-prompt.md`.
- **Giao diện quản lý**: mở `start-app.cmd` (Windows) hoặc `start-app.command` (Mac). App chạy ở `http://127.0.0.1:<47000 + hash thư mục>/` (đặt `SA_PORT` để chọn cổng; chạy tay: `node src/server.mjs`). Trang: Thương hiệu (trạng thái `--tool-ready`), Sửa social.json, Nghiên cứu, Bản nháp (Duyệt/Bỏ), Cài đặt (kèm prompt lịch và nút chép). Giao diện chỉ gọi hàm của `scripts/`, không có quy trình riêng.

- Thương hiệu: thư mục skill chuẩn trong `C:\hoangpq\vaniecom-workspace\skills\` (`skillsRoot`), có `project/social.json` với `enabled: true` và qua `scripts/check-skill.mjs --tool-ready` của skill. Thêm thương hiệu = đặt thư mục skill vào đó. Tool không giữ dữ kiện hay nguồn của thương hiệu nào.
- Ảnh: Codex CLI tạo; logo không bao giờ nằm trên sản phẩm; watermark góc chỉ khi thương hiệu bật; metadata bỏ bằng `C:\hoangpq\remove-watermark-skill` (ảnh gốc giữ, điểm ảnh không đổi, vẫn khai báo AI). Scene-swap (đổi cảnh ảnh của shop tham khảo) chỉ khi thương hiệu bật `product_images.reference_redraw`.
- Cần: Node.js 22+, Codex CLI đã đăng nhập, Playwright MCP gắn Chrome đã đăng nhập Facebook (nghiên cứu), ffmpeg (chỉ khi dùng watermark).
- Kiểm tra: `npm test`.

```
config/settings.json   cài đặt chung: skillsRoot, giới hạn nghiên cứu, codex, ffmpeg, remove_watermark, luật duyệt
scripts/               brands, sources, social, research, ideas, draft, image-clean, queue, approve, writeback (in JSON)
prompts/               scene-edit.txt (ảnh thương hiệu), scene-swap.txt, caption-brief.md, idea-abstract.md
src/server.mjs, ui/    giao diện quản lý (lớp mỏng trên scripts/)
core/                  vỏ chung của Product Review/Video: launcher WebView2, Cấu hình, Cập nhật, bridge 8795
docs/                  plan.md, research.md (Playwright), scheduled-prompt.md, index.html (trang tải)
workspace/             chỉ ở máy (git bỏ qua): runs/<brand>/<date>/<source>/, drafts/<brand>/<id>/, logs/, settings.json
```
