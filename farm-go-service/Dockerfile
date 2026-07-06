# --- 阶段 1:构建 ---
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod main.go ./
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/farm-go-service main.go

# --- 阶段 2:运行 ---
FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -S app && adduser -S app -G app
USER app
WORKDIR /app
COPY --from=build /out/farm-go-service /app/farm-go-service
EXPOSE 8060
ENTRYPOINT ["/app/farm-go-service"]
