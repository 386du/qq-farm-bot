export {};
export interface Account {
  id: string;
  name: string;
  code: string;
  platform: string;
  uin: string;
  qq: string;
  avatar: string;
  username: string;
  loginType?: string;
  openid?: string;
  createdAt: number;
  updatedAt: number;
  // 容器启动时是否自动启动该账号
  // - 用户在管理后台点"启动"时会自动设为 true（表示"我希望这个账号一直跑"）
  // - 用户在管理后台点"停止"时会自动设为 false
  // - 用户也可以在账号列表里显式 toggle 这个开关
  // 持久化到 data/accounts.json（容器重建后保留）
  autoStart?: boolean;
  // Go 扫码登录专用：定时刷新 Code 的间隔（分钟），0 = 不刷新
  codeRefreshIntervalMinutes?: number;
}

export interface AccountsData {
  accounts: Account[];
  nextId: number;
}
