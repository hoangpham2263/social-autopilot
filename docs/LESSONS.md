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

## Scene-swap (ảnh tham khảo làm ảnh sản phẩm)
- Giữ nguyên TOÀN BỘ sản phẩm, kể cả chữ trên sản phẩm (đúng từng ký tự, hướng, bố cục); chỉ đổi nền và nội dung caption.
- Xoá mọi logo, watermark, nhãn size, điện thoại, giá, chữ phủ của shop nguồn; `confirm-clean` sau khi xem.
- Ảnh tham khảo là ảnh cận, sản phẩm đầy khung: không giữ tỉ lệ đó, lùi máy, đặt đúng cỡ thật trong phòng.
- Ảnh tham khảo có chữ mẫu ("Your Names") thì không scene-swap ảnh đó.
- Caption không bịa nghĩa/bản dịch của chữ khi không chắc: gọi là "the lettering on the sign", nói về thiết kế, cách đặt làm.

## Caption
- Không bao giờ nhãn AI trên bài (`isAiGenerated` false).
- Bài tham khảo chỉ cho giọng/hook; bố cục luôn theo mục 8 của skill. Không chép chữ, tên shop của bài tham khảo.
- Xem kỹ từng ảnh (contact sheet) trước khi viết caption; chữ trong caption đúng chữ thấy trong ảnh.

## Quy trình và tool
- Skill chỉ đọc: tool không ghi vào thư mục skill. Tool chỉ đụng bài của chính nó (`workspace/posts/<brand>/`).
- Agent không bao giờ Approve; dừng ở To review.
- Metricool: không bao giờ nháp; luôn bài hẹn giờ thật vào giờ chính tốt nhất; không bao giờ gửi một bài hai lần.
- Một trình duyệt = một agent; không đụng Chrome crawl (:9222) từ test/UI.
