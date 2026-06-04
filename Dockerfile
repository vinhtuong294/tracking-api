FROM ghcr.io/puppeteer/puppeteer:latest

# Hugging Face yêu cầu chạy ở cổng 7860
ENV PORT=7860
EXPOSE 7860

# Thư mục làm việc (mặc định của image này là /home/pptruser và chạy dưới quyền UID 1000 - cực chuẩn cho Hugging Face)
WORKDIR /home/pptruser/app

# Sao chép package.json và cài đặt thư viện
COPY --chown=pptruser:pptruser package*.json ./
RUN npm install

# Sao chép toàn bộ mã nguồn
COPY --chown=pptruser:pptruser . .

# Lệnh khởi động server
CMD ["node", "server.js"]
