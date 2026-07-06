// Farm Go Service
// 把 Gewechat(个人微信扫码)封装成你项目要的 3 个接口:
//   POST /Login/LoginGetQRCar       -> { Success, Data: { Uuid, QrBase64 } }
//   POST /Login/LoginCheckQR?uuid=  -> { Success, Data: { status, acctSectResp{userName,nickName} } }
//   POST /Wxapp/JSLogin             -> { Success, Data: { code } }
//
// 流程:
//   1. LoginGetQRCar  -> 调 Gewechat /gewe/v2/api/login/getLoginQrCode 拿 QR
//   2. LoginCheckQR   -> 调 Gewechat /gewe/v2/api/login/checkLoginQr 拿 wxid
//   3. Wxapp/JSLogin  -> 拿 wxid 转发到下游 JSLogin 服务(同 wxlogin apiBase)换 code
//
// 部署: 见同目录 README.md
package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// ============== 配置 ==============

type Config struct {
	Port       string // 本服务监听端口,默认 8060
	GeweBase   string // Gewechat 服务地址,例如 http://127.0.0.1:2531
	GeweToken  string // Gewechat Token(从 /tools/getTokenId 拿)
	JsLoginAPI string // 下游 JSLogin 服务地址,例如 http://127.0.0.1:8059/api
	AppID      string // 微信小程序 AppID,默认 wx5306c5978fdb76e4
	RegionID   string // Gewechat 地区 ID,默认 320000(江苏)
	DeviceType string // Gewechat 设备类型,默认 mac
	LogPrefix  string // 日志前缀
}

func loadConfig() Config {
	return Config{
		Port:       getenv("PORT", "8060"),
		GeweBase:   strings.TrimRight(getenv("GEWE_BASE", "http://127.0.0.1:2531"), "/"),
		GeweToken:  getenv("GEWE_TOKEN", ""),
		JsLoginAPI: strings.TrimRight(getenv("JSLOGIN_API", ""), "/"),
		AppID:      getenv("APPID", "wx5306c5978fdb76e4"),
		RegionID:   getenv("REGION_ID", "320000"),
		DeviceType: getenv("DEVICE_TYPE", "mac"),
		LogPrefix:  getenv("LOG_PREFIX", "[farm-go]"),
	}
}

func getenv(k, def string) string {
	if v, ok := os.LookupEnv(k); ok && v != "" {
		return v
	}
	return def
}

// ============== Session 管理 ==============

const sessionTTL = 3 * time.Minute

type Session struct {
	UUID      string    // 本服务对外 uuid
	GeweAppID string    // Gewechat 返回的 appId
	GeweUUID  string    // Gewechat 返回的 uuid
	Status    int       // 0=等待扫码 1=已扫码待确认 2=已确认
	WxID      string    // 已确认后写入
	Nickname  string    // 已确认后写入
	CreatedAt time.Time
}

var (
	sessMu      sync.RWMutex
	sessByUUID  = map[string]*Session{}
	byGeweAppID = map[string]string{} // geweAppID -> 本服务 uuid,用于复用同一个 appId
)

func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func putSession(s *Session) {
	sessMu.Lock()
	defer sessMu.Unlock()
	sessByUUID[s.UUID] = s
	if s.GeweAppID != "" {
		byGeweAppID[s.GeweAppID] = s.UUID
	}
}

func getSession(uuid string) (*Session, bool) {
	sessMu.RLock()
	defer sessMu.RUnlock()
	s, ok := sessByUUID[uuid]
	return s, ok
}

func cleanupExpiredSessions() {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for range t.C {
		cutoff := time.Now().Add(-sessionTTL)
		sessMu.Lock()
		for k, s := range sessByUUID {
			if s.CreatedAt.Before(cutoff) {
				delete(sessByUUID, k)
				if s.GeweAppID != "" {
					delete(byGeweAppID, s.GeweAppID)
				}
			}
		}
		sessMu.Unlock()
	}
}

// ============== Gewechat API ==============

type geweTokenResp struct {
	Ret  int    `json:"ret"`
	Msg  string `json:"msg"`
	Data string `json:"data"`
}

type geweGetQRData struct {
	AppID       string `json:"appId"`
	QrData      string `json:"qrData"`
	QrImgBase64 string `json:"qrImgBase64"`
	UUID        string `json:"uuid"`
}

type geweGetQRResp struct {
	Ret  int            `json:"ret"`
	Msg  string         `json:"msg"`
	Data geweGetQRData  `json:"data"`
}

type geweCheckData struct {
	Status       int    `json:"status"` // 1=初始,2=已扫码,3=已确认登录
	UUID         string `json:"uuid"`
	AcctSectResp struct {
		UserName string `json:"userName"`
		NickName string `json:"nickName"`
	} `json:"acctSectResp"`
	ExpiredTime int64 `json:"expiredTime"`
}

type geweCheckResp struct {
	Ret  int           `json:"ret"`
	Msg  string        `json:"msg"`
	Data geweCheckData `json:"data"`
}

func (c Config) geweRequest(method, path string, body interface{}, out interface{}) error {
	url := c.GeweBase + path
	var bodyR io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("序列化请求体失败: %w", err)
		}
		bodyR = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, bodyR)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.GeweToken != "" {
		req.Header.Set("X-GEWE-TOKEN", c.GeweToken)
	}
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("请求 Gewechat 失败: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return fmt.Errorf("Gewechat 返回 HTTP %d: %s", resp.StatusCode, truncate(string(raw), 200))
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("解析 Gewechat 响应失败: %w (raw: %s)", err, truncate(string(raw), 200))
	}
	return nil
}

// 自动获取 Token(若启动时 GEWE_TOKEN 为空)
func autoFetchToken(c *Config) error {
	if c.GeweToken != "" {
		return nil
	}
	var resp geweTokenResp
	if err := c.geweRequest("POST", "/tools/getTokenId", nil, &resp); err != nil {
		return err
	}
	if resp.Ret != 200 || resp.Data == "" {
		return fmt.Errorf("Gewechat getTokenId 失败: ret=%d msg=%s", resp.Ret, resp.Msg)
	}
	c.GeweToken = resp.Data
	log.Printf("%s 自动获取 Gewechat Token 成功: %s...", c.LogPrefix, truncate(c.GeweToken, 12))
	return nil
}

func (c Config) geweGetQR(appID string) (*geweGetQRData, error) {
	body := map[string]interface{}{
		"appId":    appID,
		"type":     c.DeviceType,
		"regionId": c.RegionID,
	}
	var resp geweGetQRResp
	if err := c.geweRequest("POST", "/gewe/v2/api/login/getLoginQrCode", body, &resp); err != nil {
		return nil, err
	}
	if resp.Ret != 200 {
		return nil, fmt.Errorf("Gewechat getLoginQrCode 失败: ret=%d msg=%s", resp.Ret, resp.Msg)
	}
	return &resp.Data, nil
}

func (c Config) geweCheckQR(appID, uuid string) (*geweCheckData, error) {
	body := map[string]string{
		"appId": appID,
		"uuid":  uuid,
	}
	var resp geweCheckResp
	if err := c.geweRequest("POST", "/gewe/v2/api/login/checkLoginQr", body, &resp); err != nil {
		return nil, err
	}
	if resp.Ret != 200 {
		return nil, fmt.Errorf("Gewechat checkLoginQr 失败: ret=%d msg=%s", resp.Ret, resp.Msg)
	}
	return &resp.Data, nil
}

// ============== 对外 API ==============

type APIResp struct {
	Success bool        `json:"Success"`
	Message string      `json:"Message,omitempty"`
	Data    interface{} `json:"Data,omitempty"`
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func handleGetQR(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 1) 调 Gewechat 拿 QR(首次 appId 传空)
		qr, err := cfg.geweGetQR("")
		if err != nil {
			log.Printf("%s [getqr] %v", cfg.LogPrefix, err)
			writeJSON(w, 200, APIResp{Success: false, Message: err.Error()})
			return
		}

		// 2) 提取 base64 主体
		qrBase64 := qr.QrImgBase64
		if i := strings.Index(qrBase64, ","); strings.HasPrefix(qrBase64, "data:") && i > 0 {
			qrBase64 = qrBase64[i+1:]
		}

		// 3) 创建 session
		s := &Session{
			UUID:      newUUID(),
			GeweAppID: qr.AppID,
			GeweUUID:  qr.UUID,
			Status:    0,
			CreatedAt: time.Now(),
		}
		putSession(s)
		log.Printf("%s [getqr] 新 session uuid=%s geweAppId=%s", cfg.LogPrefix, s.UUID, s.GeweAppID)

		writeJSON(w, 200, APIResp{
			Success: true,
			Data: map[string]string{
				"Uuid":     s.UUID,
				"QrBase64": qrBase64,
			},
		})
	}
}

func handleCheckQR(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uuid := r.URL.Query().Get("uuid")
		if uuid == "" {
			writeJSON(w, 200, APIResp{Success: false, Message: "缺少 uuid"})
			return
		}
		s, ok := getSession(uuid)
		if !ok {
			writeJSON(w, 200, APIResp{Success: false, Message: "uuid 不存在或已过期"})
			return
		}

		// 已确认直接返回
		if s.Status == 2 && s.WxID != "" {
			writeJSON(w, 200, APIResp{
				Success: true,
				Data: map[string]interface{}{
					"status": 2,
					"acctSectResp": map[string]string{
						"userName": s.WxID,
						"nickName": s.Nickname,
					},
				},
			})
			return
		}

		// 调 Gewechat 查状态
		geweData, err := cfg.geweCheckQR(s.GeweAppID, s.GeweUUID)
		if err != nil {
			log.Printf("%s [check] uuid=%s err=%v", cfg.LogPrefix, uuid, err)
			// 通道类错误继续返回原 status,不报错
			writeJSON(w, 200, APIResp{
				Success: true,
				Data:    map[string]int{"status": s.Status},
			})
			return
		}
		// 1=初始 2=已扫码 3=已确认
		switch geweData.Status {
		case 2:
			sessMu.Lock()
			s.Status = 1
			sessMu.Unlock()
		case 3:
			sessMu.Lock()
			s.Status = 2
			s.WxID = geweData.AcctSectResp.UserName
			s.Nickname = geweData.AcctSectResp.NickName
			sessMu.Unlock()
			log.Printf("%s [check] uuid=%s 已确认 wxid=%s", cfg.LogPrefix, uuid, s.WxID)
		}

		if s.Status == 2 {
			writeJSON(w, 200, APIResp{
				Success: true,
				Data: map[string]interface{}{
					"status": 2,
					"acctSectResp": map[string]string{
						"userName": s.WxID,
						"nickName": s.Nickname,
					},
				},
			})
			return
		}
		writeJSON(w, 200, APIResp{
			Success: true,
			Data:    map[string]int{"status": s.Status},
		})
	}
}

func handleJSLogin(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if cfg.JsLoginAPI == "" {
			writeJSON(w, 200, APIResp{
				Success: false,
				Message: "未配置 JSLOGIN_API(下游 JSLogin 服务地址)",
			})
			return
		}
		var body struct {
			Wxid  string `json:"Wxid"`
			Appid string `json:"Appid"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, 200, APIResp{Success: false, Message: "请求体解析失败: " + err.Error()})
			return
		}
		if body.Wxid == "" {
			writeJSON(w, 200, APIResp{Success: false, Message: "缺少 Wxid"})
			return
		}
		if body.Appid == "" {
			body.Appid = cfg.AppID
		}

		// 转发到下游 JSLogin 服务
		payload, _ := json.Marshal(map[string]string{
			"Wxid":  body.Wxid,
			"Appid": body.Appid,
		})
		url := cfg.JsLoginAPI + "/Wxapp/JSLogin"
		req, _ := http.NewRequest("POST", url, bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		client := &http.Client{Timeout: 15 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			writeJSON(w, 200, APIResp{Success: false, Message: "调用下游 JSLogin 失败: " + err.Error()})
			return
		}
		defer resp.Body.Close()
		raw, _ := io.ReadAll(resp.Body)

		// 兼容多种返回结构: 大写 Success / 小写 success
		var rawMap map[string]interface{}
		_ = json.Unmarshal(raw, &rawMap)

		code := extractString(rawMap, "code", "Code", "data.code", "Data.code")
		success := extractBool(rawMap, "Success", "success")
		message := extractString(rawMap, "Message", "message", "msg")

		if code != "" && (success || success == false && message == "") {
			writeJSON(w, 200, APIResp{
				Success: true,
				Data:    map[string]string{"code": code},
			})
			return
		}
		if code != "" {
			// success 为 false 但仍有 code,仍然透传(兼容)
			writeJSON(w, 200, APIResp{
				Success: true,
				Data:    map[string]string{"code": code},
			})
			return
		}
		writeJSON(w, 200, APIResp{
			Success: false,
			Message: fmt.Sprintf("下游 JSLogin 未返回 code (resp: %s)", truncate(string(raw), 200)),
		})
	}
}

func handleHealth(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]interface{}{
			"status":   "ok",
			"appid":    cfg.AppID,
			"gewe":     cfg.GeweBase,
			"jsLogin":  cfg.JsLoginAPI,
			"regionId": cfg.RegionID,
			"device":   cfg.DeviceType,
		})
	}
}

// ============== 工具 ==============

func extractString(m map[string]interface{}, keys ...string) string {
	for _, k := range keys {
		if v, ok := getNested(m, k); ok {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
	}
	return ""
}

func extractBool(m map[string]interface{}, keys ...string) bool {
	for _, k := range keys {
		if v, ok := getNested(m, k); ok {
			if b, ok := v.(bool); ok {
				return b
			}
		}
	}
	return false
}

func getNested(m map[string]interface{}, dottedKey string) (interface{}, bool) {
	parts := strings.Split(dottedKey, ".")
	cur := interface{}(m)
	for _, p := range parts {
		mp, ok := cur.(map[string]interface{})
		if !ok {
			return nil, false
		}
		v, ok := mp[p]
		if !ok {
			return nil, false
		}
		cur = v
	}
	return cur, true
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-GEWE-TOKEN, x-proxy-api-key, x-proxy-api-url")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ============== main ==============

func main() {
	cfg := loadConfig()

	// 启动期自动获取 Token
	if err := autoFetchToken(&cfg); err != nil {
		log.Fatalf("%s 自动获取 Token 失败: %v", cfg.LogPrefix, err)
	}

	if cfg.GeweToken == "" {
		log.Fatalf("%s GEWE_TOKEN 未配置且自动获取失败", cfg.LogPrefix)
	}

	if cfg.JsLoginAPI == "" {
		log.Printf("%s 警告: JSLOGIN_API 未配置,/Wxapp/JSLogin 端点将不可用", cfg.LogPrefix)
	}

	go cleanupExpiredSessions()

	mux := http.NewServeMux()
	mux.HandleFunc("/Login/LoginGetQRCar", handleGetQR(cfg))
	mux.HandleFunc("/Login/LoginCheckQR", handleCheckQR(cfg))
	mux.HandleFunc("/Wxapp/JSLogin", handleJSLogin(cfg))
	mux.HandleFunc("/health", handleHealth(cfg))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			writeJSON(w, 200, map[string]string{
				"service": "farm-go-service",
				"docs":    "POST /Login/LoginGetQRCar | POST /Login/LoginCheckQR?uuid= | POST /Wxapp/JSLogin",
			})
			return
		}
		http.NotFound(w, r)
	})

	addr := ":" + cfg.Port
	log.Printf("%s Farm Go Service 启动,监听 %s", cfg.LogPrefix, addr)
	log.Printf("%s   Gewechat: %s", cfg.LogPrefix, cfg.GeweBase)
	log.Printf("%s   JSLogin:  %s", cfg.LogPrefix, cfg.JsLoginAPI)
	log.Printf("%s   AppID:    %s", cfg.LogPrefix, cfg.AppID)
	log.Printf("%s   Region:   %s / Device: %s", cfg.LogPrefix, cfg.RegionID, cfg.DeviceType)

	srv := &http.Server{
		Addr:              addr,
		Handler:           corsMiddleware(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("%s 服务退出: %v", cfg.LogPrefix, err)
	}
}
