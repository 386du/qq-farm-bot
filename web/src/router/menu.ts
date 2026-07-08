export interface MenuItem {
  path: string
  name: string
  label: string
  icon: string
  component: () => Promise<any>
  adminOnly?: boolean
}

export const menuRoutes: MenuItem[] = [
  {
    path: '',
    name: 'dashboard',
    label: '概览',
    icon: 'i-carbon-home',
    component: () => import('@/views/Dashboard.vue'),
  },
  {
    path: 'personal',
    name: 'personal',
    label: '个人',
    icon: 'i-carbon-wheat',
    component: () => import('@/views/Personal.vue'),
  },
  {
    path: 'mall',
    name: 'mall',
    label: '道具商城',
    icon: 'i-carbon-shop',
    component: () => import('@/views/Mall.vue'),
  },
  {
    path: 'activity',
    name: 'activity',
    label: '荷风游记',
    icon: 'i-carbon-flower',
    component: () => import('@/views/Activity.vue'),
  },
  {
    path: 'friends',
    name: 'friends',
    label: '好友',
    icon: 'i-carbon-user-multiple',
    component: () => import('@/views/Friends.vue'),
  },
  {
    path: 'invite',
    name: 'invite',
    label: '邀请',
    icon: 'i-carbon-gift',
    component: () => import('@/views/Invite.vue'),
  },
  {
    path: 'analytics',
    name: 'analytics',
    label: '分析',
    icon: 'i-carbon-chart-column',
    component: () => import('@/views/Analytics.vue'),
  },
  {
    path: 'settings',
    name: 'Settings',
    label: '设置',
    icon: 'i-carbon-settings',
    component: () => import('@/views/Settings.vue'),
  },
  {
    path: 'config',
    name: 'config',
    label: '游戏配置',
    icon: 'i-carbon-cube',
    component: () => import('@/views/ConfigManage.vue'),
  },
  {
    path: 'admin',
    name: 'admin',
    label: '后台',
    icon: 'i-carbon-security',
    component: () => import('@/views/AdminPanel.vue'),
    adminOnly: true,
  },
]
