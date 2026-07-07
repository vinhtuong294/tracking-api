const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// Danh sách Proxy US của bạn
const PROXIES = [
    "51.81.76.67:50552:pxdpwv1c9h:dPWV1c9h",
    "51.81.219.188:55541:pxfbvz9d1m:fBVZ9d1M",
    "51.81.179.179:64105:pxfdxl2n8t:fDXL2n8t",
    "185.149.232.124:30862:pxmqpx2i8r:mQpX2i8r",
    "15.204.2.33:47145:pxzmiq8c5c:zMIQ8c5c"
];

// Từ khóa tìm kiếm: "Comfort Colors shirt trend"
const SEARCH_URL = 'https://www.tiktok.com/search/video?q=comfort%20colors%20shirt%20trend';

async function runTest() {
    const proxy = PROXIES[0];
    const [ip, port, username, password] = proxy.split(':');
    const proxyServer = `${ip}:${port}`;

    console.log(`🚀 Bắt đầu quét Trend với Proxy US: ${proxyServer}`);

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true, // Chạy ngầm
            args: [
                `--proxy-server=http://${proxyServer}`,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const page = await browser.newPage();

        // Xác thực Proxy
        await page.authenticate({ username, password });

        console.log(`\n🔍 Đang chuẩn bị đánh chặn gói tin API TikTok US...`);
        console.log(`URL: ${SEARCH_URL}`);
        
        let capturedVideos = [];

        // Lắng nghe và ĐÁNH CHẶN gói tin API trả về từ máy chủ TikTok
        page.on('response', async (response) => {
            const url = response.url();
            // Bắt các gói tin chứa kết quả tìm kiếm hoặc video
            if (url.includes('/api/search/item') || url.includes('/api/search/general') || url.includes('api/explore/item')) {
                try {
                    const data = await response.json();
                    
                    // Xử lý dữ liệu tùy theo cấu trúc JSON mà TikTok trả về
                    if (data && data.item_list) {
                        data.item_list.forEach(item => {
                            capturedVideos.push({
                                url: `https://www.tiktok.com/@${item.author.uniqueId}/video/${item.id}`,
                                desc: item.desc || "Không có mô tả",
                                views: item.stats ? item.stats.playCount : 0,
                                likes: item.stats ? item.stats.diggCount : 0,
                                author: item.author.uniqueId
                            });
                        });
                    } else if (data && data.data) {
                        data.data.forEach(d => {
                            if (d.type === 1 && d.item) {
                                let item = d.item;
                                capturedVideos.push({
                                    url: `https://www.tiktok.com/@${item.author.uniqueId}/video/${item.id}`,
                                    desc: item.desc || "Không có mô tả",
                                    views: item.stats ? item.stats.playCount : 0,
                                    likes: item.stats ? item.stats.diggCount : 0,
                                    author: item.author.uniqueId
                                });
                            }
                        });
                    }
                } catch (e) {
                    // Bỏ qua các lỗi không parse được JSON
                }
            }
        });
        
        // Bắt đầu truy cập trang (Trình duyệt sẽ tự động bắt gói tin)
        await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        
        console.log("⏳ Đang đợi trình duyệt mô phỏng người dùng thật và tóm gọn gói tin...");
        await new Promise(resolve => setTimeout(resolve, 8000));

        // Cuộn chuột xuống một chút để kích hoạt TikTok load thêm dữ liệu
        await page.evaluate(() => window.scrollTo(0, 1000));
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log("\n✅ ĐÃ ĐÁNH CHẶN THÀNH CÔNG DỮ LIỆU TỪ TIKTOK US:");
        if (capturedVideos.length === 0) {
            console.log("⚠️ Không lấy được gói tin API nào. Có thể giao thức đổi, bị Captcha chặn hoàn toàn, hoặc cần thêm Cookie.");
        } else {
            // Lọc bỏ các video trùng lặp
            const uniqueVideos = Array.from(new Set(capturedVideos.map(v => v.url)))
                .map(url => {
                    return capturedVideos.find(v => v.url === url);
                });

            uniqueVideos.slice(0, 10).forEach((v, i) => {
                console.log(`\n[${i+1}] Link: ${v.url}`);
                console.log(`    👤 Tác giả: @${v.author}`);
                console.log(`    👁️ Lượt xem: ${v.views} | ❤️ Tim: ${v.likes}`);
                console.log(`    📝 Mô tả: ${v.desc.substring(0, 100).replace(/\\n/g, ' ')}...`);
            });
        }

    } catch (error) {
        console.error("❌ Xảy ra lỗi trong quá trình quét:", error.message);
    } finally {
        if (browser) {
            console.log("\n🛑 Đóng trình duyệt.");
            await browser.close();
        }
    }
}

runTest();
