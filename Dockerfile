#=======================================================
# BƯỚC 1: BUILD (Chuẩn bị và cài đặt thư viện)
#=======================================================
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Chỉ copy package.json để cài bộ thư viện
COPY package*.json ./

# Dùng 'npm ci' nhanh hơn và an toàn hơn 'npm install'.
# flag --omit=dev (hoặc --only=production) giúp bỏ qua dependency như nodemon, cdk,...
RUN npm ci --omit=dev

#=======================================================
# BƯỚC 2: RUNNER (Image chạy thực tế gọn nhẹ và bảo mật)
#=======================================================
FROM node:20-alpine

# Thiết lập biến môi trường
ENV NODE_ENV=production
ENV PORT=3000

# Tạo thư mục và thiết lập quyền sở hữu cho user 'node' (non-root) thay vì root
WORKDIR /usr/src/app
RUN chown node:node /usr/src/app

# Chuyển sang user bảo mật hơn
USER node

# Copy lại các thư viện ĐÃ CÀI từ bước builder (giúp giảm dung lượng do không chứa cache của npm)
COPY --chown=node:node --from=builder /usr/src/app/node_modules ./node_modules

# Copy toàn bộ code vào
COPY --chown=node:node . .

EXPOSE $PORT

# TỐI ƯU: Chạy thẳng node thay vì npm start để Docker quản lý Shutdown Signal (SIGTERM) mượt hơn
CMD ["node", "src/index.js"]
