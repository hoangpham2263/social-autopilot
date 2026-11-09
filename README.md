# social-autopilot

Tool cho mỗi thương hiệu: xem trang tham khảo → rút ý → làm ảnh và caption riêng của thương hiệu → **người duyệt** → ghi bài đã duyệt vào thư mục skill của thương hiệu. Ảnh bài đã duyệt được đẩy lên repo ảnh công khai `social-autopilot-sources` để có link cho Metricool (`host-image.mjs`). Không tự đăng bài; Publish (Metricool) làm sau.

Một quy trình, hai mặt:
- **Headless** (nguồn duy nhất): agent theo lịch (Claude Code scheduled task/routine, Codex/ChatGPT automation) chạy `RUNBOOK.md` bằng các script trong `scripts/`. Prompt dán vào lịch: `docs/scheduled-prompt.md`. Cuối mỗi vòng agent chạy `node scripts/dashboard.mjs`.
- **Dashboard tĩnh, chỉ xem**: `dashboard.html`, nhấp đúp là mở; không server, không nút thao tác. Quản lý (duyệt/bỏ, sửa `social.json`, chạy lại một bước) làm trong chat với agent hoặc bằng script. Xem mục Dashboard.

- Thương hiệu: thư mục skill chuẩn trong `C:\hoangpq\vaniecom-workspace\skills\` (`skillsRoot`), có `project/social.json` với `enabled: true` và qua `scripts/check-skill.mjs --tool-ready` của skill. Thêm thương hiệu = đặt thư mục skill vào đó. Dữ kiện thương hiệu chỉ nằm trong `skills\<brand>\project\social.json` (và `project.md`); tool không giữ dữ kiện hay nguồn của thương hiệu nào.
- Ảnh: Codex CLI tạo; logo không bao giờ nằm trên sản phẩm; watermark góc chỉ khi thương hiệu bật; metadata bỏ bằng `C:\hoangpq\remove-watermark-skill` (ảnh gốc giữ, điểm ảnh không đổi, vẫn khai báo AI). Scene-swap (đổi cảnh ảnh của shop tham khảo) chỉ khi thương hiệu bật `product_images.reference_redraw`.
- Cần: Node.js 22+, Codex CLI đã đăng nhập, Playwright MCP gắn Chrome đã đăng nhập Facebook (nghiên cứu), ffmpeg (chỉ khi dùng watermark).
- Kiểm tra: `npm test`.

```
config/settings.json   cài đặt chung: skillsRoot, giới hạn nghiên cứu, codex, ffmpeg, remove_watermark, luật duyệt, imageHost
scripts/               brands, sources, social, research, ideas, draft, image-clean, queue, approve, writeback, host-image (in JSON), dashboard
prompts/               scene-edit.txt (ảnh thương hiệu), scene-swap.txt, caption-brief.md, idea-abstract.md
docs/                  plan.md, research.md (Playwright), scheduled-prompt.md, metricool*.md (giai đoạn sau)
tests/                 cycle.test.mjs (+ fake-codex.mjs), dashboard.test.mjs, host-image.test.mjs
workspace/             chỉ ở máy (git bỏ qua): runs/<brand>/<date>/<source>/, drafts/<brand>/<id>/, logs/, settings.json
```

## Dashboard

Trang tĩnh, chỉ để xem trạng thái: một file `dashboard.html` ở gốc tool (git bỏ qua vì chứa dữ liệu máy), dữ liệu nhúng sẵn dạng JSON, ảnh trỏ đường dẫn tương đối tới `workspace/` (không base64), mở bằng `file://`, không server, không gửi gì ra ngoài (chỉ tải font Geist nếu có mạng).

- **Mở**: nhấp đúp `open-dashboard.cmd` (tạo lại rồi mở trong trình duyệt). Hoặc chạy `node scripts/dashboard.mjs` rồi mở `dashboard.html`. Mac: `node scripts/dashboard.mjs && open dashboard.html`.
- **Có gì** (chỉ phần chính): dòng đầu ghi giờ cập nhật và lệnh làm mới; 3 thẻ tổng quan (chờ duyệt, thương hiệu sẵn sàng x/y, đã duyệt chưa đăng); bản nháp chờ duyệt (ảnh, ý tưởng, kênh, link bài tham khảo, caption từng ngôn ngữ thu gọn được, scene-swap có ảnh gốc của shop đặt cạnh ảnh mới, thư mục ẩn trong nút nhỏ, mã để nhắn agent "duyệt <id>" kèm nút Chép); danh sách ngắn bài đã duyệt (POST-xx, link ảnh đã host kèm nút Chép link, hoặc "chưa có link"; chỉ hiện khi có bài đã duyệt); danh sách thương hiệu (trạng thái, phần còn thiếu bằng lời thường, số nguồn tham khảo đang bật). Có lỗi trong 24 giờ qua thì chỉ hiện một dòng cảnh báo với số lỗi và thư mục `workspace/logs`. Tab lọc thương hiệu chỉ hiện khi có hơn 3 thương hiệu.
- **Chỉ đọc**: script chỉ gọi hàm đọc của `scripts/` (brands, research limits, drafts, runs) và không ghi gì vào thư mục thương hiệu hay bản nháp. Duyệt, bỏ, sửa `social.json` làm trong chat với agent.
- Trang ghi giờ tạo; dữ liệu cũ hơn 1 ngày thì hiện cảnh báo. `--out <file>` để ghi chỗ khác (test dùng).

## Host ảnh (link cho Metricool)

`node scripts/host-image.mjs publish --brand <id> --post POST-xx` (tự chạy sau `approve`/`writeback`): chỉ bài đã được người duyệt trong catalog của thương hiệu; kiểm lại sạch metadata; chép ảnh vào repo công khai `C:\hoangpq\social-autopilot-sources` tại `<brand>/<yyyy>/<mm>/<post-id>.<ext>`, commit "`<brand> <post-id>`", push, chờ link `https://raw.githubusercontent.com/hoangpham2263/social-autopilot-sources/main/...` trả HTTP 200, rồi ghi `media_url` vào mục catalog. `remove` gỡ file (commit + push) khi Metricool đã lưu bản riêng. Chạy lại không trùng. Cấu hình: `imageHost` trong `config/settings.json` (`type: "github-repo"`; `"shopify-files"` để sau). Không đăng hay gửi gì tới Metricool/mạng xã hội.
