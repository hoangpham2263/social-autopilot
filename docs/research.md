# Chế độ "Chỉ nghiên cứu": crawl hết bài của nguồn vào kho

Agent làm phần duyệt trang (Playwright MCP trên Chrome đã đăng nhập); tool không có scraper. Lệnh và thứ tự: `RUNBOOK.md`, Chế độ 1. Kho của mỗi thương hiệu: `workspace/store/<brand>/` (`items.json`, `images/`, `progress.json`, `duplicates.json`); DreamyVows và GRENHEIM không bao giờ trộn.

## Trước khi bắt đầu
- Công cụ: Claude Code hoặc Codex có Playwright MCP (`npx -y @playwright/mcp@latest --extension`) gắn vào Chrome đã đăng nhập Facebook bằng tài khoản phụ (`research.fb_account` trong social.json). Không tự đăng nhập, không nhập mật khẩu, không lưu cookie.
- Chỉ mở các source mà `research.mjs start` trả về (`run.sources`), đúng thứ tự, của **một** thương hiệu. Một Chrome, một agent: không chạy song song.
- Đọc `stop_rule` và `known_file` của từng source. `known.json` có `post_urls` (bài của nguồn này trong kho), `brand_post_urls` và `brand_post_ids` (mọi link/mã bài Facebook đã có trong kho của thương hiệu, mọi nguồn), `newest_posted_date`.

## Nhịp và an toàn
- Nghỉ ngẫu nhiên trong `delay_seconds` (mặc định 5-15 giây) giữa **mọi** lần mở trang, cuộn, bấm; cuộn từng đoạn như người đọc, không cuộn liên tục.
- Dừng ngay khi gặp checkpoint, captcha, "Bạn tạm thời bị chặn", yêu cầu đăng nhập lại hay xác minh: `research.mjs result --source <sid> --state blocked --note "<lý do>"`, không mở thêm source nào trong lượt này, không thử lại trong ngày.

## Crawl hết bài của một source
1. Mở `url` của source. Trang Facebook: vào tab **Bài viết** (hoặc trang chính, phần bài viết). Nếu nguồn chủ yếu đăng ảnh (album sản phẩm), dùng tab **Ảnh** (`/photos` hoặc `/photos_by`), mở từng ảnh để vào bài.
2. Cuộn xuống dần (mỗi lần một màn hình, nghỉ giữa các lần) cho tới khi đúng `stop_rule`:
   - **hết trang**: cuộn thêm 3 lần liền mà không có bài mới hiện ra (không còn vòng tải thêm) → `--state end`;
   - **tới bài đã có** (lần crawl sau, không `--full`): gặp **3 bài liên tiếp** có link hoặc mã nằm trong `known.json` → `--state known`. Bài ghim đầu trang có thể là bài cũ: bỏ qua, đi tiếp;
   - **tới mốc ngày** (`--since`): tới bài đăng trước ngày đó → `--state since`;
   - **đủ số bài** (`--max-posts N`): đã lấy N bài mới → `--state limit`;
   - dừng giữa chừng vì lý do khác (hết thời gian, trang lỗi) → `--state partial --note "<lý do>"`.
3. Với **mỗi bài** trong lúc cuộn (`[data-ad-rendering-role="story_message"]` là phần chữ của bài):
   - Lấy link bài (`https://www.facebook.com/<trang>/posts/<id>`, `/permalink/...`, hoặc `https://www.facebook.com/photo/?fbid=...`). Nếu link hoặc mã số trong link (fbid, story_fbid, `/posts/<id>`, `pfbid...`) có trong `known.json` (`brand_post_urls`, `brand_post_ids`): **bỏ qua, không mở, không tải**.
   - Bài mới: mở bài (hoặc ảnh → "Xem bài viết"), bấm "Xem thêm" để có **caption đầy đủ**; lưu nguyên văn (U+034F và ký tự ẩn để `ingest` lọc).
   - **Ngày đăng**: đọc nhãn thời gian của bài, ghi `posted_date` dạng `YYYY-MM-DD` (không rõ thì bỏ trống).
   - **Ảnh**: mỗi ảnh của bài, lấy URL `scontent` lớn nhất (mở ảnh ở chế độ xem lớn), tải bằng curl vào `<source>/raw/<n>-<k>.jpg`. Ưu tiên JPEG/PNG; WebP chỉ khi không có cách khác. Không chụp màn hình thay ảnh. Bài video: lấy ảnh bìa.
   - Ghi mọi link khác của cùng bài thấy được (link `photo/?fbid=...` của từng ảnh, permalink) vào `alt_urls`: Facebook hiện một bài dưới nhiều mã, `ingest` dùng các mã này để bỏ trùng.
   - Tên shop (`store`), loại sản phẩm (`main_product`), giá ghi công khai (`price_seen`): tuỳ chọn.
4. Ghi `<source>/raw.json` (có thể ghi và `ingest` nhiều đợt trong lúc cuộn; bài đã vào kho được bỏ qua ở đợt sau):
   ```json
   [
     { "post_url": "https://www.facebook.com/shop/posts/1234567890",
       "alt_urls": ["https://www.facebook.com/photo/?fbid=1122334455"],
       "posted_date": "2026-10-28",
       "caption": "...",
       "images": ["raw/1-1.jpg", "raw/1-2.jpg"],
       "main_product": "đèn neon Happy Birthday để bàn", "price_seen": "600.000đ", "store": "Tên trang" }
   ]
   ```
5. `node scripts/research.mjs ingest --brand <id> --source <sid>` rồi `node scripts/research.mjs result --brand <id> --source <sid> --state <...>`. Sang source tiếp theo.
6. Hết các source: `node scripts/research.mjs report --brand <id>` và báo người dùng.

## Bỏ trùng (tool tự làm khi ingest)
Kho không bao giờ giữ một bài hai lần, trên mọi nguồn của thương hiệu:
- cùng link bài (bỏ `www.`/`m.`, tham số theo dõi) hoặc cùng mã bài Facebook (kể cả `alt_urls`);
- cùng ảnh: SHA-1 của file, hoặc ảnh gần giống (dHash 256 bit, khác ≤ `research.dedupe.image_distance`, mặc định 20 bit): shop khác đăng lại hay Facebook nén lại vẫn bị bắt. JPEG/PNG đọc được trên Windows (System.Drawing) và macOS (sips); WebP cần ffmpeg (`settings.ffmpeg.command`), không có thì chỉ so SHA-1 (JSON báo `images_without_phash`);
- cùng caption (chữ thường, bỏ ký tự ẩn, emoji, hashtag, link, số điện thoại, dấu câu) hoặc giống ≥ `research.dedupe.caption_similarity` (mặc định 90%), với caption đủ dài (≥ 40 ký tự sau chuẩn hoá).

Bài trùng ghi vào `duplicates.json` (khớp bài nào, luật nào); báo cáo ghi "x bài trùng bỏ qua" theo nguồn.

## Lấy gì, không lấy gì
- Lấy: ảnh bài, caption, ngày đăng, link bài, loại sản phẩm, giá công khai. Chỉ để học ý (loại sản phẩm, bối cảnh, góc chụp, khung bài).
- Không lấy: bình luận, tên/ảnh người bình luận, tin nhắn, thông tin cá nhân.
- Ảnh và caption đối thủ chỉ nằm trong `workspace/` (git bỏ qua), không bao giờ vào bài của thương hiệu (trừ scene-swap opt-in, đã xoá logo/tên shop).

## Bài học
- Facebook chèn U+034F và ký tự zero-width vào caption: luôn qua `ingest`, không dùng caption thô.
- Facebook hiện cùng một bài dưới nhiều mã (bài và từng ảnh; đã gặp với Duo Decor): ghi `alt_urls`; `ingest` còn so ảnh và caption.
- Dựng lại cảnh từ ảnh đối thủ vẫn là sản phẩm của họ: bài thật dùng ảnh sản phẩm của thương hiệu.
