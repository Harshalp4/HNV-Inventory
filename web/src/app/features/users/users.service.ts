import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface PermissionWarning {
  title: string;
  detail: string;
}

export interface SaveRolePermissionsResult {
  roleCode: string;
  permissions: string[];
  /** Allowed, but worth saying out loud — see RolePermissionEndpoints. */
  warnings: PermissionWarning[];
}
import { RoleCode } from '../../core/auth/auth.models';
import { CreatedUser, CreateUserRequest, Paged, Role, UserDetail, UserListItem } from './user.models';

export interface UserFilters {
  q?: string;
  role?: string;
  siteId?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly http = inject(HttpClient);

  list(filters: UserFilters): Observable<Paged<UserListItem>> {
    let params = new HttpParams();
    if (filters.q) params = params.set('q', filters.q);
    if (filters.role) params = params.set('role', filters.role);
    if (filters.siteId) params = params.set('siteId', filters.siteId);
    if (filters.isActive !== undefined) params = params.set('isActive', filters.isActive);
    if (filters.page) params = params.set('page', filters.page);
    if (filters.pageSize) params = params.set('pageSize', filters.pageSize);

    return this.http.get<Paged<UserListItem>>('/api/users', { params });
  }

  get(id: string): Observable<UserDetail> {
    return this.http.get<UserDetail>(`/api/users/${id}`);
  }

  create(request: CreateUserRequest): Observable<CreatedUser> {
    return this.http.post<CreatedUser>('/api/users', request);
  }

  update(id: string, request: { fullName: string; phoneNumber: string; email: string | null }) {
    return this.http.put<UserDetail>(`/api/users/${id}`, request);
  }

  setActive(id: string, active: boolean): Observable<UserDetail> {
    return this.http.post<UserDetail>(`/api/users/${id}/${active ? 'activate' : 'deactivate'}`, {});
  }

  resetPassword(id: string): Observable<{ temporaryPassword: string }> {
    return this.http.post<{ temporaryPassword: string }>(`/api/users/${id}/reset-password`, {});
  }

  addRole(id: string, roleCode: RoleCode, siteId: string | null): Observable<UserDetail> {
    return this.http.post<UserDetail>(`/api/users/${id}/roles`, { roleCode, siteId });
  }

  removeRole(id: string, assignmentId: string): Observable<UserDetail> {
    return this.http.delete<UserDetail>(`/api/users/${id}/roles/${assignmentId}`);
  }

  /** Replaces everything a role may do. Warnings come back with the saved result. */
  saveRolePermissions(code: string, permissions: string[]): Observable<SaveRolePermissionsResult> {
    return this.http.put<SaveRolePermissionsResult>(
      `/api/roles/${code}/permissions`, { permissions });
  }

  resetRolePermissions(code: string): Observable<SaveRolePermissionsResult> {
    return this.http.post<SaveRolePermissionsResult>(
      `/api/roles/${code}/permissions/reset`, {});
  }

  /** Every permission the API understands — used to spot ones the editor cannot show. */
  permissions(): Observable<string[]> {
    return this.http.get<string[]>('/api/permissions');
  }

  roles(): Observable<Role[]> {
    return this.http.get<Role[]>('/api/roles');
  }
}
