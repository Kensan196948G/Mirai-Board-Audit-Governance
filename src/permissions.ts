import type { UserRole } from "./types.ts";

export type Permission =
  | "meeting:view"
  | "meeting:manage"
  | "convocation:create"
  | "attendance:create"
  | "meeting:status"
  | "agenda:view"
  | "agenda:create"
  | "agenda:submit"
  | "agenda:return"
  | "agenda:withdraw"
  | "agenda:resubmit"
  | "conflict:declare"
  | "conflict:determine"
  | "package:fix"
  | "eligibility:view"
  | "opinion:create"
  | "vote:cast"
  | "decision:finalize"
  | "minutes:create"
  | "minutes:sign"
  | "action:manage"
  | "action:confirm"
  | "audit:universe"
  | "audit:risk"
  | "audit:plan"
  | "audit:engagement"
  | "procedure:create"
  | "workpaper:create"
  | "workpaper:review"
  | "workpaper:approve"
  | "finding:create"
  | "finding:finalize"
  | "finding:respond"
  | "finding:retest"
  | "finding:reopen"
  | "notification:ack"
  | "search"
  | "dashboard:view"
  | "export:csv"
  | "evidence:view"
  | "manifest:verify"
  | "retention:manage"
  | "legalhold:manage"
  | "disposal:manage"
  | "ai:use"
  | "auditlog:view"
  | "admin:users"
  | "admin:sod"
  | "admin:requirements"
  | "admin:audit-access"
  | "access:manage"
  | "access:view"
  | "connector:manage";

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  director: [
    "meeting:view",
    "agenda:view",
    "conflict:declare",
    "opinion:create",
    "vote:cast",
    "minutes:sign",
    "action:manage",
    "notification:ack",
    "search",
    "dashboard:view",
    "export:csv",
    "evidence:view",
    "manifest:verify",
    "ai:use",
  ],
  kansa_yaku: [
    "meeting:view",
    "agenda:view",
    "conflict:declare",
    "opinion:create",
    "minutes:sign",
    "notification:ack",
    "search",
    "dashboard:view",
    "export:csv",
    "evidence:view",
    "manifest:verify",
    "auditlog:view",
    "ai:use",
  ],
  secretariat: [
    "meeting:view",
    "meeting:manage",
    "convocation:create",
    "attendance:create",
    "meeting:status",
    "agenda:view",
    "agenda:create",
    "agenda:return",
    "conflict:determine",
    "package:fix",
    "eligibility:view",
    "decision:finalize",
    "minutes:create",
    "minutes:sign",
    "action:manage",
    "action:confirm",
    "notification:ack",
    "search",
    "dashboard:view",
    "export:csv",
    "evidence:view",
    "manifest:verify",
    "retention:manage",
    "legalhold:manage",
    "disposal:manage",
    "ai:use",
    "admin:requirements",
  ],
  internal_auditor: [
    "agenda:view",
    "meeting:view",
    "audit:universe",
    "audit:risk",
    "audit:engagement",
    "procedure:create",
    "workpaper:create",
    "workpaper:review",
    "finding:create",
    "finding:retest",
    "notification:ack",
    "search",
    "dashboard:view",
    "export:csv",
    "evidence:view",
    "manifest:verify",
    "ai:use",
  ],
  internal_audit_manager: [
    "meeting:view",
    "agenda:view",
    "audit:universe",
    "audit:risk",
    "audit:plan",
    "audit:engagement",
    "procedure:create",
    "workpaper:create",
    "workpaper:review",
    "workpaper:approve",
    "finding:create",
    "finding:finalize",
    "finding:retest",
    "finding:reopen",
    "notification:ack",
    "search",
    "dashboard:view",
    "export:csv",
    "evidence:view",
    "manifest:verify",
    "auditlog:view",
    "admin:sod",
    "admin:requirements",
    "access:view",
    "ai:use",
  ],
  business_owner: [
    "meeting:view",
    "agenda:view",
    "agenda:create",
    "agenda:submit",
    "agenda:withdraw",
    "agenda:resubmit",
    "conflict:declare",
    "action:manage",
    "finding:respond",
    "notification:ack",
    "search",
    "dashboard:view",
    "export:csv",
    "evidence:view",
  ],
  legal: [
    "meeting:view",
    "agenda:view",
    "search",
    "dashboard:view",
    "export:csv",
    "evidence:view",
    "manifest:verify",
    "retention:manage",
    "legalhold:manage",
    "admin:requirements",
    "access:view",
    "notification:ack",
  ],
  records: [
    "meeting:view",
    "agenda:view",
    "search",
    "dashboard:view",
    "export:csv",
    "evidence:view",
    "manifest:verify",
    "retention:manage",
    "legalhold:manage",
    "disposal:manage",
    "auditlog:view",
    "admin:requirements",
    "access:view",
    "notification:ack",
  ],
  admin: [
    "meeting:view",
    "meeting:manage",
    "convocation:create",
    "attendance:create",
    "meeting:status",
    "agenda:view",
    "agenda:create",
    "agenda:return",
    "conflict:determine",
    "package:fix",
    "eligibility:view",
    "decision:finalize",
    "minutes:create",
    "minutes:sign",
    "action:manage",
    "action:confirm",
    "audit:universe",
    "audit:risk",
    "audit:plan",
    "audit:engagement",
    "procedure:create",
    "workpaper:create",
    "workpaper:review",
    "workpaper:approve",
    "finding:create",
    "finding:finalize",
    "finding:respond",
    "finding:retest",
    "finding:reopen",
    "notification:ack",
    "search",
    "dashboard:view",
    "export:csv",
    "evidence:view",
    "manifest:verify",
    "retention:manage",
    "legalhold:manage",
    "disposal:manage",
    "ai:use",
    "auditlog:view",
    "admin:users",
    "admin:sod",
    "admin:requirements",
    "admin:audit-access",
    "access:manage",
    "access:view",
    "connector:manage",
  ],
  audit_log_viewer: [
    "agenda:view",
    "meeting:view",
    "search",
    "dashboard:view",
    "evidence:view",
    "manifest:verify",
    "auditlog:view",
    "export:csv",
    "access:view",
    "notification:ack",
  ],
};

export function permissionsFor(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function can(role: UserRole, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

/** 議案・会議体へのアクセスが許されるロール（ABACの基本） */
export const GLOBAL_ACCESS_ROLES: UserRole[] = ["secretariat", "admin", "legal", "records", "kansa_yaku", "internal_audit_manager", "internal_auditor"];

export type CoiControls = {
  view: "allowed" | "blocked";
  deliberate: "allowed" | "blocked";
  vote: "allowed" | "blocked";
  notify: "allowed" | "blocked";
};

export const ALLOW_ALL_CONTROLS: CoiControls = {
  view: "allowed",
  deliberate: "allowed",
  vote: "allowed",
  notify: "allowed",
};

export function parseControls(raw: string | null | undefined): CoiControls {
  if (!raw) return ALLOW_ALL_CONTROLS;
  try {
    const parsed = JSON.parse(raw) as Partial<CoiControls>;
    return {
      view: parsed.view === "blocked" ? "blocked" : "allowed",
      deliberate: parsed.deliberate === "blocked" ? "blocked" : "allowed",
      vote: parsed.vote === "blocked" ? "blocked" : "allowed",
      notify: parsed.notify === "blocked" ? "blocked" : "allowed",
    };
  } catch {
    return ALLOW_ALL_CONTROLS;
  }
}
