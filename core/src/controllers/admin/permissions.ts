export {};

/**
 * 角色与权限系统
 *
 * 角色说明：
 * - admin:    超级管理员，拥有所有权限
 * - operator: 运营人员，可管理卡密/用户/账号/黑名单/公告，但不能改系统配置/备份/清理
 * - viewer:   只读用户，只能查看 dashboard、用户、账号、日志
 * - user:     普通用户，只能访问自己的账号（不进后台）
 */

type Role = 'admin' | 'operator' | 'viewer' | 'user';

const ALL_ROLES: Role[] = ['admin', 'operator', 'viewer', 'user'];

interface RoleDefinition {
  label: string;
  permissions: string[];
}

const ROLE_PERMISSIONS: Record<Role, RoleDefinition> = {
  admin: {
    label: '超级管理员',
    permissions: ['*'],
  },
  operator: {
    label: '运营人员',
    permissions: [
      'dashboard:read',
      'account:read',
      'account:control',
      'card:*',
      'user:read',
      'user:write',
      'log:read',
      'blacklist:*',
      'announcement:*',
      'session:read',
      'session:delete',
    ],
  },
  viewer: {
    label: '只读管理员',
    permissions: [
      'dashboard:read',
      'account:read',
      'user:read',
      'log:read',
      'session:read',
    ],
  },
  user: {
    label: '普通用户',
    permissions: [],
  },
};

function isValidRole(role: string): role is Role {
  return ALL_ROLES.includes(role as Role);
}

function getRoleLabel(role: string): string {
  if (!isValidRole(role)) return role;
  return ROLE_PERMISSIONS[role].label;
}

function getRolePermissions(role: string): string[] {
  if (!isValidRole(role)) return [];
  return ROLE_PERMISSIONS[role].permissions;
}

function hasPermission(role: string, permission: string): boolean {
  if (!isValidRole(role)) return false;
  const perms = getRolePermissions(role);
  if (perms.includes('*')) return true;
  if (perms.includes(permission)) return true;

  // 支持通配符匹配，如 card:* 匹配 card:create
  const prefix = permission.split(':')[0];
  if (perms.includes(`${prefix}:*`)) return true;

  return false;
}

function hasAnyPermission(role: string, permissions: string[]): boolean {
  return permissions.some(p => hasPermission(role, p));
}

function hasAllPermissions(role: string, permissions: string[]): boolean {
  return permissions.every(p => hasPermission(role, p));
}

function getRoles(): { value: Role; label: string }[] {
  return ALL_ROLES.map(role => ({ value: role, label: ROLE_PERMISSIONS[role].label }));
}

module.exports = {
  isValidRole,
  getRoleLabel,
  getRolePermissions,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  getRoles,
  ALL_ROLES,
};
