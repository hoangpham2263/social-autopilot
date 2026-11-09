# Prompt cho lịch chạy

Dán nguyên khối dưới đây vào Claude Code scheduled task / routine, hoặc Codex/ChatGPT automation. Gợi ý lịch: mỗi ngày một lần, buổi sáng. Agent cần: quyền chạy `node` và `codex` trong `C:\hoangpq\social-autopilot`, đọc `C:\hoangpq\vaniecom-workspace\skills\`, Playwright MCP gắn Chrome đã đăng nhập Facebook.

```text
Bạn chạy MỘT vòng social-autopilot.

Thư mục làm việc: C:\hoangpq\social-autopilot. Đọc AGENTS.md rồi làm đúng RUNBOOK.md, từ bước 0 tới bước 7:
0. node scripts/approve.mjs sync; node scripts/brands.mjs; node scripts/sources.mjs.
1. Với từng thương hiệu usable, lần lượt (không song song): research.mjs start (tôn trọng giới hạn; bị chặn thì bỏ qua nghiên cứu), duyệt các source của chính thương hiệu đó theo docs/research.md, research.mjs ingest.
2. ideas.mjs init, điền ý theo prompts/idea-abstract.md, pick tối đa 1 ý cho thương hiệu này trong vòng này.
3. draft.mjs new với ảnh sản phẩm của chính thương hiệu (scene-swap --ref-image chỉ khi social.json product_images.reference_redraw.enabled), hoàn thiện prompt.txt (giữ lệnh NO LOGO), draft.mjs image (tự làm sạch metadata bằng remove-watermark-skill), watermark nếu thương hiệu bật, scene-swap thì xem ảnh rồi confirm-clean, viết caption theo brief.md và skill của thương hiệu, draft.mjs check.
4. KHÔNG tự duyệt. Không ghi gì vào thư mục thương hiệu. Không đăng bài ở đâu (Metricool chưa làm).
5. Cuối vòng: node scripts/queue.mjs, rồi gửi tôi báo cáo ngắn bằng tiếng Việt: mỗi thương hiệu, số bài đã nghiên cứu hoặc lý do bị chặn; danh sách chờ duyệt (id, đường dẫn image.png, caption từng ngôn ngữ nguyên văn, link bài tham khảo; scene-swap kèm ảnh gốc của shop); lỗi cần tôi xử lý. Nhắc tôi trả lời "duyệt <id>" hoặc "bỏ <id>: lý do".
6. Kết thúc vòng (kể cả khi dừng sớm): node scripts/dashboard.mjs, rồi nhắc tôi mở dashboard.html (chỉ xem; mọi thao tác làm trong chat).

Mọi script in JSON; ok:false thì ghi lý do và sang việc tiếp theo, không lách giới hạn. Gặp checkpoint/captcha Facebook thì dừng nghiên cứu ngay.
```

Khi người dùng trả lời trong chat "duyệt <id>": agent chạy `node scripts/approve.mjs approve --id <id> --by "<tên người duyệt>"` (tên phải khớp `approval.owner` trong social.json của thương hiệu) và báo lại POST-xx cùng thư mục bài và link ảnh đã host (`image_host.url`, hoặc lỗi + lệnh `image_host.next` nếu chưa có link), rồi chạy `node scripts/dashboard.mjs` để dashboard cập nhật.
