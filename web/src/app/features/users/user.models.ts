import { RoleCode } from '../../core/auth/auth.models';

export interface RoleAssignment {
  id: string;
  roleCode: RoleCode;
  roleName: string;
  siteId: string | null;
  siteCode: string | null;
  siteName: string | null;
}

export interface UserListItem {
  id: string;
  fullName: string;
  email: string | null;
  phoneNumber: string;
  isActive: boolean;
  isLockedOut: boolean;
  lastLoginAt: string | null;
  roles: RoleAssignment[];
}

export interface UserDetail extends UserListItem {
  mustChangePassword: boolean;
  lockedOutUntil: string | null;
  createdAt: string;
}

export interface Role {
  id: string;
  code: RoleCode;
  name: string;
  description: string;
  /** 'SiteScoped' roles must name a site; 'Organisation' roles must not. */
  scope: 'SiteScoped' | 'Organisation';
  sortOrder: number;
  permissions: string[];
  /** Active people holding it, counted once each however many sites they cover. */
  userCount: number;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNext: boolean;
}

export interface CreateUserRequest {
  fullName: string;
  phoneNumber: string;
  email: string | null;
  password?: string | null;
  roles?: { roleCode: RoleCode; siteId: string | null }[];
}

export interface CreatedUser {
  user: UserDetail;
  /** Shown exactly once, at creation. It is never retrievable afterwards. */
  temporaryPassword: string | null;
}
