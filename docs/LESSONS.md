# LESSONS: đọc trước khi làm bài

Bài học đã đúc kết của dự án, ngắn gọn. Luật chi tiết của từng thương hiệu nằm trong skill (`references/image-guide.md`, `project/project.md` mục 8, 10).

## Ảnh: sản phẩm
- Không bao giờ đặt logo thương hiệu lên sản phẩm (prompt giữ NO LOGO); logo chỉ là watermark nhỏ ở góc khi thương hiệu bật.
- Prompt tả sản phẩm từng chữ: ký tự, dấu, font, màu, vật liệu; kiểm lại chữ sau khi tạo.
- Sản phẩm chữ theo khách (`custom_text`): chữ hợp cảnh đúng kiểu chữ của sản phẩm; không placeholder ("Your Names", "Your Logo"); không tên thương hiệu/shop bên thứ ba; không tên khách thật lấy từ ảnh tham khảo (dùng tên tự đặt).

## Ảnh: bối cảnh và kích thước
- Sản phẩm hợp bối cảnh: biển kinh doanh (bar, café, logo, "Open", menu) chỉ ở địa điểm kinh doanh thật; bảng cá nhân (tên cặp đôi, tên bé, chữ ngắn) ở nhà. Kiểm ở bước ý tưởng.
- Cỡ theo bối cảnh: nhà ở nhỏ/vừa, hẹp hơn đồ bên dưới; địa điểm kinh doanh vừa/lớn nhưng vẫn theo tỉ lệ dưới.
- AI luôn vẽ sản phẩm to hơn thật. Prompt có số, không chỉ "đúng cỡ":
  - gọi tên vật so sánh kèm cỡ thật (`--compare "the 4-seat table below, 120 cm (47 in) wide"`); không viết "to bằng cái bàn";
  - sản phẩm ≤ 60% món đồ bên dưới (bàn/sofa/giường/quầy), ≤ ~40% mảng tường, chừa tường phía trên ≥ 20% chiều cao sản phẩm và hai bên;
  - ảnh phòng/toàn cảnh, sản phẩm chiếm ~20-35% ngang ảnh, trừ bài cận cảnh (`--close-up`).
- Sau mỗi ảnh: đo và ghi `draft.mjs size-check --id <id> --product-pct N --object-pct N`; vượt giới hạn thì tạo lại MỘT lần (`reprompt --smaller N` + `image --force`); vẫn vượt thì báo.
- GRENHEIM: kích thước thật từ trang sản phẩm; đồ đúng phòng (bàn ăn ở phòng ăn, console ở lối vào...); kích thước phải ước lượng thì ghi rõ là ước lượng.

## Ảnh: trông như ảnh đời thật
- Ảnh chụp thật, ngẫu hứng: điện thoại/DSLR ngang tầm mắt, bố cục hơi lệch tâm, không đối xứng hoàn hảo.
- Ánh sáng hỗn hợp tự nhiên (đèn trong phòng + cửa sổ/ánh sáng môi trường), phơi sáng thật, không HDR, không quá bão hoà; có chút hạt/nhiễu.
- Vật liệu có dấu dùng (trầy, dấu tay, sơn không đều); chi tiết đời sống (khăn giấy, menu, chai gia vị, áo khoác vắt ghế). Không sạch kiểu showroom, không bóng kiểu CGI/3D.
- Người: tuỳ chọn, chỉ một phần trong khung hoặc mờ hậu cảnh; không mặt rõ, không nhận ra được ai.
- Neon/đèn sáng thật: quầng mềm, loang nhẹ và đổ màu lên tường gần, phản chiếu nhẹ; chữ vẫn nét.
- Ảnh vẫn trông dựng/render thì tạo lại một lần.

## Bài từ ảnh tham khảo (scene-swap): keep-scene / new-scene (người dùng, 10/11/2026)
- Luôn lấy SẢN PHẨM từ ảnh tham khảo (đúng bảng/đồ đó) và luôn xoá mọi logo, tên shop, watermark, nhãn size, số điện thoại, giá, chữ phủ lạ; `confirm-clean` sau khi xem.
- Agent NHÌN ảnh tham khảo rồi chọn chế độ, ghi `ref_has_face` + `ref_mode` (file ý, draft.json):
  - **Không có mặt người → `keep-scene`:** GIỮ nguyên cảnh/nền/khung hình gốc, CẬP NHẬT chữ trên sản phẩm: chữ mới hợp bối cảnh, CÙNG ngôn ngữ/chữ viết với chữ gốc, đúng font/màu/bố cục của sản phẩm; không placeholder, không tên thương hiệu bên thứ ba, không tên khách thật. Ghi `ref_text` (chữ gốc) + `sign_text` (chữ mới, phải khác chữ gốc); caption nhắc đúng chữ mới. Không đo tỉ lệ (giữ khung gốc).
  - **Có mặt người (bất kỳ ai nhận ra được) → `new-scene`:** ĐỔI sang cảnh đời thật mới hợp sản phẩm, xoá hẳn mọi người (không dùng người nào trong ảnh của họ); chữ trên sản phẩm giữ nguyên. Luật tỉ lệ + ảnh như đời thật vẫn áp dụng (lùi máy khỏi ảnh cận, `size-check`); `confirm-clean --no-people` sau khi xem không còn người.
- Ảnh tham khảo có chữ mẫu ("Your Names"): keep-scene thay bằng chữ thật; new-scene thì không dùng ảnh đó.
- Caption không bịa nghĩa/bản dịch của chữ khi không chắc: gọi là "the lettering on the sign", nói về thiết kế, cách đặt làm.

## Caption
- Không bao giờ nhãn AI trên bài (`isAiGenerated` false).
- Bài tham khảo chỉ cho giọng/hook; bố cục luôn theo mục 8 của skill. Không chép chữ, tên shop của bài tham khảo.
- Xem kỹ từng ảnh (contact sheet) trước khi viết caption; chữ trong caption đúng chữ thấy trong ảnh.

## Quy trình và tool
- Skill chỉ đọc: tool không ghi vào thư mục skill. Tool chỉ đụng bài của chính nó (`workspace/posts/<brand>/`).
- Agent không bao giờ Approve; dừng ở To review.
- Metricool: không bao giờ nháp; luôn bài hẹn giờ thật vào giờ chính tốt nhất; không bao giờ gửi một bài hai lần.
- Một trình duyệt = một agent: Chrome đã đăng nhập (Playwright MCP) chỉ một agent dùng một lúc; test/UI không mở trình duyệt đó.
