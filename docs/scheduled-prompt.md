# Prompt cho lịch chạy

Dán nguyên khối dưới đây vào Claude Code scheduled task / routine, hoặc Codex/ChatGPT automation. Gợi ý lịch: mỗi ngày một lần, buổi sáng. Agent cần: quyền chạy `node` và `codex` trong `C:\hoangpq\social-autopilot`, đọc `C:\hoangpq\vaniecom-workspace\skills\`, Playwright MCP gắn Chrome đã đăng nhập Facebook, connector claude.ai "Metricool" (tool MCP `createScheduledPost`, `getScheduledPosts`; gói Starter, không REST API).

```text
Bạn chạy MỘT vòng social-autopilot.

Thư mục làm việc: C:\hoangpq\social-autopilot. Đọc AGENTS.md rồi làm đúng RUNBOOK.md, từ bước 0 tới bước 7 (kể cả bước 5c):
0. node scripts/approve.mjs sync; node scripts/brands.mjs; node scripts/sources.mjs.
1. Với từng thương hiệu usable, lần lượt (không song song): research.mjs start (không giới hạn lượt/bài; vẫn nghỉ ngẫu nhiên giữa thao tác), duyệt các source của chính thương hiệu đó theo docs/research.md, research.mjs ingest.
2. ideas.mjs init, điền ý theo prompts/idea-abstract.md, pick tối đa 1 ý cho thương hiệu này trong vòng này.
3. draft.mjs new với ảnh sản phẩm của chính thương hiệu (scene-swap --ref-image chỉ khi social.json product_images.reference_redraw.enabled), hoàn thiện prompt.txt (giữ lệnh NO LOGO), draft.mjs image (tự làm sạch metadata bằng remove-watermark-skill), watermark nếu thương hiệu bật, scene-swap thì xem ảnh rồi confirm-clean, viết caption theo brief.md và skill của thương hiệu, draft.mjs check.
4. KHÔNG tự duyệt. Không ghi gì vào thư mục thương hiệu trước khi tôi duyệt. Không đăng thẳng lên mạng xã hội.
4b. Gửi lên Metricool qua MCP (RUNBOOK bước 5c), chỉ bài tôi đã duyệt và đã host ảnh, từng thương hiệu:
   a. node scripts/metricool-mcp.mjs status --brand <id>; có query thì gọi tool MCP getScheduledPosts với đúng tham số, khớp theo id: ERROR thì báo tôi, PUBLISHED thì chạy mark-published.mjs của skill, PENDING/nháp thì để yên.
   b. node scripts/metricool-mcp.mjs payload --brand <id> (mặc định nháp; chỉ --schedule khi tôi bảo hẹn giờ thật).
   c. Với từng item: gọi createScheduledPost với đúng args.blogId, args.date, args.info (không sửa info), rồi chạy lệnh item.record với id, uuid, plannerUrl, publicationDate.dateTime, publicationDate.timezone Metricool trả về.
   Không bao giờ tạo/sửa bài cho Fortera Apparel (blogId <blog_id_1>). Không dùng createScheduledPostForReview. MCP lỗi thì ghi vào báo cáo; CSV (metricool-csv.mjs) chỉ là dự phòng.
5. Cuối vòng: node scripts/queue.mjs, rồi gửi tôi báo cáo ngắn bằng tiếng Việt: mỗi thương hiệu, số bài đã nghiên cứu hoặc lý do bị chặn; danh sách chờ duyệt (id, đường dẫn image.png, caption đăng nguyên văn (tiếng Anh) và bản tiếng Việt chỉ để duyệt (ghi rõ không đăng), link bài tham khảo; scene-swap kèm ảnh gốc của shop); bài đã gửi lên Metricool (nháp/hẹn giờ, giờ khách, plannerUrl), bài đã đăng, bài Metricool ERROR; lỗi cần tôi xử lý. Nhắc tôi trả lời "duyệt <id>" hoặc "bỏ <id>: lý do".
6. Kết thúc vòng (kể cả khi dừng sớm): nhắc tôi mở app (start-app.cmd) để duyệt/bỏ, hoặc trả lời trong chat. Không dựng trang nào; app đọc dữ liệu mới mỗi lần mở.

Mọi script in JSON; ok:false thì ghi lý do và sang việc tiếp theo, không lách luật. Không bao giờ ghi nhãn AI trong caption. Gặp checkpoint/captcha Facebook thì dừng nghiên cứu ngay.
```

Khi người dùng trả lời trong chat "duyệt <id>": agent chạy `node scripts/approve.mjs approve --id <id>` (không có người duyệt đích danh; `--by` tuỳ chọn, chỉ ghi vết) và báo lại POST-xx cùng thư mục bài và link ảnh đã host (`image_host.url`, hoặc lỗi + lệnh `image_host.next` nếu chưa có link). App tự hiện trạng thái mới khi mở lại.
