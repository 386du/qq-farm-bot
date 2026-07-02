export {};
export type PlantingStrategy =
  | 'preferred'
  | 'level'
  | 'max_exp'
  | 'max_fert_exp'
  | 'max_profit'
  | 'max_fert_profit'
  | 'bag_priority';

export type BagSeedFallbackStrategy = Exclude<PlantingStrategy, 'bag_priority'>;

export type FertilizerMode = 'both' | 'normal' | 'organic' | 'smart' | 'none';

export type FertilizerLandType = 'purple-gold' | 'gold' | 'black' | 'red' | 'normal';

export interface AutomationConfig {
  farm: boolean;
  farm_push: boolean;
  land_upgrade: boolean;
  friend: boolean;
  friend_help_exp_limit: boolean;
  friend_help_only_guard_dog: boolean;
  friend_steal: boolean;
  friend_help: boolean;
  friend_bad: boolean;
  friend_auto_accept: boolean;
  friend_auto_accept_min_level: number;
  task: boolean;
  fertilizer_gift: boolean;
  fertilizer_buy_organic: boolean;
  fertilizer_buy_normal: boolean;
  sell: boolean;
  fertilizer: FertilizerMode;
  fertilizer_multi_season: boolean;
  fertilizer_land_types: FertilizerLandType[];
  fertilizer_smart_seconds: number;
  skip_own_weed_bug: boolean;
}

export interface IntervalConfig {
  farm: number;
  farmMin: number;
  farmMax: number;
  helpMin: number;
  helpMax: number;
  stealMin: number;
  stealMax: number;
  [key: string]: number;
}

export interface QuietHoursConfig {
  enabled: boolean;
  start: string;
  end: string;
}

export interface AccountConfig {
  automation: AutomationConfig;
  plantingStrategy: PlantingStrategy;
  preferredSeedId: number;
  intervals: IntervalConfig;
  friendQuietHours: QuietHoursConfig;
  knownFriendGids: number[];
  knownFriendGidSyncCooldownSec: number;
  friendsListCacheTtlSec: number;
  friendBlacklist: number[];
  friendGuardDogGids: number[];
  plantBlacklist: number[];
  stealDelaySeconds: number;
  plantOrderRandom: boolean;
  plantDelaySeconds: number;
  fertilizerBuyOrganicCount: number;
  fertilizerBuyOrganicThresholdHours: number;
  fertilizerBuyNormalCount: number;
  fertilizerBuyNormalThresholdHours: number;
  fertilizerBuyCheckIntervalMinutes: number;
  bagSeedPriority: number[];
  bagSeedFallbackStrategy: BagSeedFallbackStrategy;
}

export interface OfflineReminder {
  channel: string;
  reloginUrlMode: 'none' | 'qq_link' | 'qr_link';
  endpoint: string;
  token: string;
  title: string;
  msg: string;
  offlineDeleteSec: number;
}

export interface UIConfig {
  theme: 'light' | 'dark';
}

export interface DeviceInfo {
  os: string;
  clientVersion: string;
  sysSoftware: string;
  network: string;
  memory: string;
  deviceId: string;
  userAgent: string;
}

export interface SystemConfig {
  serverUrl: string;
  clientVersion: string;
  platform: string;
  os: string;
  deviceInfo: DeviceInfo;
}

export interface Announcement {
  content: string;
  showOnce: boolean;
  updatedAt: number;
}

export interface YybOpenIdEntry {
  // 应用宝 OpenID(每个账号独立,来自应用宝一键登录服务)
  openid: string;
  // 该 openid 对应的 API Token(不同 openid 可能来自不同外部 API 账号,token 不通用)
  apiToken: string;
  // 备注名(可选,登录时默认用 openid 末 6 位)
  name?: string;
}

export interface YybConfig {
  enabled: boolean;
  // 接口地址(公共,所有 openid 共享)
  endpoint: string;
  reconnectIntervalMinutes: number;
  autoReconnect: boolean;
  // openid 列表,每个 openid 带自己的 token
  accounts: YybOpenIdEntry[];
}

export interface GlobalConfig {
  accountConfigs: Record<string, AccountConfig>;
  defaultAccountConfig: AccountConfig;
  ui: UIConfig;
  offlineReminder: OfflineReminder;
  userOfflineReminders: Record<string, OfflineReminder>;
  userYybConfigs: Record<string, YybConfig>;
  adminPasswordHash: string;
  announcement: Announcement;
  announcementReadRecords: Record<string, number>;
  systemConfig: SystemConfig | null;
}
