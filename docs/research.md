# Nghiên cứu trên Facebook bằng Playwright

Agent làm phần duyệt trang; tool không có scraper. Rút từ bản thử `C:\hoangpq\neon-competitors\` (07/11/2026).

## Trước khi bắt đầu
- Chỉ mở các source mà `research.mjs start` trả về (`run.sources`), đúng thứ tự, của **một** thương hiệu.
- Playwright MCP gắn vào Chrome đã đăng nhập Facebook (nên dùng tài khoản phụ, ghi ở `research.fb_account` của social.json). Không tự đăng nhập, không lưu cookie, không nhập mật khẩu.
- `mode: semi-auto`: chỉ đọc trang người dùng đang mở hoặc link người dùng gửi.
- Một Chrome, một agent: không chạy song song thương hiệu khác.

## Mỗi source
1. Mở `url` của source. Nghỉ ngẫu nhiên trong `delay_seconds` (mặc định 5-15 giây) giữa mọi lần mở trang, cuộn, bấm.
2. Bài trong feed: `[data-ad-rendering-role="story_message"]`. Lấy tối đa `max_posts` bài hợp `what_to_take` của source.
3. Caption đầy đủ: mở ảnh của bài, bấm "Xem bài viết" (hoặc "Xem thêm"), đọc lại `story_message`. Caption Facebook có ký tự ẩn U+034F; cứ lưu nguyên, `ingest` sẽ lọc.
4. Ảnh: lấy URL `scontent` lớn nhất của ảnh bài, tải bằng curl vào `<source>/raw/<n>.jpg`. Không chụp màn hình thay ảnh.
5. Link bài: dạng `https://www.facebook.com/photo/?fbid=...` hoặc link bài viết.
6. Ghi `<source>/raw.json`:
   ```json
   [
     { "post_url": "https://www.facebook.com/photo/?fbid=...", "caption": "...", "image": "raw/1.jpg",
       "main_product": "đèn neon Happy Birthday để bàn", "price_seen": "600.000đ", "store": "Tên trang" }
   ]
   ```
7. Dừng ngay khi gặp checkpoint, captcha, "bạn tạm thời bị chặn", yêu cầu đăng nhập lại. Ghi lý do vào báo cáo; không thử lại trong ngày.

## Lấy gì, không lấy gì
- Lấy: ảnh bài, caption, loại sản phẩm, giá nếu ghi công khai, link bài. Chỉ để học ý (loại sản phẩm, bối cảnh, góc chụp, khung bài).
- Không lấy: bình luận, tên/ảnh người bình luận, tin nhắn, thông tin cá nhân.
- Ảnh và caption đối thủ chỉ nằm trong `workspace/runs/` (git bỏ qua), không bao giờ vào bài của thương hiệu.

## Bài học từ bản thử
- Dựng lại cảnh từ ảnh đối thủ (bg-test) vẫn là sản phẩm của họ: chỉ dùng để thử prompt, **không giao thành bài**. Bài thật dùng ảnh sản phẩm của thương hiệu.
- Prompt Codex tốt: tả sản phẩm từng chữ, dấu, font, màu, vật liệu, dây, tỉ lệ so với đồ xung quanh; cảnh mới hợp cách dùng thật; 1-2 đạo cụ; xoá logo/watermark/nhãn size; "No people"; ảnh thứ hai chỉ là ảnh không khí.
- Kiểm từng chữ và dấu sau khi tạo (Codex từng đọc "a" thành "o"); Codex có hạn mức ảnh.
