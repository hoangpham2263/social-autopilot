# Brief caption: {{BRAND}}

Viết caption bằng skill của thương hiệu, không bằng giọng riêng của tool.

1. Đọc `{{SKILL}}` (quy trình viết bài, mục A; kiểm tra, mục E) và `{{PROJECT}}` (các mục social.json chỉ định: {{SECTIONS}}; thêm mục 4 khách, 5 sản phẩm, 6 điều kiện bán khi cần dữ kiện).
2. Nội dung bài theo ý đã chọn dưới đây. Ý này là ý trừu tượng rút từ một bài tham khảo; **không** dùng câu chữ, giá, số điện thoại, tên shop của bài tham khảo.
3. Chữ trên sản phẩm trong caption phải đúng chữ nhìn thấy trong `image.png`.
4. Không bịa dữ kiện ngoài project.md (giá, thời gian giao, review khách).
5. Ảnh là ảnh dựng cảnh bằng AI: KHÔNG thêm nhãn AI hay chữ công bố AI vào caption hay bài đăng.

## Ý đã chọn

```json
{{IDEA}}
```

## Kênh và ngôn ngữ (social.json)

{{NETWORKS}}

## File cần viết (trong thư mục bản nháp này)

{{FILES}}

Biến thể theo kênh chỉ khi kênh cần (ví dụ TikTok không xuống dòng): `content-<lang>-<network>.txt`.

Mỗi file: chữ thường, không Markdown, không ký tự ẩn, không quá một dòng trống liền nhau; có dòng `🌐 Website: {{WEBSITE}}`; dòng cuối có hashtag `{{HASHTAG}}`.

Xong chạy `node scripts/draft.mjs check --id <id>`.
