# Biến bài tham khảo thành ý trừu tượng

Dùng cho từng ý trong `workspace/store/<brand>/ideas.json` (Mode 2 "Create & publish", RUNBOOK bước 2.3). Nhìn ảnh `ref_image` và caption của bài kho (`item`; `node scripts/store.mjs show --brand <id> --id S0001`), rồi đọc `project/project.md` của thương hiệu (mục 4 khách, 5 sản phẩm, 10 quy tắc riêng).

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
| product_size | cỡ thật theo bối cảnh (social.json product_images.size_source; image-guide của skill) | 60 cm (24 in) ngang |
| size_compare | vật so sánh trong cảnh + cỡ thật của nó (sản phẩm ≤ 60% vật đó, ≤ 40% tường, chiếm 20-35% ngang ảnh trừ bài cận cảnh) | tủ gỗ bên dưới, 120 cm (47 in) ngang |
| audience | chỉ khi custom_text, bước 1: ai xem bài | cặp đôi sắp cưới ở Mỹ |
| scene_type | chỉ khi custom_text, bước 2: một khoá của bảng loại bảng x cảnh trong project.md mục 10 (khối Sign wording rules) | wedding |
| sign_text | chỉ khi custom_text, bước 3: chữ MỚI tiếng Anh, hư cấu, hợp cảnh + audience; không chép chữ/tên/chữ ngoại ngữ của ảnh tham khảo, khác 10 bài gần nhất; cả keep-scene lẫn new-scene | Mia & Jonah |
| text_reason | chỉ khi custom_text, bước 3: vì sao khách này muốn đúng chữ này ở cảnh này | cặp mới đính hôn thích tên riêng ở bàn sweetheart |
| ref_has_face | chỉ scene-swap: ảnh tham khảo có mặt người (ai nhận ra được) không | false |
| ref_mode | chỉ scene-swap: không mặt người → keep-scene (giữ cảnh, chữ mới); có mặt người → new-scene (cảnh mới, xoá người, giữ chữ) | keep-scene |
| ref_text | scene-swap (bắt buộc khi custom_text, cả hai mode): chữ đang có trên sản phẩm trong ảnh tham khảo, đúng từng ký tự ("unreadable" nếu không đọc được) | Love |

Thương hiệu custom_text: làm theo thứ tự RUNBOOK 2.3a (ý + audience, scene_type, rồi mới chữ); kiểm bằng `node scripts/ideas.mjs check --brand <id> --id I001`.

Trước khi chọn ý: **kiểm sản phẩm hợp bối cảnh** theo image-guide của skill (mục "Sản phẩm hợp bối cảnh") và bảng trong project.md mục 10 (vd biển quán bar/logo cửa hàng chỉ ở địa điểm kinh doanh thật, nhà ở chỉ bảng cá nhân). Sai cặp thì đổi scene cho đúng hoặc reject.

Không bao giờ:
- chép câu, cụm 6 từ trở lên, giá, số điện thoại, link, tên shop hay hashtag của bài tham khảo (`ideas.mjs set` chặn);
- mô tả để vẽ lại ảnh, logo, thiết kế hay chữ trên sản phẩm của đối thủ;
- dùng ảnh tham khảo làm ảnh đưa vào Codex (`draft.mjs new` chặn).

Bài kho đã dùng trước (`previous_uses` trong kết quả `init` / file ý): chỉ giữ cảm hứng, chọn **góc mới**: cảnh khác VÀ sản phẩm hoặc chữ (`sign_text`) khác mọi lượt trước; lặp lại bị chặn.

Ý không hợp thương hiệu thì `ideas.mjs reject --note "<lý do>"` (thêm `--item rejected` nếu bài kho cũng không nên dùng lại).
