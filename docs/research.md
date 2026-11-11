# Mode 1 "Research only": Claude mở trang, cuộn, gọi script trích xuất; nhìn ảnh để lọc

**Ai làm:** Claude (Playwright MCP, Chrome **đã đăng nhập của người dùng**) mở trang của bước `research.mjs next`, tự cuộn, tự quyết khi nào dừng, và đọc dữ liệu bằng **một script trích xuất** (`scripts/collect.mjs script`, adapter riêng từng nền tảng trong `scripts/platforms/`) chỉ đọc trang hiện tại rồi trả về ngay; `collect.mjs from-page` tải ảnh và ghi `raw.json`. Claude **nhìn ảnh** để quyết `product_fit` và **sửa adapter** khi script đọc thiếu (mục "Adapter").

**Thứ tự (người dùng, 10/11/2026):**
1. **Trang tham khảo** của thương hiệu (`research.sources[]` trong `project/social.json` của skill): bài mới chưa có trong kho.
2. Hết trang tham khảo mà chưa đủ **mục tiêu** của lượt (`--max-posts N` = mục tiêu bài mới mỗi thương hiệu), hoặc không đặt mục tiêu: **tìm thêm (discovery)** theo `research.discovery.keywords` / `hashtags` (tiếng Anh, thị trường Mỹ) trên các nền tảng bật: Instagram, Pinterest, Facebook (tìm bài + nhóm công khai), Reddit, Etsy, Houzz (chỉ thương hiệu nội thất/nhà). Xoay vòng các nền tảng (mỗi lần một truy vấn của nền tảng ít truy vấn nhất), tới khi đủ mục tiêu hoặc hết truy vấn. Mỗi nền tảng tối đa `max_per_platform` bài giữ mỗi lượt.
3. **Chỉ lấy bài có SẢN PHẨM đúng loại thương hiệu bán** (`research.discovery.product_fit`): `types` (loại sản phẩm, theo project.md mục 5), `must_have`, `must_not`. Bài sai loại bị bỏ **ngay lúc lấy** (không tải ảnh, không lưu; chỉ ghi vào `rejected[]` của raw.json) và lần nữa ở bước lọc. DreamyVows: bảng LED neon theo yêu cầu (chữ, câu, tên, logo, cưới, sự kiện, bar), bảng neon phải có trong ảnh và là chủ thể. GRENHEIM: đồ gỗ tự nhiên (bàn ăn, bàn trà, console live-edge...), không kim loại/nhựa/MDF.

## Một đường duy nhất: mở, cuộn, trích xuất

Research chỉ có **một đường**. Claude tự làm: mở trang (hoặc URL tìm kiếm/hashtag) bằng Playwright MCP, tự cuộn bằng thao tác Playwright MCP bình thường, tự quyết khi nào dừng. Để đọc dữ liệu, Claude gọi **một script trích xuất**: script chỉ đọc những gì đang có trên trang lúc đó và trả về ngay (không mở trang, không cuộn, không chờ).
Mỗi bước `research.mjs next` in: `open` (URL cần mở), `scroll` (cách cuộn), `scroll_wait_seconds` (chờ giữa hai lần cuộn, theo nền tảng: `research.scroll_wait_seconds` trong config; Pinterest/Houzz/Etsy 2-4 giây, Instagram/Facebook 5-10 giây), `script`, `from_page`, `target` (số bài cần), `stop_rules`, `adapter` (`platform`, `status`: `untested` | `ok` | `broken` | `missing`; registry `scripts/platforms/index.mjs`).
1. **Mở** `open` bằng `browser_navigate`.
2. **Trích xuất:** `node scripts/collect.mjs script --brand <id> --for-query|--for-source <id>` in script; dán vào MỘT lần gọi `browser_run_code_unsafe`. Kết quả là MỘT dòng `{total, total_on_page, reason, tag, b64}`; chỉ có các bài **mới** (id đã trả trong bước này nằm ở `<thư mục bước>/seen.json`, script bỏ qua; `--seen <file>` để dùng danh sách khác).
3. **Ghi:** `node scripts/collect.mjs from-page --brand <id> --for-query|--for-source <id> --b64 <cả dòng b64>` (hoặc `--file <result.json>`). Không gõ lại JSON; đọc lại 4 ký tự `tag`. from-page kiểm `total` + checksum + tag, bỏ bài đã có trong kho, tải ảnh, **cộng thêm** vào `raw.json` (nhiều lần trích xuất của cùng bước cộng dồn), trả `added`, `collected`, `extracts_without_new`, `counters` + `summary`, `stop`, `review[]`, `next`. **Một vòng = trích xuất → from-page → nhìn ảnh `review[]` và chạy `collect.mjs fit` ngay → đọc bộ đếm → quyết.**
4. **Cuộn** (phím End hoặc con lăn, 1-2 lần, chờ `scroll_wait_seconds`; Facebook: con lăn chuột 3 lần rồi chờ 3-5 giây, phím End không tải feed), rồi trích xuất lại (bước 2-3).
5. **Dừng** khi: đủ `need` bài **đã giữ sau fit** (`need_more` = 0; `from-page` không báo `target` khi còn `pending_fit`); `poor_source` (đã đọc ≥ 3 × `need`, `research.max_read_factor`, mà vẫn thiếu: nguồn ít bài hợp thương hiệu, chuyển nguồn); 3 lần trích xuất liền không có bài mới; mọi bài đều đã có (`known`); tường đăng nhập / captcha / checkpoint / trang đóng (`reason`) → `result --state blocked|end|known`. Mỗi lần trích xuất, nhìn ảnh `review[].image` (nguồn và truy vấn), ghi `[{ "id", "fit": true, "type": "<một chuỗi trong product_fit.types>", "reason" } | { "id", "fit": false, "reason" }]`, `collect.mjs fit --brand <id> --for-query <qid> --file <f>` (in `read 6 · kept 2 · rejected 4 · need 3 · missing 1`; bộ đếm lưu ở `progress.json` cạnh `raw.json`); `ingest`; `result --state <suggested_state>`.
6. Script **chỉ đọc**: không bấm, không hover, không gõ, không like/lưu/theo dõi/bình luận/nhắn tin/tham gia/đăng/đăng nhập; không ghi token/cookie. Instagram: bài mới còn thiếu ảnh thì đọc trang bài `/p/<code>/` (GET, giới hạn 3 giây).

## Adapter (Claude sửa SELECTORS)
Trích xuất thiếu bài đang thấy trên trang, sai id/ảnh/caption, hoặc 0 bài (`note` bắt đầu bằng `error`):
- `browser_snapshot` / `browser_evaluate` xem DOM (link bài, ảnh, caption, tác giả, ô lưới), tìm selector bền (`href` theo mẫu, `role`, `data-*`) thay vì class sinh tự động.
- Sửa **chỉ khối `SELECTORS`** ở đầu `scripts/platforms/<nền tảng>.mjs` (Facebook: `scripts/fb-extract.mjs`), rồi chạy lại `script` và trích xuất lại trên cùng trang. Chưa có adapter: tạo file theo mẫu `etsy.mjs` (`SELECTORS`, `searchUrl`, `postId`, `toPost`, `pageScript`), đăng ký trong `index.mjs` (`status: 'untested'`).
- Đúng: `status: 'ok'`, `checked: '<YYYY-MM-DD>'` trong `index.mjs`; sửa hàm đọc thì thêm fixture HTML (`tests/fixtures/`). Không sửa được: `status: 'broken'` + `note`.
Adapter viết khi chưa có trình duyệt đều `untested`; lần đầu mỗi nền tảng luôn so `review[]` với trang thật.


## Vòng lặp của agent
```
node scripts/research.mjs browser --brand <id> --state ok        # 1.0 Playwright MCP đã nối Chrome của người dùng (fail → --state fail --note, dừng)
node scripts/research.mjs start --brand <id> [OPTIONS]            # 1.1 mở lượt: trang tham khảo + hàng đợi truy vấn discovery
node scripts/store.mjs known --brand <id>                         # một lần: brand_post_urls / brand_post_ids (bài đã có: không mở, không tải)
lặp:
  node scripts/research.mjs next --brand <id>                     # việc tiếp theo: step reference | discovery | done
  → mở `open` (browser_navigate); lặp: collect.mjs script (ghi extract.js, in đường dẫn) → browser_run_code_unsafe với `filename` (không dán) → collect.mjs from-page --b64 → cuộn (End / con lăn; Facebook: con lăn 3 lần, chờ 3-5 giây), tới khi một stop_rule đúng
  → (discovery) nhìn ảnh, node scripts/collect.mjs fit --brand <id> --for-query <qid> --file <decisions.json>
  → node scripts/research.mjs ingest --brand <id> --source <sid>  |  --query <qid>
  → node scripts/research.mjs result --brand <id> --source <sid> --state end|known|since|limit|blocked|partial
                                                                  |  --query <qid> --state done|limit|empty|blocked|partial [--note ..]
tới khi next trả "done" → 1.3 lọc (store.mjs classify / verdict) → 1.4 report
```
- `next` (mọi bước): `open`, `scroll`, `scroll_wait_seconds`, `script`, `from_page`, `target`, `stop_rules`, `adapter` (`platform`, `status`, `checked`, `note`).
- `next` (reference): `url`, `stop_rule`, `known_file`, `share` (phần của trang trong mục tiêu), `raw_file`, `downloads`.
- `next` (discovery): `platform`, `kind` (keyword/hashtag), `term`, `found_by`, `url` (trang tìm kiếm/hashtag mở sẵn), `share` (tối đa bài mới cho truy vấn này), `platform_notes`, `product_fit`, `raw_file`, `downloads`.
- Mục tiêu đã đủ khi còn trang tham khảo chưa làm: `next` trả `skip: true` kèm lệnh `result --state skipped`.
- `result --query ... --state`: `done` (đã xem hết kết quả hợp trong vài màn hình), `limit` (đủ `share`), `empty` (không có bài hợp), `blocked` (tường đăng nhập/captcha/checkpoint: các truy vấn còn lại của **nền tảng đó** bị bỏ trong lượt này, nền tảng khác vẫn tiếp), `partial` (dừng giữa chừng, cần `--note`).

## Luật chung trên mọi nền tảng
- **Chỉ xem:** mở trang, cuộn, mở bài, đọc. **Không bao giờ** like, thả tim, lưu/save/pin, theo dõi, bình luận, nhắn tin, chia sẻ, tham gia nhóm, đăng hay tải lên gì. Không đăng nhập hộ, không nhập mật khẩu, không lưu cookie. Một trình duyệt = một agent (Chrome đã đăng nhập qua Playwright MCP).
- **Nhịp lịch sự:** chờ giữa hai lần cuộn theo `research.scroll_wait_seconds` (Pinterest/Houzz/Etsy 2-4 giây, Instagram/Facebook 5-10 giây). Cuộn bằng phím End hoặc con lăn (`browser_press_key` End / `browser_run_code_unsafe` running `async (page) => { for (let i=0;i<3;i++){ await page.mouse.wheel(0,900); await page.waitForTimeout(1200);} await page.waitForTimeout(3500); }` (there is no browser_mouse_wheel tool)), 1-2 lần mỗi vòng, rồi trích xuất. Dừng theo `stop_rules` của `next`.
- **Dừng ngay** khi gặp tường đăng nhập, captcha, "checkpoint", "unusual activity", "try again later", trang trống bất thường: `result --state blocked --note "<thấy gì>"`, không thử lại nền tảng đó trong lượt.
- **Đọc gọn:** đọc dữ liệu bằng script trích xuất của bước (một lần gọi, chỉ bài mới); snapshot/screenshot chỉ để nhìn sản phẩm khi cần phán đoán hoặc để sửa selector.
- **Bỏ bài đã có:** link hoặc mã bài nằm trong `brand_post_urls` / `brand_post_ids` (lệnh `store.mjs known`) thì bỏ qua, không mở, không tải.
- **Kiểm sản phẩm TRƯỚC khi tải** (nhìn ảnh): đúng một loại trong `product_fit.types`, đạt `must_have`, không dính `must_not`. Không đạt → ghi `{ post_url, author, reason }` vào `rejected[]`, không tải. Đạt → ghi `product_fit: { "type": "<đúng một chuỗi trong types>", "reason": "<thấy gì>" }`. `ingest` từ chối bài không có `product_fit.type` hợp lệ (ghi `rejected.json`).
- **Mỗi bài cần:** `post_url` (permalink của bài/pin/video/listing, không phải link trang tìm kiếm), `alt_urls` (link khác của cùng bài nếu thấy), `images` (file đã tải, ảnh lớn nhất), `caption` (đầy đủ, nguyên văn), `author` (tên tài khoản/trang/shop), `posted_date` (`YYYY-MM-DD` nếu thấy, không thì trống), `likes` (số nếu hiện, không thì bỏ), `product_fit`.
- **Tải ảnh:** lấy URL ảnh lớn nhất (`img.currentSrc`, phần tử lớn nhất của `srcset`, ảnh ở chế độ xem lớn), tải bằng `curl -L -A "Mozilla/5.0" -e <post_url> -o <downloads>/<n>-<k>.jpg "<url>"`. JPEG/PNG/WebP thật (ingest kiểm chữ ký file). curl bị 403: trong trang chạy `browser_evaluate` `fetch(url).then(r => r.arrayBuffer())` đổi sang base64 rồi ghi file bằng `node -e`. Video/Shorts: ảnh bìa hoặc khung hình rõ sản phẩm (ảnh `poster`/thumbnail). Không chụp màn hình thay ảnh.
- **raw.json** (một file mỗi nguồn/truy vấn, ghi đè được, ingest nhiều đợt không đếm trùng):
  ```json
  { "query": { "id": "instagram-h-customneonsign", "platform": "instagram" }, "platform": "instagram",
    "posts": [
      { "post_url": "https://www.instagram.com/p/AbC123/", "alt_urls": [], "author": "@studio.events",
        "caption": "...", "posted_date": "2026-10-28", "likes": 312, "images": ["raw/1-1.jpg"],
        "product_fit": { "type": "wedding neon sign", "reason": "Better Together sign behind the sweetheart table, clearly the subject" } } ],
    "rejected": [ { "post_url": "https://www.instagram.com/p/XyZ789/", "author": "@x", "reason": "LED strip lights, no sign" } ] }
  ```
  Trang tham khảo dùng `{ "page": { "name", "avatar" }, "posts": [...], "rejected": [...] }` như cũ (thêm `platform`, `author`, `product_fit` khi agent lấy).

## Theo nền tảng
`next` đã đưa sẵn `open`; dưới đây là ghi chú từng trang (link, ảnh, caption, tác giả, dấu hiệu bị chặn) để Claude kiểm kết quả trích xuất và sửa `SELECTORS` của adapter (mục "Adapter"). Selector có thể đổi: không đọc được thì nhìn DOM rồi sửa adapter; không đoán dữ liệu.

### instagram
- Mở: hashtag `instagram.com/explore/tags/<tag>/`, từ khoá `instagram.com/explore/search/keyword/?q=<kw>`. Lưới ô vuông; mỗi ô là `a[href*="/p/"]` hoặc `a[href*="/reel/"]`.
- Đọc lưới một lần: `[...document.querySelectorAll('a[href*="/p/"],a[href*="/reel/"]')].map(a => ({ href: a.href, img: a.querySelector('img')?.currentSrc, alt: a.querySelector('img')?.alt }))` (`alt` thường có mô tả + caption ngắn: lọc nhanh sản phẩm).
- Bài có vẻ hợp: mở link (cùng tab, xong `browser_navigate_back`), đọc caption (`h1` hoặc khối chữ đầu), tên tài khoản (link hồ sơ đầu tiên), ngày (`time[datetime]`), lượt thích nếu hiện; ảnh: `img` lớn nhất trong `article` (album: bấm "Next" từng ảnh, tối đa 4). `/reel/` và `/p/` cùng mã là một bài.
- Dừng: hộp "Log in to continue"/"Sign up" che trang, "Try again later" → blocked.

### pinterest
- Mở: `pinterest.com/search/pins/?q=<kw>` (hashtag: `q=%23tag`). Lưới pin `a[href*="/pin/"]`.
- Đọc lưới: link pin + `img.currentSrc` (thay `/236x/` bằng `/736x/` hoặc `/originals/` cho ảnh lớn) + `alt`.
- Mở pin khi cần: tiêu đề, mô tả, nguồn (link ra web/shop: ghi vào `alt_urls` nếu là bài mạng xã hội), tên người đăng. Nhiều pin là mockup của shop: chỉ giữ ảnh thật hoặc ảnh sản phẩm sạch; ảnh chữ mẫu ("Your Names") vẫn được lấy làm ý nhưng không scene-swap.
- Dừng: popup đăng nhập không đóng được → blocked.

### facebook
- Mở: tìm bài `facebook.com/search/posts/?q=<kw>`, hashtag `facebook.com/hashtag/<tag>`. Nhóm công khai: `facebook.com/search/groups/?q=<kw>` → mở nhóm **công khai** đã thấy bài, đọc tab bài viết; **không bao giờ** bấm Tham gia/Join, không trả lời câu hỏi nhóm.
- Đọc như trang tham khảo (mục "Trang tham khảo" bên dưới): permalink `/posts/`, `/permalink/`, `story_fbid`, `photo/?fbid=` (mọi link của cùng bài vào `alt_urls`), "Xem thêm"/"See more" chỉ trong chữ bài, ảnh `scontent` lớn nhất. Không lấy bình luận.
- Dừng: checkpoint, "Bạn tạm thời bị chặn", form đăng nhập → blocked.

### reddit
- Mở: `reddit.com/search/?q=<kw>&type=posts`. Kết quả `a[href*="/comments/"]`.
- Mở bài có ảnh: tiêu đề + chữ bài (caption), subreddit + tác giả (`u/...`, ghi `author`), điểm upvote (`likes`), ảnh `i.redd.it` / `preview.redd.it` (bỏ tham số để lấy ảnh gốc; gallery: tối đa 4). Ảnh khách tự chụp rất tốt để học bối cảnh thật. Bỏ bài chỉ có chữ.
- Dừng: "You've been blocked by network security", trang xác minh → blocked.

### etsy
- Mở: `etsy.com/search?q=<kw>`. Listing `a[href*="/listing/"]`.
- Đọc: tiêu đề listing (caption), tên shop (`author`), ảnh listing lớn (`il_fullxfull` thay `il_340x270`), số sao/đánh giá nếu hiện (`likes` bỏ trống). Ảnh sản phẩm của đối thủ **cùng loại sản phẩm**: ứng viên scene-swap (khi thương hiệu bật `reference_redraw`), vẫn phải xoá logo/chữ shop. Bỏ quảng cáo "Ad by" nếu lạc loại.
- Dừng: captcha "We need to make sure you're not a robot" → blocked.


### houzz
- Chỉ thương hiệu nội thất/nhà (GRENHEIM). Mở: `houzz.com/photos/query/<kw-gạch-nối>`. Ảnh phòng thật ở Mỹ.
- Đọc: link ảnh (trang `.../phvw-vp~<id>`), tiêu đề/mô tả, tên nhà thiết kế (`author`), ảnh lớn (`img` lớn nhất, thay cỡ trong URL bằng bản lớn). Chỉ giữ khi món đồ gỗ đúng loại là chủ thể của ảnh, không phải chi tiết nhỏ trong phòng.
- Dừng: trang xác minh/captcha → blocked.

## Bản quyền
Bài tìm thêm (discovery) chỉ để **học ý** (bối cảnh, góc chụp, khung caption, cách đặt sản phẩm); ảnh và chữ đối thủ chỉ nằm trong `workspace/` (git bỏ qua), không bao giờ vào bài của thương hiệu. Scene-swap chỉ từ ảnh sản phẩm của đối thủ **cùng loại sản phẩm** thương hiệu làm được (`reference_redraw` bật, `--brand-can-produce`, xoá logo/tên shop, `confirm-clean`); ảnh người dùng thường (Reddit, Instagram cá nhân) không bao giờ scene-swap.

## Lọc sau khi lấy (`store.mjs classify` / `verdict`)
- `classify --brand <id> [--limit 40] [--source <sid>]`: lô bài `new` chưa lọc (id, nguồn, `platform`, `found_by`, `author`, `product_fit` đã ghi lúc lấy, đoạn đầu caption hoặc `(no caption)`, media, đường dẫn thumb), `what_to_take` từng trang tham khảo, `product_fit` của skill (`types`, `must_have`, `must_not`), đường dẫn `project.md` (phạm vi sản phẩm), `rules_of_thumb`, `remaining_after`.
- Agent quyết cả lô trong một lượt (đọc chữ + xem ảnh thumb, **không mở trình duyệt**), ghi `[{ "id", "fit": true|false, "reason" }]`, chạy `verdict --brand <id> --file <file>`. `fit:false` → Removed, ghi chú `filter: <lý do>` (sản phẩm sai loại: lý do bắt đầu bằng `off-brand:`); `fit:true` → giữ. Bài đã rejected bị bỏ qua (`skipped`).
- Luật nhanh: bỏ **sản phẩm không thuộc `product_fit.types`** hoặc dính `must_not` (lần kiểm thứ hai, kể cả bài không có `product_fit`); bỏ **tuyển dụng**; bỏ **cuộc thi / minigame / giveaway**; bỏ **chỉ có chữ** (hoặc ảnh chỉ là chữ, banner khuyến mãi không thấy sản phẩm); bỏ **chia sẻ lại không có ảnh sản phẩm**. Không chắc → giữ (người dùng còn Remove ở app).
- Báo cáo/nhật ký: mỗi trang tham khảo `kept` / `filtered`; trang có ≥ 5 bài đã lọc mà giữ < 30% bị gắn cờ keep rate thấp (xem lại `what_to_take` hoặc thay nguồn). Discovery: mỗi nền tảng và mỗi truy vấn `kept` / `off-brand` (bỏ lúc lấy) / `duplicates`.

## Trang tham khảo (agent, Playwright MCP)
Bước 1 của mọi lượt. `next` trả `step: reference` với `url`, `stop_rule`, `known_file` (`known.json`: `post_urls`, `brand_post_urls`, `brand_post_ids`, `newest_seen`, `oldest_seen`), `share`. Đọc bằng script trích xuất (mục "Một đường duy nhất"); chờ `scroll_wait_seconds` giữa hai lần cuộn. Gặp checkpoint/captcha: `research.mjs result --source <sid> --state blocked --note "<lý do>"`, không mở trang tham khảo Facebook nào nữa trong lượt (trang còn lại `--state skipped`); discovery trên nền tảng khác vẫn theo `next`.

### Lấy một trang tham khảo
1. Mở `url` của source. Trang Facebook: vào tab **Bài viết** (hoặc trang chính, phần bài viết). Nếu nguồn chủ yếu đăng ảnh (album sản phẩm), dùng tab **Ảnh** (`/photos` hoặc `/photos_by`), mở từng ảnh để vào bài.
2. Cuộn xuống dần (mỗi lần một màn hình, nghỉ giữa các lần) cho tới khi đúng `stop_rule`:
   - **hết trang**: cuộn thêm 3 lần liền mà không có bài mới hiện ra (không còn vòng tải thêm) → `--state end`;
   - **tới bài đã có** (lần crawl sau, không `--full`): gặp **3 bài liên tiếp** có link hoặc mã nằm trong `known.json` → `--state known`. Bài ghim đầu trang có thể là bài cũ: bỏ qua, đi tiếp;
   - **tới mốc ngày** (`--since`): tới bài đăng trước ngày đó → `--state since`;
   - **đủ phần của nguồn** (`--max-posts N` là tối đa N bài mới cho cả thương hiệu, chia đều cho các nguồn; phần của nguồn ghi trong `stop_rule`, sau mỗi `ingest` xem `next_source_share`): đã lấy đủ phần → `--state limit`;
   - dừng giữa chừng vì lý do khác (hết thời gian, trang lỗi) → `--state partial --note "<lý do>"`.
   - Lượt `--backfill` không có `--state known` (bài đã có là chỗ phải cuộn qua, không phải chỗ dừng).
3. Script trích xuất đọc cho **mỗi bài** những gì dưới đây; Claude kiểm `review[]` với trang (`[data-ad-rendering-role="story_message"]` là phần chữ của bài):
   - Lấy link bài (`https://www.facebook.com/<trang>/posts/<id>`, `/permalink/...`, hoặc `https://www.facebook.com/photo/?fbid=...`). Nếu link hoặc mã số trong link (fbid, story_fbid, `/posts/<id>`, `pfbid...`) có trong `known.json` (`brand_post_urls`, `brand_post_ids`): **bỏ qua, không mở, không tải**.
   - Bài mới: caption lấy từ phần chữ của bài (không bấm "Xem thêm"; caption bị cắt thì giữ phần thấy được); lưu nguyên văn (U+034F và ký tự ẩn để `ingest` lọc).
   - **Ngày đăng**: đọc nhãn thời gian của bài, ghi `posted_date` dạng `YYYY-MM-DD` (không rõ thì bỏ trống).
   - **Ảnh**: mỗi ảnh của bài, lấy URL `scontent` lớn nhất (mở ảnh ở chế độ xem lớn), tải bằng curl vào `<source>/raw/<n>-<k>.jpg`. Ưu tiên JPEG/PNG; WebP chỉ khi không có cách khác. Không chụp màn hình thay ảnh. Bài video: lấy ảnh bìa.
   - Ghi mọi link khác của cùng bài thấy được (link `photo/?fbid=...` của từng ảnh, permalink) vào `alt_urls`: Facebook hiện một bài dưới nhiều mã, `ingest` dùng các mã này để bỏ trùng.
   - Tên shop (`store`), loại sản phẩm (`main_product`), giá ghi công khai (`price_seen`): tuỳ chọn.
   - **Sản phẩm đúng loại** (mục "Luật chung"): ghi `product_fit` { type, reason }; bài sai loại không tải, chỉ ghi vào `rejected[]`.
4. Ghi `<source>/raw.json` dạng `{ "page": { "name": "<tên trang>", "avatar": "raw/avatar.jpg" }, "posts": [...] }` (có thể ghi và `ingest` nhiều đợt; link đã ingest từ thư mục này được bỏ qua, không tính trùng):
   ```json
   { "page": { "name": "Tên trang", "avatar": "raw/avatar.jpg" }, "posts": [
     { "post_url": "https://www.facebook.com/shop/posts/1234567890",
       "alt_urls": ["https://www.facebook.com/photo/?fbid=1122334455"],
       "posted_date": "2026-10-28",
       "caption": "...",
       "images": ["raw/1-1.jpg", "raw/1-2.jpg"],
       "main_product": "đèn neon Happy Birthday để bàn", "price_seen": "600.000đ", "store": "Tên trang" }
   ] }
   ```
5. `node scripts/research.mjs ingest --brand <id> --source <sid>` rồi `node scripts/research.mjs result --brand <id> --source <sid> --state <...>`.
6. Chạy lại `node scripts/research.mjs next --brand <id>`: trang tham khảo kế tiếp, rồi các truy vấn discovery.

### Backfill: lấy dần các bài cũ hơn của trang tham khảo
Lượt mặc định dừng sau 3 bài đã có, nên các bài **cũ hơn** những gì lần đầu đã crawl (lần đầu dùng `--max-posts` / `--since`, hoặc dừng giữa chừng) không bao giờ được lấy. `node scripts/research.mjs start --brand <id> --backfill [--source <sid>] [--since ..] [--max-posts N]` lấy chúng:
- `workspace/store/<brand>/progress.json`, mỗi nguồn: `newest_seen`, `oldest_seen` (`date`, `post_id`, `post_url`), `reached_end` (đã cuộn tới hết trang một lần), `last_run` (kiểu lượt `new|backfill|full`, cách dừng, `new_on_top`, `backfilled`). Nguồn có `reached_end: true` bị `--backfill` bỏ qua (`run.skipped`, không còn bài cũ hơn); nguồn có `oldest_seen` đã trước `--since` cũng bỏ qua.
- **Cuộn nhanh qua bài đã có** (từ đầu trang tới `oldest_seen`):
  - Không mở bài, không bấm "Xem thêm", không tải ảnh. Chỉ đọc link/mã của các bài đang hiện trên trang và đối chiếu với `known.json` (`post_urls`, `brand_post_urls`, `brand_post_ids`).
  - Đọc link bằng một lần `browser_evaluate` thay vì snapshot từng bài, vd `[...document.querySelectorAll('a[href*="/posts/"],a[href*="/permalink/"],a[href*="fbid="],a[href*="/videos/"]')].map(a => a.href)`; tìm `oldest_seen.post_id` hoặc `oldest_seen.post_url` trong danh sách đó.
  - Mỗi lần cuộn nhiều màn hình (phím End hoặc con lăn), chờ ở cận dưới `scroll_wait_seconds` ( vẫn ngẫu nhiên, không cuộn liên tục). Checkpoint/captcha: dừng như mọi lượt.
  - Đã thấy `oldest_seen` trên trang (hoặc ngày đăng của bài đang hiện đã cũ hơn `oldest_seen.date`): về nhịp thường.
- **Từ sau `oldest_seen`**: làm như crawl thường (mục trên, bước 3-5): bài chưa có trong `known.json` thì mở, lấy caption/ngày/ảnh; bài đã có thì bỏ qua. Lấy tới **hết trang** (`--state end`, ghi `reached_end`), tới mốc `--since` (`--state since`) hoặc đủ `--max-posts` bài (`--state limit`).
- Không thấy được `oldest_seen` (bài đã bị xoá): dùng ngày, lấy từ bài đầu tiên cũ hơn `oldest_seen.date`.
- Báo cáo (`research.mjs report`) theo nguồn: `new_on_top` (bài mới ở đầu trang), `backfilled` (bài cũ hơn lấy thêm), `reached_end_text` (có/chưa) và `older_posts` (còn bài cũ chưa lấy không: chạy `--backfill`).



## Facebook: script trích xuất
Adapter Facebook (`scripts/platforms/facebook.mjs`, đọc bằng `extractFeed` / `extractGrid` của `scripts/fb-extract.mjs`, status `untested`: cần kiểm trên trình duyệt) chỉ đọc: không bấm "Xem thêm", không hover. Mã bài = permalink thật của bài (`/posts/pfbid…`, `story_fbid`, `/permalink/`, mã reel/video) khi DOM có, không thì fbid của ảnh; các fbid ảnh khác là **alias** (ghi vào `alt_urls`), nên kiểm bài đã có khớp cả hai dạng. Bài album: caption lấy từ phần chữ của bài, không lấy chữ của từng ảnh. Ngày: `aria-label` / tooltip của link thời gian, hoặc `abbr`/`time`; không có thì để trống. Tab Ảnh/Reels (`/photos_by`, `/reels`): Claude tự mở tab đó rồi trích xuất như thường.

## Bỏ trùng (tool tự làm khi ingest)
Kho không bao giờ giữ một bài hai lần, trên mọi nguồn **và mọi nền tảng** của thương hiệu:
- cùng link bài (bỏ `www.`/`m.`, tham số theo dõi) hoặc cùng mã bài (kể cả `alt_urls`): mã Facebook; Instagram `/p/` = `/reel/`; mã pin Pinterest, bài Reddit, listing Etsy, ảnh Houzz;
- cùng ảnh: SHA-1 của file, hoặc ảnh gần giống (dHash 256 bit, khác ≤ `research.dedupe.image_distance`, mặc định 20 bit): shop khác đăng lại hay Facebook nén lại vẫn bị bắt. JPEG/PNG đọc được trên Windows (System.Drawing) và macOS (sips); WebP cần ffmpeg (`settings.ffmpeg.command`), không có thì chỉ so SHA-1 (JSON báo `images_without_phash`);
- cùng caption (chữ thường, bỏ ký tự ẩn, emoji, hashtag, link, số điện thoại, dấu câu) hoặc giống ≥ `research.dedupe.caption_similarity` (mặc định 90%), với caption đủ dài (≥ 40 ký tự sau chuẩn hoá).

Bài trùng ghi vào `duplicates.json` (khớp bài nào, luật nào); báo cáo ghi "x bài trùng bỏ qua" theo nguồn.

## Lấy gì, không lấy gì
- Lấy: ảnh bài, caption, ngày đăng, link bài, loại sản phẩm, giá công khai. Chỉ để học ý (loại sản phẩm, bối cảnh, góc chụp, khung bài).
- Không lấy: bình luận, tên/ảnh người bình luận, tin nhắn, thông tin cá nhân.
- Ảnh và caption đối thủ chỉ nằm trong `workspace/` (git bỏ qua), không bao giờ vào bài của thương hiệu (trừ scene-swap opt-in, đã xoá logo/tên shop).

## Bài học
- Facebook chèn U+034F và ký tự zero-width vào caption: luôn qua `ingest`, không dùng caption thô.
- Facebook hiện cùng một bài dưới nhiều mã (bài và từng ảnh): ghi `alt_urls`; `ingest` còn so ảnh và caption.
- Dựng lại cảnh từ ảnh đối thủ vẫn là sản phẩm của họ: bài thật dùng ảnh sản phẩm của thương hiệu.
- Timeline của một số trang (vd ít tương tác) chỉ tải 1-3 bài rồi đứng: tab ảnh bỏ sót reels và bài chữ, nên khi lấy tay phải thử `/posts`, rồi gộp lưới `/photos_by` + `/reels`.
- Mở lại lượt cùng ngày từng ingest lại `raw.json` cũ và đếm thành bài trùng giả: `start` giờ chuyển dữ liệu cũ vào `archive/`, `ingest` bỏ qua link đã ingest.
- Script trích xuất chỉ đọc trang hiện tại nên trả về ngay; việc cuộn và quyết khi nào dừng là của Claude. Selector dễ hỏng khi giao diện đổi: mọi selector gom ở khối `SELECTORS` đầu mỗi adapter, Claude xem DOM, sửa ở đó rồi trích xuất lại.
- Tìm theo từ khoá ra nhiều sản phẩm lạc loại (đèn LED dây, đồ kim loại...): kiểm `product_fit` trước khi tải, không lưu bài sai loại.
