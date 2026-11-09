# Biến bài tham khảo thành ý trừu tượng

Dùng cho từng ý trong `workspace/store/<brand>/ideas.json` (chế độ "Làm bài & đưa lên", bước 2.1). Nhìn ảnh `ref_image` và caption của bài kho (`item`; `node scripts/store.mjs show --brand <id> --id S0001`), rồi đọc `project/project.md` của thương hiệu (mục 4 khách, 5 sản phẩm, 10 quy tắc riêng).

Điền các trường bằng lời của mình, ngắn, ở dạng thương hiệu **có thể tự làm với sản phẩm của chính mình**:

| Trường | Ghi gì | Ví dụ |
|---|---|---|
| product_type | loại sản phẩm của THƯƠNG HIỆU hợp với ý (theo project.md mục 5) | neon chữ viết tay để bàn |
| scene | bối cảnh dùng thật (theo mục 4, 10) | bàn ăn tối kỷ niệm trong nhà hàng, chạng vạng |
| angle | góc máy, khoảng cách | ngang tầm mắt người ngồi, hơi chéo |
| props | 1-2 đạo cụ | bình hoa nhỏ |
| caption_structure | khung bài, không câu chữ | mở bằng dịp dùng, 2 ý về cách đặt làm, CTA tự thiết kế trên web |
| hook | góc kể chuyện | quà kỷ niệm để bàn, mang đi được |
| why | vì sao ý này hợp khách của thương hiệu | khách cưới/kỷ niệm ở Mỹ |

Không bao giờ:
- chép câu, cụm 6 từ trở lên, giá, số điện thoại, link, tên shop hay hashtag của bài tham khảo (`ideas.mjs set` chặn);
- mô tả để vẽ lại ảnh, logo, thiết kế hay chữ trên sản phẩm của đối thủ;
- dùng ảnh tham khảo làm ảnh đưa vào Codex (`draft.mjs new` chặn).

Ý không hợp thương hiệu thì `ideas.mjs reject --note "<lý do>"` (thêm `--item rejected` nếu bài kho cũng không nên dùng lại).
